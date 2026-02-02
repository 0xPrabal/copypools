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
    if (res.headersSent) return; // Request may have timed out
    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get protocol stats');
    if (res.headersSent) return; // Request may have timed out
    res.status(500).json({ error: 'Failed to fetch protocol stats' });
  }
});

// Get daily stats
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query;
    const result = await subgraph.getDailyStats(parseInt(days as string));
    if (res.headersSent) return;
    res.json((result as any).dailyStatss?.items || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get daily stats');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

// Get user/portfolio analytics
router.get('/user/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const analytics = await analyticsService.getPortfolioAnalytics(address);
    if (res.headersSent) return;
    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, address: req.params.address }, 'Failed to get user analytics');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch user analytics' });
  }
});

// Get position analytics
router.get('/position/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const analytics = await analyticsService.getPositionAnalytics(tokenId);

    if (res.headersSent) return;
    if (!analytics) {
      return res.status(404).json({ error: 'Position not found' });
    }

    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get position analytics');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch position analytics' });
  }
});

// Check compound profitability for a position
router.get('/compound-check/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await analyticsService.checkCompoundProfitability(tokenId);
    if (res.headersSent) return;
    res.json(result);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to check compound profitability');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to check compound profitability' });
  }
});

// Check rebalance need for a position
router.get('/rebalance-check/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await analyticsService.checkRebalanceNeed(tokenId);
    if (res.headersSent) return;
    res.json(result);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to check rebalance need');
    if (res.headersSent) return;
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

    if (res.headersSent) return;
    res.json({ results });
  } catch (error) {
    routeLogger.error({ error }, 'Failed batch check');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to perform batch check' });
  }
});

// Get top positions by fees earned
router.get('/top-positions', async (req: Request, res: Response) => {
  try {
    const { limit = '10' } = req.query;
    const requestedLimit = parseInt(limit as string);

    // Fetch more positions to ensure we find actual top earners
    // We fetch up to 1000 positions to get a comprehensive view
    const result = await subgraph.getAllPositions(1000, 0);
    const positions = (result as any)?.positions?.items || [];

    // Sort by total collected fees (token0 + token1) descending
    const sortedPositions = positions.sort((a: any, b: any) => {
      const aFees = BigInt(a.collectedFeesToken0 || '0') + BigInt(a.collectedFeesToken1 || '0');
      const bFees = BigInt(b.collectedFeesToken0 || '0') + BigInt(b.collectedFeesToken1 || '0');
      return bFees > aFees ? 1 : bFees < aFees ? -1 : 0;
    });

    // Return only the requested number of top positions
    if (res.headersSent) return;
    res.json(sortedPositions.slice(0, requestedLimit));
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get top positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch top positions' });
  }
});

// Get compound statistics
router.get('/compounds', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query;

    // Get compoundable positions count from subgraph
    const compoundableResult = await subgraph.getCompoundablePositions('0', 1000);
    const compoundConfigs = (compoundableResult as any)?.compoundConfigs || [];

    const stats = {
      totalCompoundConfigs: compoundConfigs.length,
      enabledConfigs: compoundConfigs.filter((c: any) => c.enabled).length,
      // These would need event tracking to calculate accurately
      totalCompounds: 0,
      totalCompoundedToken0: '0',
      totalCompoundedToken1: '0',
      totalCompoundedUSD: '0',
      avgCompoundAmount: '0',
      avgGasCost: '0',
      profitableCompounds: 0,
      period: `${days} days`,
    };

    if (res.headersSent) return;
    res.json(stats);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get compound stats');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch compound stats' });
  }
});

// Get rebalance statistics
router.get('/rebalances', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query;

    // Get rebalanceable positions count from subgraph
    const rebalanceableResult = await subgraph.getRebalanceablePositions(1000);
    const rangeConfigs = (rebalanceableResult as any)?.rangeConfigs || [];

    const stats = {
      totalRangeConfigs: rangeConfigs.length,
      enabledConfigs: rangeConfigs.filter((c: any) => c.enabled).length,
      // These would need event tracking to calculate accurately
      totalRebalances: 0,
      avgRangeWidth: 0,
      avgTimeInRange: 0,
      successfulRebalances: 0,
      period: `${days} days`,
    };

    if (res.headersSent) return;
    res.json(stats);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get rebalance stats');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch rebalance stats' });
  }
});

export { router as analyticsRouter };
