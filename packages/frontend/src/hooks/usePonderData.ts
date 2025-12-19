import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient, useChainId } from 'wagmi';
import { encodeAbiParameters, keccak256 } from 'viem';
import { getContracts, CHAIN_IDS } from '@/config/contracts';
import { backendApi, BackendPosition } from '@/lib/backend';

// StateView ABI - for getting current pool tick
const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
] as const;

// V4Compoundor ABI - for checking compound config
const V4_COMPOUNDOR_ABI = [
  {
    name: 'configs',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'enabled', type: 'bool' },
      { name: 'minCompoundInterval', type: 'uint32' },
      { name: 'minRewardAmount', type: 'uint256' },
    ],
  },
] as const;

// V4AutoRange ABI - for checking range config
const V4_AUTO_RANGE_ABI = [
  {
    name: 'rangeConfigs',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'enabled', type: 'bool' },
      { name: 'lowerDelta', type: 'int24' },
      { name: 'upperDelta', type: 'int24' },
      { name: 'rebalanceThreshold', type: 'uint32' },
      { name: 'minRebalanceInterval', type: 'uint32' },
      { name: 'collectFeesOnRebalance', type: 'bool' },
      { name: 'maxSwapSlippage', type: 'uint256' },
    ],
  },
] as const;

// PositionManager ABI - minimal interface for fetching positions
const POSITION_MANAGER_ABI = [
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
  {
    name: 'nextTokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
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
      {
        name: 'positionInfo',
        type: 'uint256',
      },
    ],
  },
  {
    name: 'getPositionLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
] as const;

