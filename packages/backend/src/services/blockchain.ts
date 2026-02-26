import { createPublicClient, createWalletClient, http, fallback, parseAbi, Address, Hex, Chain, encodeAbiParameters, keccak256, PublicClient, WalletClient, Transport } from 'viem';
import { mainnet, arbitrum, base, optimism, polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config, contracts } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { memoryCache, CACHE_KEYS, CACHE_TTL } from './cache.js';
import { V4CompoundorAbi } from '../abis/V4Compoundor.js';
import { V4AutoRangeAbi } from '../abis/V4AutoRange.js';
import { V4UtilsAbi } from '../abis/V4Utils.js';
import { V4AutoExitAbi } from '../abis/V4AutoExit.js';
import { rpcManager, executeBatch } from './rpc-manager.js';

// Chain mapping
const chains: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
  137: polygon,
};

const chain = chains[config.CHAIN_ID] || base;

/**
 * Get public client with circuit breaker and health monitoring
 * Uses the RPC manager for automatic failover and rate limiting
 */
function getClient(): PublicClient {
  return rpcManager.getClient(config.CHAIN_ID);
}

// Export public client getter (for backwards compatibility)
// Note: This now returns a health-aware client that may change on RPC failures
export const publicClient = getClient();

// Wallet client type
type AppWalletClient = WalletClient<Transport, Chain> | null;

// Safely create wallet client - only if valid private key is provided
function createWalletClientSafe(): AppWalletClient {
  const pk = config.PRIVATE_KEY;

  // Check if private key is valid (must be 64 hex chars with optional 0x prefix)
  if (!pk) {
    logger.info('No PRIVATE_KEY provided - wallet client disabled');
    return null;
  }

  const cleanPk = pk.startsWith('0x') ? pk : `0x${pk}`;

  // Validate it's a proper 32-byte hex string
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanPk)) {
    logger.error('Invalid PRIVATE_KEY format - must be 64 hex characters. Wallet client disabled.');
    return null;
  }

  try {
    // Create wallet transport using healthy RPCs from RPC manager
    const { getValidRpcs } = require('../config/rpc.js');
    const rpcs = getValidRpcs(config.CHAIN_ID);
    const walletTransport = rpcs.length > 0
      ? fallback(rpcs.map((rpc: { url: string }) => http(rpc.url, { timeout: 30_000 })), { rank: false })
      : http(config.RPC_URL, { timeout: 30_000 });

    return createWalletClient({
      account: privateKeyToAccount(cleanPk as Hex),
      chain,
      transport: walletTransport,
    }) as AppWalletClient;
  } catch (err) {
    logger.error({ err }, 'Failed to create wallet client');
    return null;
  }
}

export const walletClient: AppWalletClient = createWalletClientSafe();

// Use local ABIs
const V4CompoundorABI = V4CompoundorAbi;
const V4AutoRangeABI = V4AutoRangeAbi;
const V4UtilsABI = V4UtilsAbi;

// Full ABI from compiled contract
const V4AutoExitABI = V4AutoExitAbi;

const V4VaultABI = parseAbi([
  'function isLiquidatable(uint256 tokenId) view returns (bool)',
  'function getHealthFactor(uint256 tokenId) view returns (uint256)',
]);

// StateView ABI for getting current pool tick
const StateViewABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

// Compound functions
export async function checkCompoundProfitable(tokenId: bigint): Promise<{ profitable: boolean; reward: bigint }> {
  // Check cache first
  const cacheKey = CACHE_KEYS.compoundProfitable(tokenId.toString());
  const cached = memoryCache.get<{ profitable: boolean; reward: string }>(cacheKey);
  if (cached) {
    return { profitable: cached.profitable, reward: BigInt(cached.reward) };
  }

  const result = await publicClient.readContract({
    address: contracts.v4Compoundor as Address,
    abi: V4CompoundorABI,
    functionName: 'isCompoundProfitable',
    args: [tokenId],
  }) as [boolean, bigint];

  const value = { profitable: result[0], reward: result[1] };

  // Cache for 60 seconds
  memoryCache.set(cacheKey, { profitable: value.profitable, reward: value.reward.toString() }, CACHE_TTL.COMPOUND_PROFITABLE);

  return value;
}

export async function getPendingFees(tokenId: bigint): Promise<{ amount0: bigint; amount1: bigint }> {
  // Check cache first
  const cacheKey = CACHE_KEYS.pendingFees(tokenId.toString());
  const cached = memoryCache.get<{ amount0: string; amount1: string }>(cacheKey);
  if (cached) {
    return { amount0: BigInt(cached.amount0), amount1: BigInt(cached.amount1) };
  }

  const result = await publicClient.readContract({
    address: contracts.v4Compoundor as Address,
    abi: V4CompoundorABI,
    functionName: 'getPendingFees',
    args: [tokenId],
  }) as [bigint, bigint];

  const value = { amount0: result[0], amount1: result[1] };

  // Cache for 30 seconds
  memoryCache.set(cacheKey, { amount0: value.amount0.toString(), amount1: value.amount1.toString() }, CACHE_TTL.PENDING_FEES);

  return value;
}

