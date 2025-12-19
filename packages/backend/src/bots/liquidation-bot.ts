import { CronJob } from 'cron';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as subgraph from '../services/subgraph.js';
import * as blockchain from '../services/blockchain.js';
import { getSwapData } from '../services/swap.js';

const botLogger = logger.child({ bot: 'liquidation' });

interface LiquidatableLoan {
  tokenId: string;
  borrower: string;
  borrowedCurrency: string;
  borrowedAmount: string;
  healthFactor: string;
  vaultAddress: string;
}

async function processLiquidation(loan: LiquidatableLoan): Promise<boolean> {
  try {
    const tokenId = BigInt(loan.tokenId);

    // Verify liquidatable on-chain
    const isLiquidatable = await blockchain.checkLiquidatable(tokenId);

    if (!isLiquidatable) {
      botLogger.debug({ tokenId: loan.tokenId }, 'Not liquidatable');
      return false;
    }

    // Get health factor
    const healthFactor = await blockchain.getHealthFactor(tokenId);
    botLogger.info(
      { tokenId: loan.tokenId, healthFactor: healthFactor.toString() },
      'Liquidating position'
    );

    // Calculate repay amount (liquidate 50% of debt)
    const borrowedAmount = BigInt(loan.borrowedAmount);
    const repayAmount = borrowedAmount / 2n;

    // Get swap data for liquidation
    const swapData = await getSwapData(
      loan.vaultAddress,
      loan.borrowedCurrency,
      loan.borrowedCurrency,
      repayAmount,
      0n
    );

    // Execute liquidation
    const hash = await blockchain.executeLiquidation(tokenId, repayAmount, swapData);

    botLogger.info(
      {
        tokenId: loan.tokenId,
        hash,
        repayAmount: repayAmount.toString(),
      },
      'Liquidation successful'
    );

    return true;
  } catch (error) {
    botLogger.error({ tokenId: loan.tokenId, error }, 'Liquidation failed');
    return false;
  }
}

async function runLiquidationBot(): Promise<void> {
  botLogger.info('Starting liquidation bot run');

  try {
    // Check gas price
    await blockchain.getGasPrice();

    // Get liquidatable loans from subgraph
    const result = await subgraph.getLiquidatableLoans();
    const loans = (result as any).loans || [];

    botLogger.info({ count: loans.length }, 'Found liquidatable loans');

    let successCount = 0;
    let failCount = 0;

    for (const loan of loans) {
      const loanData: LiquidatableLoan = {
        tokenId: loan.position.tokenId,
        borrower: loan.borrower,
        borrowedCurrency: loan.borrowedCurrency,
        borrowedAmount: loan.borrowedAmount,
        healthFactor: loan.healthFactor,
        vaultAddress: loan.vault.id,
      };

      const success = await processLiquidation(loanData);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    botLogger.info({ successCount, failCount }, 'Liquidation bot run completed');
  } catch (error) {
    botLogger.error({ error }, 'Liquidation bot run failed');
  }
}

export function startLiquidationBot(): CronJob {
  const intervalMs = config.LIQUIDATION_INTERVAL_MS;
  const cronExpression = `*/${Math.floor(intervalMs / 1000)} * * * * *`;

  const job = new CronJob(cronExpression, runLiquidationBot, null, false);

  if (config.BOT_ENABLED) {
    job.start();
    botLogger.info({ intervalMs }, 'Liquidation bot started');
  }

  return job;
}

export { runLiquidationBot };
