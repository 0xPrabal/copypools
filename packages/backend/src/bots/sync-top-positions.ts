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

const syncLogger = logger.child({ module: 'sync-top-positions' });

const SYNC_INTERVAL = '*/10 * * * *'; // Every 10 minutes
const MIN_POSITION_VALUE_USD = 500;
const MIN_AGE_DAYS = 1;
const MAX_POSITIONS = 500;

let isSyncing = false;

/**
 * Sync top positions from Ponder into the leaderboard table.
 * Fetches all active positions, calculates metrics, ranks them, and stores top 500.
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

    // Step 1: Fetch all active positions from Ponder with pool + token data
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

    // Step 2: Collect unique token addresses and batch-fetch prices
    const tokenAddresses = new Set<string>();
    for (const pos of allPositions) {
      if (pos.token0Id || pos.currency0) {
        tokenAddresses.add((pos.token0Id || pos.currency0 || '').toLowerCase());
      }
      if (pos.token1Id || pos.currency1) {
        tokenAddresses.add((pos.token1Id || pos.currency1 || '').toLowerCase());
      }
    }

    // Fetch prices from DB cache (populated by syncTokenPrices cron — no RPC/API calls)
    const priceMap = new Map<string, number>();
    const dbPrices = await getBatchTokenPricesFromDb(Array.from(tokenAddresses), 8453);
    for (const [addr, dbPrice] of dbPrices) {
      if (dbPrice.priceUsd != null && dbPrice.priceUsd > 0) {
        priceMap.set(addr, dbPrice.priceUsd);
      }
    }

    syncLogger.info({ pricesFound: priceMap.size, tokensTotal: tokenAddresses.size }, 'Fetched token prices');

    // Step 3: Calculate metrics for each position
    const now = Math.floor(Date.now() / 1000);
    const candidates: TopPosition[] = [];

    for (const pos of allPositions) {
      try {
        const liquidity = BigInt(pos.liquidity || '0');
        if (liquidity === 0n) continue;

        const tickLower = pos.tickLower;
        const tickUpper = pos.tickUpper;
        const currentTick = pos.poolTick ?? 0;
        const sqrtPriceX96Str = pos.poolSqrtPriceX96 || '0';
        const sqrtPriceX96 = BigInt(sqrtPriceX96Str);
        if (sqrtPriceX96 === 0n) continue;

        // Extract token addresses from poolId or join data
        const poolId = pos.poolId || '';
        const token0Address = (pos.token0Id || '').toLowerCase();
        const token1Address = (pos.token1Id || '').toLowerCase();
        const token0Decimals = pos.token0Decimals || 18;
        const token1Decimals = pos.token1Decimals || 18;

        // Calculate token amounts from liquidity
        const { amount0, amount1 } = liquidityToAmounts(
          liquidity,
          sqrtPriceX96,
          tickLower,
          tickUpper
        );

        // Get prices
        const price0 = priceMap.get(token0Address) || 0;
        const price1 = priceMap.get(token1Address) || 0;

        if (price0 === 0 && price1 === 0) continue;

        // Calculate position value
        const amount0Float = Number(amount0) / (10 ** token0Decimals);
        const amount1Float = Number(amount1) / (10 ** token1Decimals);
        const positionValueUsd = (amount0Float * price0) + (amount1Float * price1);

        if (positionValueUsd < MIN_POSITION_VALUE_USD) continue;

        // Calculate age
        const createdAt = parseInt(pos.createdAtTimestamp || '0');
        const ageDays = createdAt > 0 ? Math.floor((now - createdAt) / 86400) : 0;
        if (ageDays < MIN_AGE_DAYS) continue;

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

        // Build the top position object
        candidates.push({
          tokenId: pos.tokenId,
          chainId: 8453,
          owner: pos.owner,
          poolId,
          token0Address,
          token1Address,
          token0Symbol: pos.token0Symbol || null,
          token1Symbol: pos.token1Symbol || null,
          token0Decimals,
          token1Decimals,
          fee: pos.poolFee || null,
          tickSpacing: pos.tickSpacing || null,
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
          pendingFeesUsd: 0, // Would need on-chain call for pending fees
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
        // Skip individual position errors
        syncLogger.debug({ error: posError, tokenId: pos.tokenId }, 'Failed to process position');
      }
    }

    syncLogger.info({ candidates: candidates.length }, 'Calculated metrics for positions');

    if (candidates.length === 0) {
      syncLogger.warn('No qualifying positions after filtering');
      return;
    }

    // Step 4: Sort and rank
    // Sort by totalApr DESC, take top MAX_POSITIONS
    candidates.sort((a, b) => b.totalApr - a.totalApr);
    const topByApr = candidates.slice(0, MAX_POSITIONS);

    // Assign ranks
    const aprSorted = [...topByApr].sort((a, b) => b.totalApr - a.totalApr);
    const valueSorted = [...topByApr].sort((a, b) => b.positionValueUsd - a.positionValueUsd);
    const feeSorted = [...topByApr].sort((a, b) => b.feeApr - a.feeApr);

    for (let i = 0; i < topByApr.length; i++) {
      topByApr[i].rankByApr = aprSorted.findIndex(p => p.tokenId === topByApr[i].tokenId) + 1;
      topByApr[i].rankByValue = valueSorted.findIndex(p => p.tokenId === topByApr[i].tokenId) + 1;
      topByApr[i].rankByFees = feeSorted.findIndex(p => p.tokenId === topByApr[i].tokenId) + 1;
    }

    // Step 5: Upsert to DB and clean stale
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
 * Enhance pool sync with 7d/30d metrics and suggested ranges.
 * Called after pool day data is available in the DB.
 */
export async function syncPoolLeaderboardMetrics(): Promise<void> {
  try {
    // Get pools from local DB (no Graph API call — pools synced by syncPools job)
    const { pools } = await getV4Pools({ limit: 100, sortBy: 'tvl', sortOrder: 'desc' });
    if (!pools || pools.length === 0) return;

    // Build a pool→tick map from the top_positions we just synced (avoids Graph call)
    const poolTickMap = new Map<string, number>();
    try {
      const { positions: topPos } = await import('../services/database.js')
        .then(m => m.getTopPositions({ limit: 500, sortBy: 'apr' }));
      for (const tp of topPos) {
        if (tp.poolId && tp.currentTick !== null && !poolTickMap.has(tp.poolId)) {
          poolTickMap.set(tp.poolId, tp.currentTick);
        }
      }
    } catch { /* non-fatal */ }

    syncLogger.info({ poolCount: pools.length }, 'Enriching pools with leaderboard metrics');

    for (const pool of pools) {
      try {
        const poolId = pool.id;
        const tvlUsd = pool.tvlUsd || 0;
        const tick = poolTickMap.get(poolId) || 0;
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

        // Calculate suggested ranges
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
  // Uniswap V4 MIN/MAX tick constants
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
      // ±50% price range: ln(1.50)/ln(1.0001) ≈ 4055 ticks
      const delta = 4055;
      const lower = alignTick(currentTick - delta, tickSpacing, true);
      const upper = alignTick(currentTick + delta, tickSpacing, false);
      // Concentrated liquidity earns more per unit — rough multiplier
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
      // ±5% price range: ln(1.05)/ln(1.0001) ≈ 488 ticks
      const delta = 488;
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
        // Run pool metrics enrichment after positions sync
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
