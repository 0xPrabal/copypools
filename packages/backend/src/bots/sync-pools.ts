import { CronJob } from 'cron';
import { logger } from '../utils/logger.js';
import { fetchAllPools } from '../services/uniswap-subgraph.js';
import {
  batchUpsertV4Pools, getPoolsLastSyncTime, getPositionsNeedingConfigSync,
  batchUpdatePositionConfigs, upsertTokenPrices, upsertPoolDayData,
  upsertPoolSwaps, upsertPoolTicks, upsertProtocolStats, upsertProtocolDayData
} from '../services/database.js';
import { batchGetCompoundConfigs, batchGetRangeConfigs, batchGetExitConfigs } from '../services/blockchain.js';
import {
  fetchTokenPrices, fetchEthPrice, fetchTopTokens,
  fetchGraphPools, fetchPoolDayData, fetchSwaps, fetchTicks,
  fetchProtocolStats, fetchUniswapDayData
} from '../services/graph-client.js';

const syncLogger = logger.child({ module: 'sync-pools' });

// Sync pools every 15 minutes
const SYNC_INTERVAL = '*/15 * * * *';

let isSyncing = false;

export async function syncPools(): Promise<void> {
  if (isSyncing) {
    syncLogger.info('Pool sync already in progress, skipping');
    return;
  }

  isSyncing = true;
  const startTime = Date.now();

  try {
    syncLogger.info('Starting pool sync...');

    // Fetch pools from external sources
    const pools = await fetchAllPools();

    if (pools.length === 0) {
      syncLogger.warn('No pools fetched from external sources');
      return;
    }

    syncLogger.info({ count: pools.length }, 'Fetched pools from external sources');

    // Filter out pools without required fields (fee must be > 0)
    const validPools = pools.filter(
      (pool): pool is typeof pool & { id: string; currency0: string; currency1: string; fee: number } =>
        !!pool.id && !!pool.currency0 && !!pool.currency1 && pool.fee !== undefined && pool.fee > 0
    );

    if (validPools.length === 0) {
      syncLogger.warn('No valid pools to upsert after filtering');
      return;
    }

    // Upsert pools to database
    await batchUpsertV4Pools(validPools);

    const duration = Date.now() - startTime;
    syncLogger.info(
      { count: pools.length, durationMs: duration },
      'Pool sync completed successfully'
    );
  } catch (error) {
    syncLogger.error({ error }, 'Pool sync failed');
    throw error;
  } finally {
    isSyncing = false;
  }
}

export function startPoolSyncJob(): CronJob {
  syncLogger.info('Starting pool sync job (every 15 minutes)');

  // Run initial sync immediately
  syncPools().catch((error) => {
    syncLogger.error({ error }, 'Initial pool sync failed');
  });

  // Schedule recurring sync
  const job = new CronJob(
    SYNC_INTERVAL,
    async () => {
      try {
        await syncPools();
      } catch (error) {
        syncLogger.error({ error }, 'Scheduled pool sync failed');
      }
    },
    null,
    true // Start the job immediately
  );

  return job;
}

// ============ Automation Config Sync (Phase 1 DB Caching) ============

const CONFIG_SYNC_INTERVAL = '*/5 * * * *'; // Every 5 minutes
let isConfigSyncing = false;

/**
 * Background sync job: reads automation configs from chain via batch multicall
 * and writes them to the positions DB. This eliminates RPC calls from the request path.
 */
