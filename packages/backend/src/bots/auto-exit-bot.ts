import { CronJob } from 'cron';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as subgraph from '../services/subgraph.js';
import * as blockchain from '../services/blockchain.js';
import { getSwapData } from '../services/swap.js';

const botLogger = logger.child({ bot: 'auto-exit' });

interface ExitablePosition {
  tokenId: string;
  poolId: string;
  exitType: number;
  triggerSqrtPriceX96: string;
  targetCurrency: string;
  maxPriceImpact: string;
  swapToSingleAsset: boolean;
}

async function processExit(position: ExitablePosition): Promise<boolean> {
  try {
    const tokenId = BigInt(position.tokenId);

    // Check exit condition on-chain
    const { shouldExit, exitType } = await blockchain.checkExit(tokenId);

    if (!shouldExit) {
      botLogger.debug({ tokenId: position.tokenId }, 'Exit conditions not met');
      return false;
    }

    // Get swap data for target currency
    const swapData = position.swapToSingleAsset
      ? await getSwapData(
          position.poolId,
          position.targetCurrency,
          position.targetCurrency,
          0n,
          0n
        )
      : '0x';

    // Execute exit
    const hash = await blockchain.executeExit(tokenId, swapData as `0x${string}`);

    botLogger.info(
      {
        tokenId: position.tokenId,
        hash,
        exitType,
      },
      'Exit executed successfully'
    );

    return true;
  } catch (error) {
    botLogger.error({ tokenId: position.tokenId, error }, 'Exit execution failed');
    return false;
  }
}

async function runAutoExitBot(): Promise<void> {
  botLogger.info('Starting auto-exit bot run');

  try {
    // Check gas price
    await blockchain.getGasPrice();

    // Get exitable positions from subgraph
    const result = await subgraph.getExitablePositions();
    const configs = (result as any).exitConfigs || [];

    botLogger.info({ count: configs.length }, 'Found exit configurations');

    let successCount = 0;
    let failCount = 0;

    for (const exitConfig of configs) {
      // Check deadline
      if (exitConfig.deadline && exitConfig.deadline !== '0') {
        const deadline = parseInt(exitConfig.deadline);
        const now = Math.floor(Date.now() / 1000);
        if (now > deadline) {
          botLogger.debug(
            { tokenId: exitConfig.position.tokenId },
            'Exit deadline passed'
          );
          continue;
        }
      }

      const position: ExitablePosition = {
        tokenId: exitConfig.position.tokenId,
        poolId: exitConfig.position.pool.id,
        exitType: exitConfig.exitType,
        triggerSqrtPriceX96: exitConfig.triggerSqrtPriceX96,
        targetCurrency: exitConfig.targetCurrency,
        maxPriceImpact: exitConfig.maxPriceImpact,
        swapToSingleAsset: exitConfig.swapToSingleAsset,
      };

      const success = await processExit(position);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    botLogger.info({ successCount, failCount }, 'Auto-exit bot run completed');
  } catch (error) {
    botLogger.error({ error }, 'Auto-exit bot run failed');
  }
}

export function startAutoExitBot(): CronJob {
  const intervalMs = config.AUTO_EXIT_INTERVAL_MS;
  // Convert to minutes for cron expression (minimum 1 minute)
  const intervalMinutes = Math.max(1, Math.floor(intervalMs / 60000));
  const cronExpression = `*/${intervalMinutes} * * * *`; // Every X minutes

  const job = new CronJob(cronExpression, runAutoExitBot, null, false);

  if (config.BOT_ENABLED) {
    job.start();
    botLogger.info({ intervalMs, intervalMinutes }, 'Auto-exit bot started');
  }

  return job;
}

export { runAutoExitBot };