// Token info mapping per chain (from Uniswap default token list)
const TOKEN_INFO_BY_CHAIN: Record<number, Record<string, { symbol: string; decimals: number }>> = {
  // Base Mainnet tokens - Comprehensive list from Uniswap
  [CHAIN_IDS.BASE]: {
    // Native & Wrapped ETH
    '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18 },
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
    // Stablecoins
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
    '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', decimals: 6 },
    '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': { symbol: 'EURC', decimals: 6 },
    '0x449b3317a6d1efb1bc3ba0700c9eaa4ffff4ae65': { symbol: 'AUDD', decimals: 6 },
    // Coinbase Wrapped Assets
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
    '0xcbd06e5a2b0c65597161de254aa074e489deb510': { symbol: 'cbDOGE', decimals: 8 },
    '0xcb585250f852c6c6bf90434ab21a00f02833a4af': { symbol: 'cbXRP', decimals: 6 },
    '0xcb17c9db87b595717c857a08468793f5bab6445f': { symbol: 'cbLTC', decimals: 8 },
    '0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c': { symbol: 'cbADA', decimals: 6 },
    // LST/LRT tokens
    '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18 },
    '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c': { symbol: 'rETH', decimals: 18 },
    // DeFi Governance Tokens
    '0xc3de830ea07524a0761646a6a4e4be0e114a3c83': { symbol: 'UNI', decimals: 18 },
    '0x9e1028f5f1d5ede59748ffcee5532509976840e0': { symbol: 'COMP', decimals: 18 },
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', decimals: 18 },
    '0xa88594d404727625a9437c3f886c7643872296ae': { symbol: 'WELL', decimals: 18 },
    '0x1c7a460413dd4e964f96d8dfc56e7223ce88cd85': { symbol: 'SEAM', decimals: 18 },
    '0x6985884c4392d348587b19cb9eaaf157f13271cd': { symbol: 'ZRO', decimals: 18 },
    '0x3bb4445d30ac020a84c1b5a8a2c6248ebc9779d0': { symbol: 'ZRX', decimals: 18 },
    '0xab36452dbac151be02b16ca17d8919826072f64a': { symbol: 'RSR', decimals: 18 },
    // Meme & Community Tokens
    '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': { symbol: 'DEGEN', decimals: 18 },
    '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4': { symbol: 'TOSHI', decimals: 18 },
    '0x0555e30da8f98308edb960aa94c0db47230d2b9c': { symbol: 'BRETT', decimals: 18 },
    '0x50da645f148798f68ef2d7db7c1cb22a6819bb2c': { symbol: 'SPX', decimals: 8 },
    '0x2a06a17cbc6d0032cac2c6696da90f29d39a1a29': { symbol: 'BITCOIN', decimals: 8 },
    '0x9a26f5433671751c3276a065f57e5a02d2817973': { symbol: 'KEYCAT', decimals: 18 },
    '0x6921b130d297cc43754afba22e5eac0fbf8db75b': { symbol: 'doginme', decimals: 18 },
    // AI & Tech Tokens
    '0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825': { symbol: 'AIXBT', decimals: 18 },
    '0x98d0baa52b2d063e780de12f615f963fe8537553': { symbol: 'KAITO', decimals: 18 },
    '0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf': { symbol: 'VVV', decimals: 18 },
    '0xc0041ef357b183448b235a8ea73ce4e4ec8c265f': { symbol: 'COOKIE', decimals: 18 },
    '0xb33ff54b9f7242ef1593d2c9bcd8f9df46c77935': { symbol: 'FAI', decimals: 18 },
    '0x30c7235866872213f68cb1f08c37cb9eccb93452': { symbol: 'PROMPT', decimals: 18 },
    // Infrastructure & Protocol Tokens
    '0xb3b32f9f8827d4634fe7d973fa1034ec9fddb3b3': { symbol: 'B3', decimals: 18 },
    '0x1111111111166b7fe7bd91427724b487980afc69': { symbol: 'ZORA', decimals: 18 },
    '0x1bc0c42215582d5a085795f4badabac3ff36d1bcb': { symbol: 'CLANKER', decimals: 18 },
    '0x9d0e8f5b25384c7310cb8c6ae32c8fbeb645d083': { symbol: 'DRV', decimals: 18 },
    '0xed6e000def95780fb89734c07ee2ce9f6dcaf110': { symbol: 'EDGE', decimals: 18 },
    '0xca73ed1815e5915489570014e024b7ebe65de679': { symbol: 'ODOS', decimals: 18 },
    '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b': { symbol: 'BNKR', decimals: 18 },
    '0xfbb75a59193a3525a8825bebe7d4b56899e2f7e1': { symbol: 'RSC', decimals: 18 },
    '0x00000000a22c618fd6b4d7e9a335c4b96b189a38': { symbol: 'TOWNS', decimals: 18 },
    '0xf43eb8de897fbc7f2502483b2bef7bb9ea179229': { symbol: 'ZEN', decimals: 18 },
    '0x4bfaa776991e85e5f8b1255461cbbd216cfc714f': { symbol: 'HOME', decimals: 18 },
    '0x7300b37ddfab110d83290a29dfb31b1740219fe': { symbol: 'MAMO', decimals: 18 },
    '0xc729777d0470f30612b1564fd96e8dd26f5814e3': { symbol: 'SAPIEN', decimals: 18 },
    '0x1b4617734c43f6159f3a70b7e06d883647512778': { symbol: 'AWE', decimals: 18 },
    '0x5ab3d4c385b400f3abb49e80de2faf6a88a7b691': { symbol: 'FLOCK', decimals: 18 },
    '0xef4461891dfb3ac8572ccf7c794664a8dd927945': { symbol: 'WCT', decimals: 18 },
  },
  // Sepolia testnet tokens
  [CHAIN_IDS.SEPOLIA]: {
    '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18 },
    '0x7b79995e5f793a07bc00c21412e50ecae098e7f9': { symbol: 'WETH', decimals: 18 },
    '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': { symbol: 'USDC', decimals: 6 },
    '0x68194a729c2450ad26072b3d33adacbcef39d574': { symbol: 'DAI', decimals: 18 },
  },
};