export async function syncAutomationConfigs(): Promise<void> {
  if (isConfigSyncing) {
    syncLogger.info('Config sync already in progress, skipping');
    return;
  }

  isConfigSyncing = true;
  const startTime = Date.now();

  try {
    // Get positions with active liquidity that have null configs
    const positions = await getPositionsNeedingConfigSync(8453, 50);

    if (positions.length === 0) {
      syncLogger.debug('No positions need config sync');
      return;
    }

    syncLogger.info({ count: positions.length }, 'Syncing automation configs for positions');

    // Collect token IDs needing each config type
    const needCompound = positions.filter(p => !p.compoundConfig).map(p => BigInt(p.tokenId));
    const needRange = positions.filter(p => !p.rangeConfig).map(p => BigInt(p.tokenId));
    const needExit = positions.filter(p => !p.exitConfig).map(p => BigInt(p.tokenId));

    // Batch multicall for all missing configs (max 3 RPC calls total)
    const [compoundConfigs, rangeConfigs, exitConfigs] = await Promise.all([
      needCompound.length > 0 ? batchGetCompoundConfigs(needCompound) : Promise.resolve(new Map()),
      needRange.length > 0 ? batchGetRangeConfigs(needRange) : Promise.resolve(new Map()),
      needExit.length > 0 ? batchGetExitConfigs(needExit) : Promise.resolve(new Map()),
    ]);

    // Prepare DB updates
    const updates: Array<{
      tokenId: string;
      chainId: number;
      compoundConfig?: any;
      rangeConfig?: any;
      exitConfig?: any;
    }> = [];

    for (const pos of positions) {
      const update: typeof updates[0] = { tokenId: pos.tokenId, chainId: 8453 };
      let hasUpdate = false;

      if (!pos.compoundConfig) {
        const config = compoundConfigs.get(pos.tokenId);
        if (config) {
          update.compoundConfig = config.enabled ? {
            enabled: config.enabled,
            minCompoundInterval: config.minCompoundInterval,
            minRewardAmount: config.minRewardAmount.toString(),
          } : { enabled: false };
          hasUpdate = true;
        }
      }

      if (!pos.rangeConfig) {
        const config = rangeConfigs.get(pos.tokenId);
        if (config) {
          update.rangeConfig = config.enabled ? config : { enabled: false };
          hasUpdate = true;
        }
      }

      if (!pos.exitConfig) {
        const config = exitConfigs.get(pos.tokenId);
        if (config) {
          update.exitConfig = config.enabled ? {
            enabled: config.enabled,
            triggerTickLower: config.triggerTickLower,
            triggerTickUpper: config.triggerTickUpper,
            exitOnRangeExit: config.exitOnRangeExit,
            exitToken: config.exitToken,
            maxSwapSlippage: config.maxSwapSlippage.toString(),
            minExitInterval: config.minExitInterval,
          } : { enabled: false };
          hasUpdate = true;
        }
      }

      if (hasUpdate) updates.push(update);
    }

    // Write to DB
    if (updates.length > 0) {
      await batchUpdatePositionConfigs(updates);
    }

    const duration = Date.now() - startTime;
    syncLogger.info(
      {
        positions: positions.length,
        updated: updates.length,
        rpcCalls: (needCompound.length > 0 ? 1 : 0) + (needRange.length > 0 ? 1 : 0) + (needExit.length > 0 ? 1 : 0),
        durationMs: duration,
      },
      'Automation config sync completed'
    );
  } catch (error) {
    syncLogger.error({ error }, 'Automation config sync failed');
  } finally {
    isConfigSyncing = false;
  }
}

export function startConfigSyncJob(): CronJob {
  syncLogger.info('Starting automation config sync job (every 5 minutes)');

  // Run initial sync after a 30-second delay (let pool sync finish first)
  setTimeout(() => {
    syncAutomationConfigs().catch((error) => {
      syncLogger.error({ error }, 'Initial config sync failed');
    });
  }, 30000);

  const job = new CronJob(
    CONFIG_SYNC_INTERVAL,
    async () => {
      try {
        await syncAutomationConfigs();
      } catch (error) {
        syncLogger.error({ error }, 'Scheduled config sync failed');
      }
    },
    null,
    true
  );

  return job;
}

// ============ Pool Historical Data Sync (Phase 3 DB Caching) ============

const HISTORICAL_SYNC_INTERVAL = '*/15 * * * *'; // Every 15 minutes
let isHistoricalSyncing = false;

/**
 * Background sync job: fetches pool day data, swaps, and ticks from Graph
 * for top pools and writes to DB. Eliminates Graph calls from request path.
 */
