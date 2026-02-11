import { logger } from '../utils/logger.js';
import * as subgraph from './subgraph.js';
import * as blockchain from './blockchain.js';
import { calculateUSDMetrics, USDMetrics } from './price.js';
import { memoryCache } from './cache.js';

const analyticsLogger = logger.child({ module: 'analytics' });

// Cache TTLs for expensive analytics operations
const PROTOCOL_ANALYTICS_TTL = 5 * 60 * 1000; // 5 minutes
const PORTFOLIO_ANALYTICS_TTL = 2 * 60 * 1000; // 2 minutes
const TVL_POSITION_TIMEOUT = 8000; // 8s per position in TVL calc

// Types
export interface PositionAnalytics {
  tokenId: string;
  totalFeesEarned: {
    token0: string;
    token1: string;
  };
  currentValue: {
    token0: string;
    token1: string;
  };
  unrealizedFees: {
    token0: string;
    token1: string;
  };
  compoundStats?: {
    totalCompounds: number;
    totalCompoundedToken0: string;
    totalCompoundedToken1: string;
    lastCompoundTime?: string;
  };
  rangeStats?: {
    totalRebalances: number;
    lastRebalanceTime?: string;
    timeInRange: number; // percentage
  };
  profitability: {
    estimatedAPR: string;
    dailyFeeRate: string;
    isInRange: boolean;
  };
  // USD-based metrics
  usdMetrics?: USDMetrics;
}

export interface PortfolioAnalytics {
  totalPositions: number;
  activePositions: number;
  totalValueLocked: string;
  totalFeesEarned: string;
  totalCompounds: number;
  totalRebalances: number;
  averageAPR: string;
  positionBreakdown: {
    inRange: number;
    outOfRange: number;
    compoundEnabled: number;
    rangeEnabled: number;
  };
}

export interface ProtocolAnalytics {
  totalPositions: number;
  activePositions: number;
  totalTVL: string;
  totalVolume: string;
  totalFees: string;
  totalCompoundConfigs: number;
  totalRangeConfigs: number;
  totalExitConfigs: number;
  dailyActivePositions: number;
  weeklyGrowth: string;
}

