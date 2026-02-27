import { CronJob } from 'cron';
import { logger } from '../utils/logger.js';
import {
  upsertTopPositions,
  deleteStaleTopPositions,
  updatePoolLeaderboardMetrics,
  getBatchTokenPricesFromDb,
  type TopPosition,
  type SuggestedRange,
} from '../services/database.js';
import { getAllPositionsWithPool } from '../services/subgraph.js';
import { liquidityToAmounts } from '../services/price.js';
import { getPoolDayDataFromDb, getV4Pools } from '../services/database.js';
import { fetchGraphPools, fetchTokenPrices } from '../services/graph-client.js';

const syncLogger = logger.child({ module: 'sync-top-positions' });

// Fallback prices for well-known Base mainnet tokens (used when Graph + DB price feeds are all down)
const FALLBACK_PRICES: Record<string, number> = {
  '0x4200000000000000000000000000000000000006': 2600,  // WETH
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 1,     // USDC
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6dc': 1,     // USDbC
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 1,     // DAI
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 2800,  // cbETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 95000, // cbBTC
  '0x0000000000000000000000000000000000000000': 2600,  // Native ETH (zero address)
};

const SYNC_INTERVAL = '*/10 * * * *'; // Every 10 minutes
const MIN_POSITION_VALUE_USD = 100;
const MIN_AGE_DAYS = 0;
const MAX_POSITIONS = 500;

let isSyncing = false;

/**
 * Build pool data map from Graph subgraph (primary) with Ponder fallback.
 * Graph provides: tick, sqrtPrice, fee, tickSpacing, token0/token1 addresses + symbols + decimals
 */
// Store raw Graph pool data for price derivation
let graphPoolsRaw: any[] = [];

async function buildPoolDataMap(
  ponderPositions: any[]
): Promise<Map<string, {
  tick: number;
  sqrtPriceX96: string;
  fee: number;
  tickSpacing: number;
  token0Address: string;
  token1Address: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
}>> {
  const poolMap = new Map<string, any>();

  // Primary: Graph subgraph — has tick, sqrtPrice, fee, tickSpacing, token metadata
  try {
    const graphPools = await fetchGraphPools(200, 0, false);
    if (graphPools && graphPools.length > 0) {
      graphPoolsRaw = graphPools; // Store for price derivation
      for (const gp of graphPools) {
        poolMap.set(gp.id.toLowerCase(), {
          tick: parseInt(gp.tick || '0'),
          sqrtPriceX96: gp.sqrtPrice || '0',
          fee: parseInt(gp.feeTier || '0'),
          tickSpacing: parseInt(gp.tickSpacing || '10'),
          token0Address: gp.token0.id.toLowerCase(),
          token1Address: gp.token1.id.toLowerCase(),
          token0Symbol: gp.token0.symbol,
          token1Symbol: gp.token1.symbol,
          token0Decimals: parseInt(gp.token0.decimals || '18'),
          token1Decimals: parseInt(gp.token1.decimals || '18'),
        });
      }
      syncLogger.info({ count: poolMap.size }, 'Loaded pool data from Graph subgraph');
    }
  } catch (error) {
    syncLogger.warn({ error: (error as Error).message }, 'Graph subgraph unavailable for pool data');
  }

  // Fallback: Fill gaps from Ponder position data (already joined with pool + token)
  if (poolMap.size === 0) {
    syncLogger.warn('Graph returned no pools, using Ponder pool data as fallback');
  }

  for (const pos of ponderPositions) {
    const poolId = (pos.poolId || '').toLowerCase();
    if (!poolId || poolMap.has(poolId)) continue;

    // Only add if Ponder has the pool data
    if (pos.poolTick != null && pos.poolSqrtPriceX96) {
      poolMap.set(poolId, {
        tick: pos.poolTick,
        sqrtPriceX96: pos.poolSqrtPriceX96,
        fee: pos.poolFee || 0,
        tickSpacing: pos.poolTickSpacing || 10,
        token0Address: (pos.token0Id || '').toLowerCase(),
        token1Address: (pos.token1Id || '').toLowerCase(),
        token0Symbol: pos.token0Symbol || 'UNKNOWN',
        token1Symbol: pos.token1Symbol || 'UNKNOWN',
        token0Decimals: pos.token0Decimals || 18,
        token1Decimals: pos.token1Decimals || 18,
      });
    }
  }

  syncLogger.info({ totalPools: poolMap.size }, 'Pool data map built');
  return poolMap;
}

