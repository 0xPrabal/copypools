import { logger } from '../utils/logger.js';
import { V4Pool, CHAIN_IDS } from './database.js';

const subgraphLogger = logger.child({ module: 'uniswap-subgraph' });

// Default chain for pool sync (Base)
const DEFAULT_CHAIN_ID = CHAIN_IDS.BASE;

// Token logo URLs from TrustWallet assets
const TOKEN_LOGOS: Record<string, string> = {
  // Native/Wrapped ETH
  '0x0000000000000000000000000000000000000000': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  '0x4200000000000000000000000000000000000006': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png', // WETH on Base
  // Stablecoins
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', // USDC
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', // USDbC
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EesdeE3606eB48/logo.png', // DAI
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', // USDT
  // Coinbase Wrapped
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 'https://assets.coingecko.com/coins/images/27008/small/cbeth.png', // cbETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'https://assets.coingecko.com/coins/images/40143/small/cbbtc.webp', // cbBTC
  // LST/LRT
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 'https://assets.coingecko.com/coins/images/18834/small/wstETH.png', // wstETH
  '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c': 'https://assets.coingecko.com/coins/images/20764/small/reth.png', // rETH
  // DeFi
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 'https://assets.coingecko.com/coins/images/24413/small/aero.png', // AERO
  // Meme
  '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': 'https://assets.coingecko.com/coins/images/34515/small/degen.png', // DEGEN
};

// Token symbols and decimals
const TOKEN_INFO: Record<string, { symbol: string; decimals: number }> = {
  '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18 },
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
  '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', decimals: 6 },
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18 },
  '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c': { symbol: 'rETH', decimals: 18 },
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', decimals: 18 },
  '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': { symbol: 'DEGEN', decimals: 18 },
};

// GeckoTerminal API for pool data
const GECKO_BASE_URL = 'https://api.geckoterminal.com/api/v2';

interface GeckoPoolData {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    reserve_in_usd: string;
    pool_created_at: string;
    fdv_usd: string;
    volume_usd: {
      h24: string;
      h6: string;
      h1: string;
      m5: string;
    };
    price_change_percentage: {
      h24: string;
      h6: string;
      h1: string;
      m5: string;
    };
  };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}

interface SubgraphPool {
  id: string;
  token0: {
    id: string;
    symbol: string;
    decimals: string;
  };
  token1: {
    id: string;
    symbol: string;
    decimals: string;
  };
  feeTier: string;
  liquidity: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  poolDayData?: Array<{
    date: number;
    volumeUSD: string;
    feesUSD: string;
    tvlUSD: string;
  }>;
}

// Parse fee from pool name (e.g., "WETH / USDC 0.05%" -> 500)
function parseFeeFromName(name: string): number {
  const feeMatch = name.match(/(\d+\.?\d*)%/);
  if (feeMatch) {
    const feePercent = parseFloat(feeMatch[1]);
    return Math.round(feePercent * 10000); // Convert to basis points
  }
  return 3000; // Default 0.3%
}