export async function syncPoolHistoricalData(): Promise<void> {
  if (isHistoricalSyncing) {
    syncLogger.info('Historical data sync already in progress, skipping');
    return;
  }

  isHistoricalSyncing = true;
  const startTime = Date.now();

  try {
    // Get top pools from Graph (these are the ones users are most likely to query)
    const pools = await fetchGraphPools(50, 10, false);
    if (!pools || pools.length === 0) {
      syncLogger.warn('No pools returned from Graph for historical sync');
      return;
    }

    syncLogger.info({ poolCount: pools.length }, 'Starting historical data sync for top pools');

    let syncedDayData = 0;
    let syncedSwaps = 0;
    let syncedTicks = 0;

    // Process pools in batches of 5 to avoid overwhelming the Graph API
    const BATCH_SIZE = 5;
    for (let i = 0; i < pools.length; i += BATCH_SIZE) {
      const batch = pools.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (pool: any) => {
          try {
            // Fetch day data, swaps, and ticks in parallel per pool
            const [dayData, swaps, ticks] = await Promise.all([
              fetchPoolDayData(pool.id, 30),
              fetchSwaps(pool.id, 50),
              fetchTicks(pool.id, 200),
            ]);

            // Upsert day data
            if (dayData.length > 0) {
              await upsertPoolDayData(pool.id, dayData);
              syncedDayData += dayData.length;
            }

            // Upsert swaps
            if (swaps.length > 0) {
              await upsertPoolSwaps(
                swaps.map((s: any) => ({
                  id: s.id,
                  poolId: pool.id,
                  timestamp: s.timestamp,
                  sender: s.sender,
                  token0Symbol: s.token0?.symbol || '',
                  token1Symbol: s.token1?.symbol || '',
                  amount0: s.amount0,
                  amount1: s.amount1,
                  amountUSD: s.amountUSD,
                  tick: s.tick,
                }))
              );
              syncedSwaps += swaps.length;
            }

            // Upsert ticks
            if (ticks.length > 0) {
              await upsertPoolTicks(pool.id, ticks);
              syncedTicks += ticks.length;
            }
          } catch (error) {
            syncLogger.warn({ error, poolId: pool.id }, 'Failed to sync historical data for pool');
          }
        })
      );

      // Brief delay between batches
      if (i + BATCH_SIZE < pools.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Date.now() - startTime;
    syncLogger.info(
      { pools: pools.length, syncedDayData, syncedSwaps, syncedTicks, durationMs: duration },
      'Pool historical data sync completed'
    );
  } catch (error) {
    syncLogger.error({ error }, 'Pool historical data sync failed');
  } finally {
    isHistoricalSyncing = false;
  }
}

export function startHistoricalDataSyncJob(): CronJob {
  syncLogger.info('Starting pool historical data sync job (every 15 minutes)');

  // Run initial sync after 60-second delay (let other syncs finish first)
  setTimeout(() => {
    syncPoolHistoricalData().catch((error) => {
      syncLogger.error({ error }, 'Initial historical data sync failed');
    });
  }, 60000);

  const job = new CronJob(
    HISTORICAL_SYNC_INTERVAL,
    async () => {
      try {
        await syncPoolHistoricalData();
      } catch (error) {
        syncLogger.error({ error }, 'Scheduled historical data sync failed');
      }
    },
    null,
    true
  );

  return job;
}

// ============ Token Price Sync (Phase 2 DB Caching) ============

const PRICE_SYNC_INTERVAL = '*/2 * * * *'; // Every 2 minutes
let isPriceSyncing = false;

/**
 * Background sync job: fetches token prices from Graph subgraph
 * and writes them to the token_prices DB table.
 */
export async function syncTokenPrices(): Promise<void> {
  if (isPriceSyncing) {
    syncLogger.info('Token price sync already in progress, skipping');
    return;
  }

  isPriceSyncing = true;
  const startTime = Date.now();

  try {
    // Get top tokens from Graph to know which addresses to price
    const topTokens = await fetchTopTokens(50);
    if (!topTokens || topTokens.length === 0) {
      syncLogger.warn('No tokens returned from Graph for price sync');
      return;
    }

    // Get ETH price for derivedETH conversion
    const ethPrice = await fetchEthPrice();

    // Get token prices from Graph (derivedETH + Bundle)
    const addresses = topTokens.map((t: any) => t.id);
    const graphPrices = await fetchTokenPrices(addresses);

    // Build upsert data
    const priceUpdates: Array<{
      address: string;
      chainId: number;
      symbol?: string;
      decimals?: number;
      priceUsd: number | null;
      derivedEth?: number | null;
      source: string;
    }> = [];

    for (const token of topTokens) {
      const graphPrice = graphPrices.get(token.id.toLowerCase());
      const derivedEth = parseFloat(token.derivedETH || '0');

      priceUpdates.push({
        address: token.id,
        chainId: 8453,
        symbol: token.symbol,
        decimals: parseInt(token.decimals || '18'),
        priceUsd: graphPrice ?? (derivedEth > 0 && ethPrice > 0 ? derivedEth * ethPrice : null),
        derivedEth: derivedEth > 0 ? derivedEth : null,
        source: 'graph',
      });
    }

    // Also store ETH price explicitly
    if (ethPrice > 0) {
      priceUpdates.push({
        address: '0x0000000000000000000000000000000000000000',
        chainId: 8453,
        symbol: 'ETH',
        decimals: 18,
        priceUsd: ethPrice,
        source: 'graph:bundle',
      });
      priceUpdates.push({
        address: '0x4200000000000000000000000000000000000006',
        chainId: 8453,
        symbol: 'WETH',
        decimals: 18,
        priceUsd: ethPrice,
        source: 'graph:bundle',
      });
    }

    // Upsert to DB
    if (priceUpdates.length > 0) {
      await upsertTokenPrices(priceUpdates);
    }

    const duration = Date.now() - startTime;
    syncLogger.info(
      { tokens: priceUpdates.length, ethPrice, durationMs: duration },
      'Token price sync completed'
    );
  } catch (error) {
    syncLogger.error({ error }, 'Token price sync failed');
  } finally {
    isPriceSyncing = false;
  }
}