/**
 * Build token price map from multiple sources in priority order:
 * 1. Graph subgraph (derivedETH * ethPrice) — freshest
 * 2. DB cache (from syncTokenPrices cron)
 * 3. Ponder token prices (from indexer)
 * 4. Hardcoded fallbacks for well-known tokens
 */
async function buildPriceMap(
  tokenAddresses: Set<string>,
  ponderPositions: any[]
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();

  // Source 1: Graph subgraph — direct query for token prices
  try {
    const graphPrices = await fetchTokenPrices(Array.from(tokenAddresses));
    if (graphPrices && graphPrices.size > 0) {
      for (const [addr, price] of graphPrices) {
        if (price > 0) priceMap.set(addr, price);
      }
      syncLogger.info({ count: priceMap.size }, 'Loaded prices from Graph subgraph');
    }
  } catch (error) {
    syncLogger.warn({ error: (error as Error).message }, 'Graph subgraph unavailable for prices');
  }

  // Source 2: DB cache (from syncTokenPrices cron — 0 API calls)
  if (priceMap.size < tokenAddresses.size) {
    try {
      const missingAddrs = Array.from(tokenAddresses).filter(a => !priceMap.has(a));
      if (missingAddrs.length > 0) {
        const dbPrices = await getBatchTokenPricesFromDb(missingAddrs, 8453);
        let dbCount = 0;
        for (const [addr, dbPrice] of dbPrices) {
          if (dbPrice.priceUsd != null && dbPrice.priceUsd > 0 && !priceMap.has(addr)) {
            priceMap.set(addr, dbPrice.priceUsd);
            dbCount++;
          }
        }
        if (dbCount > 0) {
          syncLogger.info({ count: dbCount }, 'Filled price gaps from DB cache');
        }
      }
    } catch (error) {
      syncLogger.warn({ error: (error as Error).message }, 'DB price cache unavailable');
    }
  }

  // Source 3: Ponder token prices (from indexer)
  if (priceMap.size < tokenAddresses.size) {
    let ponderCount = 0;
    for (const pos of ponderPositions) {
      const t0Addr = (pos.token0Id || '').toLowerCase();
      const t1Addr = (pos.token1Id || '').toLowerCase();
      const t0Price = parseFloat(pos.token0PriceUsd || '0');
      const t1Price = parseFloat(pos.token1PriceUsd || '0');
      if (t0Addr && t0Price > 0 && !priceMap.has(t0Addr)) {
        priceMap.set(t0Addr, t0Price);
        ponderCount++;
      }
      if (t1Addr && t1Price > 0 && !priceMap.has(t1Addr)) {
        priceMap.set(t1Addr, t1Price);
        ponderCount++;
      }
    }
    if (ponderCount > 0) {
      syncLogger.info({ count: ponderCount }, 'Filled price gaps from Ponder token data');
    }
  }

  // Source 4: Hardcoded fallbacks for well-known Base tokens
  let fallbackCount = 0;
  for (const addr of tokenAddresses) {
    if (!priceMap.has(addr) && FALLBACK_PRICES[addr]) {
      priceMap.set(addr, FALLBACK_PRICES[addr]);
      fallbackCount++;
    }
  }
  if (fallbackCount > 0) {
    syncLogger.warn({ count: fallbackCount }, 'Used hardcoded fallback prices for well-known tokens');
  }

  // Source 5: Derive prices from Graph pool pair data (token0Price/token1Price)
  // If we know one token's USD price and the pool has a relative price, derive the other
  if (graphPoolsRaw.length > 0) {
    let derivedCount = 0;
    // Multiple passes to propagate prices through pool pairs
    for (let pass = 0; pass < 3; pass++) {
      for (const gp of graphPoolsRaw) {
        const t0 = gp.token0.id.toLowerCase();
        const t1 = gp.token1.id.toLowerCase();
        const t0Price = parseFloat(gp.token0Price || '0'); // price of token0 in terms of token1
        const t1Price = parseFloat(gp.token1Price || '0'); // price of token1 in terms of token0

        if (t0Price > 0 && priceMap.has(t1) && !priceMap.has(t0)) {
          // token0_usd = token0Price_in_token1 * token1_usd
          priceMap.set(t0, t0Price * priceMap.get(t1)!);
          derivedCount++;
        }
        if (t1Price > 0 && priceMap.has(t0) && !priceMap.has(t1)) {
          // token1_usd = token1Price_in_token0 * token0_usd
          priceMap.set(t1, t1Price * priceMap.get(t0)!);
          derivedCount++;
        }
      }
    }
    if (derivedCount > 0) {
      syncLogger.info({ count: derivedCount }, 'Derived token prices from Graph pool pair data');
    }
  }

  syncLogger.info({
    pricesFound: priceMap.size,
    tokensTotal: tokenAddresses.size,
    samplePrices: Array.from(priceMap.entries()).slice(0, 8).map(([k, v]) => `${k.slice(0, 10)}=$${v.toFixed(2)}`),
  }, 'Price map built');

  return priceMap;
}