// Calculate position analytics
export async function getPositionAnalytics(
  tokenId: string,
  chainId: number = 8453,
  includeUSD: boolean = true
): Promise<PositionAnalytics | null> {
  try {
    const positionResult = await subgraph.getPosition(tokenId);
    let position = (positionResult as any)?.position;

    if (!position) {
      return null;
    }

    // CRITICAL: Check if position needs enrichment from chain
    // poolId === 'unknown' or tickLower/tickUpper === 0 means Ponder has incomplete data
    const needsEnrichment = !position.poolId || position.poolId === 'unknown' ||
      (position.tickLower === 0 && position.tickUpper === 0);

    if (needsEnrichment) {
      analyticsLogger.debug({ tokenId }, 'Position needs enrichment from chain (unknown poolId)');
      const onChainInfo = await blockchain.getPositionInfo(BigInt(tokenId));
      if (onChainInfo) {
        // Merge on-chain data with Ponder data
        position = {
          ...position,
          poolId: onChainInfo.poolId,
          poolKey: onChainInfo.poolKey,
          tickLower: onChainInfo.tickLower,
          tickUpper: onChainInfo.tickUpper,
          liquidity: onChainInfo.liquidity,
        };

        // Persist to database for future requests (async, don't wait)
        subgraph.updatePositionFromChain(
          tokenId,
          onChainInfo.poolId,
          onChainInfo.tickLower,
          onChainInfo.tickUpper,
          onChainInfo.liquidity
        ).catch(err => {
          analyticsLogger.warn({ error: err, tokenId }, 'Failed to persist enriched position');
        });
      }
    }

    // Get on-chain pending fees
    let unrealizedFees = { token0: '0', token1: '0' };
    let pendingFeesBigInt = { amount0: 0n, amount1: 0n };
    try {
      const fees = await blockchain.getPendingFees(BigInt(tokenId));
      pendingFeesBigInt = fees;
      unrealizedFees = {
        token0: fees.amount0.toString(),
        token1: fees.amount1.toString(),
      };
    } catch (e) {
      analyticsLogger.debug({ tokenId }, 'Could not fetch on-chain fees');
    }

    // Calculate profitability metrics
    const collectedFees0 = BigInt(position.collectedFeesToken0 || '0');
    const collectedFees1 = BigInt(position.collectedFeesToken1 || '0');
    const deposited0 = BigInt(position.depositedToken0 || '0');
    const deposited1 = BigInt(position.depositedToken1 || '0');

    // Simple APR estimate based on fees vs deposits
    let estimatedAPR = '0';
    const totalDeposited = deposited0 + deposited1;
    const totalFees = collectedFees0 + collectedFees1 + BigInt(unrealizedFees.token0) + BigInt(unrealizedFees.token1);

    const createdAt = parseInt(position.createdAtTimestamp || '0');

    if (totalDeposited > 0n) {
      // Calculate days since creation
      const now = Math.floor(Date.now() / 1000);
      const daysActive = Math.max(1, (now - createdAt) / 86400);

      // Annualized return
      const annualizedReturn = (Number(totalFees) / Number(totalDeposited)) * (365 / daysActive) * 100;
      estimatedAPR = annualizedReturn.toFixed(2);
    }

    // Daily fee rate
    const dailyFeeRate = estimatedAPR ? (parseFloat(estimatedAPR) / 365).toFixed(4) : '0';

    // Check if in range (would need current tick from pool)
    const isInRange = position.tickLower <= 0 && position.tickUpper >= 0; // Placeholder

    // Calculate USD metrics if requested
    let usdMetrics: USDMetrics | undefined = undefined;
    if (includeUSD) {
      try {
        // Get pool data for sqrtPriceX96 from blockchain (doesn't require subgraph pool data)
        const positionInfo = await blockchain.getPositionInfo(BigInt(tokenId));

        if (positionInfo?.poolKey) {
          const slot0 = await blockchain.getPoolSlot0(positionInfo.poolKey);

          usdMetrics = await calculateUSDMetrics(
            BigInt(position.liquidity || '0'),
            slot0.sqrtPriceX96,
            position.tickLower,
            position.tickUpper,
            positionInfo.poolKey.currency0,
            positionInfo.poolKey.currency1,
            chainId,
            pendingFeesBigInt,
            { amount0: collectedFees0, amount1: collectedFees1 },
            createdAt
          );
        }
      } catch (e) {
        analyticsLogger.debug({ tokenId, error: e }, 'Could not calculate USD metrics');
      }
    }

    return {
      tokenId,
      totalFeesEarned: {
        token0: position.collectedFeesToken0 || '0',
        token1: position.collectedFeesToken1 || '0',
      },
      currentValue: {
        token0: (BigInt(position.depositedToken0 || '0') - BigInt(position.withdrawnToken0 || '0')).toString(),
        token1: (BigInt(position.depositedToken1 || '0') - BigInt(position.withdrawnToken1 || '0')).toString(),
      },
      unrealizedFees,
      compoundStats: position.compoundConfig ? {
        totalCompounds: position.compoundConfig.totalCompounds || 0,
        totalCompoundedToken0: position.compoundConfig.totalCompoundedToken0 || '0',
        totalCompoundedToken1: position.compoundConfig.totalCompoundedToken1 || '0',
        lastCompoundTime: position.compoundConfig.lastCompoundTimestamp,
      } : undefined,
      rangeStats: position.rangeConfig ? {
        totalRebalances: position.rangeConfig.totalRebalances || 0,
        lastRebalanceTime: position.rangeConfig.lastRebalanceTimestamp,
        timeInRange: 85, // Placeholder - would need historical data
      } : undefined,
      profitability: {
        estimatedAPR,
        dailyFeeRate,
        isInRange,
      },
      usdMetrics,
    };
  } catch (error) {
    analyticsLogger.error({ tokenId, error }, 'Failed to get position analytics');
    return null;
  }
}

