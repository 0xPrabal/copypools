/**
 * Multi-chain blockchain service
 * Creates and caches viem clients per chain on demand
 */

import { createPublicClient, http, fallback, PublicClient, Chain, parseAbi } from 'viem';
import { base, sepolia } from 'viem/chains';
import { getChainConfig, isSupportedChain, type SupportedChainId } from '../config/chains.js';

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

const StateViewABI = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

// Chain definitions
const CHAIN_DEFINITIONS: Record<SupportedChainId, Chain> = {
  8453: base,
  11155111: sepolia,
};

// Cache for public clients per chain
const clientCache = new Map<number, PublicClient>();

/**
 * Get or create a public client for a specific chain
 */
export function getPublicClient(chainId: number): PublicClient | null {
  if (!isSupportedChain(chainId)) {
    return null;
  }

  // Return cached client if available
  if (clientCache.has(chainId)) {
    return clientCache.get(chainId)!;
  }

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig || chainConfig.rpcUrls.length === 0) {
    return null;
  }

  // Create fallback transport with multiple RPCs
  const transport = fallback(
    chainConfig.rpcUrls.map((url) => http(url, { timeout: 30_000, retryCount: 2 })),
    { rank: true }
  );

  // Create and cache the client
  const client = createPublicClient({
    chain: CHAIN_DEFINITIONS[chainId as SupportedChainId],
    transport,
  });

  clientCache.set(chainId, client);
  return client;
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

  // Compute poolId
  const { encodeAbiParameters, keccak256 } = await import('viem');
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
 */
export async function fetchPositionsForOwner(chainId: number, ownerAddress: string) {
  const client = getPublicClient(chainId);
  const chainConfig = getChainConfig(chainId);

  if (!client || !chainConfig) {
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
        const response = await fetch(nftApiUrl);
        if (response.ok) {
          const data = await response.json() as { ownedNfts?: Array<{ tokenId: string }> };
          const tokenIds = data.ownedNfts?.map((nft) => nft.tokenId) || [];

          // Fetch position details for each token
          const positions = await Promise.all(
            tokenIds.map(async (tokenId: string) => {
              try {
                const info = await getPositionInfo(chainId, BigInt(tokenId));
                const currentTick = await getPoolCurrentTick(chainId, info.poolKey);
                const inRange = currentTick >= info.tickLower && currentTick < info.tickUpper;
                return { ...info, currentTick, inRange };
              } catch {
                return null;
              }
            })
          );

          return positions.filter(Boolean);
        }
      } catch (e) {
        console.warn('Alchemy NFT API failed, falling back to RPC scan');
      }
    }
  }

  // Fallback: Would need to scan events or use a different method
  // For now, return empty if Alchemy not available
  return [];
}
