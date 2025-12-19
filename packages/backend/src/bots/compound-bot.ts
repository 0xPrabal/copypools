import { CronJob } from 'cron';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as subgraph from '../services/subgraph.js';
import * as blockchain from '../services/blockchain.js';
import { getSwapData } from '../services/swap.js';

const botLogger = logger.child({ bot: 'compound' });

interface CompoundablePosition {
  tokenId: string;
  poolId: string;
  token0: string;
  token1: string;
  lastCompoundTimestamp: string | null;
  minCompoundInterval: number;
  minRewardAmount: string;
}

async function processCompound(position: CompoundablePosition): Promise<boolean> {
  try {
    const tokenId = BigInt(position.tokenId);

    // Check if profitable on-chain
    const { profitable, reward } = await blockchain.checkCompoundProfitable(tokenId);

    if (!profitable) {
      botLogger.debug({ tokenId: position.tokenId }, 'Not profitable to compound');
      return false;
    }

    // Get pending fees
    const { amount0, amount1 } = await blockchain.getPendingFees(tokenId);

    if (amount0 === 0n && amount1 === 0n) {
      botLogger.debug({ tokenId: position.tokenId }, 'No fees to compound');
      return false;
    }

    // Get optimal swap data for rebalancing
    const swapData = await getSwapData(
      position.poolId,
      position.token0,
      position.token1,
      amount0,
      amount1
    );

    // Execute compound
    const hash = await blockchain.executeCompound(tokenId, swapData);

    botLogger.info(
      {
        tokenId: position.tokenId,
        hash,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        reward: reward.toString(),
      },
      'Compound successful'
    );

    return true;
  } catch (error) {
    botLogger.error({ tokenId: position.tokenId, error }, 'Compound failed');
    return false;
  }
}

async function runCompoundBot(): Promise<void> {
  botLogger.info('Starting compound bot run');

  try {
    // Check gas price
    const gasPrice = await blockchain.getGasPrice();
    botLogger.debug({ gasPrice: gasPrice.toString() }, 'Current gas price');

    // Get compoundable positions from subgraph
    const result = await subgraph.getCompoundablePositions('0');
    const positions = (result as any).compoundConfigs || [];

    botLogger.info({ count: positions.length }, 'Found compoundable positions');

    let successCount = 0;
    let failCount = 0;

    for (const config of positions) {
      // Check time interval
      const lastCompound = config.lastCompoundTimestamp
        ? parseInt(config.lastCompoundTimestamp)
        : 0;
      const now = Math.floor(Date.now() / 1000);

      if (now - lastCompound < config.minCompoundInterval) {
        botLogger.debug(
          { tokenId: config.position.tokenId },
          'Too soon to compound'
        );
        continue;
      }

      const position: CompoundablePosition = {
        tokenId: config.position.tokenId,
        poolId: config.position.pool.id,
        token0: config.position.pool.token0.id,
        token1: config.position.pool.token1.id,
        lastCompoundTimestamp: config.lastCompoundTimestamp,
        minCompoundInterval: config.minCompoundInterval,
        minRewardAmount: config.minRewardAmount,
      };

      const success = await processCompound(position);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    botLogger.info({ successCount, failCount }, 'Compound bot run completed');
  } catch (error) {
    botLogger.error({ error }, 'Compound bot run failed');
  }
}

export function startCompoundBot(): CronJob {
  const intervalMs = config.COMPOUND_INTERVAL_MS;
  const cronExpression = `*/${Math.floor(intervalMs / 1000)} * * * * *`;

  const job = new CronJob(cronExpression, runCompoundBot, null, false);

  if (config.BOT_ENABLED) {
    job.start();
    botLogger.info({ intervalMs }, 'Compound bot started');
  }

  return job;
}

export { runCompoundBot };