// Calculate portfolio analytics for a user
export async function getPortfolioAnalytics(owner: string): Promise<PortfolioAnalytics> {
  // Check cache first (2 min TTL per user)
  const cacheKey = `portfolio_analytics_${owner.toLowerCase()}`;
  const cached = memoryCache.get<PortfolioAnalytics>(cacheKey);
  if (cached) {
    analyticsLogger.debug({ owner }, 'Portfolio analytics cache hit');
    return cached;
  }

  try {
    const result = await subgraph.getPositionsByOwner(owner, 100, 0);
    const positions = (result as any)?.positions?.items || [];

    let totalValueLocked = 0n;
    let totalFeesEarned = 0n;
    let totalCompounds = 0;
    let totalRebalances = 0;
    let totalAPR = 0;
    let inRange = 0;
    let outOfRange = 0;
    let compoundEnabled = 0;
    let rangeEnabled = 0;

    for (const position of positions) {
      // Accumulate stats
      totalFeesEarned += BigInt(position.collectedFeesToken0 || '0') + BigInt(position.collectedFeesToken1 || '0');

      // Check automation status
      if (position.compoundConfig?.enabled) compoundEnabled++;
      if (position.rangeConfig?.enabled) rangeEnabled++;

      // In/out of range (placeholder logic)
      if (BigInt(position.liquidity || '0') > 0n) {
        inRange++; // Would need actual tick data
      }
    }

    const activePositions = positions.filter((p: any) => BigInt(p.liquidity || '0') > 0n).length;
    const averageAPR = positions.length > 0 ? (totalAPR / positions.length).toFixed(2) : '0';

    const portfolioResult: PortfolioAnalytics = {
      totalPositions: positions.length,
      activePositions,
      totalValueLocked: totalValueLocked.toString(),
      totalFeesEarned: totalFeesEarned.toString(),
      totalCompounds,
      totalRebalances,
      averageAPR,
      positionBreakdown: {
        inRange,
        outOfRange,
        compoundEnabled,
        rangeEnabled,
      },
    };

    // Cache the result
    memoryCache.set(cacheKey, portfolioResult, PORTFOLIO_ANALYTICS_TTL);
    analyticsLogger.debug({ owner, positions: positions.length }, 'Portfolio analytics cached');

    return portfolioResult;
  } catch (error) {
    analyticsLogger.error({ owner, error }, 'Failed to get portfolio analytics');
    return {
      totalPositions: 0,
      activePositions: 0,
      totalValueLocked: '0',
      totalFeesEarned: '0',
      totalCompounds: 0,
      totalRebalances: 0,
      averageAPR: '0',
      positionBreakdown: {
        inRange: 0,
        outOfRange: 0,
        compoundEnabled: 0,
        rangeEnabled: 0,
      },
    };
  }
}

