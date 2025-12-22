/**
 * Multi-chain blockchain service
 * Uses RPC manager for circuit breaker, rate limiting, and health monitoring
 */

import { PublicClient, parseAbi } from 'viem';
import { getChainConfig, isSupportedChain } from '../config/chains.js';
import { rpcManager, executeBatch } from './rpc-manager.js';
import { logger } from '../utils/logger.js';

const multichainLogger = logger.child({ module: 'multichain' });

// Minimal ABIs for multichain operations
const PositionManagerABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
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
  {
    name: 'getPositionLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint128' }],
  },
] as const;

// Import viem functions at module level (not dynamic import)
import { encodeAbiParameters, keccak256 } from 'viem';

const StateViewABI = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

/**
 * Get a health-aware public client for a specific chain
 * Uses RPC manager with circuit breaker and rate limiting
 */
export function getPublicClient(chainId: number): PublicClient | null {
  if (!isSupportedChain(chainId)) {
    multichainLogger.debug({ chainId }, 'Chain not supported');
    return null;
  }

  try {
    return rpcManager.getClient(chainId);
  } catch (error) {
    multichainLogger.error({ chainId, error }, 'Failed to get client for chain');
    return null;
  }
}

/**
 * Get position info for a token ID on a specific chain
 */
export async function getPositionInfo(chainId: number, tokenId: bigint) {
  const client = getPublicClient(chainId);
  const chainConfig = getChainConfig(chainId);

  if (!client || !chainConfig) {
    throw new Error(`Chain ${chainId} not supported`);
  }

  const [owner, poolAndPositionInfo, liquidity] = await Promise.all([
    client.readContract({
      address: chainConfig.contracts.POSITION_MANAGER,
      abi: PositionManagerABI,
      functionName: 'ownerOf',
      args: [tokenId],
    }),
    client.readContract({
      address: chainConfig.contracts.POSITION_MANAGER,
      abi: PositionManagerABI,
      functionName: 'getPoolAndPositionInfo',
      args: [tokenId],
    }),
    client.readContract({
      address: chainConfig.contracts.POSITION_MANAGER,
      abi: PositionManagerABI,
      functionName: 'getPositionLiquidity',
      args: [tokenId],
    }),
  ]);

  const [poolKey, positionInfoPacked] = poolAndPositionInfo as [
    { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string },
    bigint
  ];

  const { tickLower, tickUpper } = parsePositionInfo(positionInfoPacked);

  return {
    tokenId: tokenId.toString(),
    owner: owner as string,
    poolKey,
    tickLower,
    tickUpper,
    liquidity: (liquidity as bigint).toString(),
  };
}

/**
 * Get current pool tick for a position's pool
 */
export async function getPoolCurrentTick(chainId: number, poolKey: any): Promise<number> {
  const client = getPublicClient(chainId);
  const chainConfig = getChainConfig(chainId);

  if (!client || !chainConfig) {
    throw new Error(`Chain ${chainId} not supported`);
  }

  // Compute poolId using module-level imports (no dynamic import)
  const poolIdBytes = keccak256(
    encodeAbiParameters(
      [
        { type: 'address', name: 'currency0' },
        { type: 'address', name: 'currency1' },
        { type: 'uint24', name: 'fee' },
        { type: 'int24', name: 'tickSpacing' },
        { type: 'address', name: 'hooks' },
      ],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    )
  );

  const slot0 = await client.readContract({
    address: chainConfig.contracts.STATE_VIEW,
    abi: StateViewABI,
    functionName: 'getSlot0',
    args: [poolIdBytes],
  }) as [bigint, number, number, number];

  return slot0[1]; // tick is second element
}

/**
 * Parse packed position info to extract tick bounds
 */
function parsePositionInfo(positionInfo: bigint): { tickLower: number; tickUpper: number; hasSubscriber: boolean } {
  const hasSubscriber = (positionInfo & BigInt(0xFF)) !== BigInt(0);
  const tickLowerRaw = Number((positionInfo >> BigInt(8)) & BigInt(0xFFFFFF));
  const tickLower = tickLowerRaw >= 0x800000 ? tickLowerRaw - 0x1000000 : tickLowerRaw;
  const tickUpperRaw = Number((positionInfo >> BigInt(32)) & BigInt(0xFFFFFF));
  const tickUpper = tickUpperRaw >= 0x800000 ? tickUpperRaw - 0x1000000 : tickUpperRaw;

  return { tickLower, tickUpper, hasSubscriber };
}

/**
 * Fetch all positions for an owner on a specific chain using Alchemy NFT API
 * Uses rate-limited batch execution for optimal RPC usage
 */
export async function fetchPositionsForOwner(chainId: number, ownerAddress: string) {
  const client = getPublicClient(chainId);
  const chainConfig = getChainConfig(chainId);

  if (!client || !chainConfig) {
    multichainLogger.debug({ chainId, ownerAddress }, 'Chain not configured');
    return [];
  }

  // Try Alchemy NFT API first (if RPC URL contains alchemy)
  const alchemyUrl = chainConfig.rpcUrls.find(url => url.includes('alchemy'));
  if (alchemyUrl) {
    const alchemyMatch = alchemyUrl.match(/https:\/\/([^.]+)\.g\.alchemy\.com\/v2\/([^/]+)/);
    if (alchemyMatch) {
      const [, network, apiKey] = alchemyMatch;
      try {
        const nftApiUrl = `https://${network}.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner?owner=${ownerAddress}&contractAddresses[]=${chainConfig.contracts.POSITION_MANAGER}&withMetadata=false`;
        const response = await fetch(nftApiUrl, { signal: AbortSignal.timeout(10000) });

        if (response.ok) {
          const data = await response.json() as { ownedNfts?: Array<{ tokenId: string }> };
          const tokenIds = data.ownedNfts?.map((nft) => nft.tokenId) || [];

          multichainLogger.debug({ chainId, ownerAddress, count: tokenIds.length }, 'Found positions via Alchemy');

          // Use rate-limited batch execution
          const positions = await executeBatch(
            tokenIds,
            async (tokenId: string) => {
              const info = await getPositionInfo(chainId, BigInt(tokenId));
              const currentTick = await getPoolCurrentTick(chainId, info.poolKey);
              const inRange = currentTick >= info.tickLower && currentTick < info.tickUpper;
              return { ...info, currentTick, inRange };
            },
            { batchSize: 5, delayBetweenBatches: 200 }
          );

          return positions.filter(Boolean);
        }
      } catch (e) {
        multichainLogger.warn({ chainId, ownerAddress, error: e }, 'Alchemy NFT API failed');
      }
    }
  }

  // Fallback: Return empty if Alchemy not available
  // Could implement event scanning here if needed
  multichainLogger.debug({ chainId, ownerAddress }, 'No Alchemy API available, returning empty');
  return [];
}

/**
 * Invalidate client cache for a chain (useful when RPCs fail)
 */
export function invalidateChainClient(chainId: number): void {
  rpcManager.invalidateClient(chainId);
}