function getTokenInfo(address: string | undefined, chainId: number): { symbol: string; decimals: number } {
  if (!address) {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
  const chainTokens = TOKEN_INFO_BY_CHAIN[chainId] || TOKEN_INFO_BY_CHAIN[CHAIN_IDS.BASE];
  const info = chainTokens[address.toLowerCase()];
  return info || { symbol: address.slice(0, 6), decimals: 18 };
}

// Compute poolId from poolKey (keccak256 of abi-encoded poolKey)
function computePoolId(poolKey: {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [
      poolKey.currency0 as `0x${string}`,
      poolKey.currency1 as `0x${string}`,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks as `0x${string}`,
    ]
  );
  return keccak256(encoded);
}

// Decode packed PositionInfo to extract tick range
// PositionInfo layout (from LSB): hasSubscriber (8 bits) | tickLower (24 bits) | tickUpper (24 bits) | poolId (200 bits)
// See: v4-periphery/src/libraries/PositionInfoLibrary.sol
function decodePositionInfo(packed: bigint): { tickLower: number; tickUpper: number; hasSubscriber: boolean } {
  const hasSubscriber = Number(packed & 0xffn) !== 0;
  // tickLower is at offset 8 (bits 8-31)
  const tickLowerRaw = Number((packed >> 8n) & 0xffffffn);
  // tickUpper is at offset 32 (bits 32-55)
  const tickUpperRaw = Number((packed >> 32n) & 0xffffffn);

  // Convert from unsigned to signed 24-bit
  const tickLower = tickLowerRaw > 0x7fffff ? tickLowerRaw - 0x1000000 : tickLowerRaw;
  const tickUpper = tickUpperRaw > 0x7fffff ? tickUpperRaw - 0x1000000 : tickUpperRaw;

  return { tickLower, tickUpper, hasSubscriber };
}

// Simple config interfaces for display purposes (subset of full contract configs)
export interface PositionCompoundConfig {
  enabled: boolean;
  minCompoundInterval: number;
  minRewardAmount: string;
}

export interface PositionRangeConfig {
  enabled: boolean;
  lowerDelta: number;
  upperDelta: number;
  rebalanceThreshold: number;
}

export interface Position {
  id: string;
  tokenId: string;
  pool: {
    token0: { symbol: string; address: string; decimals: number };
    token1: { symbol: string; address: string; decimals: number };
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  sqrtPriceX96: string; // Current pool sqrtPriceX96 as string (bigint serialized)
  liquidity: string;
  inRange: boolean;
  compoundConfig?: PositionCompoundConfig;
  rangeConfig?: PositionRangeConfig;
  exitConfig?: { exitType: number };
}

// Transfer event for ERC721 - used to find user's positions efficiently
const TRANSFER_EVENT_ABI = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'tokenId', type: 'uint256', indexed: true },
  ],
} as const;

// Position cache is now stored in PostgreSQL via backend API
// See backendApi.getPositionCache, backendApi.savePositionCache in @/lib/backend

// Start blocks for position scanning (when V4 PositionManager was deployed)
const POSITION_MANAGER_START_BLOCKS: Record<number, bigint> = {
  [CHAIN_IDS.BASE]: 25800000n, // Base mainnet V4 deployment
  [CHAIN_IDS.SEPOLIA]: 7540000n, // Sepolia V4 deployment
};