export function startTokenPriceSyncJob(): CronJob {
  syncLogger.info('Starting token price sync job (every 2 minutes)');

  // Run initial sync after 15-second delay
  setTimeout(() => {
    syncTokenPrices().catch((error) => {
      syncLogger.error({ error }, 'Initial token price sync failed');
    });
  }, 15000);

  const job = new CronJob(
    PRICE_SYNC_INTERVAL,
    async () => {
      try {
        await syncTokenPrices();
      } catch (error) {
        syncLogger.error({ error }, 'Scheduled token price sync failed');
      }
    },
    null,
    true
  );

  return job;
}

// ============ Protocol Stats Sync (Phase 4 DB Caching) ============

const PROTOCOL_STATS_SYNC_INTERVAL = '*/15 * * * *'; // Every 15 minutes
let isProtocolStatsSyncing = false;

/**
 * Background sync job: fetches protocol stats and daily data from Graph
 * and writes to DB. Eliminates Graph calls from /analytics/* request path.
 */
export async function syncProtocolStatsData(): Promise<void> {
  if (isProtocolStatsSyncing) {
    syncLogger.info('Protocol stats sync already in progress, skipping');
    return;
  }

  isProtocolStatsSyncing = true;
  const startTime = Date.now();

  try {
    // Fetch protocol stats and daily data in parallel from Graph (2 queries)
    const [stats, dayData] = await Promise.all([
      fetchProtocolStats(),
      fetchUniswapDayData(30),
    ]);

    // Upsert protocol stats
    if (stats) {
      await upsertProtocolStats({
        poolCount: parseInt(stats.poolCount) || 0,
        txCount: parseInt(stats.txCount) || 0,
        totalVolumeUsd: parseFloat(stats.totalVolumeUSD) || 0,
        totalFeesUsd: parseFloat(stats.totalFeesUSD) || 0,
        totalValueLockedUsd: parseFloat(stats.totalValueLockedUSD) || 0,
        poolManagerAddress: stats.id,
      });
    }

    // Upsert protocol day data
    if (dayData && dayData.length > 0) {
      await upsertProtocolDayData(dayData);
    }

    const duration = Date.now() - startTime;
    syncLogger.info(
      { hasStats: !!stats, dayDataCount: dayData?.length || 0, durationMs: duration },
      'Protocol stats sync completed'
    );
  } catch (error) {
    syncLogger.error({ error }, 'Protocol stats sync failed');
  } finally {
    isProtocolStatsSyncing = false;
  }
}

export function startProtocolStatsSyncJob(): CronJob {
  syncLogger.info('Starting protocol stats sync job (every 15 minutes)');

  // Run initial sync after 20-second delay
  setTimeout(() => {
    syncProtocolStatsData().catch((error) => {
      syncLogger.error({ error }, 'Initial protocol stats sync failed');
    });
  }, 20000);

  const job = new CronJob(
    PROTOCOL_STATS_SYNC_INTERVAL,
    async () => {
      try {
        await syncProtocolStatsData();
      } catch (error) {
        syncLogger.error({ error }, 'Scheduled protocol stats sync failed');
      }
    },
    null,
    true
  );

  return job;
}

// Get status of last sync
export async function getPoolSyncStatus(): Promise<{
  lastSyncTime: Date | null;
  isSyncing: boolean;
}> {
  const lastSyncTime = await getPoolsLastSyncTime();
  return {
    lastSyncTime,
    isSyncing,
  };
}