export async function executeCompound(tokenId: bigint, swapData: Hex): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  // Deadline: 5 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Compoundor as Address,
    abi: V4CompoundorABI,
    functionName: 'autoCompound',
    args: [tokenId, swapData, deadline],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ tokenId: tokenId.toString(), hash }, 'Compound executed');

  return hash;
}

// Auto-exit functions
export async function checkExit(tokenId: bigint): Promise<{ shouldExit: boolean; reason: number }> {
  // Check cache first
  const cacheKey = `check_exit_${tokenId.toString()}`;
  const cached = memoryCache.get<{ shouldExit: boolean; reason: number }>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoExit as Address,
    abi: V4AutoExitABI,
    functionName: 'checkExit',
    args: [tokenId],
  }) as [boolean, number];

  const value = { shouldExit: result[0], reason: result[1] };

  // Cache for 5 minutes (exit conditions change slowly — tied to tick movement)
  memoryCache.set(cacheKey, value, CACHE_TTL.CHECK_REBALANCE);

  return value;
}

export async function executeExit(tokenId: bigint, swapData: Hex, swapData1: Hex = '0x'): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  // Deadline: 5 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const { request } = await publicClient.simulateContract({
    address: contracts.v4AutoExit as Address,
    abi: V4AutoExitABI,
    functionName: 'executeExit',
    args: [tokenId, swapData, swapData1, deadline],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ tokenId: tokenId.toString(), hash }, 'Exit executed');

  return hash;
}

export async function getExitConfig(tokenId: bigint): Promise<{
  enabled: boolean;
  triggerTickLower: number;
  triggerTickUpper: number;
  exitOnRangeExit: boolean;
  exitToken: string;
  maxSwapSlippage: bigint;
  minExitInterval: number;
}> {
  const result = await publicClient.readContract({
    address: contracts.v4AutoExit as Address,
    abi: V4AutoExitABI,
    functionName: 'getExitConfig',
    args: [tokenId],
  }) as any;

  return {
    enabled: result.enabled,
    triggerTickLower: Number(result.triggerTickLower),
    triggerTickUpper: Number(result.triggerTickUpper),
    exitOnRangeExit: result.exitOnRangeExit,
    exitToken: result.exitToken,
    maxSwapSlippage: BigInt(result.maxSwapSlippage),
    minExitInterval: Number(result.minExitInterval),
  };
}

// Auto-range functions
export async function checkRebalance(tokenId: bigint): Promise<{ needsRebalance: boolean; reason: number }> {
  // Check cache first
  const cacheKey = CACHE_KEYS.checkRebalance(tokenId.toString());
  const cached = memoryCache.get<{ needsRebalance: boolean; reason: number }>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'checkRebalance',
    args: [tokenId],
  }) as [boolean, number];

  const value = { needsRebalance: result[0], reason: result[1] };

  // Cache for 30 seconds
  memoryCache.set(cacheKey, value, CACHE_TTL.CHECK_REBALANCE);

  return value;
}

// Position info type for caching
interface CachedPositionInfo {
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  tickLower: number;
  tickUpper: number;
  liquidity: string; // Store as string for cache serialization
}

// Get position info from V4AutoRange contract (with caching)
export async function getAutoRangePositionInfo(tokenId: bigint): Promise<{
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}> {
  // Check cache first
  const cacheKey = CACHE_KEYS.positionInfo(tokenId.toString());
  const cached = memoryCache.get<CachedPositionInfo>(cacheKey);
  if (cached) {
    return {
      ...cached,
      liquidity: BigInt(cached.liquidity),
    };
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'getPositionInfo',
    args: [tokenId],
  }) as [
    { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string },
    number,
    number,
    bigint
  ];

  const positionInfo = {
    poolKey: result[0],
    tickLower: result[1],
    tickUpper: result[2],
    liquidity: result[3],
  };

  // Cache for 2 minutes (position tick range doesn't change often)
  memoryCache.set(cacheKey, {
    ...positionInfo,
    liquidity: positionInfo.liquidity.toString(),
  }, CACHE_TTL.POSITION_INFO);

  return positionInfo;
}

// Get optimal range for a position (with caching)
export async function calculateOptimalRange(tokenId: bigint): Promise<{ tickLower: number; tickUpper: number }> {
  const cacheKey = `calc_optimal_range_${tokenId.toString()}`;
  const cached = memoryCache.get<{ tickLower: number; tickUpper: number }>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'calculateOptimalRange',
    args: [tokenId],
  }) as [number, number];

  const value = { tickLower: result[0], tickUpper: result[1] };

  // Cache for 5 minutes (depends on current tick, refreshed each bot run)
  memoryCache.set(cacheKey, value, CACHE_TTL.CALCULATE_OPTIMAL_RANGE);

  return value;
}

// Compute poolId from poolKey
function computePoolId(poolKey: {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}): string {
  const encoded = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [
      poolKey.currency0 as Address,
      poolKey.currency1 as Address,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks as Address,
    ]
  );
  return keccak256(encoded);
}

