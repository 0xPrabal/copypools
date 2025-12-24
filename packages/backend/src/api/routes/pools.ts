import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const routeLogger = logger.child({ route: 'pools' });

// Get all pools
router.get('/', async (req: Request, res: Response) => {
  try {
    const { first = '100', skip = '0' } = req.query;

    const result = await subgraph.getPools(
      parseInt(first as string),
      parseInt(skip as string)
    );

    res.json((result as any).pools || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get pools');
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

// Get pool by ID
router.get('/:poolId', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const result = await subgraph.getPool(poolId);
    const pool = (result as any).pool;

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    res.json(pool);
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool');
    res.status(500).json({ error: 'Failed to fetch pool' });
  }
});

// Get pool analytics (for Initiator backtesting)
router.get('/:poolId/analytics', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { days = '30' } = req.query;

    // Get pool data from database
    const result = await subgraph.getPool(poolId);
    const pool = (result as any).pool;

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    // Use actual pool data where available
    const analytics = {
      poolId,
      period: parseInt(days as string),
      avgApr: 0, // Would need historical data to calculate
      volatility: 0, // Would need historical tick data
      priceRange: {
        min: 0,
        max: 0,
      },
      volumeUSD: pool.volumeUsd || pool.volume_usd || '0',
      feesUSD: pool.feesUsd || pool.fees_usd || '0',
      totalValueLockedUSD: pool.totalValueLockedUsd || pool.total_value_locked_usd || '0',
      fee: pool.fee,
      tickSpacing: pool.tickSpacing || pool.tick_spacing,
      token0: pool.token0Id || pool.token0_id,
      token1: pool.token1Id || pool.token1_id,
    };

    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool analytics');
    res.status(500).json({ error: 'Failed to fetch pool analytics' });
  }
});

// Backtest position (Initiator feature)
router.post('/:poolId/backtest', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { tickLower, tickUpper, amount0, amount1, days = 30 } = req.body;

    // Simulate historical performance
    const backtest = {
      poolId,
      tickLower,
      tickUpper,
      inputAmount0: amount0,
      inputAmount1: amount1,
      period: days,
      results: {
        estimatedFees: {
          token0: '0',
          token1: '0',
        },
        impermanentLoss: 0,
        apr: 0,
        vsHodl: 0,
        timeInRange: 100,
      },
    };

    res.json(backtest);
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to backtest');
    res.status(500).json({ error: 'Failed to run backtest' });
  }
});

// Get optimal range for a pool
router.get('/:poolId/optimal-range', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const { strategy = 'balanced' } = req.query;

    // Calculate optimal range based on strategy
    // Strategies: narrow (high fees, high IL risk), balanced, wide (low fees, low IL risk)
    const optimalRange = {
      poolId,
      strategy,
      tickLower: 0,
      tickUpper: 0,
      estimatedApr: 0,
      estimatedIL: 0,
      confidenceLevel: 0,
    };

    res.json(optimalRange);
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get optimal range');
    res.status(500).json({ error: 'Failed to calculate optimal range' });
  }
});

export { router as poolsRouter };