/**
 * Sync top positions from Ponder into the leaderboard table.
 *
 * Data flow:
 * - Positions (ticks, liquidity, fees): Ponder (Graph doesn't have position tick/liquidity data)
 * - Pool data (currentTick, sqrtPrice): Graph subgraph (primary) → Ponder (fallback)
 * - Token prices: Graph subgraph → DB cache → Ponder → hardcoded fallbacks
 */
export async function syncTopPositions(): Promise<void> {
  if (isSyncing) {
    syncLogger.info('Top positions sync already in progress, skipping');
    return;
  }

  isSyncing = true;
  const startTime = Date.now();

  try {
    syncLogger.info('Starting top positions sync...');
    graphPoolsRaw = []; // Reset for fresh data

    // Step 1: Fetch all active positions from Ponder
    // Ponder is the ONLY source for position-specific data (ticks, liquidity, deposited/collected)
    // Graph V4 subgraph's Position entity doesn't include these fields
    const allPositions: any[] = [];
    let skip = 0;
    const batchSize = 500;
    let hasMore = true;

    while (hasMore) {
      const result = await getAllPositionsWithPool(batchSize, skip, true);
      const items = result?.positions?.items || [];
      allPositions.push(...items);
      skip += batchSize;
      hasMore = items.length === batchSize;

      if (allPositions.length > 5000) {
        syncLogger.warn('Too many positions, capping at 5000');
        break;
      }
    }

    if (allPositions.length === 0) {
      syncLogger.warn('No active positions found from Ponder');
      return;
    }

    syncLogger.info({ count: allPositions.length }, 'Fetched active positions from Ponder');

    // Step 2: Build pool data map — Graph subgraph is primary, Ponder is fallback
    const poolDataMap = await buildPoolDataMap(allPositions);

    // Step 3: Collect token addresses and build price map (multi-source)
    const tokenAddresses = new Set<string>();
    for (const pos of allPositions) {
      const poolId = (pos.poolId || '').toLowerCase();
      const poolData = poolDataMap.get(poolId);
      if (poolData) {
        tokenAddresses.add(poolData.token0Address);
        tokenAddresses.add(poolData.token1Address);
      } else if (pos.token0Id || pos.token1Id) {
        if (pos.token0Id) tokenAddresses.add(pos.token0Id.toLowerCase());
        if (pos.token1Id) tokenAddresses.add(pos.token1Id.toLowerCase());
      }
    }
    // Remove empty string
    tokenAddresses.delete('');

    const priceMap = await buildPriceMap(tokenAddresses, allPositions);

    // Step 4: Calculate metrics for each position
    const now = Math.floor(Date.now() / 1000);
    const candidates: TopPosition[] = [];
    const skipReasons = { zeroLiq: 0, noPool: 0, zeroSqrt: 0, noTokens: 0, noPrice: 0, lowValue: 0, youngAge: 0 };

    for (const pos of allPositions) {
      try {
        const liquidity = BigInt(pos.liquidity || '0');
        if (liquidity === 0n) { skipReasons.zeroLiq++; continue; }

        const tickLower = pos.tickLower;
        const tickUpper = pos.tickUpper;
        const poolId = (pos.poolId || '').toLowerCase();

        // Get pool data from our multi-source pool map
        const poolData = poolDataMap.get(poolId);
        if (!poolData && !pos.poolTick && !pos.poolSqrtPriceX96) { skipReasons.noPool++; continue; }
        const currentTick = poolData?.tick ?? pos.poolTick ?? 0;
        const sqrtPriceX96Str = poolData?.sqrtPriceX96 || pos.poolSqrtPriceX96 || '0';
        const sqrtPriceX96 = BigInt(sqrtPriceX96Str);
        if (sqrtPriceX96 === 0n) { skipReasons.zeroSqrt++; continue; }

        // Token addresses and metadata from pool data
        const token0Address = poolData?.token0Address || (pos.token0Id || '').toLowerCase();
        const token1Address = poolData?.token1Address || (pos.token1Id || '').toLowerCase();
        const token0Decimals = poolData?.token0Decimals || pos.token0Decimals || 18;
        const token1Decimals = poolData?.token1Decimals || pos.token1Decimals || 18;
        const token0Symbol = poolData?.token0Symbol || pos.token0Symbol || null;
        const token1Symbol = poolData?.token1Symbol || pos.token1Symbol || null;
        const fee = poolData?.fee || pos.poolFee || null;
        const tickSpacing = poolData?.tickSpacing || pos.poolTickSpacing || null;

        if (!token0Address && !token1Address) { skipReasons.noTokens++; continue; }

        // Calculate token amounts from liquidity
        const { amount0, amount1 } = liquidityToAmounts(
          liquidity,
          sqrtPriceX96,
          tickLower,
          tickUpper
        );

        // Get prices from our multi-source price map
        const price0 = priceMap.get(token0Address) || 0;
        const price1 = priceMap.get(token1Address) || 0;
        if (price0 === 0 && price1 === 0) { skipReasons.noPrice++; continue; }

        // Calculate position value
        const amount0Float = Number(amount0) / (10 ** token0Decimals);
        const amount1Float = Number(amount1) / (10 ** token1Decimals);
        const positionValueUsd = (amount0Float * price0) + (amount1Float * price1);
        if (positionValueUsd < MIN_POSITION_VALUE_USD) { skipReasons.lowValue++; continue; }

        // Calculate age
        const createdAt = parseInt(pos.createdAtTimestamp || '0');
        const ageDays = createdAt > 0 ? Math.floor((now - createdAt) / 86400) : 0;
        if (ageDays < MIN_AGE_DAYS) { skipReasons.youngAge++; continue; }

        // Calculate deposited value
        const deposited0 = Number(BigInt(pos.depositedToken0 || '0')) / (10 ** token0Decimals);
        const deposited1 = Number(BigInt(pos.depositedToken1 || '0')) / (10 ** token1Decimals);
        const depositedValueUsd = (deposited0 * price0) + (deposited1 * price1);

        // Calculate collected fees
        const collected0 = Number(BigInt(pos.collectedFeesToken0 || '0')) / (10 ** token0Decimals);
        const collected1 = Number(BigInt(pos.collectedFeesToken1 || '0')) / (10 ** token1Decimals);
        const collectedFeesUsd = (collected0 * price0) + (collected1 * price1);

        // PnL and ROI
        const pnlUsd = positionValueUsd + collectedFeesUsd - (depositedValueUsd > 0 ? depositedValueUsd : positionValueUsd);
        const roi = depositedValueUsd > 0 ? (pnlUsd / depositedValueUsd) * 100 : 0;

        // APR calculations
        const feeApr = positionValueUsd > 0 && ageDays > 0
          ? (collectedFeesUsd / positionValueUsd) * (365 / ageDays) * 100
          : 0;
        const totalApr = depositedValueUsd > 0 && ageDays > 0
          ? (pnlUsd / depositedValueUsd) * (365 / ageDays) * 100
          : 0;

        // In-range check
        const inRange = currentTick >= tickLower && currentTick < tickUpper;

        candidates.push({
          tokenId: pos.tokenId,
          chainId: 8453,
          owner: pos.owner,
          poolId,
          token0Address,
          token1Address,
          token0Symbol,
          token1Symbol,
          token0Decimals,
          token1Decimals,
          fee,
          tickSpacing,
          tickLower,
          tickUpper,
          liquidity: pos.liquidity,
          currentTick,
          sqrtPriceX96: sqrtPriceX96Str,
          inRange,
          positionValueUsd: Math.round(positionValueUsd * 100) / 100,
          depositedToken0: pos.depositedToken0 || '0',
          depositedToken1: pos.depositedToken1 || '0',
          collectedFeesToken0: pos.collectedFeesToken0 || '0',
          collectedFeesToken1: pos.collectedFeesToken1 || '0',
          pendingFeesUsd: 0,
          feeApr: Math.round(feeApr * 100) / 100,
          totalApr: Math.round(totalApr * 100) / 100,
          pnlUsd: Math.round(pnlUsd * 100) / 100,
          roi: Math.round(roi * 100) / 100,
          ageDays,
          compoundEnabled: false,
          rangeEnabled: false,
          exitEnabled: false,
          compoundConfig: null,
          rangeConfig: null,
          exitConfig: null,
          rankByApr: null,
          rankByValue: null,
          rankByFees: null,
          lastSyncedAt: new Date(),
        });
      } catch (posError) {
        syncLogger.debug({ error: posError, tokenId: pos.tokenId }, 'Failed to process position');
      }
    }

    syncLogger.info({ candidates: candidates.length, skipReasons }, 'Calculated metrics for positions');

    if (candidates.length === 0) {
      syncLogger.warn('No qualifying positions after filtering');
      return;
    }

    // Step 5: Sort and rank
    candidates.sort((a, b) => b.totalApr - a.totalApr);
    const topByApr = candidates.slice(0, MAX_POSITIONS);

    const aprSorted = [...topByApr].sort((a, b) => b.totalApr - a.totalApr);
    const valueSorted = [...topByApr].sort((a, b) => b.positionValueUsd - a.positionValueUsd);
    const feeSorted = [...topByApr].sort((a, b) => b.feeApr - a.feeApr);

    for (let i = 0; i < topByApr.length; i++) {
      topByApr[i].rankByApr = aprSorted.findIndex(p => p.tokenId === topByApr[i].tokenId) + 1;
      topByApr[i].rankByValue = valueSorted.findIndex(p => p.tokenId === topByApr[i].tokenId) + 1;
      topByApr[i].rankByFees = feeSorted.findIndex(p => p.tokenId === topByApr[i].tokenId) + 1;
    }

    // Step 6: Upsert to DB and clean stale
    await upsertTopPositions(topByApr);
    const validTokenIds = topByApr.map(p => p.tokenId);
    await deleteStaleTopPositions(validTokenIds);

    const duration = Date.now() - startTime;
    syncLogger.info(
      {
        totalFetched: allPositions.length,
        qualified: candidates.length,
        stored: topByApr.length,
        durationMs: duration,
      },
      'Top positions sync completed'
    );
  } catch (error) {
    syncLogger.error({ error }, 'Top positions sync failed');
  } finally {
    isSyncing = false;
  }
}