// Get current tick directly from pool via StateView (with caching)
export async function getPoolCurrentTick(poolKey: {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}): Promise<number> {
  const poolId = computePoolId(poolKey);

  // Check cache first
  const cacheKey = CACHE_KEYS.poolTick(poolId);
  const cached = memoryCache.get<number>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const result = await publicClient.readContract({
    address: contracts.stateView as Address,
    abi: StateViewABI,
    functionName: 'getSlot0',
    args: [poolId as `0x${string}`],
  }) as [bigint, number, number, number];

  const tick = result[1];

  // Cache for 30 seconds (also populate slot0 cache for shared data)
  memoryCache.set(cacheKey, tick, CACHE_TTL.POOL_TICK);

  return tick;
}

// Get pool slot0 data including sqrtPriceX96 and tick (with caching)
export async function getPoolSlot0(poolKey: {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}): Promise<{ sqrtPriceX96: bigint; tick: number }> {
  const poolId = computePoolId(poolKey);

  // Check cache first
  const cacheKey = CACHE_KEYS.poolSlot0(poolId);
  const cached = memoryCache.get<{ sqrtPriceX96: string; tick: number }>(cacheKey);
  if (cached) {
    return { sqrtPriceX96: BigInt(cached.sqrtPriceX96), tick: cached.tick };
  }

  const result = await publicClient.readContract({
    address: contracts.stateView as Address,
    abi: StateViewABI,
    functionName: 'getSlot0',
    args: [poolId as `0x${string}`],
  }) as [bigint, number, number, number];

  const value = {
    sqrtPriceX96: result[0],
    tick: result[1],
  };

  // Cache for 30 seconds
  memoryCache.set(cacheKey, { sqrtPriceX96: value.sqrtPriceX96.toString(), tick: value.tick }, CACHE_TTL.POOL_SLOT0);

  // Also update the pool tick cache (shares same underlying data)
  const tickCacheKey = CACHE_KEYS.poolTick(poolId);
  memoryCache.set(tickCacheKey, value.tick, CACHE_TTL.POOL_TICK);

  return value;
}

// Get position status (in range, current tick, ticks) - with caching
export async function getPositionStatus(tokenId: bigint): Promise<{
  inRange: boolean;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
}> {
  // Check cache first
  const cacheKey = CACHE_KEYS.positionStatus(tokenId.toString());
  const cached = memoryCache.get<{ inRange: boolean; currentTick: number; tickLower: number; tickUpper: number }>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'getPositionStatus',
    args: [tokenId],
  }) as [boolean, number, number, number];

  const value = {
    inRange: result[0],
    currentTick: result[1],
    tickLower: result[2],
    tickUpper: result[3],
  };

  // Cache for 30 seconds
  memoryCache.set(cacheKey, value, CACHE_TTL.POSITION_STATUS);

  return value;
}

export async function executeRebalance(tokenId: bigint, swapData: Hex): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  // Deadline: 5 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const { request } = await publicClient.simulateContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'executeRebalance',
    args: [tokenId, swapData, deadline],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ tokenId: tokenId.toString(), hash }, 'Rebalance executed');

  return hash;
}

// Get the position that a given position was rebalanced to (0 if not rebalanced) - with caching
export async function getRebalancedTo(tokenId: bigint): Promise<bigint> {
  // Check cache first (immutable once set, so long TTL is safe)
  const cacheKey = CACHE_KEYS.rebalancedTo(tokenId.toString());
  const cached = memoryCache.get<string>(cacheKey);
  if (cached !== null) {
    return BigInt(cached);
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'rebalancedTo',
    args: [tokenId],
  });

  const value = result as bigint;

  // Cache for 5 minutes (immutable once set, 0 means not yet rebalanced)
  memoryCache.set(cacheKey, value.toString(), CACHE_TTL.REBALANCED_TO);

  return value;
}

// Follow the rebalance chain to get the latest position ID
export async function getLatestPositionInChain(tokenId: bigint): Promise<bigint> {
  let current = tokenId;
  while (true) {
    const next = await getRebalancedTo(current);
    if (next === 0n) return current;
    current = next;
  }
}

// Get last rebalance time for a position (with caching)
export async function getLastRebalanceTime(tokenId: bigint): Promise<number> {
  const cacheKey = `last_rebalance_time_${tokenId.toString()}`;
  const cached = memoryCache.get<number>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const result = await publicClient.readContract({
    address: contracts.v4AutoRange as Address,
    abi: V4AutoRangeABI,
    functionName: 'lastRebalanceTime',
    args: [tokenId],
  });

  const value = Number(result as bigint);

  // Cache for 10 minutes (only changes on rebalance)
  memoryCache.set(cacheKey, value, CACHE_TTL.LAST_REBALANCE_TIME);

  return value;
}

// Export contracts for use in other modules
export { contracts };

// Liquidation functions (V4Vault not yet implemented)
export async function checkLiquidatable(tokenId: bigint): Promise<boolean> {
  if (!contracts.v4Vault) {
    throw new Error('V4Vault contract not deployed');
  }

  return publicClient.readContract({
    address: contracts.v4Vault as Address,
    abi: V4VaultABI,
    functionName: 'isLiquidatable',
    args: [tokenId],
  });
}