// Calculate protocol TVL from active positions
async function calculateProtocolTVL(): Promise<{ tvl: string; totalFees: string }> {
  try {
    // Get active positions directly from database (with filter in SQL)
    // Limit to 30 to keep TVL calc under 20s (30 positions × 5 batch × ~2s each)
    const positionsResult = await subgraph.getAllPositions(30, 0, true); // activeOnly = true
    const activePositions = (positionsResult as any)?.positions?.items || [];

    analyticsLogger.info({ activeCount: activePositions.length }, 'Fetched active positions for TVL calculation');

    if (activePositions.length === 0) {
      return { tvl: '0', totalFees: '0' };
    }

    let totalTVL = 0;
    let totalFees = 0;
    let successCount = 0;
    let errorCount = 0;

    // Calculate USD value for each position (limit concurrent calls)
    // Use larger batch size (5) with per-position timeout to finish faster
    const batchSize = 5;
    for (let i = 0; i < activePositions.length; i += batchSize) {
      const batch = activePositions.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (position: any) => {
          // Wrap each position calculation with a timeout
          return new Promise<{ tvl: number; fees: number }>((resolve) => {
            const timeout = setTimeout(() => {
              analyticsLogger.debug({ tokenId: position.tokenId }, 'TVL calc timed out');
              resolve({ tvl: 0, fees: 0 });
            }, TVL_POSITION_TIMEOUT);

            (async () => {
              try {
                const tokenId = position.tokenId || position.token_id;
                if (!tokenId) {
                  return { tvl: 0, fees: 0 };
                }

                const tokenIdBigInt = BigInt(tokenId);
                const positionInfo = await blockchain.getPositionInfo(tokenIdBigInt);

                if (!positionInfo?.poolKey) {
                  return { tvl: 0, fees: 0 };
                }

                const slot0 = await blockchain.getPoolSlot0(positionInfo.poolKey);
                const pendingFees = await blockchain.getPendingFees(tokenIdBigInt);

                const tickLower = position.tickLower || position.tick_lower || 0;
                const tickUpper = position.tickUpper || position.tick_upper || 0;

                const metrics = await calculateUSDMetrics(
                  BigInt(position.liquidity || '0'),
                  slot0.sqrtPriceX96,
                  tickLower,
                  tickUpper,
                  positionInfo.poolKey.currency0,
                  positionInfo.poolKey.currency1,
                  8453, // Base mainnet
                  pendingFees,
                  { amount0: BigInt(position.collectedFeesToken0 || position.collected_fees_token0 || '0'), amount1: BigInt(position.collectedFeesToken1 || position.collected_fees_token1 || '0') },
                  parseInt(position.createdAtTimestamp || position.created_at_timestamp || '0')
                );

                return {
                  tvl: metrics.positionValueUSD || 0,
                  fees: metrics.totalFeesEarnedUSD || 0,
                };
              } catch (e) {
                analyticsLogger.debug({ error: (e as Error).message }, 'Failed to calculate position TVL');
                return { tvl: 0, fees: 0 };
              }
            })().then((val) => {
              clearTimeout(timeout);
              resolve(val);
            });
          });
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          totalTVL += result.value.tvl;
          totalFees += result.value.fees;
          if (result.value.tvl > 0) successCount++;
          else errorCount++;
        } else {
          errorCount++;
        }
      }
    }

    analyticsLogger.info({ totalTVL, totalFees, successCount, errorCount }, 'TVL calculation complete');

    return {
      tvl: totalTVL.toFixed(2),
      totalFees: totalFees.toFixed(2),
    };
  } catch (error) {
    analyticsLogger.error({ error: (error as Error).message }, 'Failed to calculate protocol TVL');
    return { tvl: '0', totalFees: '0' };
  }
}

