import { CronJob } from 'cron';
import { logger } from '../utils/logger.js';
import { fetchAllPools } from '../services/uniswap-subgraph.js';
import { batchUpsertV4Pools, getPoolsLastSyncTime } from '../services/database.js';

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

    // Filter out pools without required fields
    const validPools = pools.filter(
      (pool): pool is typeof pool & { id: string; currency0: string; currency1: string; fee: number } =>
        !!pool.id && !!pool.currency0 && !!pool.currency1 && pool.fee !== undefined
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