/**
 * Enhance pool leaderboard with 7d/30d metrics and suggested ranges.
 * Uses Graph subgraph for pool tick data, DB for historical day data.
 */
export async function syncPoolLeaderboardMetrics(): Promise<void> {
  try {
    // Get pools from local DB
    const { pools } = await getV4Pools({ limit: 100, sortBy: 'tvl', sortOrder: 'desc' });
    if (!pools || pools.length === 0) return;

    // Get pool ticks from Graph subgraph (more reliable than Ponder pool table)
    const poolTickMap = new Map<string, { tick: number; sqrtPrice: string }>();
    try {
      const graphPools = await fetchGraphPools(200, 0, false);
      if (graphPools) {
        for (const gp of graphPools) {
          poolTickMap.set(gp.id.toLowerCase(), {
            tick: parseInt(gp.tick || '0'),
            sqrtPrice: gp.sqrtPrice || '0',
          });
        }
      }
    } catch { /* non-fatal — will fall back to top_positions data */ }

    // Fallback: get ticks from top_positions we synced
    if (poolTickMap.size === 0) {
      try {
        const { positions: topPos } = await import('../services/database.js')
          .then(m => m.getTopPositions({ limit: 500, sortBy: 'apr' }));
        for (const tp of topPos) {
          if (tp.poolId && tp.currentTick !== null && !poolTickMap.has(tp.poolId)) {
            poolTickMap.set(tp.poolId, { tick: tp.currentTick, sqrtPrice: tp.sqrtPriceX96 || '0' });
          }
        }
      } catch { /* non-fatal */ }
    }

    syncLogger.info({ poolCount: pools.length, tickSources: poolTickMap.size }, 'Enriching pools with leaderboard metrics');

    for (const pool of pools) {
      try {
        const poolId = pool.id;
        const tvlUsd = pool.tvlUsd || 0;
        const tickData = poolTickMap.get(poolId.toLowerCase());
        const tick = tickData?.tick || 0;
        const tickSpacing = pool.tickSpacing || 10;

        // Get pool day data from DB (populated by historical sync)
        const dayData = await getPoolDayDataFromDb(poolId, 30);

        let fees7d = 0;
        let fees30d = 0;

        for (let i = 0; i < dayData.length; i++) {
          const feesUsd = parseFloat(dayData[i].fees_usd || '0');
          fees30d += feesUsd;
          if (i < 7) fees7d += feesUsd;
        }

        const apr7d = tvlUsd > 0 && fees7d > 0 ? ((fees7d / 7) * 365 / tvlUsd) * 100 : 0;
        const apr30d = tvlUsd > 0 && fees30d > 0 ? ((fees30d / 30) * 365 / tvlUsd) * 100 : 0;
        const poolApr = tvlUsd > 0 && dayData.length > 0
          ? (parseFloat(dayData[0]?.fees_usd || '0') * 365 / tvlUsd) * 100
          : 0;

        // Calculate suggested ranges using Graph tick data
        const suggestedRangeFull = calculateSuggestedRange('full', tick, tickSpacing, poolApr);
        const suggestedRangeWide = calculateSuggestedRange('wide', tick, tickSpacing, poolApr);
        const suggestedRangeConcentrated = calculateSuggestedRange('concentrated', tick, tickSpacing, poolApr);

        await updatePoolLeaderboardMetrics(poolId, {
          fees7dUsd: Math.round(fees7d * 100) / 100,
          fees30dUsd: Math.round(fees30d * 100) / 100,
          apr7d: Math.round(apr7d * 100) / 100,
          apr30d: Math.round(apr30d * 100) / 100,
          suggestedRangeFull,
          suggestedRangeWide,
          suggestedRangeConcentrated,
        });
      } catch (error) {
        syncLogger.debug({ error, poolId: pool.id }, 'Failed to enrich pool with leaderboard metrics');
      }
    }

    syncLogger.info({ poolCount: pools.length }, 'Pool leaderboard metrics enrichment completed');
  } catch (error) {
    syncLogger.error({ error }, 'Pool leaderboard metrics sync failed');
  }
}