export async function getHealthFactor(tokenId: bigint): Promise<bigint> {
  if (!contracts.v4Vault) {
    throw new Error('V4Vault contract not deployed');
  }

  return publicClient.readContract({
    address: contracts.v4Vault as Address,
    abi: V4VaultABI,
    functionName: 'getHealthFactor',
    args: [tokenId],
  });
}

export async function executeLiquidation(tokenId: bigint, repayAmount: bigint, swapData: Hex): Promise<Hex> {
  if (!contracts.v4Vault) {
    throw new Error('V4Vault contract not deployed');
  }
  if (!walletClient) throw new Error('Wallet not configured');

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Vault as Address,
    abi: V4VaultABI,
    functionName: 'liquidate',
    args: [tokenId, repayAmount, swapData],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ tokenId: tokenId.toString(), hash }, 'Liquidation executed');

  return hash;
}

// V4Utils functions
export async function swapAndMint(params: any): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Utils as Address,
    abi: V4UtilsABI,
    functionName: 'swapAndMint',
    args: [params],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ hash }, 'SwapAndMint executed');

  return hash;
}

export async function swapAndIncreaseLiquidity(params: any): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Utils as Address,
    abi: V4UtilsABI,
    functionName: 'swapAndIncreaseLiquidity',
    args: [params],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ hash }, 'SwapAndIncreaseLiquidity executed');

  return hash;
}

export async function decreaseAndSwap(params: any): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Utils as Address,
    abi: V4UtilsABI,
    functionName: 'decreaseAndSwap',
    args: [params],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ hash }, 'DecreaseAndSwap executed');

  return hash;
}

export async function collectAndSwap(params: any): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Utils as Address,
    abi: V4UtilsABI,
    functionName: 'collectAndSwap',
    args: [params],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ hash }, 'CollectAndSwap executed');

  return hash;
}

export async function moveRange(params: any): Promise<Hex> {
  if (!walletClient) throw new Error('Wallet not configured');

  const { request } = await publicClient.simulateContract({
    address: contracts.v4Utils as Address,
    abi: V4UtilsABI,
    functionName: 'moveRange',
    args: [params],
    account: walletClient.account,
  });

  const hash = await walletClient.writeContract(request);
  logger.info({ hash }, 'MoveRange executed');

  return hash;
}

// Get on-chain compound config
export async function getCompoundConfig(tokenId: bigint): Promise<{ enabled: boolean; minCompoundInterval: number; minRewardAmount: bigint }> {
  const result = await publicClient.readContract({
    address: contracts.v4Compoundor as Address,
    abi: V4CompoundorABI,
    functionName: 'configs',
    args: [tokenId],
  }) as [boolean, number, bigint];

  return {
    enabled: result[0],
    minCompoundInterval: result[1],
    minRewardAmount: result[2],
  };
}

// Get on-chain range config (with caching)
export async function getRangeConfig(tokenId: bigint): Promise<{ enabled: boolean; lowerDelta: number; upperDelta: number; rebalanceThreshold: number } | null> {
  // Check cache first
  const cacheKey = CACHE_KEYS.rangeConfig(tokenId.toString());
  const cached = memoryCache.get<{ enabled: boolean; lowerDelta: number; upperDelta: number; rebalanceThreshold: number } | null>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const result = await publicClient.readContract({
      address: contracts.v4AutoRange as Address,
      abi: V4AutoRangeABI,
      functionName: 'rangeConfigs',
      args: [tokenId],
    }) as unknown as [boolean, number, number, number, number, boolean, bigint];

    const value = {
      enabled: result[0],
      lowerDelta: result[1],
      upperDelta: result[2],
      rebalanceThreshold: result[3],
    };

    // Cache for 2 minutes (config rarely changes)
    memoryCache.set(cacheKey, value, CACHE_TTL.RANGE_CONFIG);

    return value;
  } catch {
    return null;
  }
}

// ============ Batch Config Functions (Phase 1 DB Caching) ============

/**
 * Batch read compound configs via multicall.
 * Reads up to 50 configs in 1 RPC call instead of 50 individual calls.
 */
export async function batchGetCompoundConfigs(
  tokenIds: bigint[]
): Promise<Map<string, { enabled: boolean; minCompoundInterval: number; minRewardAmount: bigint }>> {
  const result = new Map<string, { enabled: boolean; minCompoundInterval: number; minRewardAmount: bigint }>();
  if (tokenIds.length === 0) return result;

  try {
    const calls = tokenIds.map(tokenId => ({
      address: contracts.v4Compoundor as Address,
      abi: V4CompoundorABI,
      functionName: 'configs' as const,
      args: [tokenId] as const,
    }));

    const results = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
    });

    for (let i = 0; i < tokenIds.length; i++) {
      const res = results[i];
      if (res.status === 'success' && res.result) {
        const [enabled, minCompoundInterval, minRewardAmount] = res.result as [boolean, number, bigint];
        result.set(tokenIds[i].toString(), { enabled, minCompoundInterval, minRewardAmount });
      }
    }

    logger.debug({ requested: tokenIds.length, found: result.size }, 'Batch read compound configs via multicall');
  } catch (error) {
    logger.error({ error, count: tokenIds.length }, 'Failed to batch read compound configs');
  }

  return result;
}

