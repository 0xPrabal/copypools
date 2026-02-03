import { Router, Request, Response, NextFunction } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as analyticsService from '../../services/analytics.js';
import * as blockchain from '../../services/blockchain.js';
import { logger } from '../../utils/logger.js';
import { rpcManager } from '../../services/rpc-manager.js';
import { config } from '../../config/index.js';
import { ErrorCodes } from '../../utils/errors.js';

const router = Router();
const routeLogger = logger.child({ route: 'analytics' });

/**
 * Check if RPC service is available and healthy
 */
function isRpcHealthy(chainId: number = config.CHAIN_ID): boolean {
  const stats = rpcManager.getStats();
  const chainStats = stats.rpcs.find(r => r.chainId === chainId);
  return chainStats ? chainStats.healthy > 0 : false;
}

/**
 * Middleware to check RPC health before operations that require chain access
 * Returns 503 Service Unavailable if all RPCs are unhealthy
 */
function checkRpcHealth(_req: Request, res: Response, next: NextFunction): void {
  if (!isRpcHealthy()) {
    const stats = rpcManager.getStats();
    routeLogger.warn({ rpcStats: stats }, 'RPC service degraded, returning 503');

    res.setHeader('Retry-After', '30');
    res.status(503).json({
      error: 'Service temporarily unavailable',
      code: ErrorCodes.RPC_ALL_UNHEALTHY,
      message: 'All RPC endpoints are currently unhealthy. Please retry in 30 seconds.',
      retryAfter: 30,
    });
    return;
  }

  next();
}

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