/**
 * Calculate suggested tick range for a given strategy.
 */
function calculateSuggestedRange(
  strategy: 'full' | 'wide' | 'concentrated',
  currentTick: number,
  tickSpacing: number,
  baseApr: number
): SuggestedRange {
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;

  const alignTick = (tick: number, spacing: number, roundDown: boolean): number => {
    const aligned = Math.floor(tick / spacing) * spacing;
    return roundDown ? aligned : aligned + spacing;
  };

  switch (strategy) {
    case 'full': {
      return {
        tickLower: alignTick(MIN_TICK, tickSpacing, false),
        tickUpper: alignTick(MAX_TICK, tickSpacing, true),
        expectedApr: baseApr,
        label: 'Full Range',
        risk: 'low',
      };
    }
    case 'wide': {
      const delta = 4055; // ±50% price range
      const lower = alignTick(currentTick - delta, tickSpacing, true);
      const upper = alignTick(currentTick + delta, tickSpacing, false);
      const concentrationMultiplier = (MAX_TICK - MIN_TICK) / (delta * 2);
      return {
        tickLower: lower,
        tickUpper: upper,
        expectedApr: Math.round(baseApr * Math.min(concentrationMultiplier, 5) * 100) / 100,
        label: 'Wide Range',
        risk: 'medium',
      };
    }
    case 'concentrated': {
      const delta = 488; // ±5% price range
      const lower = alignTick(currentTick - delta, tickSpacing, true);
      const upper = alignTick(currentTick + delta, tickSpacing, false);
      const concentrationMultiplier = (MAX_TICK - MIN_TICK) / (delta * 2);
      return {
        tickLower: lower,
        tickUpper: upper,
        expectedApr: Math.round(baseApr * Math.min(concentrationMultiplier, 50) * 100) / 100,
        label: 'Concentrated',
        risk: 'high',
      };
    }
  }
}

export function startTopPositionSyncJob(): CronJob {
  syncLogger.info('Starting top positions sync job (every 10 minutes)');

  // Run initial sync after 45-second delay (let pool + price syncs finish first)
  setTimeout(() => {
    syncTopPositions().catch((error) => {
      syncLogger.error({ error }, 'Initial top positions sync failed');
    });

    // Also enrich pools with leaderboard metrics after a further delay
    setTimeout(() => {
      syncPoolLeaderboardMetrics().catch((error) => {
        syncLogger.error({ error }, 'Initial pool leaderboard metrics sync failed');
      });
    }, 30000);
  }, 45000);

  const job = new CronJob(
    SYNC_INTERVAL,
    async () => {
      try {
        await syncTopPositions();
        await syncPoolLeaderboardMetrics();
      } catch (error) {
        syncLogger.error({ error }, 'Scheduled top positions sync failed');
      }
    },
    null,
    true
  );

  return job;
}
