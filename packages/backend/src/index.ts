import { startServer } from './api/server.js';
import { startAllBots, stopAllBots } from './bots/index.js';
import { runNotificationChecks } from './services/notifications.js';
import { closeConnection as closePonderDb } from './services/subgraph.js';
import { logger } from './utils/logger.js';

// Notification check interval (5 minutes)
const NOTIFICATION_CHECK_INTERVAL = 5 * 60 * 1000;

// Track intervals for cleanup
let notificationInterval: ReturnType<typeof setInterval> | null = null;
let server: any = null;

async function main() {
  logger.info('Starting Copypools Backend...');

  // Start API server (wait for database initialization to complete)
  server = await startServer();

  // Start automation bots
  startAllBots();

  // Start notification checker
  logger.info('Starting notification checker...');
  runNotificationChecks().catch(err => {
    logger.error({ err }, 'Initial notification check failed');
  });

  // Schedule periodic notification checks
  notificationInterval = setInterval(() => {
    runNotificationChecks().catch(err => {
      logger.error({ err }, 'Periodic notification check failed');
    });
  }, NOTIFICATION_CHECK_INTERVAL);

  logger.info('Copypools Backend started successfully');
}

// Graceful shutdown handler
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received, draining...');

  // Clear intervals
  if (notificationInterval) {
    clearInterval(notificationInterval);
    notificationInterval = null;
  }

  // Stop bots
  stopAllBots();

  // Close HTTP server (stop accepting new connections, drain existing)
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
      // Force close after 10 seconds
      setTimeout(() => {
        logger.warn('Forcing HTTP server close after timeout');
        resolve();
      }, 10_000);
    });
  }

  // Close database connections
  try {
    await closePonderDb();
    logger.info('Database connections closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database connections');
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  logger.error({ error }, 'Failed to start backend');
  process.exit(1);
});
