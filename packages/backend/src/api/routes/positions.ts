import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as blockchain from '../../services/blockchain.js';
import * as database from '../../services/database.js';
import * as multichain from '../../services/multichain.js';
import { logger } from '../../utils/logger.js';
import { memoryCache } from '../../services/cache.js';
import { config } from '../../config/index.js';
import { isSupportedChain, getChainConfig } from '../../config/chains.js';
import {
  analyzePosition,
  calculateVolatility,
  getPriceHistory,
  recordPriceSample,
  makeRebalanceDecision,
  PositionAnalysis,
  RebalanceDecision,
} from '../../services/smart-rebalance.js';

const router = Router();
const routeLogger = logger.child({ route: 'positions' });

// Cache settings
const MEMORY_CACHE_TTL = 15 * 1000; // 15 seconds for in-memory
const DB_CACHE_STALE_MINUTES = 2; // Consider DB cache stale after 2 minutes

// Get position by token ID - fetches directly from chain
router.get('/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;

    // Fetch position directly from PositionManager on chain
    const position = await blockchain.getPositionInfo(BigInt(tokenId));

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Enrich with compound/range config from Ponder
    try {
      const compoundConfig = await blockchain.getCompoundConfig(BigInt(tokenId));
      (position as any).compoundConfig = compoundConfig;
    } catch (e) {
      // Not registered for compounding
    }

    try {
      const rangeConfig = await blockchain.getRangeConfig(BigInt(tokenId));
      (position as any).rangeConfig = rangeConfig;
    } catch (e) {
      // Not registered for auto-range
    }

    // Get pending fees if registered for compounding
    try {
      const pendingFees = await blockchain.getPendingFees(BigInt(tokenId));
      (position as any).pendingFees = {
        amount0: pendingFees.amount0.toString(),
        amount1: pendingFees.amount1.toString(),
      };
    } catch (e) {
      // Position might not be registered for compounding
    }

    res.json(position);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get position');
    res.status(500).json({ error: 'Failed to fetch position' });
  }
});

