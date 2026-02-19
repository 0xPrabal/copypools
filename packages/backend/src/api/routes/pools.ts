import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import { getV4Pools } from '../../services/database.js';
import { syncPools } from '../../bots/sync-pools.js';
import { logger } from '../../utils/logger.js';
import {
  fetchGraphPool,
  fetchPoolDayData,
  fetchPoolHourData,
  fetchSwaps,
  fetchTicks,
  searchPools,
} from '../../services/graph-client.js';

const router = Router();
const routeLogger = logger.child({ route: 'pools' });

// Valid sort fields
const VALID_SORT_FIELDS = ['tvl', 'apr', 'volume1d', 'volume30d', 'fee'] as const;
type SortField = typeof VALID_SORT_FIELDS[number];

// Chain name mapping
const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
  1: 'Ethereum',
  42161: 'Arbitrum',
  10: 'Optimism',
};

// Get V4 pools with pagination (for pools table page)
router.get('/v4', async (req: Request, res: Response) => {
  try {
    // Default to Base (8453), can be extended to other chains
    const chainId = parseInt(req.query.chainId as string) || 8453;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sortBy = (req.query.sortBy as string) || 'apr';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

    // Validate sort field
    const validSortBy = VALID_SORT_FIELDS.includes(sortBy as SortField)
      ? sortBy as SortField
      : 'apr';

    const { pools, total } = await getV4Pools({
      chainId,
      page,
      limit,
      sortBy: validSortBy,
      sortOrder,
    });

    // Format pools for frontend
    const formattedPools = pools.map((pool, index) => ({
      rank: (page - 1) * limit + index + 1,
      id: pool.id,
      chainId: pool.chainId,
      chainName: CHAIN_NAMES[pool.chainId] || 'Unknown',
      token0Symbol: pool.token0Symbol || 'UNKNOWN',
      token1Symbol: pool.token1Symbol || 'UNKNOWN',
      token0Logo: pool.token0Logo,
      token1Logo: pool.token1Logo,
      token0Address: pool.currency0,
      token1Address: pool.currency1,
      protocol: 'v4',
      feeTier: formatFeeTier(pool.fee),
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      tvlUsd: pool.tvlUsd,
      poolApr: pool.poolApr,
      rewardApr: pool.rewardApr,
      volume1dUsd: pool.volume1dUsd,
      volume30dUsd: pool.volume30dUsd,
      volume1dTvlRatio: pool.tvlUsd > 0 ? pool.volume1dUsd / pool.tvlUsd : 0,
    }));

    if (res.headersSent) return;
    res.json({
      chainId,
      chainName: CHAIN_NAMES[chainId] || 'Unknown',
      pools: formattedPools,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get V4 pools');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch V4 pools' });
  }
});

// Format fee tier for display
function formatFeeTier(fee: number): string {
  const feePercent = fee / 10000;
  if (feePercent < 0.01) return `${feePercent * 100}bps`;
  return `${feePercent}%`;
}

// Trigger manual pool sync
router.post('/v4/sync', async (req: Request, res: Response) => {
  try {
    routeLogger.info('Manual pool sync triggered');
    await syncPools();
    const { pools, total } = await getV4Pools({ chainId: 8453, limit: 1 });
    if (res.headersSent) return;
    res.json({ success: true, message: 'Pool sync completed', totalPools: total });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to sync pools');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to sync pools' });
  }
});

// Get all pools (legacy)
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

// ─── Graph-powered Routes ──────────────────────────────────────

// Get pool OHLCV chart data (daily)
router.get('/:poolId/chart', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const granularity = (req.query.granularity as string) || 'day';

    if (granularity === 'hour') {
      const hours = Math.min(days * 24, 720); // max 30 days of hourly
      const data = await fetchPoolHourData(poolId, hours);
      if (res.headersSent) return;
      return res.json({
        poolId,
        granularity: 'hour',
        count: data.length,
        data: data.map(d => ({
          timestamp: d.periodStartUnix,
          tvlUSD: parseFloat(d.tvlUSD),
          volumeUSD: parseFloat(d.volumeUSD),
          feesUSD: parseFloat(d.feesUSD),
          open: parseFloat(d.open),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          close: parseFloat(d.close),
        })),
      });
    }

    const data = await fetchPoolDayData(poolId, days);
    if (res.headersSent) return;
    res.json({
      poolId,
      granularity: 'day',
      count: data.length,
      data: data.map(d => ({
        timestamp: d.date,
        tvlUSD: parseFloat(d.tvlUSD),
        volumeUSD: parseFloat(d.volumeUSD),
        feesUSD: parseFloat(d.feesUSD),
        open: parseFloat(d.open),
        high: parseFloat(d.high),
        low: parseFloat(d.low),
        close: parseFloat(d.close),
        token0Price: parseFloat(d.token0Price),
        token1Price: parseFloat(d.token1Price),
        txCount: parseInt(d.txCount),
      })),
    });
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool chart data');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch pool chart data' });
  }
});

