import { CronJob } from 'cron';
import { startCompoundBot } from './compound-bot.js';
import { startAutoExitBot } from './auto-exit-bot.js';
import { startAutoRangeBot } from './auto-range-bot.js';
import { startLiquidationBot } from './liquidation-bot.js';
import { startPositionIndexer } from './position-indexer.js';
import { runNotificationChecks } from '../services/notifications.js';
import { logger } from '../utils/logger.js';
import { config, contracts } from '../config/index.js';

const botsLogger = logger.child({ module: 'bots' });

export function startAllBots(): void {
  if (!config.BOT_ENABLED) {
    botsLogger.info('Bots are disabled');
    return;
  }

  botsLogger.info('Starting bots for deployed contracts...');

  const jobs: any[] = [];

  // Start compound bot (V4Compoundor - deployed)
  const compoundJob = startCompoundBot();
  jobs.push(compoundJob);
  botsLogger.info('Compound bot started');

  // Start auto-range bot (V4AutoRange - deployed)
  const autoRangeJob = startAutoRangeBot();
  jobs.push(autoRangeJob);
  botsLogger.info('Auto-range bot started');

  // Start auto-exit bot only if contract is deployed
  let autoExitJob: any = null;
  if (contracts.v4AutoExit) {
    autoExitJob = startAutoExitBot();
    jobs.push(autoExitJob);
    botsLogger.info('Auto-exit bot started');
  } else {
    botsLogger.warn('V4AutoExit contract not deployed - skipping auto-exit bot');
  }

  // Start liquidation bot only if vault contract is deployed
  let liquidationJob: any = null;
  if (contracts.v4Vault) {
    liquidationJob = startLiquidationBot();
    jobs.push(liquidationJob);
    botsLogger.info('Liquidation bot started');
  } else {
    botsLogger.warn('V4Vault contract not deployed - skipping liquidation bot');
  }

  botsLogger.info(`${jobs.length} bots started successfully`);

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
  jobs.push(notificationJob);
  botsLogger.info('Notification service started (every 10 minutes)');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    botsLogger.info('Stopping bots...');
    jobs.forEach((job) => job.stop());
    botsLogger.info('All bots stopped');
    process.exit(0);
  });
}

export {
  startCompoundBot,
  startAutoExitBot,
  startAutoRangeBot,
  startLiquidationBot,
};
