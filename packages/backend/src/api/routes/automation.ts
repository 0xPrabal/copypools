import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as blockchain from '../../services/blockchain.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const routeLogger = logger.child({ route: 'automation' });

// ========== Auto-Compound Endpoints ==========

// Get compound config for a position
router.get('/compound/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Get pending fees
    const pendingFees = await blockchain.getPendingFees(BigInt(tokenId));
    const { profitable, reward } = await blockchain.checkCompoundProfitable(BigInt(tokenId));

    res.json({
      tokenId,
      config: position.compoundConfig,
      pendingFees: {
        amount0: pendingFees.amount0.toString(),
        amount1: pendingFees.amount1.toString(),
      },
      profitable,
      estimatedReward: reward.toString(),
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get compound config');
    res.status(500).json({ error: 'Failed to fetch compound config' });
  }
});

// Get all compoundable positions
router.get('/compound', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getCompoundablePositions('0', parseInt(limit as string));
    res.json((result as any).compoundConfigs || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get compoundable positions');
    res.status(500).json({ error: 'Failed to fetch compoundable positions' });
  }
});

// ========== Auto-Exit Endpoints ==========

// Get exit config for a position
router.get('/exit/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Check exit condition
    const { shouldExit, exitType } = await blockchain.checkExit(BigInt(tokenId));

    res.json({
      tokenId,
      config: position.exitConfig,
      currentPrice: position.pool.sqrtPriceX96,
      shouldExit,
      exitType,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get exit config');
    res.status(500).json({ error: 'Failed to fetch exit config' });
  }
});

// Get all exitable positions
router.get('/exit', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getExitablePositions(parseInt(limit as string));
    res.json((result as any).exitConfigs || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get exitable positions');
    res.status(500).json({ error: 'Failed to fetch exitable positions' });
  }
});

// ========== Auto-Range Endpoints ==========

// Get range config for a position
router.get('/range/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Check rebalance condition
    const { needsRebalance, reason } = await blockchain.checkRebalance(BigInt(tokenId));

    res.json({
      tokenId,
      config: position.rangeConfig,
      currentTick: position.pool.tick,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      needsRebalance,
      reason,
      inRange: position.pool.tick >= position.tickLower && position.pool.tick < position.tickUpper,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get range config');
    res.status(500).json({ error: 'Failed to fetch range config' });
  }
});

// Get all rebalanceable positions
router.get('/range', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getRebalanceablePositions(parseInt(limit as string));
    res.json((result as any).rangeConfigs || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get rebalanceable positions');
    res.status(500).json({ error: 'Failed to fetch rebalanceable positions' });
  }
});

// ========== Batch Status Endpoint ==========

// Get automation status for multiple positions
router.post('/batch-status', async (req: Request, res: Response) => {
  try {
    const { tokenIds } = req.body;

    if (!Array.isArray(tokenIds)) {
      return res.status(400).json({ error: 'tokenIds must be an array' });
    }

    const statuses = await Promise.all(
      tokenIds.map(async (tokenId: string) => {
        try {
          const [compoundCheck, exitCheck, rebalanceCheck] = await Promise.all([
            blockchain.checkCompoundProfitable(BigInt(tokenId)).catch(() => ({ profitable: false, reward: 0n })),
            blockchain.checkExit(BigInt(tokenId)).catch(() => ({ shouldExit: false, exitType: 0 })),
            blockchain.checkRebalance(BigInt(tokenId)).catch(() => ({ needsRebalance: false, reason: 0 })),
          ]);

          return {
            tokenId,
            compound: compoundCheck,
            exit: exitCheck,
            rebalance: rebalanceCheck,
          };
        } catch {
          return { tokenId, error: true };
        }
      })
    );

    res.json(statuses);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get batch status');
    res.status(500).json({ error: 'Failed to fetch batch status' });
  }
});

export { router as automationRouter };