// Get protocol-wide analytics
export async function getProtocolAnalytics(): Promise<ProtocolAnalytics> {
  // Check cache first (5 min TTL - TVL changes slowly)
  const cacheKey = 'protocol_analytics';
  const cached = memoryCache.get<ProtocolAnalytics>(cacheKey);
  if (cached) {
    analyticsLogger.debug('Protocol analytics cache hit');
    return cached;
  }

  try {
    const statsResult = await subgraph.getProtocolStats();
    const stats = (statsResult as any)?.protocolStats;

    // Calculate TVL from active positions if pool-level TVL is 0
    let totalTVL = stats?.totalSupplied || '0';
    let totalFees = stats?.totalFeesUSD || '0';

    // If TVL is 0, calculate from active positions
    if (totalTVL === '0' || totalTVL === 0) {
      try {
        const tvlData = await calculateProtocolTVL();
        totalTVL = tvlData.tvl;
        if (totalFees === '0' || totalFees === 0) {
          totalFees = tvlData.totalFees;
        }
      } catch (e) {
        analyticsLogger.warn({ error: e }, 'Failed to calculate TVL from positions');
      }
    }

    const result: ProtocolAnalytics = {
      totalPositions: stats?.totalPositions || 0,
      activePositions: stats?.activePositions || 0,
      totalTVL,
      totalVolume: stats?.totalVolumeUSD || '0',
      totalFees,
      totalCompoundConfigs: stats?.totalCompoundConfigs || 0,
      totalRangeConfigs: stats?.totalRangeConfigs || 0,
      totalExitConfigs: stats?.totalExitConfigs || 0,
      dailyActivePositions: 0, // Would need daily data
      weeklyGrowth: '0', // Would need historical data
    };

    // Cache the result (5 min TTL)
    memoryCache.set(cacheKey, result, PROTOCOL_ANALYTICS_TTL);
    analyticsLogger.info({ totalTVL, totalPositions: result.totalPositions }, 'Protocol analytics cached');

    return result;
  } catch (error) {
    analyticsLogger.error({ error }, 'Failed to get protocol analytics');
    return {
      totalPositions: 0,
      activePositions: 0,
      totalTVL: '0',
      totalVolume: '0',
      totalFees: '0',
      totalCompoundConfigs: 0,
      totalRangeConfigs: 0,
      totalExitConfigs: 0,
      dailyActivePositions: 0,
      weeklyGrowth: '0',
    };
  }
}

// Check compound profitability for a position
export async function checkCompoundProfitability(tokenId: string): Promise<{
  isProfitable: boolean;
  estimatedReward: string;
  pendingFees: { token0: string; token1: string };
  recommendation: string;
}> {
  try {
    const tokenIdBigInt = BigInt(tokenId);

    // Check on-chain profitability
    const { profitable, reward } = await blockchain.checkCompoundProfitable(tokenIdBigInt);
    const fees = await blockchain.getPendingFees(tokenIdBigInt);

    let recommendation = '';
    if (profitable) {
      recommendation = 'Compounding is profitable. Consider triggering a compound now.';
    } else if (fees.amount0 > 0n || fees.amount1 > 0n) {
      recommendation = 'Fees have accumulated but compounding is not yet profitable. Wait for more fees.';
    } else {
      recommendation = 'No significant fees accumulated yet.';
    }

    return {
      isProfitable: profitable,
      estimatedReward: reward.toString(),
      pendingFees: {
        token0: fees.amount0.toString(),
        token1: fees.amount1.toString(),
      },
      recommendation,
    };
  } catch (error) {
    analyticsLogger.error({ tokenId, error }, 'Failed to check compound profitability');
    return {
      isProfitable: false,
      estimatedReward: '0',
      pendingFees: { token0: '0', token1: '0' },
      recommendation: 'Unable to determine profitability. Please try again.',
    };
  }
}

// Check rebalance need for a position
export async function checkRebalanceNeed(tokenId: string): Promise<{
  needsRebalance: boolean;
  reason: string;
  currentTick?: number;
  positionRange?: { lower: number; upper: number };
  recommendation: string;
}> {
  try {
    const tokenIdBigInt = BigInt(tokenId);

    // Check on-chain rebalance status
    const { needsRebalance, reason } = await blockchain.checkRebalance(tokenIdBigInt);

    const reasonMap: Record<number, string> = {
      0: 'Position is in range',
      1: 'Price below position range',
      2: 'Price above position range',
    };

    let recommendation = '';
    if (needsRebalance) {
      recommendation = 'Position is out of range. Rebalancing will move your liquidity to earn fees again.';
    } else {
      recommendation = 'Position is performing well in the current range.';
    }

    return {
      needsRebalance,
      reason: reasonMap[reason] || 'Unknown',
      recommendation,
    };
  } catch (error) {
    analyticsLogger.error({ tokenId, error }, 'Failed to check rebalance need');
    return {
      needsRebalance: false,
      reason: 'Unable to determine',
      recommendation: 'Unable to check rebalance status. Please try again.',
    };
  }
}
