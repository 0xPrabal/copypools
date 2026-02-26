import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import {
  getTopPositions,
  getTopPositionByTokenId,
  getLeaderboardPools,
} from '../../services/database.js';

const router = Router();
const routeLogger = logger.child({ route: 'leaderboard' });

// Valid sort fields for positions
const VALID_POSITION_SORTS = ['apr', 'feeApr', 'value', 'pnl', 'roi', 'fees'] as const;
type PositionSortField = typeof VALID_POSITION_SORTS[number];

// Valid sort fields for pools
const VALID_POOL_SORTS = ['tvl', 'apr', 'apr7d', 'apr30d', 'volume1d', 'fees7d'] as const;
type PoolSortField = typeof VALID_POOL_SORTS[number];

// GET /api/leaderboard/positions - Top positions leaderboard
router.get('/positions', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sortBy = (req.query.sortBy as string) || 'apr';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const poolId = req.query.poolId as string | undefined;
    const inRangeOnly = req.query.inRangeOnly === 'true';
    const minValueUsd = req.query.minValueUsd
      ? parseFloat(req.query.minValueUsd as string)
      : undefined;

    const validSortBy = VALID_POSITION_SORTS.includes(sortBy as PositionSortField)
      ? (sortBy as PositionSortField)
      : 'apr';

    const { positions, total } = await getTopPositions({
      page,
      limit,
      sortBy: validSortBy,
      sortOrder,
      poolId,
      inRangeOnly,
      minValueUsd,
    });

    const formattedPositions = positions.map((pos, index) => ({
      rank: (page - 1) * limit + index + 1,
      tokenId: pos.tokenId,
      chainId: pos.chainId,
      owner: pos.owner,
      ownerShort: `${pos.owner.slice(0, 6)}...${pos.owner.slice(-4)}`,
      poolId: pos.poolId,
      token0: {
        address: pos.token0Address,
        symbol: pos.token0Symbol || 'UNKNOWN',
        decimals: pos.token0Decimals,
      },
      token1: {
        address: pos.token1Address,
        symbol: pos.token1Symbol || 'UNKNOWN',
        decimals: pos.token1Decimals,
      },
      fee: pos.fee,
      tickSpacing: pos.tickSpacing,
      tickLower: pos.tickLower,
      tickUpper: pos.tickUpper,
      liquidity: pos.liquidity,
      currentTick: pos.currentTick,
      inRange: pos.inRange,
      metrics: {
        positionValueUsd: pos.positionValueUsd,
        pendingFeesUsd: pos.pendingFeesUsd,
        feeApr: pos.feeApr,
        totalApr: pos.totalApr,
        pnlUsd: pos.pnlUsd,
        roi: pos.roi,
        ageDays: pos.ageDays,
      },
      automation: {
        compoundEnabled: pos.compoundEnabled,
        rangeEnabled: pos.rangeEnabled,
        exitEnabled: pos.exitEnabled,
        compoundConfig: pos.compoundConfig,
        rangeConfig: pos.rangeConfig,
        exitConfig: pos.exitConfig,
      },
      ranks: {
        byApr: pos.rankByApr,
        byValue: pos.rankByValue,
        byFees: pos.rankByFees,
      },
      lastSyncedAt: pos.lastSyncedAt,
    }));

    if (res.headersSent) return;
    res.json({
      positions: formattedPositions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get leaderboard positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch leaderboard positions' });
  }
});

// GET /api/leaderboard/positions/:tokenId - Single position detail
router.get('/positions/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;

    const position = await getTopPositionByTokenId(tokenId);

    if (!position) {
      if (res.headersSent) return;
      return res.status(404).json({ error: 'Position not found in leaderboard' });
    }

    if (res.headersSent) return;
    res.json({
      tokenId: position.tokenId,
      chainId: position.chainId,
      owner: position.owner,
      poolId: position.poolId,
      token0: {
        address: position.token0Address,
        symbol: position.token0Symbol || 'UNKNOWN',
        decimals: position.token0Decimals,
      },
      token1: {
        address: position.token1Address,
        symbol: position.token1Symbol || 'UNKNOWN',
        decimals: position.token1Decimals,
      },
      fee: position.fee,
      tickSpacing: position.tickSpacing,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity,
      currentTick: position.currentTick,
      sqrtPriceX96: position.sqrtPriceX96,
      inRange: position.inRange,
      metrics: {
        positionValueUsd: position.positionValueUsd,
        depositedToken0: position.depositedToken0,
        depositedToken1: position.depositedToken1,
        collectedFeesToken0: position.collectedFeesToken0,
        collectedFeesToken1: position.collectedFeesToken1,
        pendingFeesUsd: position.pendingFeesUsd,
        feeApr: position.feeApr,
        totalApr: position.totalApr,
        pnlUsd: position.pnlUsd,
        roi: position.roi,
        ageDays: position.ageDays,
      },
      automation: {
        compoundEnabled: position.compoundEnabled,
        rangeEnabled: position.rangeEnabled,
        exitEnabled: position.exitEnabled,
        compoundConfig: position.compoundConfig,
        rangeConfig: position.rangeConfig,
        exitConfig: position.exitConfig,
      },
      ranks: {
        byApr: position.rankByApr,
        byValue: position.rankByValue,
        byFees: position.rankByFees,
      },
      lastSyncedAt: position.lastSyncedAt,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get position detail');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch position detail' });
  }
});

