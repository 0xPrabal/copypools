import { CronJob } from 'cron';
import { startCompoundBot } from './compound-bot.js';
import { startAutoExitBot } from './auto-exit-bot.js';
import { startAutoRangeBot } from './auto-range-bot.js';
import { startLiquidationBot } from './liquidation-bot.js';
import { startPositionIndexer } from './position-indexer.js';
import { startPoolSyncJob, startConfigSyncJob } from './sync-pools.js';
import { runNotificationChecks } from '../services/notifications.js';
import { logger } from '../utils/logger.js';
import { config, contracts } from '../config/index.js';

const botsLogger = logger.child({ module: 'bots' });

// Track all jobs for graceful shutdown
const activeJobs: any[] = [];

export function startAllBots(): void {
  if (!config.BOT_ENABLED) {
    botsLogger.info('Bots are disabled');
    return;
  }

  botsLogger.info('Starting bots for deployed contracts...');

  // Start compound bot (V4Compoundor - deployed)
  const compoundJob = startCompoundBot();
  activeJobs.push(compoundJob);
  botsLogger.info('Compound bot started');

  // Start auto-range bot (V4AutoRange - deployed)
  const autoRangeJob = startAutoRangeBot();
  activeJobs.push(autoRangeJob);
  botsLogger.info('Auto-range bot started');

  // Start auto-exit bot only if contract is deployed
  if (contracts.v4AutoExit) {
    const autoExitJob = startAutoExitBot();
    activeJobs.push(autoExitJob);
    botsLogger.info('Auto-exit bot started');
  } else {
    botsLogger.warn('V4AutoExit contract not deployed - skipping auto-exit bot');
  }

  // Start liquidation bot only if vault contract is deployed
  if (contracts.v4Vault) {
    const liquidationJob = startLiquidationBot();
    activeJobs.push(liquidationJob);
    botsLogger.info('Liquidation bot started');
  } else {
    botsLogger.warn('V4Vault contract not deployed - skipping liquidation bot');
  }

  botsLogger.info(`${activeJobs.length} bots started successfully`);

  // Start position indexer (indexes Transfer events for all users)
  startPositionIndexer()
    .then(() => {
      botsLogger.info('Position indexer started');
    })
    .catch((error) => {
      botsLogger.error({ error }, 'Position indexer failed to start');
    });

  // Start notification service (runs every 10 minutes)
  const notificationJob = new CronJob('*/10 * * * *', runNotificationChecks, null, true);
  activeJobs.push(notificationJob);
  botsLogger.info('Notification service started (every 10 minutes)');

  // Start pool sync job (syncs V4 pools every 15 minutes)
  const poolSyncJob = startPoolSyncJob();
  activeJobs.push(poolSyncJob);
  botsLogger.info('Pool sync job started (every 15 minutes)');

  // Start automation config sync job (syncs compound/range/exit configs every 5 minutes)
  const configSyncJob = startConfigSyncJob();
  activeJobs.push(configSyncJob);
  botsLogger.info('Automation config sync job started (every 5 minutes)');
}

export function stopAllBots(): void {
  botsLogger.info('Stopping all bots...');
  activeJobs.forEach((job) => {
    try { job.stop(); } catch { /* already stopped */ }
  });
  activeJobs.length = 0;
  botsLogger.info('All bots stopped');
}

export {
  startCompoundBot,
  startAutoExitBot,
  startAutoRangeBot,
  startLiquidationBot,
};