/**
 * Batch read range configs via multicall.
 */
export async function batchGetRangeConfigs(
  tokenIds: bigint[]
): Promise<Map<string, { enabled: boolean; lowerDelta: number; upperDelta: number; rebalanceThreshold: number }>> {
  const result = new Map<string, { enabled: boolean; lowerDelta: number; upperDelta: number; rebalanceThreshold: number }>();
  if (tokenIds.length === 0) return result;

  try {
    const calls = tokenIds.map(tokenId => ({
      address: contracts.v4AutoRange as Address,
      abi: V4AutoRangeABI,
      functionName: 'rangeConfigs' as const,
      args: [tokenId] as const,
    }));

    const results = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
    });

    for (let i = 0; i < tokenIds.length; i++) {
      const res = results[i];
      if (res.status === 'success' && res.result) {
        const data = res.result as unknown as [boolean, number, number, number, number, boolean, bigint];
        result.set(tokenIds[i].toString(), {
          enabled: data[0],
          lowerDelta: data[1],
          upperDelta: data[2],
          rebalanceThreshold: data[3],
        });
      }
    }

    logger.debug({ requested: tokenIds.length, found: result.size }, 'Batch read range configs via multicall');
  } catch (error) {
    logger.error({ error, count: tokenIds.length }, 'Failed to batch read range configs');
  }

  return result;
}

/**
 * Batch read exit configs via multicall.
 */
export async function batchGetExitConfigs(
  tokenIds: bigint[]
): Promise<Map<string, { enabled: boolean; triggerTickLower: number; triggerTickUpper: number; exitOnRangeExit: boolean; exitToken: string; maxSwapSlippage: bigint; minExitInterval: number }>> {
  const result = new Map<string, { enabled: boolean; triggerTickLower: number; triggerTickUpper: number; exitOnRangeExit: boolean; exitToken: string; maxSwapSlippage: bigint; minExitInterval: number }>();
  if (tokenIds.length === 0) return result;

  try {
    const calls = tokenIds.map(tokenId => ({
      address: contracts.v4AutoExit as Address,
      abi: V4AutoExitABI,
      functionName: 'getExitConfig' as const,
      args: [tokenId] as const,
    }));

    const results = await publicClient.multicall({
      contracts: calls,
      allowFailure: true,
    });

    for (let i = 0; i < tokenIds.length; i++) {
      const res = results[i];
      if (res.status === 'success' && res.result) {
        const data = res.result as any;
        result.set(tokenIds[i].toString(), {
          enabled: data.enabled,
          triggerTickLower: Number(data.triggerTickLower),
          triggerTickUpper: Number(data.triggerTickUpper),
          exitOnRangeExit: data.exitOnRangeExit,
          exitToken: data.exitToken,
          maxSwapSlippage: BigInt(data.maxSwapSlippage),
          minExitInterval: Number(data.minExitInterval),
        });
      }
    }

    logger.debug({ requested: tokenIds.length, found: result.size }, 'Batch read exit configs via multicall');
  } catch (error) {
    logger.error({ error, count: tokenIds.length }, 'Failed to batch read exit configs');
  }

  return result;
}

// Gas estimation (with caching)
export async function getGasPrice(): Promise<bigint> {
  // Check cache first
  const cacheKey = CACHE_KEYS.gasPrice();
  const cached = memoryCache.get<string>(cacheKey);
  if (cached) {
    const gasPrice = BigInt(cached);
    const maxGasPrice = BigInt(config.MAX_GAS_PRICE_GWEI) * BigInt(1e9);
    if (gasPrice > maxGasPrice) {
      throw new Error('Gas price too high');
    }
    return gasPrice;
  }

  const gasPrice = await publicClient.getGasPrice();

  // Cache for 15 seconds
  memoryCache.set(cacheKey, gasPrice.toString(), CACHE_TTL.GAS_PRICE);

  const maxGasPrice = BigInt(config.MAX_GAS_PRICE_GWEI) * BigInt(1e9);

  if (gasPrice > maxGasPrice) {
    logger.warn({ gasPrice: gasPrice.toString(), maxGasPrice: maxGasPrice.toString() }, 'Gas price too high');
    throw new Error('Gas price too high');
  }

  return gasPrice;
}

// ============ PositionManager Functions ============
// Fetch positions directly from chain (not from Ponder)

// Use PositionManager from config (chain-aware)
const POSITION_MANAGER_ADDRESS = contracts.positionManager as Address;

// PositionManager ABI (minimal for reading positions)
// V4 PositionManager uses different function names than V3
const PositionManagerABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  // V4 function: returns just liquidity
  {
    name: 'getPositionLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
  // V4 function: returns PoolKey tuple and PositionInfo (packed uint256)
  // PoolKey: (Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, IHooks hooks)
  // PositionInfo: packed uint256 with poolId (200 bits) | tickUpper (24 bits) | tickLower (24 bits) | hasSubscriber (8 bits)
  {
    name: 'getPoolAndPositionInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
      { name: 'positionInfo', type: 'uint256' },
    ],
  },
] as const;