// GET /api/leaderboard/pools - Enhanced pool leaderboard
router.get('/pools', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const sortBy = (req.query.sortBy as string) || 'apr';
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
    const minTvl = req.query.minTvl
      ? parseFloat(req.query.minTvl as string)
      : undefined;

    const validSortBy = VALID_POOL_SORTS.includes(sortBy as PoolSortField)
      ? (sortBy as PoolSortField)
      : 'apr';

    const { pools, total } = await getLeaderboardPools({
      page,
      limit,
      sortBy: validSortBy,
      sortOrder,
      minTvl,
    });

    const formattedPools = pools.map((pool, index) => ({
      rank: (page - 1) * limit + index + 1,
      id: pool.id,
      chainId: pool.chainId,
      token0: {
        address: pool.currency0,
        symbol: pool.token0Symbol || 'UNKNOWN',
        logo: pool.token0Logo,
        decimals: pool.token0Decimals,
      },
      token1: {
        address: pool.currency1,
        symbol: pool.token1Symbol || 'UNKNOWN',
        logo: pool.token1Logo,
        decimals: pool.token1Decimals,
      },
      fee: pool.fee,
      feeTierFormatted: formatFeeTier(pool.fee),
      tickSpacing: pool.tickSpacing,
      hooks: pool.hooks,
      metrics: {
        tvlUsd: pool.tvlUsd,
        volume1dUsd: pool.volume1dUsd,
        volume30dUsd: pool.volume30dUsd,
        fees1dUsd: pool.fees1dUsd,
        fees7dUsd: pool.fees7dUsd,
        fees30dUsd: pool.fees30dUsd,
        poolApr: pool.poolApr,
        apr7d: pool.apr7d,
        apr30d: pool.apr30d,
        rewardApr: pool.rewardApr,
      },
      suggestedRanges: {
        full: pool.suggestedRangeFull,
        wide: pool.suggestedRangeWide,
        concentrated: pool.suggestedRangeConcentrated,
      },
      positionCount: pool.positionCount,
      lastSyncedAt: pool.lastSyncedAt,
    }));

    if (res.headersSent) return;
    res.json({
      pools: formattedPools,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get leaderboard pools');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch leaderboard pools' });
  }
});

// GET /api/leaderboard/pools/:poolId/strategies - Suggested ranges for a pool
router.get('/pools/:poolId/strategies', async (req: Request, res: Response) => {
  try {
    const { poolId } = req.params;

    const { pools } = await getLeaderboardPools({
      page: 1,
      limit: 1,
      sortBy: 'tvl',
    });

    // Find the specific pool
    const { pools: allPools } = await getLeaderboardPools({
      page: 1,
      limit: 200,
      sortBy: 'tvl',
    });

    const pool = allPools.find(p => p.id.toLowerCase() === poolId.toLowerCase());

    if (!pool) {
      if (res.headersSent) return;
      return res.status(404).json({ error: 'Pool not found' });
    }

    if (res.headersSent) return;
    res.json({
      poolId: pool.id,
      token0Symbol: pool.token0Symbol,
      token1Symbol: pool.token1Symbol,
      fee: pool.fee,
      tvlUsd: pool.tvlUsd,
      poolApr: pool.poolApr,
      strategies: [
        {
          id: 'full',
          ...pool.suggestedRangeFull,
        },
        {
          id: 'wide',
          ...pool.suggestedRangeWide,
        },
        {
          id: 'concentrated',
          ...pool.suggestedRangeConcentrated,
        },
      ].filter(s => s.tickLower !== undefined),
    });
  } catch (error) {
    routeLogger.error({ error, poolId: req.params.poolId }, 'Failed to get pool strategies');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch pool strategies' });
  }
});

function formatFeeTier(fee: number): string {
  const feePercent = fee / 10000;
  if (feePercent < 0.01) return `${feePercent * 100}bps`;
  return `${feePercent}%`;
}

export { router as leaderboardRouter };
