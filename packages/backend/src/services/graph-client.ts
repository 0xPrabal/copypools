import { logger } from '../utils/logger.js';

const graphLogger = logger.child({ module: 'graph-client' });

// Subgraph endpoints in priority order
const SUBGRAPH_IDS = {
  PRIMARY: 'Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj',   // uniswap-v4-base-3
  FALLBACK: 'HNCFA9TyBqpo5qpe6QreQABAA1kV8g46mhkCcicu6v2R',   // uniswap-v4-base
};

const GRAPH_GATEWAY = 'https://gateway.thegraph.com/api/subgraphs/id';

// In-memory cache
const cache = new Map<string, { data: unknown; expiry: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiry > Date.now()) {
    return entry.data as T;
  }
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

// Get API key from env
function getApiKey(): string | null {
  return process.env.GRAPH_API_KEY || null;
}

// Execute a GraphQL query with automatic failover
async function queryGraph<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    graphLogger.warn('GRAPH_API_KEY not set, skipping Graph queries');
    return null;
  }

  const subgraphIds = [SUBGRAPH_IDS.PRIMARY, SUBGRAPH_IDS.FALLBACK];

  for (const subgraphId of subgraphIds) {
    try {
      const url = `${GRAPH_GATEWAY}/${subgraphId}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        graphLogger.warn({ status: response.status, subgraphId }, 'Graph API returned non-OK status');
        continue;
      }

      const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

      if (result.errors?.length) {
        graphLogger.warn({ errors: result.errors, subgraphId, hasData: !!result.data }, 'Graph query returned errors');
        // Graph often returns partial data WITH errors (e.g., "bad indexers" warning).
        // If we got data alongside errors, use it instead of falling through.
        if (result.data) {
          graphLogger.info({ subgraphId }, 'Using partial Graph data despite errors');
          return result.data;
        }
        continue;
      }

      if (result.data) {
        return result.data;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      graphLogger.warn({ error: msg, subgraphId }, 'Graph query failed, trying next endpoint');
    }
  }

  graphLogger.error('All Graph subgraph endpoints failed');
  return null;
}

// ─── Public API ────────────────────────────────────────────────

// Types

export interface GraphPosition {
  id: string;
  tokenId: string;
  owner: string;
  origin: string;
  createdAtTimestamp: string;
}

export interface GraphPositionEnriched {
  tokenId: string;
  owner: string;
  createdAtTimestamp: string;
  collectedFeesToken0: string;
  collectedFeesToken1: string;
  depositedToken0: string;
  depositedToken1: string;
  withdrawnToken0: string;
  withdrawnToken1: string;
  pool?: {
    id: string;
    token0: { id: string; symbol: string; decimals: string };
    token1: { id: string; symbol: string; decimals: string };
    feeTier: string;
  };
}

export interface GraphCollect {
  id: string;
  amount0: string;
  amount1: string;
  timestamp: string;
  position: { tokenId: string };
}

export interface GraphPool {
  id: string;
  token0: { id: string; symbol: string; name: string; decimals: string };
  token1: { id: string; symbol: string; name: string; decimals: string };
  feeTier: string;
  liquidity: string;
  sqrtPrice: string;
  tick: string | null;
  tickSpacing: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  liquidityProviderCount: string;
  hooks: string;
  createdAtTimestamp: string;
  token0Price: string;
  token1Price: string;
  poolDayData?: GraphPoolDayData[];
}

export interface GraphPoolDayData {
  date: number;
  tvlUSD: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  token0Price: string;
  token1Price: string;
  open: string;
  high: string;
  low: string;
  close: string;
  liquidity: string;
}

export interface GraphPoolHourData {
  periodStartUnix: number;
  tvlUSD: string;
  volumeUSD: string;
  feesUSD: string;
  open: string;
  high: string;
  low: string;
  close: string;
  liquidity: string;
}

export interface GraphToken {
  id: string;
  symbol: string;
  name: string;
  decimals: string;
  derivedETH: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  poolCount: string;
}

export interface GraphSwap {
  id: string;
  timestamp: string;
  pool: { id: string };
  token0: { id: string; symbol: string };
  token1: { id: string; symbol: string };
  sender: string;
  origin: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  sqrtPriceX96: string;
  tick: string;
}

export interface GraphTick {
  tickIdx: string;
  liquidityGross: string;
  liquidityNet: string;
  price0: string;
  price1: string;
}

export interface GraphProtocolStats {
  id: string;
  poolCount: string;
  txCount: string;
  totalVolumeUSD: string;
  totalFeesUSD: string;
  totalValueLockedUSD: string;
}

export interface GraphUniswapDayData {
  date: number;
  volumeUSD: string;
  feesUSD: string;
  tvlUSD: string;
  txCount: string;
}

// ─── Fetch Functions ───────────────────────────────────────────

/**
 * Fetch top pools ordered by TVL with optional day data
 */
export async function fetchGraphPools(
  first: number = 100,
  skip: number = 0,
  includeDayData: boolean = true,
  minTxCount: number = 10,
): Promise<GraphPool[]> {
  const cacheKey = `pools:${first}:${skip}:${minTxCount}:${includeDayData}`;
  const cached = getCached<GraphPool[]>(cacheKey);
  if (cached) return cached;

  const dayDataFragment = includeDayData
    ? `poolDayData(first: 30, orderBy: date, orderDirection: desc) {
        date volumeUSD feesUSD tvlUSD token0Price token1Price
        open high low close liquidity volumeToken0 volumeToken1 txCount
      }`
    : '';

  const query = `{
    pools(
      first: ${first}
      skip: ${skip}
      orderBy: totalValueLockedUSD
      orderDirection: desc
      where: { txCount_gt: "${minTxCount}" }
    ) {
      id
      token0 { id symbol name decimals }
      token1 { id symbol name decimals }
      feeTier
      liquidity
      sqrtPrice
      tick
      tickSpacing
      totalValueLockedUSD
      volumeUSD
      feesUSD
      txCount
      liquidityProviderCount
      hooks
      createdAtTimestamp
      token0Price
      token1Price
      ${dayDataFragment}
    }
  }`;

  const data = await queryGraph<{ pools: GraphPool[] }>(query);
  const pools = data?.pools || [];

  if (pools.length > 0) {
    setCache(cacheKey, pools, 5 * 60 * 1000); // 5 min cache
  }

  graphLogger.info({ count: pools.length }, 'Fetched pools from Graph');
  return pools;
}

/**
 * Fetch a single pool by ID with day data
 */
export async function fetchGraphPool(poolId: string): Promise<GraphPool | null> {
  const cacheKey = `pool:${poolId}`;
  const cached = getCached<GraphPool>(cacheKey);
  if (cached) return cached;

  const query = `{
    pool(id: "${poolId.toLowerCase()}") {
      id
      token0 { id symbol name decimals }
      token1 { id symbol name decimals }
      feeTier
      liquidity
      sqrtPrice
      tick
      tickSpacing
      totalValueLockedUSD
      volumeUSD
      feesUSD
      txCount
      liquidityProviderCount
      hooks
      createdAtTimestamp
      token0Price
      token1Price
      poolDayData(first: 30, orderBy: date, orderDirection: desc) {
        date volumeUSD feesUSD tvlUSD token0Price token1Price
        open high low close liquidity volumeToken0 volumeToken1 txCount
      }
    }
  }`;

  const data = await queryGraph<{ pool: GraphPool | null }>(query);
  const pool = data?.pool || null;

  if (pool) {
    setCache(cacheKey, pool, 5 * 60 * 1000);
  }

  return pool;
}

/**
 * Fetch pool day data (OHLCV) for charts
 */
export async function fetchPoolDayData(poolId: string, days: number = 30): Promise<GraphPoolDayData[]> {
  const cacheKey = `poolDayData:${poolId}:${days}`;
  const cached = getCached<GraphPoolDayData[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    poolDayDatas(
      first: ${days}
      orderBy: date
      orderDirection: desc
      where: { pool: "${poolId.toLowerCase()}" }
    ) {
      date
      tvlUSD
      volumeToken0
      volumeToken1
      volumeUSD
      feesUSD
      txCount
      token0Price
      token1Price
      open
      high
      low
      close
      liquidity
    }
  }`;

  const data = await queryGraph<{ poolDayDatas: GraphPoolDayData[] }>(query);
  const result = data?.poolDayDatas || [];

  if (result.length > 0) {
    setCache(cacheKey, result, 60 * 60 * 1000); // 1 hour cache
  }

  return result;
}

/**
 * Fetch pool hour data for granular charts
 */
export async function fetchPoolHourData(poolId: string, hours: number = 168): Promise<GraphPoolHourData[]> {
  const cacheKey = `poolHourData:${poolId}:${hours}`;
  const cached = getCached<GraphPoolHourData[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    poolHourDatas(
      first: ${hours}
      orderBy: periodStartUnix
      orderDirection: desc
      where: { pool: "${poolId.toLowerCase()}" }
    ) {
      periodStartUnix
      tvlUSD
      volumeUSD
      feesUSD
      open
      high
      low
      close
      liquidity
    }
  }`;

  const data = await queryGraph<{ poolHourDatas: GraphPoolHourData[] }>(query);
  const result = data?.poolHourDatas || [];

  if (result.length > 0) {
    setCache(cacheKey, result, 5 * 60 * 1000); // 5 min cache
  }

  return result;
}

/**
 * Fetch ETH/USD price from Bundle entity
 */
export async function fetchEthPrice(): Promise<number> {
  const cacheKey = 'ethPrice';
  const cached = getCached<number>(cacheKey);
  if (cached) return cached;

  const query = `{ bundle(id: "1") { ethPriceUSD } }`;
  const data = await queryGraph<{ bundle: { ethPriceUSD: string } | null }>(query);

  const price = parseFloat(data?.bundle?.ethPriceUSD || '0');
  if (price > 0) {
    setCache(cacheKey, price, 2 * 60 * 1000); // 2 min cache
  }

  return price;
}

/**
 * Fetch token prices using derivedETH + Bundle
 */
export async function fetchTokenPrices(addresses: string[]): Promise<Map<string, number>> {
  if (addresses.length === 0) return new Map();

  const cacheKey = `tokenPrices:${addresses.sort().join(',')}`;
  const cached = getCached<Map<string, number>>(cacheKey);
  if (cached) return cached;

  const ids = addresses.map(a => `"${a.toLowerCase()}"`).join(',');
  const query = `{
    bundle(id: "1") { ethPriceUSD }
    tokens(where: { id_in: [${ids}] }) {
      id
      symbol
      derivedETH
      totalValueLockedUSD
    }
  }`;

  const data = await queryGraph<{
    bundle: { ethPriceUSD: string } | null;
    tokens: Array<{ id: string; derivedETH: string }>;
  }>(query);

  const prices = new Map<string, number>();
  const ethPrice = parseFloat(data?.bundle?.ethPriceUSD || '0');

  if (data?.tokens && ethPrice > 0) {
    for (const token of data.tokens) {
      const derivedETH = parseFloat(token.derivedETH || '0');
      prices.set(token.id.toLowerCase(), derivedETH * ethPrice);
    }
  }

  if (prices.size > 0) {
    setCache(cacheKey, prices, 2 * 60 * 1000); // 2 min cache
  }

  return prices;
}

/**
 * Fetch tokens by address with full metadata
 */
export async function fetchTokens(addresses: string[]): Promise<GraphToken[]> {
  if (addresses.length === 0) return [];

  const ids = addresses.map(a => `"${a.toLowerCase()}"`).join(',');
  const query = `{
    tokens(where: { id_in: [${ids}] }) {
      id symbol name decimals derivedETH
      totalValueLockedUSD volumeUSD poolCount
    }
  }`;

  const data = await queryGraph<{ tokens: GraphToken[] }>(query);
  return data?.tokens || [];
}

/**
 * Fetch top tokens by TVL
 */
export async function fetchTopTokens(first: number = 50): Promise<GraphToken[]> {
  const cacheKey = `topTokens:${first}`;
  const cached = getCached<GraphToken[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    tokens(
      first: ${first}
      orderBy: totalValueLockedUSD
      orderDirection: desc
    ) {
      id symbol name decimals derivedETH
      totalValueLockedUSD volumeUSD poolCount
    }
  }`;

  const data = await queryGraph<{ tokens: GraphToken[] }>(query);
  const tokens = data?.tokens || [];

  if (tokens.length > 0) {
    setCache(cacheKey, tokens, 5 * 60 * 1000);
  }

  return tokens;
}

/**
 * Fetch recent swaps for a pool
 */
export async function fetchSwaps(poolId: string, first: number = 50): Promise<GraphSwap[]> {
  const cacheKey = `swaps:${poolId}:${first}`;
  const cached = getCached<GraphSwap[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    swaps(
      first: ${first}
      orderBy: timestamp
      orderDirection: desc
      where: { pool: "${poolId.toLowerCase()}" }
    ) {
      id
      timestamp
      pool { id }
      token0 { id symbol }
      token1 { id symbol }
      sender
      origin
      amount0
      amount1
      amountUSD
      sqrtPriceX96
      tick
    }
  }`;

  const data = await queryGraph<{ swaps: GraphSwap[] }>(query);
  const swaps = data?.swaps || [];

  if (swaps.length > 0) {
    setCache(cacheKey, swaps, 60 * 1000); // 1 min cache
  }

  return swaps;
}

/**
 * Fetch tick liquidity distribution for a pool
 */
export async function fetchTicks(poolId: string, first: number = 200): Promise<GraphTick[]> {
  const cacheKey = `ticks:${poolId}:${first}`;
  const cached = getCached<GraphTick[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    ticks(
      first: ${first}
      where: { pool: "${poolId.toLowerCase()}" }
      orderBy: tickIdx
    ) {
      tickIdx
      liquidityGross
      liquidityNet
      price0
      price1
    }
  }`;

  const data = await queryGraph<{ ticks: GraphTick[] }>(query);
  const ticks = data?.ticks || [];

  if (ticks.length > 0) {
    setCache(cacheKey, ticks, 15 * 60 * 1000); // 15 min cache
  }

  return ticks;
}

/**
 * Fetch protocol-wide statistics from PoolManager
 */
export async function fetchProtocolStats(): Promise<GraphProtocolStats | null> {
  const cacheKey = 'protocolStats';
  const cached = getCached<GraphProtocolStats>(cacheKey);
  if (cached) return cached;

  // Base PoolManager address
  const query = `{
    poolManagers(first: 1) {
      id
      poolCount
      txCount
      totalVolumeUSD
      totalFeesUSD
      totalValueLockedUSD
    }
  }`;

  const data = await queryGraph<{ poolManagers: GraphProtocolStats[] }>(query);
  const stats = data?.poolManagers?.[0] || null;

  if (stats) {
    setCache(cacheKey, stats, 15 * 60 * 1000); // 15 min cache
  }

  return stats;
}

/**
 * Fetch daily protocol-wide data (UniswapDayData)
 */
export async function fetchUniswapDayData(days: number = 30): Promise<GraphUniswapDayData[]> {
  const cacheKey = `uniswapDayData:${days}`;
  const cached = getCached<GraphUniswapDayData[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    uniswapDayDatas(
      first: ${days}
      orderBy: date
      orderDirection: desc
    ) {
      date
      volumeUSD
      feesUSD
      tvlUSD
      txCount
    }
  }`;

  const data = await queryGraph<{ uniswapDayDatas: GraphUniswapDayData[] }>(query);
  const result = data?.uniswapDayDatas || [];

  if (result.length > 0) {
    setCache(cacheKey, result, 60 * 60 * 1000); // 1 hour cache
  }

  return result;
}

/**
 * Search pools by token symbol or address
 */
export async function searchPools(tokenQuery: string, first: number = 20): Promise<GraphPool[]> {
  const isAddress = tokenQuery.startsWith('0x') && tokenQuery.length === 42;

  let whereClause: string;
  if (isAddress) {
    const addr = tokenQuery.toLowerCase();
    whereClause = `or: [{ token0: "${addr}" }, { token1: "${addr}" }]`;
  } else {
    // Search by symbol requires fetching token IDs first, so we just get top pools
    // and filter client-side
    whereClause = `txCount_gt: "10"`;
  }

  const query = `{
    pools(
      first: ${first}
      orderBy: totalValueLockedUSD
      orderDirection: desc
      where: { ${whereClause} }
    ) {
      id
      token0 { id symbol name decimals }
      token1 { id symbol name decimals }
      feeTier
      liquidity
      sqrtPrice
      tick
      tickSpacing
      totalValueLockedUSD
      volumeUSD
      feesUSD
      txCount
      liquidityProviderCount
      hooks
      createdAtTimestamp
      token0Price
      token1Price
    }
  }`;

  const data = await queryGraph<{ pools: GraphPool[] }>(query);
  let pools = data?.pools || [];

  // Client-side filter by symbol if not address search
  if (!isAddress && tokenQuery) {
    const term = tokenQuery.toUpperCase();
    pools = pools.filter(
      p => p.token0.symbol.toUpperCase().includes(term) ||
           p.token1.symbol.toUpperCase().includes(term)
    );
  }

  return pools;
}

/**
 * Fetch ALL V4 positions from Graph subgraph (paginated).
 * Graph Position entity: id, tokenId, owner, origin, createdAtTimestamp
 * No liquidity/tick data — that must come from on-chain RPC.
 */
export async function fetchGraphPositions(
  first: number = 1000,
  skip: number = 0,
): Promise<GraphPosition[]> {
  const cacheKey = `positions:${first}:${skip}`;
  const cached = getCached<GraphPosition[]>(cacheKey);
  if (cached) return cached;

  const query = `{
    positions(
      first: ${first}
      skip: ${skip}
      orderBy: createdAtTimestamp
      orderDirection: desc
    ) {
      id
      tokenId
      owner
      origin
      createdAtTimestamp
    }
  }`;

  const data = await queryGraph<{ positions: GraphPosition[] }>(query);
  const positions = data?.positions || [];

  if (positions.length > 0) {
    setCache(cacheKey, positions, 10 * 60 * 1000); // 10 min cache
  }

  graphLogger.info({ count: positions.length, skip }, 'Fetched positions from Graph');
  return positions;
}

/**
 * Fetch enriched Position data from Graph including fee/deposit fields.
 * V4 subgraph Position entity may have: collectedFees0/1, depositedToken0/1, withdrawnToken0/1
 * Falls back gracefully if some fields don't exist in the subgraph schema.
 */
export async function fetchGraphPositionsWithFees(tokenIds: string[]): Promise<Map<string, GraphPositionEnriched>> {
  const result = new Map<string, GraphPositionEnriched>();
  if (tokenIds.length === 0) return result;

  const BATCH = 100;
  for (let i = 0; i < tokenIds.length; i += BATCH) {
    const batch = tokenIds.slice(i, i + BATCH);
    const ids = batch.map(id => `"${id}"`).join(',');

    try {
      // Try full query with all fee/deposit fields
      const query = `{
        positions(where: { tokenId_in: [${ids}] }, first: ${BATCH}) {
          tokenId
          owner
          createdAtTimestamp
          collectedFeesToken0
          collectedFeesToken1
          depositedToken0
          depositedToken1
          withdrawnToken0
          withdrawnToken1
          pool {
            id
            token0 { id symbol decimals }
            token1 { id symbol decimals }
            feeTier
          }
        }
      }`;

      const data = await queryGraph<{ positions: GraphPositionEnriched[] }>(query);
      if (data?.positions) {
        for (const pos of data.positions) {
          result.set(pos.tokenId, pos);
        }
        continue;
      }
    } catch {
      // Full query failed, try minimal query
    }

    try {
      // Fallback: try without deposit/withdrawn fields (may not exist in V4)
      const query = `{
        positions(where: { tokenId_in: [${ids}] }, first: ${BATCH}) {
          tokenId
          owner
          createdAtTimestamp
          collectedFeesToken0
          collectedFeesToken1
        }
      }`;

      const data = await queryGraph<{ positions: any[] }>(query);
      if (data?.positions) {
        for (const pos of data.positions) {
          result.set(pos.tokenId, {
            ...pos,
            depositedToken0: '0',
            depositedToken1: '0',
            withdrawnToken0: '0',
            withdrawnToken1: '0',
          });
        }
      }
    } catch (error) {
      graphLogger.warn({ error: (error as Error).message, batch: batch.length }, 'Failed to fetch enriched positions');
    }
  }

  graphLogger.info({ requested: tokenIds.length, found: result.size }, 'Fetched enriched positions from Graph');
  return result;
}

/**
 * Fetch Collect events (fee collections) for positions from Graph.
 * Returns a map of tokenId → total collected fees in USD.
 */
export async function fetchPositionCollects(tokenIds: string[]): Promise<Map<string, { amount0: number; amount1: number; amount0USD: number; amount1USD: number; count: number }>> {
  const result = new Map<string, { amount0: number; amount1: number; amount0USD: number; amount1USD: number; count: number }>();
  if (tokenIds.length === 0) return result;

  const BATCH = 50; // Smaller batch since we're querying related entities
  for (let i = 0; i < tokenIds.length; i += BATCH) {
    const batch = tokenIds.slice(i, i + BATCH);
    const ids = batch.map(id => `"${id}"`).join(',');

    try {
      // Query collects for positions (V4 subgraph structure)
      const query = `{
        collects(
          where: { position_: { tokenId_in: [${ids}] } }
          first: 1000
          orderBy: timestamp
          orderDirection: desc
        ) {
          amount0
          amount1
          amount0USD
          amount1USD
          timestamp
          position { tokenId }
        }
      }`;

      const data = await queryGraph<{ collects: Array<{ amount0: string; amount1: string; amount0USD: string; amount1USD: string; position: { tokenId: string } }> }>(query);
      if (data?.collects) {
        for (const c of data.collects) {
          const tid = c.position.tokenId;
          const existing = result.get(tid) || { amount0: 0, amount1: 0, amount0USD: 0, amount1USD: 0, count: 0 };
          existing.amount0 += parseFloat(c.amount0 || '0');
          existing.amount1 += parseFloat(c.amount1 || '0');
          existing.amount0USD += parseFloat(c.amount0USD || '0');
          existing.amount1USD += parseFloat(c.amount1USD || '0');
          existing.count++;
          result.set(tid, existing);
        }
      }
    } catch (error) {
      graphLogger.debug({ error: (error as Error).message }, 'Failed to fetch Collect events batch');
    }
  }

  graphLogger.info({ requested: tokenIds.length, withCollects: result.size }, 'Fetched Collect events from Graph');
  return result;
}

/**
 * Fetch Mint events (deposits) for positions from Graph.
 * Returns a map of tokenId → total deposited amounts.
 */
export async function fetchPositionMints(tokenIds: string[]): Promise<Map<string, { amount0: number; amount1: number; amountUSD: number; count: number }>> {
  const result = new Map<string, { amount0: number; amount1: number; amountUSD: number; count: number }>();
  if (tokenIds.length === 0) return result;

  const BATCH = 50;
  for (let i = 0; i < tokenIds.length; i += BATCH) {
    const batch = tokenIds.slice(i, i + BATCH);
    const ids = batch.map(id => `"${id}"`).join(',');

    try {
      const query = `{
        mints(
          where: { position_: { tokenId_in: [${ids}] } }
          first: 1000
          orderBy: timestamp
          orderDirection: desc
        ) {
          amount0
          amount1
          amountUSD
          timestamp
          position { tokenId }
        }
      }`;

      const data = await queryGraph<{ mints: Array<{ amount0: string; amount1: string; amountUSD: string; position: { tokenId: string } }> }>(query);
      if (data?.mints) {
        for (const m of data.mints) {
          const tid = m.position.tokenId;
          const existing = result.get(tid) || { amount0: 0, amount1: 0, amountUSD: 0, count: 0 };
          existing.amount0 += parseFloat(m.amount0 || '0');
          existing.amount1 += parseFloat(m.amount1 || '0');
          existing.amountUSD += parseFloat(m.amountUSD || '0');
          existing.count++;
          result.set(tid, existing);
        }
      }
    } catch (error) {
      graphLogger.debug({ error: (error as Error).message }, 'Failed to fetch Mint events batch');
    }
  }

  graphLogger.info({ requested: tokenIds.length, withMints: result.size }, 'Fetched Mint events from Graph');
  return result;
}

/**
 * Clear all cached data
 */
export function clearGraphCache(): void {
  cache.clear();
  graphLogger.info('Graph cache cleared');
}