// Extract Alchemy API key from RPC URL for NFT API calls
function getAlchemyApiKey(): string | null {
  const rpcUrl = config.RPC_URL;
  const match = rpcUrl.match(/alchemy\.com\/v2\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Get chain name for Alchemy API
function getAlchemyChainName(chainId: number = config.CHAIN_ID): string {
  switch (chainId) {
    case 1: return 'eth-mainnet';
    case 42161: return 'arb-mainnet';
    case 8453: return 'base-mainnet';
    case 10: return 'opt-mainnet';
    case 137: return 'polygon-mainnet';
    default: return 'base-mainnet';
  }
}

// PositionManager addresses per chain
const POSITION_MANAGER_BY_CHAIN: Record<number, string> = {
  8453: '0x7C5f5A4bBd8fD63184577525326123B519429bDc', // Base Mainnet
};

function getPositionManagerAddress(chainId: number): string {
  return POSITION_MANAGER_BY_CHAIN[chainId] || POSITION_MANAGER_ADDRESS;
}

export interface OnChainPosition {
  tokenId: string;
  owner: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  poolKey?: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
}

/**
 * Get all position token IDs owned by an address using multiple strategies:
 * 1. Ponder indexed positions - fastest, includes ALL ownership changes (0 RPC calls)
 * 2. Database cache (from position-indexer) - fast (0 RPC calls)
 * 3. Alchemy NFT API - fast
 * 4. RPC event scanning (recent 1000 blocks only) - slowest fallback
 *
 * @param noCache - If true, skip Ponder and DB cache layers for fresh discovery
 */
export async function getPositionTokenIds(ownerAddress: string, chainId: number = config.CHAIN_ID, noCache: boolean = false): Promise<bigint[]> {
  // LAYER 0: Query Ponder's position table first (0 RPC calls)
  // Ponder indexes PositionManager Transfer events for complete ownership tracking
  // Skip if noCache is true (e.g., after rebalance when Ponder may not have new position yet)
  if (!noCache) {
    try {
      const subgraph = await import('./subgraph.js');
      const ponderResult = await subgraph.getPositionsByOwner(ownerAddress);
      if (ponderResult.positions?.items?.length > 0) {
        const tokenIds = ponderResult.positions.items.map((p: { tokenId: string }) => BigInt(p.tokenId));
        logger.info({ owner: ownerAddress, chainId, count: tokenIds.length, source: 'ponder' }, 'Found position token IDs from Ponder');
        return tokenIds;
      }
    } catch (error) {
      logger.debug({ error, owner: ownerAddress }, 'Ponder query failed, trying other methods');
    }
  }

  // LAYER 1: Check database position cache (from position-indexer)
  // This is a backup in case Ponder is not running
  // Skip if noCache is true
  if (!noCache) {
    try {
      const { getPositionCache } = await import('./database.js');
      const dbCache = await getPositionCache(ownerAddress, chainId);
      if (dbCache && dbCache.tokenIds.length > 0) {
        const tokenIds = dbCache.tokenIds.map(id => BigInt(id));
        logger.info({ owner: ownerAddress, chainId, count: tokenIds.length, source: 'database_cache' }, 'Found position token IDs from database cache');
        return tokenIds;
      }
    } catch (error) {
      logger.debug({ error, owner: ownerAddress }, 'Database cache not available, trying other methods');
    }
  }

  const apiKey = getAlchemyApiKey();
  const chainName = getAlchemyChainName(chainId);
  const positionManagerAddr = getPositionManagerAddress(chainId);

  // LAYER 2: If Alchemy API is available, use NFT API for efficiency
  if (apiKey) {
    const url = `https://${chainName}.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner?owner=${ownerAddress}&contractAddresses[]=${positionManagerAddr}&withMetadata=false`;

    // Retry with exponential backoff for rate limits (429)
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        // Handle rate limiting with retry
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
          logger.warn({ owner: ownerAddress, attempt, waitTime }, 'Alchemy NFT API rate limited, retrying...');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          throw new Error(`Alchemy NFT API error: ${response.status}`);
        }

        const data = await response.json() as { ownedNfts: Array<{ tokenId: string }> };
        const tokenIds = data.ownedNfts.map((nft) => BigInt(nft.tokenId));

        logger.info({ owner: ownerAddress, count: tokenIds.length }, 'Found position token IDs from Alchemy NFT API');

        // Save to database cache for next time
        try {
          const { savePositionCache } = await import('./database.js');
          const currentBlock = await publicClient.getBlockNumber();
          await savePositionCache(ownerAddress, chainId, currentBlock.toString(), tokenIds.map(id => id.toString()));
        } catch (e) {
          // Ignore cache save errors
        }

        return tokenIds;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          logger.warn({ error, owner: ownerAddress }, 'Alchemy NFT API failed after retries, falling back to event scanning');
        }
      }
    }
  }

  // LAYER 3: Fallback - Scan ONLY recent Transfer events
  // Only scan last 1000 blocks as a fast fallback, not full history
  // If Ponder and position_cache are properly running, this should rarely be needed
  try {
    // Check memory cache first - positions don't change often
    const cacheKey = `position_tokens_${chainId}_${ownerAddress.toLowerCase()}`;
    const cached = memoryCache.get<bigint[]>(cacheKey);
    if (cached) {
      logger.debug({ owner: ownerAddress, count: cached.length }, 'Position tokens from memory cache');
      return cached;
    }

    const currentBlock = await publicClient.getBlockNumber();

    // Scan recent blocks as a fast fallback
    // Full history scanning should be handled by Ponder or position-indexer
    const RECENT_BLOCKS = BigInt(50000); // ~2 days on Base
    const startBlock = currentBlock > RECENT_BLOCKS ? currentBlock - RECENT_BLOCKS : BigInt(0);

    // Smaller batch size to avoid 413 errors and stay under rate limits
    const BATCH_SIZE = BigInt(500);
    const ownedTokens = new Set<bigint>();

    // Time limit to prevent request timeout (10 seconds max for recent scan)
    const startTime = Date.now();
    const MAX_SCAN_TIME_MS = 10000;

    logger.info({ owner: ownerAddress, startBlock: startBlock.toString(), currentBlock: currentBlock.toString() }, 'Scanning recent blocks for positions (last 1000 blocks only)');

    let lastScannedBlock = startBlock;

    for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += BATCH_SIZE) {
      // Check time limit to prevent request timeout
      if (Date.now() - startTime > MAX_SCAN_TIME_MS) {
        logger.warn({ owner: ownerAddress, scannedBlocks: (fromBlock - startBlock).toString(), found: ownedTokens.size }, 'Scan time limit reached, returning partial results');
        break;
      }

      const toBlock = fromBlock + BATCH_SIZE - BigInt(1) > currentBlock
        ? currentBlock
        : fromBlock + BATCH_SIZE - BigInt(1);

      try {
        // Get Transfer events where 'to' is the owner (mints and receives)
        // Note: RPC fallback uses publicClient which is configured for config.CHAIN_ID
        // This is acceptable since LAYER 0/1/2 are chain-aware
        const transferToLogs = await publicClient.getLogs({
          address: positionManagerAddr as Address,
          event: {
            type: 'event',
            name: 'Transfer',
            inputs: [
              { indexed: true, name: 'from', type: 'address' },
              { indexed: true, name: 'to', type: 'address' },
              { indexed: true, name: 'tokenId', type: 'uint256' },
            ],
          },
          args: {
            to: ownerAddress as Address,
          },
          fromBlock,
          toBlock,
        });

        // Get Transfer events where 'from' is the owner (transfers out and burns)
        const transferFromLogs = await publicClient.getLogs({
          address: positionManagerAddr as Address,
          event: {
            type: 'event',
            name: 'Transfer',
            inputs: [
              { indexed: true, name: 'from', type: 'address' },
              { indexed: true, name: 'to', type: 'address' },
              { indexed: true, name: 'tokenId', type: 'uint256' },
            ],
          },
          args: {
            from: ownerAddress as Address,
          },
          fromBlock,
          toBlock,
        });

        // Add tokens received
        for (const log of transferToLogs) {
          ownedTokens.add(log.args.tokenId as bigint);
        }

        // Remove tokens sent away
        for (const log of transferFromLogs) {
          ownedTokens.delete(log.args.tokenId as bigint);
        }

        lastScannedBlock = toBlock;
      } catch (batchError) {
        logger.warn({ error: batchError, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Batch scan failed, continuing...');
        // Continue with next batch instead of failing completely
      }

      // Add delay between batches to avoid rate limiting
      if (fromBlock + BATCH_SIZE < currentBlock) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const tokenIds = Array.from(ownedTokens);

    // Cache for 5 minutes to avoid re-scanning
    memoryCache.set(cacheKey, tokenIds, 5 * 60 * 1000);

    logger.info({ owner: ownerAddress, count: tokenIds.length, scannedTo: lastScannedBlock.toString(), source: 'recent_scan' }, 'Found position token IDs from recent block scanning');

    // Save to database cache for next time (only if we found something or completed the scan)
    if (tokenIds.length > 0 || lastScannedBlock >= currentBlock - BATCH_SIZE) {
      try {
        const { savePositionCache } = await import('./database.js');
        await savePositionCache(ownerAddress, config.CHAIN_ID, lastScannedBlock.toString(), tokenIds.map(id => id.toString()));
      } catch (e) {
        // Ignore cache save errors
      }
    }

    return tokenIds;
  } catch (error) {
    logger.error({ error, owner: ownerAddress }, 'Failed to get position token IDs');
    return [];
  }
}

/**
 * Parse packed PositionInfo (uint256) from V4 PositionManager
 * Layout: 200 bits poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber
 */
function parsePositionInfo(positionInfo: bigint): { tickLower: number; tickUpper: number; hasSubscriber: boolean } {
  // Extract hasSubscriber (lowest 8 bits)
  const hasSubscriber = (positionInfo & BigInt(0xFF)) !== BigInt(0);

  // Extract tickLower (bits 8-31, sign-extended int24)
  const tickLowerRaw = Number((positionInfo >> BigInt(8)) & BigInt(0xFFFFFF));
  const tickLower = tickLowerRaw >= 0x800000 ? tickLowerRaw - 0x1000000 : tickLowerRaw;

  // Extract tickUpper (bits 32-55, sign-extended int24)
  const tickUpperRaw = Number((positionInfo >> BigInt(32)) & BigInt(0xFFFFFF));
  const tickUpper = tickUpperRaw >= 0x800000 ? tickUpperRaw - 0x1000000 : tickUpperRaw;

  return { tickLower, tickUpper, hasSubscriber };
}

/**
 * Get position info for a specific token ID from V4 PositionManager
 * Uses viem's multicall to batch 3 RPC calls into 1 for 3x efficiency
 */
export async function getPositionInfo(tokenId: bigint): Promise<OnChainPosition | null> {
  try {
    // Use multicall to batch all 3 contract reads into a single RPC call
    // This reduces RPC calls by 3x compared to separate readContract calls
    const results = await publicClient.multicall({
      contracts: [
        {
          address: POSITION_MANAGER_ADDRESS,
          abi: PositionManagerABI,
          functionName: 'ownerOf',
          args: [tokenId],
        },
        {
          address: POSITION_MANAGER_ADDRESS,
          abi: PositionManagerABI,
          functionName: 'getPoolAndPositionInfo',
          args: [tokenId],
        },
        {
          address: POSITION_MANAGER_ADDRESS,
          abi: PositionManagerABI,
          functionName: 'getPositionLiquidity',
          args: [tokenId],
        },
      ],
      allowFailure: false, // Fail fast if any call fails
    });

    const [owner, poolAndPositionInfo, liquidity] = results;

    const [poolKey, positionInfoPacked] = poolAndPositionInfo as [
      { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string },
      bigint
    ];

    // Parse the packed position info
    const { tickLower, tickUpper } = parsePositionInfo(positionInfoPacked);

    // Create poolId from pool key (for display purposes, combine token addresses and fee)
    const poolId = `${poolKey.currency0}-${poolKey.currency1}-${poolKey.fee}`;

    return {
      tokenId: tokenId.toString(),
      owner: (owner as string).toLowerCase(),
      poolId,
      tickLower,
      tickUpper,
      liquidity: (liquidity as bigint).toString(),
      tokensOwed0: '0', // V4 doesn't track tokensOwed in the same way
      tokensOwed1: '0',
      // Add pool key info for enriched data
      poolKey: {
        currency0: poolKey.currency0.toLowerCase(),
        currency1: poolKey.currency1.toLowerCase(),
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks.toLowerCase(),
      },
    } as OnChainPosition;
  } catch (error) {
    logger.error({ error, tokenId: tokenId.toString() }, 'Failed to get position info');
    return null;
  }
}

/**
 * Get position liquidity directly from chain (lightweight check)
 * Used to verify Ponder data is not stale
 */
export async function getPositionLiquidity(tokenId: bigint): Promise<bigint> {
  // Check cache first
  const cacheKey = CACHE_KEYS.positionLiquidity(tokenId.toString());
  const cached = memoryCache.get<string>(cacheKey);
  if (cached !== null) {
    return BigInt(cached);
  }

  try {
    const liquidity = await publicClient.readContract({
      address: POSITION_MANAGER_ADDRESS,
      abi: PositionManagerABI,
      functionName: 'getPositionLiquidity',
      args: [tokenId],
    });
    const value = liquidity as bigint;

    // Cache for 30 seconds
    memoryCache.set(cacheKey, value.toString(), CACHE_TTL.POSITION_LIQUIDITY);

    return value;
  } catch (error) {
    logger.debug({ error, tokenId: tokenId.toString() }, 'Failed to get position liquidity');
    throw error;
  }
}

/**
 * Get all positions for an owner with full info
 * This fetches directly from chain, not from Ponder
 * Uses rate-limited batch execution for optimal RPC usage
 *
 * @param noCache - If true, skip Ponder and DB cache layers for fresh discovery
 */
export async function getPositionsByOwnerOnChain(ownerAddress: string, noCache: boolean = false): Promise<OnChainPosition[]> {
  const tokenIds = await getPositionTokenIds(ownerAddress, config.CHAIN_ID, noCache);

  if (tokenIds.length === 0) {
    return [];
  }

  // Use rate-limited batch execution with controlled concurrency
  const results = await executeBatch(
    tokenIds,
    async (tokenId) => getPositionInfo(tokenId),
    { batchSize: 5, delayBetweenBatches: 200 } // Reduced batch size, added delay
  );

  // Filter out null results
  return results.filter((p): p is OnChainPosition => p !== null);
}

/**
 * Get RPC health statistics for monitoring
 */
export function getRpcHealthStats() {
  return rpcManager.getStats();
}