export function usePositions() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['positions', address, chainId],
    queryFn: async (): Promise<Position[]> => {
      if (!address) {
        console.log('No address connected');
        return [];
      }

      console.log('Fetching positions for:', address, 'on chain:', chainId);

      try {
        // PRIMARY: Use backend API (uses Alchemy NFT API - very fast!)
        console.log('Fetching positions from backend API...');
        const backendPositions = await backendApi.getPositionsByOwner(address);

        if (backendPositions.length > 0 || !publicClient) {
          console.log('Got', backendPositions.length, 'positions from backend API');

          // Transform backend positions to frontend Position format
          const positions = backendPositions
            .filter(p => BigInt(p.liquidity) > 0n) // Filter out empty positions
            .map((bp): Position => {
              const token0Info = getTokenInfo(bp.poolKey?.currency0, chainId);
              const token1Info = getTokenInfo(bp.poolKey?.currency1, chainId);

              return {
                id: bp.tokenId,
                tokenId: bp.tokenId,
                pool: {
                  token0: {
                    symbol: token0Info.symbol,
                    address: bp.poolKey?.currency0 || '',
                    decimals: token0Info.decimals,
                  },
                  token1: {
                    symbol: token1Info.symbol,
                    address: bp.poolKey?.currency1 || '',
                    decimals: token1Info.decimals,
                  },
                  fee: bp.poolKey?.fee || 0,
                  tickSpacing: bp.poolKey?.tickSpacing || 0,
                  hooks: bp.poolKey?.hooks || '0x0000000000000000000000000000000000000000',
                },
                tickLower: bp.tickLower,
                tickUpper: bp.tickUpper,
                currentTick: bp.currentTick,
                sqrtPriceX96: '0', // Not available from backend, but not critical
                liquidity: bp.liquidity,
                inRange: bp.inRange,
                compoundConfig: bp.compoundConfig ? {
                  enabled: bp.compoundConfig.enabled,
                  minCompoundInterval: bp.compoundConfig.minCompoundInterval,
                  minRewardAmount: bp.compoundConfig.minRewardAmount,
                } : undefined,
                rangeConfig: bp.rangeConfig ? {
                  enabled: bp.rangeConfig.enabled,
                  lowerDelta: bp.rangeConfig.lowerDelta,
                  upperDelta: bp.rangeConfig.upperDelta,
                  rebalanceThreshold: bp.rangeConfig.rebalanceThreshold,
                } : undefined,
              };
            });

          return positions.sort((a, b) => Number(b.tokenId) - Number(a.tokenId));
        }

        // FALLBACK: Direct RPC if backend is unavailable
        console.log('Backend unavailable, falling back to direct RPC...');
        return await fetchPositionsDirectRPC(address, chainId, publicClient);
      } catch (error) {
        console.error('Error fetching positions:', error);

        // Try fallback on error
        if (publicClient) {
          console.log('Trying fallback to direct RPC...');
          try {
            return await fetchPositionsDirectRPC(address, chainId, publicClient);
          } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
          }
        }
        return [];
      }
    },
    enabled: !!address,
    staleTime: 30000, // Consider data stale after 30 seconds (faster now!)
    refetchInterval: 60000, // Refetch every 1 minute
  });
}

// Fallback function for direct RPC fetching (when backend is unavailable)
async function fetchPositionsDirectRPC(
  address: string,
  chainId: number,
  publicClient: any
): Promise<Position[]> {
  const CONTRACTS = getContracts(chainId);

  // Use Alchemy NFT API if available (extract from RPC URL)
  const rpcUrl = publicClient.transport?.url || '';
  const alchemyMatch = rpcUrl.match(/alchemy\.com\/v2\/([a-zA-Z0-9_-]+)/);

  if (alchemyMatch) {
    const apiKey = alchemyMatch[1];
    const chainName = chainId === CHAIN_IDS.BASE ? 'base-mainnet' :
                      chainId === CHAIN_IDS.SEPOLIA ? 'eth-sepolia' : 'base-mainnet';

    try {
      console.log('Using Alchemy NFT API for fast position lookup...');
      const url = `https://${chainName}.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner?owner=${address}&contractAddresses[]=${CONTRACTS.POSITION_MANAGER}&withMetadata=false`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json() as { ownedNfts: Array<{ tokenId: string }> };
        const tokenIds = data.ownedNfts.map((nft) => BigInt(nft.tokenId));

        console.log('Found', tokenIds.length, 'positions via Alchemy NFT API');

        // Fetch position details in parallel
        const positions: Position[] = [];
        const batchSize = 10;

        for (let i = 0; i < tokenIds.length; i += batchSize) {
          const batch = tokenIds.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(tokenId => fetchPositionDetails(publicClient, tokenId, CONTRACTS, chainId))
          );

          for (const position of results) {
            if (position) positions.push(position);
          }
        }

        return positions.sort((a, b) => Number(b.tokenId) - Number(a.tokenId));
      }
    } catch (e) {
      console.warn('Alchemy NFT API failed:', e);
    }
  }

  // Last resort: Check NFT balance and scan recent blocks only
  console.log('Using minimal block scan fallback...');
  const balance = await publicClient.readContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: 'balanceOf',
    args: [address],
  });

  if (Number(balance) === 0) return [];

  // Only scan last 500k blocks to avoid timeout
  const currentBlock = await publicClient.getBlockNumber();
  const startBlock = currentBlock - 500000n > 0n ? currentBlock - 500000n : 0n;

  const userTokenIds = new Set<bigint>();
  const chunkSize = 100000n;

  for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize > currentBlock ? currentBlock : fromBlock + chunkSize;

    try {
      const transfersIn = await publicClient.getLogs({
        address: CONTRACTS.POSITION_MANAGER,
        event: TRANSFER_EVENT_ABI,
        args: { to: address },
        fromBlock,
        toBlock,
      });

      for (const log of transfersIn) {
        if (log.args.tokenId) userTokenIds.add(log.args.tokenId);
      }

      const transfersOut = await publicClient.getLogs({
        address: CONTRACTS.POSITION_MANAGER,
        event: TRANSFER_EVENT_ABI,
        args: { from: address },
        fromBlock,
        toBlock,
      });

      for (const log of transfersOut) {
        if (log.args.tokenId) userTokenIds.delete(log.args.tokenId);
      }
    } catch (e) {
      console.warn('Error scanning blocks:', e);
    }
  }

  // Fetch position details
  const positions: Position[] = [];
  for (const tokenId of userTokenIds) {
    try {
      const owner = await publicClient.readContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      });

      if ((owner as string).toLowerCase() === address.toLowerCase()) {
        const position = await fetchPositionDetails(publicClient, tokenId, CONTRACTS, chainId);
        if (position) positions.push(position);
      }
    } catch {
      // Position may have been burned
    }
  }

  return positions.sort((a, b) => Number(b.tokenId) - Number(a.tokenId));
}