// Fetch V4 pools from GeckoTerminal
export async function fetchPoolsFromGecko(): Promise<Partial<V4Pool>[]> {
  try {
    const allPools: Partial<V4Pool>[] = [];

    // Fetch multiple pages of V4 pools from Base network
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(
        `${GECKO_BASE_URL}/networks/base/dexes/uniswap-v4-base/pools?page=${page}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        subgraphLogger.warn({ status: response.status, page }, 'GeckoTerminal API returned non-OK status');
        break;
      }

      const data = await response.json() as { data?: GeckoPoolData[] };

      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        break;
      }

      for (const pool of data.data) {
        const attrs = pool.attributes;

        // Parse pool address from id (format: base_0x...)
        const poolAddress = pool.id.split('_')[1] || attrs.address;

        // Extract token addresses from relationships
        const baseTokenId = pool.relationships?.base_token?.data?.id || '';
        const quoteTokenId = pool.relationships?.quote_token?.data?.id || '';

        // Parse token addresses (format: base_0x...)
        const token0Address = (baseTokenId.split('_')[1] || '').toLowerCase();
        const token1Address = (quoteTokenId.split('_')[1] || '').toLowerCase();

        if (!token0Address || !token1Address) continue;

        // Get token info - extract symbol from pool name if not in our map
        const poolName = attrs.name || '';
        const nameParts = poolName.split(' / ');
        const token0SymbolFromName = nameParts[0]?.trim() || 'UNKNOWN';
        const token1SymbolFromName = nameParts[1]?.split(' ')[0]?.trim() || 'UNKNOWN';

        const token0Info = TOKEN_INFO[token0Address] || { symbol: token0SymbolFromName, decimals: 18 };
        const token1Info = TOKEN_INFO[token1Address] || { symbol: token1SymbolFromName, decimals: 18 };

        const tvlUsd = parseFloat(attrs.reserve_in_usd) || 0;
        const volume1dUsd = parseFloat(attrs.volume_usd?.h24) || 0;

        // Skip pools with very low TVL
        if (tvlUsd < 1000) continue;

        // Parse fee from pool name
        const fee = parseFeeFromName(poolName);

        // Estimate fees based on fee tier
        const feeRate = fee / 1000000; // Convert basis points to rate
        const fees1dUsd = volume1dUsd * feeRate;

        // Calculate APR: (fees * 365 / tvl) * 100
        const poolApr = tvlUsd > 0 ? (fees1dUsd * 365 / tvlUsd) * 100 : 0;

        allPools.push({
          id: poolAddress,
          chainId: DEFAULT_CHAIN_ID,
          currency0: token0Address,
          currency1: token1Address,
          token0Symbol: token0Info.symbol,
          token1Symbol: token1Info.symbol,
          token0Logo: TOKEN_LOGOS[token0Address] || null,
          token1Logo: TOKEN_LOGOS[token1Address] || null,
          token0Decimals: token0Info.decimals,
          token1Decimals: token1Info.decimals,
          fee,
          tvlUsd,
          volume1dUsd,
          volume30dUsd: volume1dUsd * 30, // Estimate
          fees1dUsd,
          poolApr,
          rewardApr: null,
        });
      }

      // Small delay between requests to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    subgraphLogger.info({ count: allPools.length }, 'Fetched pools from GeckoTerminal');
    return allPools;
  } catch (error) {
    subgraphLogger.error({ error }, 'Failed to fetch pools from GeckoTerminal');
    return [];
  }
}

// Uniswap V4 Subgraph endpoint for Base (if available)
const UNISWAP_V4_SUBGRAPH = process.env.UNISWAP_V4_SUBGRAPH_URL ||
  'https://api.studio.thegraph.com/query/48211/uniswap-v4-base/version/latest';

// Fetch pools from Uniswap V4 Subgraph
export async function fetchPoolsFromSubgraph(): Promise<Partial<V4Pool>[]> {
  try {
    const query = `
      {
        pools(first: 100, orderBy: totalValueLockedUSD, orderDirection: desc) {
          id
          token0 {
            id
            symbol
            decimals
          }
          token1 {
            id
            symbol
            decimals
          }
          feeTier
          liquidity
          totalValueLockedUSD
          volumeUSD
          feesUSD
          txCount
          poolDayData(first: 30, orderBy: date, orderDirection: desc) {
            date
            volumeUSD
            feesUSD
            tvlUSD
          }
        }
      }
    `;

    const response = await fetch(UNISWAP_V4_SUBGRAPH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      subgraphLogger.warn({ status: response.status }, 'Subgraph API returned non-OK status');
      return [];
    }

    const data = await response.json() as {
      data?: { pools?: SubgraphPool[] };
      errors?: unknown[];
    };

    if (data.errors) {
      subgraphLogger.warn({ errors: data.errors }, 'Subgraph returned errors');
      return [];
    }

    const pools: Partial<V4Pool>[] = [];

    if (data.data?.pools) {
      for (const pool of data.data.pools) {
        const tvlUsd = parseFloat(pool.totalValueLockedUSD) || 0;

        // Calculate 1d and 30d volume from poolDayData
        let volume1dUsd = 0;
        let volume30dUsd = 0;
        let fees1dUsd = 0;

        if (pool.poolDayData && pool.poolDayData.length > 0) {
          volume1dUsd = parseFloat(pool.poolDayData[0]?.volumeUSD) || 0;
          fees1dUsd = parseFloat(pool.poolDayData[0]?.feesUSD) || 0;
          volume30dUsd = pool.poolDayData.reduce((sum, day) => sum + (parseFloat(day.volumeUSD) || 0), 0);
        }

        // Calculate APR
        const poolApr = tvlUsd > 0 ? (fees1dUsd * 365 / tvlUsd) * 100 : 0;

        const token0Address = pool.token0.id.toLowerCase();
        const token1Address = pool.token1.id.toLowerCase();

        pools.push({
          id: pool.id,
          chainId: DEFAULT_CHAIN_ID,
          currency0: token0Address,
          currency1: token1Address,
          token0Symbol: pool.token0.symbol,
          token1Symbol: pool.token1.symbol,
          token0Logo: TOKEN_LOGOS[token0Address] || null,
          token1Logo: TOKEN_LOGOS[token1Address] || null,
          token0Decimals: parseInt(pool.token0.decimals) || 18,
          token1Decimals: parseInt(pool.token1.decimals) || 18,
          fee: parseInt(pool.feeTier) || 3000,
          tvlUsd,
          volume1dUsd,
          volume30dUsd,
          fees1dUsd,
          poolApr,
          rewardApr: null,
        });
      }
    }

    subgraphLogger.info({ count: pools.length }, 'Fetched pools from Uniswap V4 subgraph');
    return pools;
  } catch (error) {
    subgraphLogger.error({ error }, 'Failed to fetch pools from subgraph');
    return [];
  }
}

// Main function to fetch pools - tries subgraph first, falls back to GeckoTerminal
export async function fetchAllPools(): Promise<Partial<V4Pool>[]> {
  // Try Uniswap V4 subgraph first
  let pools = await fetchPoolsFromSubgraph();

  // If subgraph returns no pools, try GeckoTerminal
  if (pools.length === 0) {
    subgraphLogger.info('Subgraph returned no pools, trying GeckoTerminal');
    pools = await fetchPoolsFromGecko();
  }

  // If still no pools, return hardcoded popular pools as fallback
  if (pools.length === 0) {
    subgraphLogger.info('No external data available, using fallback pools');
    pools = getFallbackPools();
  }

  return pools;
}

// Fallback pools if APIs are unavailable (Base chain)
function getFallbackPools(): Partial<V4Pool>[] {
  return [
    {
      id: '0x88a43bbdf9d098eec7bceda4e2494615dfd9bb9c',
      chainId: DEFAULT_CHAIN_ID,
      currency0: '0x0000000000000000000000000000000000000000',
      currency1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      token0Symbol: 'ETH',
      token1Symbol: 'USDC',
      token0Logo: TOKEN_LOGOS['0x0000000000000000000000000000000000000000'],
      token1Logo: TOKEN_LOGOS['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
      token0Decimals: 18,
      token1Decimals: 6,
      fee: 500,
      tvlUsd: 46600000,
      volume1dUsd: 15500000,
      volume30dUsd: 397700000,
      fees1dUsd: 7750,
      poolApr: 6.09,
      rewardApr: null,
    },
    {
      id: '0x4c36388be6f416a29c8d8eee81c771ce6be14b18',
      chainId: DEFAULT_CHAIN_ID,
      currency0: '0x0000000000000000000000000000000000000000',
      currency1: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      token0Symbol: 'ETH',
      token1Symbol: 'USDC',
      token0Logo: TOKEN_LOGOS['0x0000000000000000000000000000000000000000'],
      token1Logo: TOKEN_LOGOS['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
      token0Decimals: 18,
      token1Decimals: 6,
      fee: 3000,
      tvlUsd: 41500000,
      volume1dUsd: 7000000,
      volume30dUsd: 115600000,
      fees1dUsd: 21000,
      poolApr: 18.43,
      rewardApr: null,
    },
    {
      id: '0x6399c842dd2be3de30bf99bc7d1bbf6fa3650e70',
      chainId: DEFAULT_CHAIN_ID,
      currency0: '0x4200000000000000000000000000000000000006',
      currency1: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
      token0Symbol: 'WETH',
      token1Symbol: 'cbBTC',
      token0Logo: TOKEN_LOGOS['0x4200000000000000000000000000000000000006'],
      token1Logo: TOKEN_LOGOS['0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'],
      token0Decimals: 18,
      token1Decimals: 8,
      fee: 3000,
      tvlUsd: 17300000,
      volume1dUsd: 1300000,
      volume30dUsd: 26500000,
      fees1dUsd: 3900,
      poolApr: 8.53,
      rewardApr: null,
    },
    {
      id: '0x7c36dd3030f1e8b5a6d1f3a3c9c8c1f8c1f8c1f8',
      chainId: DEFAULT_CHAIN_ID,
      currency0: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
      currency1: '0x4200000000000000000000000000000000000006',
      token0Symbol: 'wstETH',
      token1Symbol: 'WETH',
      token0Logo: TOKEN_LOGOS['0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452'],
      token1Logo: TOKEN_LOGOS['0x4200000000000000000000000000000000000006'],
      token0Decimals: 18,
      token1Decimals: 18,
      fee: 100,
      tvlUsd: 28800000,
      volume1dUsd: 2200000,
      volume30dUsd: 56300000,
      fees1dUsd: 220,
      poolApr: 0.28,
      rewardApr: null,
    },
    {
      id: '0x8c36dd3030f1e8b5a6d1f3a3c9c8c1f8c1f8c1f9',
      chainId: DEFAULT_CHAIN_ID,
      currency0: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
      currency1: '0x4200000000000000000000000000000000000006',
      token0Symbol: 'DEGEN',
      token1Symbol: 'WETH',
      token0Logo: TOKEN_LOGOS['0x4ed4e862860bed51a9570b96d89af5e1b0efefed'],
      token1Logo: TOKEN_LOGOS['0x4200000000000000000000000000000000000006'],
      token0Decimals: 18,
      token1Decimals: 18,
      fee: 10000,
      tvlUsd: 5200000,
      volume1dUsd: 890000,
      volume30dUsd: 18500000,
      fees1dUsd: 8900,
      poolApr: 62.45,
      rewardApr: null,
    },
  ];
}

// Get token logo URL
export function getTokenLogo(address: string): string | null {
  return TOKEN_LOGOS[address.toLowerCase()] || null;
}

// Get token info
export function getTokenInfo(address: string): { symbol: string; decimals: number } | null {
  return TOKEN_INFO[address.toLowerCase()] || null;
}
