import { startServer } from './api/server.js';
import { startAllBots } from './bots/index.js';
import { runNotificationChecks } from './services/notifications.js';
import { logger } from './utils/logger.js';

// Notification check interval (5 minutes)
const NOTIFICATION_CHECK_INTERVAL = 5 * 60 * 1000;

async function main() {
  logger.info('Starting Copypools Backend...');

  // Start API server (wait for database initialization to complete)
  await startServer();

  // Start automation bots
  startAllBots();

  // Start notification checker
  logger.info('Starting notification checker...');
  runNotificationChecks().catch(err => {
    logger.error({ err }, 'Initial notification check failed');
  });

  // Schedule periodic notification checks
  setInterval(() => {
    runNotificationChecks().catch(err => {
      logger.error({ err }, 'Periodic notification check failed');
    });
  }, NOTIFICATION_CHECK_INTERVAL);

  logger.info('Copypools Backend started successfully');
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start backend');
  process.exit(1);
});