async function fetchPositionDetails(
  publicClient: any,
  tokenId: bigint,
  contracts: ReturnType<typeof getContracts>,
  chainId: number
): Promise<Position | null> {
  try {
    // Get pool and position info
    const result = await publicClient.readContract({
      address: contracts.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'getPoolAndPositionInfo',
      args: [tokenId],
    });

    const poolKey = result[0];
    const positionInfo = result[1] as bigint;

    // Validate poolKey has required fields
    if (!poolKey || poolKey.currency0 === undefined || poolKey.currency1 === undefined) {
      console.error(`Position ${tokenId} has invalid poolKey:`, poolKey);
      return null;
    }

    // Get liquidity
    const liquidity = await publicClient.readContract({
      address: contracts.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'getPositionLiquidity',
      args: [tokenId],
    });

    const { tickLower, tickUpper } = decodePositionInfo(positionInfo);

    // Skip positions with 0 liquidity (burned/empty positions from moveRange)
    if (liquidity === 0n) {
      console.log(`Position ${tokenId} has 0 liquidity, skipping`);
      return null;
    }

    // Compute poolId and fetch current tick to determine inRange status
    const poolId = computePoolId({
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: Number(poolKey.fee),
      tickSpacing: Number(poolKey.tickSpacing),
      hooks: poolKey.hooks,
    });

    let currentTick = 0;
    let sqrtPriceX96 = '0';
    let inRange = true;
    try {
      const slot0 = await publicClient.readContract({
        address: contracts.STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });
      sqrtPriceX96 = slot0[0].toString();
      currentTick = Number(slot0[1]);
      inRange = currentTick >= tickLower && currentTick < tickUpper;
      console.log(`Position ${tokenId}: currentTick=${currentTick}, tickLower=${tickLower}, tickUpper=${tickUpper}, inRange=${inRange}`);
    } catch (e) {
      console.warn(`Could not fetch current tick for position ${tokenId}:`, e);
      // Default to in range if we can't fetch tick
    }

    // Fetch compound config from V4Compoundor contract
    let compoundConfig: PositionCompoundConfig | undefined;
    try {
      const compoundResult = await publicClient.readContract({
        address: contracts.V4_COMPOUNDOR,
        abi: V4_COMPOUNDOR_ABI,
        functionName: 'configs',
        args: [tokenId],
      });
      // compoundResult: [enabled: boolean, minCompoundInterval: number, minRewardAmount: bigint]
      if (compoundResult[0]) {
        compoundConfig = {
          enabled: compoundResult[0],
          minCompoundInterval: Number(compoundResult[1]),
          minRewardAmount: compoundResult[2].toString(),
        };
      }
    } catch (e) {
      // Not registered for compounding - this is expected for most positions
    }

    // Fetch range config from V4AutoRange contract
    let rangeConfig: PositionRangeConfig | undefined;
    try {
      const rangeResult = await publicClient.readContract({
        address: contracts.V4_AUTO_RANGE,
        abi: V4_AUTO_RANGE_ABI,
        functionName: 'rangeConfigs',
        args: [tokenId],
      });
      // rangeResult: [enabled: boolean, lowerDelta: number, upperDelta: number, rebalanceThreshold: number]
      if (rangeResult[0]) {
        rangeConfig = {
          enabled: rangeResult[0],
          lowerDelta: Number(rangeResult[1]),
          upperDelta: Number(rangeResult[2]),
          rebalanceThreshold: Number(rangeResult[3]),
        };
      }
    } catch (e) {
      // Not registered for auto-range - this is expected for most positions
    }

    const token0Info = getTokenInfo(poolKey.currency0, chainId);
    const token1Info = getTokenInfo(poolKey.currency1, chainId);

    return {
      id: tokenId.toString(),
      tokenId: tokenId.toString(),
      pool: {
        token0: {
          symbol: token0Info.symbol,
          address: poolKey.currency0,
          decimals: token0Info.decimals,
        },
        token1: {
          symbol: token1Info.symbol,
          address: poolKey.currency1,
          decimals: token1Info.decimals,
        },
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
      tickLower,
      tickUpper,
      currentTick,
      sqrtPriceX96,
      liquidity: liquidity.toString(),
      inRange,
      compoundConfig,
      rangeConfig,
    };
  } catch (e) {
    console.error(`Error fetching position ${tokenId}:`, e);
    return null;
  }
}

export function useProtocolStats() {
  return useQuery({
    queryKey: ['protocolStats'],
    queryFn: async () => {
      // TODO: Implement proper data fetching once Ponder is configured with PostgreSQL
      return {
        totalPositions: 0,
        activePositions: 0,
        totalVolumeUSD: '0',
        totalFeesUSD: '0',
      };
    },
  });
}

// Pool Manager Initialize event ABI
const POOL_MANAGER_ABI = [
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'currency0', type: 'address', indexed: true },
      { name: 'currency1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'hooks', type: 'address', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
] as const;

// Pool data structure
export interface Pool {
  id: string; // poolId (bytes32)
  currency0: string;
  currency1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  tickSpacing: number;
  hooks: string;
  sqrtPriceX96: string;
  tick: number;
  liquidity?: string;
}

// Start blocks for each chain (when V4 was deployed - Jan 31, 2025)
const POOL_MANAGER_START_BLOCKS: Record<number, bigint> = {
  [CHAIN_IDS.BASE]: 25800000n, // Base mainnet V4 deployment (~Jan 30, 2025)
  [CHAIN_IDS.SEPOLIA]: 7540000n, // Sepolia V4 deployment (approximate)
};

// Static list of known V4 pools on Base Mainnet (cached to avoid RPC calls)
// These are popular pools that have been initialized on Uniswap V4
const STATIC_POOLS_BASE: Pool[] = [
  // ETH/USDC pools
  {
    id: '0x1',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    token0Symbol: 'ETH',
    token1Symbol: 'USDC',
    token0Decimals: 18,
    token1Decimals: 6,
    fee: 500,
    tickSpacing: 10,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '1771595571142957166518320255467520', // ~$3500
    tick: 201200,
  },
  {
    id: '0x2',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    token0Symbol: 'ETH',
    token1Symbol: 'USDC',
    token0Decimals: 18,
    token1Decimals: 6,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '1771595571142957166518320255467520',
    tick: 201200,
  },
  // WETH/USDC pools
  {
    id: '0x3',
    currency0: '0x4200000000000000000000000000000000000006',
    currency1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    token0Symbol: 'WETH',
    token1Symbol: 'USDC',
    token0Decimals: 18,
    token1Decimals: 6,
    fee: 500,
    tickSpacing: 10,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '1771595571142957166518320255467520',
    tick: 201200,
  },
  {
    id: '0x4',
    currency0: '0x4200000000000000000000000000000000000006',
    currency1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    token0Symbol: 'WETH',
    token1Symbol: 'USDC',
    token0Decimals: 18,
    token1Decimals: 6,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '1771595571142957166518320255467520',
    tick: 201200,
  },
  // cbBTC/USDC
  {
    id: '0x5',
    currency0: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    currency1: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    token0Symbol: 'USDC',
    token1Symbol: 'cbBTC',
    token0Decimals: 6,
    token1Decimals: 8,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '7922816251426434000000000000',
    tick: -50000,
  },
  // ETH/cbBTC
  {
    id: '0x6',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    token0Symbol: 'ETH',
    token1Symbol: 'cbBTC',
    token0Decimals: 18,
    token1Decimals: 8,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '250541448375047931186413801569280',
    tick: -20000,
  },
  // Stablecoin pools
  {
    id: '0x7',
    currency0: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    currency1: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    token0Symbol: 'USDC',
    token1Symbol: 'USDbC',
    token0Decimals: 6,
    token1Decimals: 6,
    fee: 100,
    tickSpacing: 1,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
  },
  // LST pools
  {
    id: '0x8',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    token0Symbol: 'ETH',
    token1Symbol: 'cbETH',
    token0Decimals: 18,
    token1Decimals: 18,
    fee: 500,
    tickSpacing: 10,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
  },
  {
    id: '0x9',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
    token0Symbol: 'ETH',
    token1Symbol: 'wstETH',
    token0Decimals: 18,
    token1Decimals: 18,
    fee: 500,
    tickSpacing: 10,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
  },
  // DeFi tokens
  {
    id: '0x10',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    token0Symbol: 'ETH',
    token1Symbol: 'AERO',
    token0Decimals: 18,
    token1Decimals: 18,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
  },
  // Meme tokens
  {
    id: '0x11',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
    token0Symbol: 'ETH',
    token1Symbol: 'DEGEN',
    token0Decimals: 18,
    token1Decimals: 18,
    fee: 10000,
    tickSpacing: 200,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
  },
];

// Static pools for Sepolia
const STATIC_POOLS_SEPOLIA: Pool[] = [
  {
    id: '0x1',
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    token0Symbol: 'ETH',
    token1Symbol: 'USDC',
    token0Decimals: 18,
    token1Decimals: 6,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
    sqrtPriceX96: '1771595571142957166518320255467520',
    tick: 201200,
  },
];

/**
 * Hook to get available V4 pools
 * Uses a static list of popular pools to avoid excessive RPC calls
 * These are the most commonly used pools on Uniswap V4
 */
export function usePools() {
  const chainId = useChainId();

  return useQuery({
    queryKey: ['pools', chainId],
    queryFn: async (): Promise<Pool[]> => {
      // Return static pools based on chain
      if (chainId === CHAIN_IDS.BASE) {
        return STATIC_POOLS_BASE;
      } else if (chainId === CHAIN_IDS.SEPOLIA) {
        return STATIC_POOLS_SEPOLIA;
      }
      return [];
    },
    staleTime: Infinity, // Static data never goes stale
  });
}

/**
 * Hook to get pool liquidity from StateView
 */
export function usePoolLiquidity(poolId: string | undefined) {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const CONTRACTS = getContracts(chainId);

  return useQuery({
    queryKey: ['poolLiquidity', poolId, chainId],
    queryFn: async () => {
      if (!publicClient || !poolId) return null;

      try {
        const slot0 = await publicClient.readContract({
          address: CONTRACTS.STATE_VIEW,
          abi: STATE_VIEW_ABI,
          functionName: 'getSlot0',
          args: [poolId as `0x${string}`],
        });

        return {
          sqrtPriceX96: slot0[0].toString(),
          tick: Number(slot0[1]),
          protocolFee: Number(slot0[2]),
          lpFee: Number(slot0[3]),
        };
      } catch (e) {
        console.error('Error fetching pool liquidity:', e);
        return null;
      }
    },
    enabled: !!publicClient && !!poolId && publicClient.chain?.id === chainId,
    staleTime: 30000,
  });
}
