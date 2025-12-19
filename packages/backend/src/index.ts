import { startServer } from './api/server.js';
import { startAllBots } from './bots/index.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting Copypools Backend...');

  // Start API server (wait for database initialization to complete)
  await startServer();

  // Start automation bots
  startAllBots();

  logger.info('Copypools Backend started successfully');
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start backend');
  process.exit(1);
});