// Get recent swaps for a pool
router.get('/:poolId/swaps', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const swaps = await fetchSwaps(poolId, limit);
    if (res.headersSent) return;
    res.json({
      poolId,
      count: swaps.length,
      swaps: swaps.map(s => ({
        id: s.id,
        timestamp: parseInt(s.timestamp),
        sender: s.sender,
        amount0: parseFloat(s.amount0),
        amount1: parseFloat(s.amount1),
        amountUSD: parseFloat(s.amountUSD),
        token0Symbol: s.token0.symbol,
        token1Symbol: s.token1.symbol,
        tick: parseInt(s.tick),
      })),
    });
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool swaps');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch pool swaps' });
  }
});

// Get tick liquidity distribution for a pool
router.get('/:poolId/ticks', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);

    const ticks = await fetchTicks(poolId, limit);
    if (res.headersSent) return;
    res.json({
      poolId,
      count: ticks.length,
      ticks: ticks.map(t => ({
        tickIdx: parseInt(t.tickIdx),
        liquidityGross: t.liquidityGross,
        liquidityNet: t.liquidityNet,
        price0: parseFloat(t.price0),
        price1: parseFloat(t.price1),
      })),
    });
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool ticks');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch pool ticks' });
  }
});

// Search pools by token address or symbol
router.get('/v4/search', async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || '';
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const pools = await searchPools(query, 20);
    if (res.headersSent) return;
    res.json({
      query,
      count: pools.length,
      pools: pools.map(p => ({
        id: p.id,
        token0Symbol: p.token0.symbol,
        token1Symbol: p.token1.symbol,
        token0Address: p.token0.id,
        token1Address: p.token1.id,
        feeTier: formatFeeTier(parseInt(p.feeTier)),
        tvlUSD: parseFloat(p.totalValueLockedUSD),
        volumeUSD: parseFloat(p.volumeUSD),
        hooks: p.hooks,
      })),
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to search pools');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to search pools' });
  }
});

// Get enriched pool detail from Graph
router.get('/:poolId/graph', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;
    const pool = await fetchGraphPool(poolId);

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found on Graph' });
    }

    // Calculate metrics
    const tvlUsd = parseFloat(pool.totalValueLockedUSD);
    let volume1d = 0;
    let fees1d = 0;
    let volume30d = 0;

    if (pool.poolDayData && pool.poolDayData.length > 0) {
      volume1d = parseFloat(pool.poolDayData[0].volumeUSD);
      fees1d = parseFloat(pool.poolDayData[0].feesUSD);
      volume30d = pool.poolDayData.reduce((sum, d) => sum + parseFloat(d.volumeUSD), 0);
    }

    const apr = tvlUsd > 0 ? (fees1d * 365 / tvlUsd) * 100 : 0;

    if (res.headersSent) return;
    res.json({
      id: pool.id,
      token0: pool.token0,
      token1: pool.token1,
      feeTier: parseInt(pool.feeTier),
      feeTierFormatted: formatFeeTier(parseInt(pool.feeTier)),
      liquidity: pool.liquidity,
      sqrtPrice: pool.sqrtPrice,
      tick: pool.tick ? parseInt(pool.tick) : null,
      tickSpacing: parseInt(pool.tickSpacing),
      hooks: pool.hooks,
      createdAt: parseInt(pool.createdAtTimestamp),
      tvlUSD: tvlUsd,
      volumeUSD: parseFloat(pool.volumeUSD),
      feesUSD: parseFloat(pool.feesUSD),
      txCount: parseInt(pool.txCount),
      lpCount: parseInt(pool.liquidityProviderCount),
      token0Price: parseFloat(pool.token0Price),
      token1Price: parseFloat(pool.token1Price),
      metrics: {
        volume1dUSD: volume1d,
        volume30dUSD: volume30d,
        fees1dUSD: fees1d,
        apr,
      },
      dayData: pool.poolDayData?.map(d => ({
        date: d.date,
        tvlUSD: parseFloat(d.tvlUSD),
        volumeUSD: parseFloat(d.volumeUSD),
        feesUSD: parseFloat(d.feesUSD),
      })) || [],
    });
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool from Graph');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch pool from Graph' });
  }
});

export { router as poolsRouter };
