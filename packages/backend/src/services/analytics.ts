import { logger } from '../utils/logger.js';
import * as subgraph from './subgraph.js';
import * as blockchain from './blockchain.js';

const analyticsLogger = logger.child({ module: 'analytics' });

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
export async function getPositionAnalytics(tokenId: string): Promise<PositionAnalytics | null> {
  try {
    const positionResult = await subgraph.getPosition(tokenId);
    const position = (positionResult as any)?.position;

    if (!position) {
      return null;
    }

    // Get on-chain pending fees
    let unrealizedFees = { token0: '0', token1: '0' };
    try {
      const fees = await blockchain.getPendingFees(BigInt(tokenId));
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

    if (totalDeposited > 0n) {
      // Calculate days since creation
      const createdAt = parseInt(position.createdAtTimestamp || '0');
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
    };
  } catch (error) {
    analyticsLogger.error({ tokenId, error }, 'Failed to get position analytics');
    return null;
  }
}

// Calculate portfolio analytics for a user
export async function getPortfolioAnalytics(owner: string): Promise<PortfolioAnalytics> {
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

    return {
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

// Get protocol-wide analytics
export async function getProtocolAnalytics(): Promise<ProtocolAnalytics> {
  try {
    const statsResult = await subgraph.getProtocolStats();
    const stats = (statsResult as any)?.protocolStats;

    return {
      totalPositions: stats?.totalPositions || 0,
      activePositions: stats?.activePositions || 0,
      totalTVL: stats?.totalSupplied || '0',
      totalVolume: stats?.totalVolumeUSD || '0',
      totalFees: stats?.totalFeesUSD || '0',
      totalCompoundConfigs: stats?.totalCompoundConfigs || 0,
      totalRangeConfigs: stats?.totalRangeConfigs || 0,
      totalExitConfigs: stats?.totalExitConfigs || 0,
      dailyActivePositions: 0, // Would need daily data
      weeklyGrowth: '0', // Would need historical data
    };
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