// Get positions by owner - uses multi-layer caching:
// 1. Memory cache (15 seconds) - instant
// 2. Database cache (2 minutes) - fast, persistent
// 3. Alchemy NFT API + RPC - fresh data
router.get('/owner/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const enrich = req.query.enrich !== 'false'; // Default to true
    const noCache = req.query.noCache === 'true'; // Force fresh fetch
    const chainId = req.query.chainId ? parseInt(req.query.chainId as string, 10) : config.CHAIN_ID;

    // Check if chain is supported
    if (!isSupportedChain(chainId)) {
      routeLogger.debug({ address, chainId }, 'Unsupported chain, returning empty');
      return res.json([]);
    }

    // Use legacy single-chain path for primary configured chain (optimized)
    const useLegacyPath = chainId === config.CHAIN_ID;

    // LAYER 1: Check memory cache (15 second TTL)
    const memoryCacheKey = `positions_${address.toLowerCase()}_${chainId}_${enrich}`;
    if (!noCache) {
      const memoryCached = memoryCache.get<any[]>(memoryCacheKey);
      if (memoryCached) {
        routeLogger.debug({ address, count: memoryCached.length, layer: 'memory' }, 'Cache hit');
        return res.json(memoryCached);
      }
    }

    // LAYER 2: Check database cache
    if (!noCache && database.isDatabaseAvailable()) {
      const dbPositions = await database.getPositionsByOwner(address, chainId);

      if (dbPositions.length > 0) {
        // Check if cache is fresh (within 2 minutes)
        const oldestUpdate = Math.min(...dbPositions.map(p => new Date(p.updatedAt).getTime()));
        const cacheAge = Date.now() - oldestUpdate;
        const isFresh = cacheAge < DB_CACHE_STALE_MINUTES * 60 * 1000;

        if (isFresh) {
          // Transform DB format to API format (using full config data from cache)
          const positions = dbPositions
            .filter(p => BigInt(p.liquidity) > 0n)
            .map(dbPos => ({
              tokenId: dbPos.tokenId,
              owner: dbPos.owner,
              poolId: dbPos.poolId,
              poolKey: {
                currency0: dbPos.currency0,
                currency1: dbPos.currency1,
                fee: dbPos.fee,
                tickSpacing: dbPos.tickSpacing,
                hooks: dbPos.hooks,
              },
              tickLower: dbPos.tickLower,
              tickUpper: dbPos.tickUpper,
              liquidity: dbPos.liquidity,
              currentTick: dbPos.currentTick,
              inRange: dbPos.inRange,
              compoundConfig: dbPos.compoundConfig,
              rangeConfig: dbPos.rangeConfig,
            }));

          // Store in memory cache
          memoryCache.set(memoryCacheKey, positions, MEMORY_CACHE_TTL);
          routeLogger.debug({ address, count: positions.length, layer: 'database', ageMs: cacheAge }, 'Cache hit');
          return res.json(positions);
        } else {
          routeLogger.debug({ address, ageMs: cacheAge }, 'DB cache stale, refreshing');
        }
      }
    }

    // LAYER 3: Fetch fresh data from chain
    routeLogger.info({ address, enrich, chainId, useLegacyPath }, 'Fetching positions from chain');

    let onChainPositions: any[];

    if (useLegacyPath) {
      // Use optimized single-chain path for primary configured chain
      onChainPositions = await blockchain.getPositionsByOwnerOnChain(address);
    } else {
      // Use multichain service for other supported chains
      onChainPositions = await multichain.fetchPositionsForOwner(chainId, address);
    }

    routeLogger.info({ address, count: onChainPositions.length, chainId }, 'Found positions on chain');

    // Enrich positions with automation configs and current tick (in parallel)
    const positions = await Promise.all(
      onChainPositions.map(async (position) => {
        const enrichedPosition: any = {
          ...position,
          depositedToken0: '0',
          depositedToken1: '0',
          withdrawnToken0: '0',
          withdrawnToken1: '0',
          collectedFeesToken0: '0',
          collectedFeesToken1: '0',
          compoundConfig: null,
          rangeConfig: null,
          currentTick: position.currentTick || 0,
          inRange: position.inRange ?? true,
        };

        if (!enrich) return enrichedPosition;

        const tokenId = BigInt(position.tokenId);

        if (useLegacyPath) {
          // Primary chain: full enrichment with automation configs
          const [compoundConfig, rangeConfig] = await Promise.all([
            blockchain.getCompoundConfig(tokenId).catch(() => null),
            blockchain.getRangeConfig(tokenId).catch(() => null),
          ]);

          if (compoundConfig?.enabled) {
            enrichedPosition.compoundConfig = compoundConfig;
          }
          if (rangeConfig?.enabled) {
            enrichedPosition.rangeConfig = rangeConfig;
          }

          // Get current tick from StateView
          if (position.poolKey) {
            try {
              const currentTick = await blockchain.getPoolCurrentTick(position.poolKey);
              enrichedPosition.currentTick = currentTick;
              enrichedPosition.inRange = currentTick >= position.tickLower && currentTick < position.tickUpper;
            } catch (e) {
              routeLogger.warn({ tokenId: position.tokenId, error: e }, 'Failed to get current tick from StateView');
            }
          }
        }
        // For non-primary chains, multichain.fetchPositionsForOwner already includes currentTick and inRange

        return enrichedPosition;
      })
    );

    // Save to memory cache
    memoryCache.set(memoryCacheKey, positions, MEMORY_CACHE_TTL);

    // Save to database cache (async, don't wait) - includes full config data
    if (database.isDatabaseAvailable() && positions.length > 0) {
      const dbPositions = positions.map(p => ({
        tokenId: p.tokenId,
        owner: address.toLowerCase(),
        chainId,
        poolId: p.poolId || '',
        currency0: p.poolKey?.currency0 || '',
        currency1: p.poolKey?.currency1 || '',
        fee: p.poolKey?.fee || 0,
        tickSpacing: p.poolKey?.tickSpacing || 0,
        hooks: p.poolKey?.hooks || '0x0000000000000000000000000000000000000000',
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidity: p.liquidity,
        currentTick: p.currentTick || 0,
        inRange: p.inRange ?? true,
        compoundConfig: p.compoundConfig || null,
        rangeConfig: p.rangeConfig || null,
      }));

      database.savePositions(dbPositions).catch(err => {
        routeLogger.warn({ error: err }, 'Failed to save positions to database');
      });
    }

    routeLogger.debug({ address, count: positions.length, layer: 'chain' }, 'Fetched fresh');
    res.json(positions);
  } catch (error) {
    routeLogger.error({
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      address: req.params.address
    }, 'Failed to get positions');
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Get position analytics
router.get('/:tokenId/analytics', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);

    if (!(result as any).position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    const position = (result as any).position;

    // Calculate analytics
    const deposited0 = BigInt(position.depositedToken0 || '0');
    const deposited1 = BigInt(position.depositedToken1 || '0');
    const withdrawn0 = BigInt(position.withdrawnToken0 || '0');
    const withdrawn1 = BigInt(position.withdrawnToken1 || '0');
    const fees0 = BigInt(position.collectedFeesToken0 || '0');
    const fees1 = BigInt(position.collectedFeesToken1 || '0');

    const analytics = {
      tokenId,
      pool: position.pool,
      totalDeposited: {
        token0: deposited0.toString(),
        token1: deposited1.toString(),
      },
      totalWithdrawn: {
        token0: withdrawn0.toString(),
        token1: withdrawn1.toString(),
      },
      totalFees: {
        token0: fees0.toString(),
        token1: fees1.toString(),
      },
      currentLiquidity: position.liquidity,
      tickRange: {
        lower: position.tickLower,
        upper: position.tickUpper,
      },
      inRange: position.pool.tick >= position.tickLower && position.pool.tick < position.tickUpper,
    };

    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get analytics');
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get position snapshots (historical data)
router.get('/:tokenId/snapshots', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    // This would query snapshots from subgraph
    // For now, return empty array
    res.json([]);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get snapshots');
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

// ============ Smart Rebalance Analysis ============

/**
 * Get smart rebalance analysis for a position
 * Returns center drift, urgency, recommendation, and whether to rebalance
 */
router.get('/:tokenId/smart-analysis', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const tokenIdBigInt = BigInt(tokenId);

    // Get position status from chain
    const positionStatus = await blockchain.getPositionStatus(tokenIdBigInt);
    const positionInfo = await blockchain.getAutoRangePositionInfo(tokenIdBigInt);
    const rangeConfig = await blockchain.getRangeConfig(tokenIdBigInt);

    if (!positionStatus || !positionInfo) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Record price sample for volatility tracking
    const poolId = `${positionInfo.poolKey.currency0}-${positionInfo.poolKey.currency1}-${positionInfo.poolKey.fee}`;
    recordPriceSample(poolId, positionStatus.currentTick);

    // Analyze position
    const analysis = analyzePosition(
      tokenId,
      positionStatus.currentTick,
      positionStatus.tickLower,
      positionStatus.tickUpper
    );

    // Calculate volatility from history
    const priceHistory = getPriceHistory(poolId);
    const volatility = calculateVolatility(priceHistory);

    // Get last rebalance time from contract
    let lastRebalanceTime = 0;
    try {
      lastRebalanceTime = await blockchain.getLastRebalanceTime(tokenIdBigInt);
    } catch {
      // Not found
    }

    // Make rebalance decision if range config exists
    let decision: RebalanceDecision | null = null;
    if (rangeConfig?.enabled) {
      decision = makeRebalanceDecision(
        analysis,
        volatility,
        rangeConfig,
        lastRebalanceTime
      );
    }

    // Calculate token composition estimate
    const tokenComposition = {
      token0Percent: Math.round((1 - analysis.tokenRatio) * 100),
      token1Percent: Math.round(analysis.tokenRatio * 100),
    };

    // Format response
    const response = {
      tokenId,
      analysis: {
        currentTick: analysis.currentTick,
        tickLower: analysis.tickLower,
        tickUpper: analysis.tickUpper,
        rangeCenter: analysis.rangeCenter,
        rangeWidth: analysis.rangeWidth,
        positionInRange: Math.round(analysis.positionInRange * 100), // 0-100%
        centerDrift: Math.round(analysis.centerDrift * 100), // 0-100%
        tokenComposition,
        inRange: analysis.inRange,
        urgency: analysis.urgency,
        action: analysis.action,
        reason: analysis.reason,
      },
      volatility: {
        tickVolatility: Math.round(volatility.tickVolatility * 100) / 100,
        hourlyChange: Math.round(volatility.hourlyChange * 100) / 100,
        momentum: Math.round(volatility.momentum * 100) / 100,
        trendStrength: Math.round(volatility.trendStrength * 100) / 100,
        priceDirection: volatility.momentum > 0.1 ? 'rising' : volatility.momentum < -0.1 ? 'falling' : 'stable',
      },
      decision: decision ? {
        shouldRebalance: decision.shouldRebalance,
        reason: decision.reason,
        urgency: decision.urgency,
        estimatedSavingsBps: decision.estimatedSavings,
        waitRecommendation: decision.waitRecommendation,
      } : null,
      rangeConfig: rangeConfig || null,
      lastRebalanceTime,
      cooldownRemaining: Math.max(0, 3600 - (Math.floor(Date.now() / 1000) - lastRebalanceTime)),
    };

    res.json(response);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get smart analysis');
    res.status(500).json({ error: 'Failed to analyze position' });
  }
});

/**
 * Get smart analysis for multiple positions at once
 */
router.post('/batch-smart-analysis', async (req: Request, res: Response) => {
  try {
    const { tokenIds } = req.body;

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      return res.status(400).json({ error: 'tokenIds array required' });
    }

    // Limit batch size
    const limitedIds = tokenIds.slice(0, 20);

    const results = await Promise.all(
      limitedIds.map(async (tokenId: string) => {
        try {
          const tokenIdBigInt = BigInt(tokenId);

          // Get position data from PositionManager (more reliable than V4AutoRange)
          const [positionData, rangeConfig, lastRebalanceTime] = await Promise.all([
            blockchain.getPositionInfo(tokenIdBigInt),
            blockchain.getRangeConfig(tokenIdBigInt).catch(() => null),
            blockchain.getLastRebalanceTime(tokenIdBigInt).catch(() => 0),
          ]);

          if (!positionData || !positionData.poolKey) {
            return { tokenId, error: 'Position not found' };
          }

          // Get current tick directly from StateView
          const currentTick = await blockchain.getPoolCurrentTick(positionData.poolKey);

          // Debug logging
          routeLogger.info({
            tokenId,
            currentTick,
            tickLower: positionData.tickLower,
            tickUpper: positionData.tickUpper,
            inRange: currentTick >= positionData.tickLower && currentTick < positionData.tickUpper,
          }, 'Position analysis data');

          // Record price sample
          const poolId = `${positionData.poolKey.currency0}-${positionData.poolKey.currency1}-${positionData.poolKey.fee}`;
          recordPriceSample(poolId, currentTick);

          // Analyze using tick data from PositionManager and currentTick from StateView
          const analysis = analyzePosition(
            tokenId,
            currentTick,
            positionData.tickLower,
            positionData.tickUpper
          );

          const priceHistory = getPriceHistory(poolId);
          const volatility = calculateVolatility(priceHistory);

          // Get decision if range enabled
          let decision: RebalanceDecision | null = null;
          if (rangeConfig?.enabled) {
            decision = makeRebalanceDecision(analysis, volatility, rangeConfig, lastRebalanceTime);
          }

          // Calculate cooldown remaining
          const cooldownRemaining = Math.max(0, 3600 - (Math.floor(Date.now() / 1000) - lastRebalanceTime));

          return {
            tokenId,
            centerDrift: Math.round(analysis.centerDrift * 100),
            inRange: analysis.inRange,
            action: analysis.action,
            urgency: analysis.urgency,
            shouldRebalance: decision?.shouldRebalance || false,
            reason: decision?.reason || analysis.reason,
            cooldownRemaining,
            tokenComposition: {
              token0Percent: Math.round((1 - analysis.tokenRatio) * 100),
              token1Percent: Math.round(analysis.tokenRatio * 100),
            },
          };
        } catch (err) {
          return { tokenId, error: 'Failed to analyze' };
        }
      })
    );

    res.json({ positions: results });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to batch analyze positions');
    res.status(500).json({ error: 'Failed to analyze positions' });
  }
});

export { router as positionsRouter };
