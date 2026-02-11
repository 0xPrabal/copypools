import { Router, Request, Response, NextFunction } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as analyticsService from '../../services/analytics.js';

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
// Uses batched concurrency (5 at a time) with per-item timeouts
router.post('/batch-check', checkRpcHealth, async (req: Request, res: Response) => {
  try {
    const { tokenIds, checkType } = req.body;

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      return res.status(400).json({ error: 'tokenIds array is required' });
    }

    if (tokenIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 positions per batch' });
    }

    const BATCH_SIZE = 5;
    const PER_ITEM_TIMEOUT = 8000; // 8s per position
    const results: any[] = [];
    let timedOutCount = 0;

    // Process in batches of 5 to control concurrency
    for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
      // Bail early if response already sent (server timeout)
      if (res.headersSent) return;

      const batch = tokenIds.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (tokenId: string) => {
          return new Promise<any>((resolve) => {
            const timeout = setTimeout(() => {
              timedOutCount++;
              resolve({ tokenId, error: 'Timed out' });
            }, PER_ITEM_TIMEOUT);

            (async () => {
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
                  return {
                    tokenId,
                    analytics: await analyticsService.getPositionAnalytics(tokenId),
                  };
                }
              } catch (e) {
                return { tokenId, error: 'Failed to check' };
              }
            })().then((val) => {
              clearTimeout(timeout);
              resolve(val);
            });
          });
        })
      );

      for (const result of batchResults) {
        results.push(result.status === 'fulfilled' ? result.value : { error: 'Failed' });
      }
    }

    if (res.headersSent) return;

    // Return partial content indicator if some timed out
    if (timedOutCount > 0) {
      routeLogger.warn({ timedOutCount, total: tokenIds.length }, 'Batch check had timeouts');
    }

    res.json({ results, _meta: { total: tokenIds.length, timedOut: timedOutCount } });
  } catch (error) {
    routeLogger.error({ error }, 'Failed batch check');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to perform batch check' });
  }
});

// Map our sort fields to Revert API sort params
const REVERT_SORT_MAP: Record<string, string> = {
  apr: 'apr',
  pnl: 'pnl',
  feeApr: 'fee_apr',
  poolApr: 'pool_apr',
  value: 'underlying_value',
  age: 'age',
  fees: 'pnl',
};

// Get top positions via Revert Finance API (152K+ real Uniswap positions)
router.get('/top-positions', async (req: Request, res: Response) => {
  try {
    const {
      limit = '20',
      page = '1',
      sortBy = 'apr',
      sortOrder = 'desc',
      minValueUsd = '0',
      network = 'base',
    } = req.query;

    const requestedLimit = Math.min(parseInt(limit as string) || 20, 100);
    const requestedPage = Math.max(parseInt(page as string) || 1, 1);
    const offset = (requestedPage - 1) * requestedLimit;
    const revertSort = REVERT_SORT_MAP[sortBy as string] || 'apr';
    const desc = (sortOrder as string) !== 'asc';

    // Build Revert API URL
    const revertParams = new URLSearchParams({
      limit: String(requestedLimit),
      offset: String(offset),
      page: String(requestedPage),
      sort: revertSort,
      desc: String(desc),
      'no-withdrawals': 'true',
      'with-v4': 'true',
    });

    // Filter by network if specified
    if (network && network !== 'all') {
      revertParams.set('network', network as string);
    }

    // Min value filter
    const minValue = parseFloat(minValueUsd as string) || 0;
    if (minValue > 0) {
      revertParams.set('min-underlying-value', String(minValue));
    }

    const revertUrl = `https://api.revert.finance/v1/positions?${revertParams.toString()}`;
    routeLogger.debug({ revertUrl }, 'Fetching top positions from Revert API');

    const revertResponse = await fetch(revertUrl, {
      headers: {
        'Accept': 'application/json',
        'Origin': 'https://revert.finance',
        'Referer': 'https://revert.finance/',
        'User-Agent': 'CopyPools/1.0',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!revertResponse.ok) {
      throw new Error(`Revert API returned ${revertResponse.status}`);
    }

    const revertData = await revertResponse.json() as {
      success: boolean;
      total_count: number;
      data: any[];
    };

    if (!revertData.success || !Array.isArray(revertData.data)) {
      throw new Error('Invalid response from Revert API');
    }

    // Transform Revert positions to our format, filtering out anomalous data
    const MAX_SANE_VALUE = 1_000_000_000; // $1B cap for sanity
    const positions = revertData.data
      .filter((pos: any) => {
        const value = parseFloat(pos.underlying_value) || 0;
        return value <= MAX_SANE_VALUE;
      })
      .map((pos: any) => {
        const perf = pos.performance?.hodl || {};
        const tokens = pos.tokens || {};
        const token0Info = tokens[pos.token0] || {};
        const token1Info = tokens[pos.token1] || {};

        return {
          tokenId: String(pos.nft_id),
          owner: pos.real_owner || '',
          tickLower: pos.tick_lower,
          tickUpper: pos.tick_upper,
          inRange: pos.in_range || false,
          network: pos.network || 'base',
          exchange: pos.exchange || 'uniswapv3',
          pool: {
            address: pos.pool || '',
            token0Symbol: token0Info.symbol || '',
            token1Symbol: token1Info.symbol || '',
            token0Address: pos.token0 || '',
            token1Address: pos.token1 || '',
            token0Decimals: token0Info.decimals || 18,
            token1Decimals: token1Info.decimals || 18,
            fee: parseInt(pos.fee_tier || '0'),
          },
          positionValueUSD: parseFloat(pos.underlying_value) || 0,
          pnl: parseFloat(perf.pool_pnl) || 0,
          roi: parseFloat(perf.pool_roi) || 0,
          apr: parseFloat(perf.pool_apr) || 0,
          feeApr: parseFloat(perf.fee_apr) || 0,
          il: parseFloat(perf.il) || 0,
          ageDays: pos.age || 0,
        };
      });

    const total = revertData.total_count || positions.length;
    const totalPages = Math.ceil(total / requestedLimit);

    if (res.headersSent) return;
    res.json({
      positions,
      pagination: {
        page: requestedPage,
        limit: requestedLimit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get top positions from Revert API');
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