// Get position analytics - requires RPC for USD calculations
router.get('/position/:tokenId', checkRpcHealth, async (req: Request, res: Response) => {
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

// Check compound profitability for a position - requires RPC
router.get('/compound-check/:tokenId', checkRpcHealth, async (req: Request, res: Response) => {
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

// Check rebalance need for a position - requires RPC
router.get('/rebalance-check/:tokenId', checkRpcHealth, async (req: Request, res: Response) => {
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

// Batch check multiple positions - requires RPC
router.post('/batch-check', checkRpcHealth, async (req: Request, res: Response) => {
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

// Get top positions by fees earned - with optional USD enrichment
router.get('/top-positions', async (req: Request, res: Response) => {
  try {
    const {
      limit = '20',
      page = '1',
      sortBy = 'fees',
      sortOrder = 'desc',
      minValueUsd = '0',
    } = req.query;

    const requestedLimit = Math.min(parseInt(limit as string) || 20, 100);
    const requestedPage = Math.max(parseInt(page as string) || 1, 1);
    const minValue = parseFloat(minValueUsd as string) || 0;
    const offset = (requestedPage - 1) * requestedLimit;

    // Fetch active positions with liquidity
    const result = await subgraph.getAllPositions(1000, 0, true);
    const positions = (result as any)?.positions?.items || [];

    // Enrich positions with USD data in parallel (batch of up to 20 at a time)
    const enriched: any[] = [];
    const batchSize = 20;

    for (let i = 0; i < positions.length; i += batchSize) {
      const batch = positions.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (pos: any) => {
          const tokenId = pos.id || pos.tokenId;
          try {
            const analytics = await analyticsService.getPositionAnalytics(tokenId);
            const createdAt = parseInt(pos.createdAtTimestamp || '0');
            const now = Math.floor(Date.now() / 1000);
            const ageSeconds = now - createdAt;

            // Get accurate tick data: DB may have 0s for unenriched positions
            // getPositionAnalytics triggers enrichment + DB persist, so re-read from DB
            // If still 0, fall back to on-chain read
            let tickLower = pos.tickLower || 0;
            let tickUpper = pos.tickUpper || 0;
            let poolFee = pos.poolKey?.fee || pos.fee || 0;
            let token0Symbol = pos.pool?.token0Symbol || '';
            let token1Symbol = pos.pool?.token1Symbol || '';

            if (tickLower === 0 && tickUpper === 0) {
              try {
                const onChainInfo = await blockchain.getPositionInfo(BigInt(tokenId));
                if (onChainInfo) {
                  tickLower = onChainInfo.tickLower;
                  tickUpper = onChainInfo.tickUpper;
                  if (onChainInfo.poolKey) {
                    poolFee = poolFee || onChainInfo.poolKey.fee;
                    token0Symbol = token0Symbol || onChainInfo.poolKey.currency0;
                    token1Symbol = token1Symbol || onChainInfo.poolKey.currency1;
                  }
                }
              } catch (chainErr) {
                routeLogger.debug({ tokenId, error: chainErr }, 'Could not fetch on-chain tick data');
              }
            }

            return {
              tokenId,
              owner: pos.owner || '',
              liquidity: pos.liquidity || '0',
              tickLower,
              tickUpper,
              collectedFeesToken0: pos.collectedFeesToken0 || '0',
              collectedFeesToken1: pos.collectedFeesToken1 || '0',
              pool: {
                token0Symbol,
                token1Symbol,
                fee: poolFee,
              },
              positionValueUSD: analytics?.usdMetrics?.positionValueUSD ?? null,
              totalFeesEarnedUSD: analytics?.usdMetrics?.totalFeesEarnedUSD ?? null,
              pendingFeesUSD: analytics?.usdMetrics?.pendingFeesUSD ?? null,
              estimatedAPR: analytics?.usdMetrics?.apyUSD ?? parseFloat(analytics?.profitability?.estimatedAPR || '0'),
              dailyFeeRate: analytics?.usdMetrics?.dailyFeeRateUSD ?? parseFloat(analytics?.profitability?.dailyFeeRate || '0'),
              inRange: analytics?.profitability?.isInRange ?? false,
              createdAtTimestamp: pos.createdAtTimestamp || '0',
              ageSeconds,
            };
          } catch (e) {
            // Return basic data without USD enrichment on failure
            const createdAt = parseInt(pos.createdAtTimestamp || '0');
            const now = Math.floor(Date.now() / 1000);

            // Still try to get ticks from chain even on analytics failure
            let tickLower = pos.tickLower || 0;
            let tickUpper = pos.tickUpper || 0;
            if (tickLower === 0 && tickUpper === 0) {
              try {
                const onChainInfo = await blockchain.getPositionInfo(BigInt(tokenId));
                if (onChainInfo) {
                  tickLower = onChainInfo.tickLower;
                  tickUpper = onChainInfo.tickUpper;
                }
              } catch { /* ignore */ }
            }

            return {
              tokenId,
              owner: pos.owner || '',
              liquidity: pos.liquidity || '0',
              tickLower,
              tickUpper,
              collectedFeesToken0: pos.collectedFeesToken0 || '0',
              collectedFeesToken1: pos.collectedFeesToken1 || '0',
              pool: {
                token0Symbol: '',
                token1Symbol: '',
                fee: 0,
              },
              positionValueUSD: null,
              totalFeesEarnedUSD: null,
              pendingFeesUSD: null,
              estimatedAPR: 0,
              dailyFeeRate: 0,
              inRange: false,
              createdAtTimestamp: pos.createdAtTimestamp || '0',
              ageSeconds: now - createdAt,
            };
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          enriched.push(result.value);
        }
      }
    }

    // Filter by minimum USD value
    const filtered = minValue > 0
      ? enriched.filter(p => p.positionValueUSD !== null && p.positionValueUSD >= minValue)
      : enriched;

    // Sort positions
    const sortField = sortBy as string;
    const order = (sortOrder as string) === 'asc' ? 1 : -1;
    filtered.sort((a: any, b: any) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case 'value':
          aVal = a.positionValueUSD ?? 0;
          bVal = b.positionValueUSD ?? 0;
          break;
        case 'apr':
          aVal = a.estimatedAPR ?? 0;
          bVal = b.estimatedAPR ?? 0;
          break;
        case 'age':
          aVal = a.ageSeconds ?? 0;
          bVal = b.ageSeconds ?? 0;
          break;
        case 'fees':
        default:
          aVal = a.totalFeesEarnedUSD ?? 0;
          bVal = b.totalFeesEarnedUSD ?? 0;
          break;
      }
      return (aVal - bVal) * order;
    });

    // Paginate
    const total = filtered.length;
    const totalPages = Math.ceil(total / requestedLimit);
    const paginatedPositions = filtered.slice(offset, offset + requestedLimit);

    if (res.headersSent) return;
    res.json({
      positions: paginatedPositions,
      pagination: {
        page: requestedPage,
        limit: requestedLimit,
        total,
        totalPages,
      },
    });
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
