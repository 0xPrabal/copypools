import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as analyticsService from '../../services/analytics.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const routeLogger = logger.child({ route: 'analytics' });

// Get protocol-wide stats
router.get('/protocol', async (_req: Request, res: Response) => {
  try {
    const analytics = await analyticsService.getProtocolAnalytics();
    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get protocol stats');
    res.status(500).json({ error: 'Failed to fetch protocol stats' });
  }
});

// Get daily stats
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query;
    const result = await subgraph.getDailyStats(parseInt(days as string));
    res.json((result as any).dailyStatss?.items || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get daily stats');
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

// Get user/portfolio analytics
router.get('/user/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const analytics = await analyticsService.getPortfolioAnalytics(address);
    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, address: req.params.address }, 'Failed to get user analytics');
    res.status(500).json({ error: 'Failed to fetch user analytics' });
  }
});

// Get position analytics
router.get('/position/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const analytics = await analyticsService.getPositionAnalytics(tokenId);

    if (!analytics) {
      return res.status(404).json({ error: 'Position not found' });
    }

    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get position analytics');
    res.status(500).json({ error: 'Failed to fetch position analytics' });
  }
});

// Check compound profitability for a position
router.get('/compound-check/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await analyticsService.checkCompoundProfitability(tokenId);
    res.json(result);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to check compound profitability');
    res.status(500).json({ error: 'Failed to check compound profitability' });
  }
});

// Check rebalance need for a position
router.get('/rebalance-check/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await analyticsService.checkRebalanceNeed(tokenId);
    res.json(result);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to check rebalance need');
    res.status(500).json({ error: 'Failed to check rebalance need' });
  }
});

// Batch check multiple positions
router.post('/batch-check', async (req: Request, res: Response) => {
  try {
    const { tokenIds, checkType } = req.body;

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      return res.status(400).json({ error: 'tokenIds array is required' });
    }

    if (tokenIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 positions per batch' });
    }

    const results = await Promise.all(
      tokenIds.map(async (tokenId: string) => {
        try {
          if (checkType === 'compound') {
            return {
              tokenId,
              ...(await analyticsService.checkCompoundProfitability(tokenId)),
            };
          } else if (checkType === 'rebalance') {
            return {
              tokenId,
              ...(await analyticsService.checkRebalanceNeed(tokenId)),
            };
          } else {
            // Return full analytics
            return {
              tokenId,
              analytics: await analyticsService.getPositionAnalytics(tokenId),
            };
          }
        } catch (e) {
          return { tokenId, error: 'Failed to check' };
        }
      })
    );

    res.json({ results });
  } catch (error) {
    routeLogger.error({ error }, 'Failed batch check');
    res.status(500).json({ error: 'Failed to perform batch check' });
  }
});

// Get top positions by fees earned
router.get('/top-positions', async (req: Request, res: Response) => {
  try {
    const { limit = '10' } = req.query;
    // Query positions and sort by fees (placeholder - would need proper aggregation)
    const result = await subgraph.getPositionsByOwner('', parseInt(limit as string), 0);
    res.json((result as any)?.positions?.items || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get top positions');
    res.status(500).json({ error: 'Failed to fetch top positions' });
  }
});

// Get compound statistics
router.get('/compounds', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query;

    // Placeholder stats - would aggregate from compound events
    const stats = {
      totalCompounds: 0,
      totalCompoundedToken0: '0',
      totalCompoundedToken1: '0',
      totalCompoundedUSD: '0',
      avgCompoundAmount: '0',
      avgGasCost: '0',
      profitableCompounds: 0,
      period: `${days} days`,
    };

    res.json(stats);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get compound stats');
    res.status(500).json({ error: 'Failed to fetch compound stats' });
  }
});

// Get rebalance statistics
router.get('/rebalances', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query;

    // Placeholder stats - would aggregate from rebalance events
    const stats = {
      totalRebalances: 0,
      avgRangeWidth: 0,
      avgTimeInRange: 0,
      successfulRebalances: 0,
      period: `${days} days`,
    };

    res.json(stats);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get rebalance stats');
    res.status(500).json({ error: 'Failed to fetch rebalance stats' });
  }
});

export { router as analyticsRouter };
