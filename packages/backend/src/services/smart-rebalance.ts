/**
 * Smart Rebalance Service
 *
 * Implements proactive center-based rebalancing that avoids common anti-patterns:
 * ❌ Rebalancing only when out of range
 * ❌ Pure time-based rebalances
 * ❌ Static ranges forever
 * ❌ Edge-only thresholds
 *
 * ✅ Center-drift detection (rebalance before hitting edge)
 * ✅ Price momentum awareness (don't rebalance into trending price)
 * ✅ Volatility-adjusted thresholds
 * ✅ Optimal timing based on gas + expected IL savings
 */

import { logger } from '../utils/logger.js';

const smartLogger = logger.child({ service: 'smart-rebalance' });

// ============ Types ============

export interface PositionAnalysis {
  tokenId: string;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  rangeCenter: number;
  rangeWidth: number;

  // Position in range (0 = at lower edge, 0.5 = center, 1 = at upper edge)
  positionInRange: number;

  // Drift from center (0 = at center, 1 = at edge)
  centerDrift: number;

  // Token composition estimate (0 = 100% token0, 1 = 100% token1)
  tokenRatio: number;

  // Is currently in range
  inRange: boolean;

  // Urgency score (0-100)
  urgency: number;

  // Recommendation
  action: 'hold' | 'monitor' | 'rebalance_soon' | 'rebalance_now';
  reason: string;
}

export interface PriceHistory {
  tick: number;
  timestamp: number;
}

export interface VolatilityMetrics {
  // Standard deviation of tick movements
  tickVolatility: number;

  // Average absolute tick change per hour
  hourlyChange: number;

  // Current momentum (-1 to +1, negative = price falling, positive = rising)
  momentum: number;

  // Trend strength (0-1)
  trendStrength: number;
}

export interface RebalanceDecision {
  shouldRebalance: boolean;
  reason: string;
  urgency: number; // 0-100
  estimatedSavings: number; // Estimated IL avoided in basis points
  waitRecommendation?: number; // Seconds to wait if not rebalancing now
}

// ============ State ============

// Price history per pool (poolId -> history)
const priceHistoryCache = new Map<string, PriceHistory[]>();
const PRICE_HISTORY_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const PRICE_HISTORY_SAMPLE_INTERVAL = 60 * 1000; // 1 minute between samples

// ============ Core Analysis Functions ============

/**
 * Analyze a position's current state and risk
 */
export function analyzePosition(
  tokenId: string,
  currentTick: number,
  tickLower: number,
  tickUpper: number
): PositionAnalysis {
  const rangeWidth = tickUpper - tickLower;
  const rangeCenter = Math.floor((tickLower + tickUpper) / 2);

  // Position in range: 0 = at tickLower, 0.5 = center, 1 = at tickUpper
  let positionInRange: number;
  if (currentTick <= tickLower) {
    positionInRange = 0;
  } else if (currentTick >= tickUpper) {
    positionInRange = 1;
  } else {
    positionInRange = (currentTick - tickLower) / rangeWidth;
  }

  // Center drift: 0 = at center, 1 = at edge
  const distanceFromCenter = Math.abs(currentTick - rangeCenter);
  const halfRange = rangeWidth / 2;
  const centerDrift = Math.min(1, distanceFromCenter / halfRange);

  // Token ratio estimate based on position
  // At tickLower: 100% token0 (ratio = 0)
  // At tickUpper: 100% token1 (ratio = 1)
  // This is simplified - real calculation uses sqrtPrice
  const tokenRatio = positionInRange;

  // In range check
  const inRange = currentTick >= tickLower && currentTick < tickUpper;

  // Calculate urgency and action
  let urgency: number;
  let action: PositionAnalysis['action'];
  let reason: string;

  if (!inRange) {
    // Already out of range - critical
    urgency = 100;
    action = 'rebalance_now';
    reason = currentTick < tickLower
      ? 'Position below range - 100% token0, not earning fees'
      : 'Position above range - 100% token1, not earning fees';
  } else if (centerDrift >= 0.85) {
    // Very close to edge (85%+ from center)
    urgency = 80;
    action = 'rebalance_now';
    reason = `Position ${Math.round(centerDrift * 100)}% from center, approaching edge`;
  } else if (centerDrift >= 0.65) {
    // Significant drift (65-85% from center)
    urgency = 60;
    action = 'rebalance_soon';
    reason = `Position ${Math.round(centerDrift * 100)}% from center, consider rebalancing`;
  } else if (centerDrift >= 0.45) {
    // Moderate drift (45-65% from center)
    urgency = 40;
    action = 'monitor';
    reason = `Position ${Math.round(centerDrift * 100)}% from center, monitoring`;
  } else {
    // Well centered (< 45% from center)
    urgency = 10;
    action = 'hold';
    reason = `Position well centered (${Math.round(centerDrift * 100)}% drift)`;
  }

  return {
    tokenId,
    currentTick,
    tickLower,
    tickUpper,
    rangeCenter,
    rangeWidth,
    positionInRange,
    centerDrift,
    tokenRatio,
    inRange,
    urgency,
    action,
    reason,
  };
}

/**
 * Calculate volatility metrics from price history
 */
export function calculateVolatility(history: PriceHistory[]): VolatilityMetrics {
  if (history.length < 2) {
    return {
      tickVolatility: 0,
      hourlyChange: 0,
      momentum: 0,
      trendStrength: 0,
    };
  }

  // Sort by timestamp
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  // Calculate tick changes
  const changes: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    changes.push(sorted[i].tick - sorted[i - 1].tick);
  }

  // Standard deviation of changes
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const squaredDiffs = changes.map(c => Math.pow(c - mean, 2));
  const tickVolatility = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / changes.length);

  // Hourly change (average absolute change scaled to 1 hour)
  const totalTime = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  const totalAbsChange = changes.reduce((a, b) => a + Math.abs(b), 0);
  const hourlyChange = totalTime > 0 ? (totalAbsChange / totalTime) * 3600000 : 0;

  // Momentum: recent trend direction
  // Use last 10% of history or at least 3 samples
  const recentCount = Math.max(3, Math.floor(sorted.length * 0.1));
  const recentHistory = sorted.slice(-recentCount);
  const recentChange = recentHistory[recentHistory.length - 1].tick - recentHistory[0].tick;
  const maxPossibleChange = tickVolatility * recentCount * 2; // Rough normalization
  const momentum = maxPossibleChange > 0
    ? Math.max(-1, Math.min(1, recentChange / maxPossibleChange))
    : 0;

  // Trend strength: how consistent is the direction?
  let sameDirection = 0;
  const recentChanges = [];
  for (let i = 1; i < recentHistory.length; i++) {
    recentChanges.push(recentHistory[i].tick - recentHistory[i - 1].tick);
  }
  for (let i = 1; i < recentChanges.length; i++) {
    if (Math.sign(recentChanges[i]) === Math.sign(recentChanges[i - 1])) {
      sameDirection++;
    }
  }
  const trendStrength = recentChanges.length > 1
    ? sameDirection / (recentChanges.length - 1)
    : 0;

  return {
    tickVolatility,
    hourlyChange,
    momentum,
    trendStrength,
  };
}

/**
 * Add price sample to history
 */
export function recordPriceSample(poolId: string, tick: number): void {
  const now = Date.now();
  let history = priceHistoryCache.get(poolId);

  if (!history) {
    history = [];
    priceHistoryCache.set(poolId, history);
  }

  // Only add if enough time has passed since last sample
  const lastSample = history[history.length - 1];
  if (lastSample && now - lastSample.timestamp < PRICE_HISTORY_SAMPLE_INTERVAL) {
    return;
  }

  history.push({ tick, timestamp: now });

  // Clean old samples
  const cutoff = now - PRICE_HISTORY_MAX_AGE;
  while (history.length > 0 && history[0].timestamp < cutoff) {
    history.shift();
  }
}

/**
 * Get price history for a pool
 */
export function getPriceHistory(poolId: string): PriceHistory[] {
  return priceHistoryCache.get(poolId) || [];
}

// ============ Smart Decision Making ============

/**
 * Make a smart rebalancing decision based on multiple factors
 */
export function makeRebalanceDecision(
  analysis: PositionAnalysis,
  volatility: VolatilityMetrics,
  rangeConfig: { lowerDelta: number; upperDelta: number; rebalanceThreshold: number },
  lastRebalanceTime: number
): RebalanceDecision {
  const now = Date.now() / 1000;
  const timeSinceLastRebalance = now - lastRebalanceTime;
  const minInterval = 3600; // 1 hour minimum (contract enforced)

  // Check cooldown
  if (timeSinceLastRebalance < minInterval) {
    return {
      shouldRebalance: false,
      reason: `Cooldown active (${Math.round(minInterval - timeSinceLastRebalance)}s remaining)`,
      urgency: analysis.urgency,
      estimatedSavings: 0,
      waitRecommendation: minInterval - timeSinceLastRebalance,
    };
  }

  // Already out of range - always rebalance
  if (!analysis.inRange) {
    return {
      shouldRebalance: true,
      reason: analysis.reason,
      urgency: 100,
      estimatedSavings: estimateILSavings(analysis, volatility),
    };
  }

  // ============ Smart Center-Based Logic ============

  // Adjust threshold based on volatility
  // High volatility = more patient (wider effective threshold)
  // Low volatility = more aggressive (tighter effective threshold)
  const volatilityAdjustment = Math.min(0.15, volatility.tickVolatility / analysis.rangeWidth);
  const adjustedCenterThreshold = 0.5 + volatilityAdjustment; // Base 50% + volatility adjustment

  // Check if we've drifted enough from center
  if (analysis.centerDrift < adjustedCenterThreshold) {
    return {
      shouldRebalance: false,
      reason: `Center drift ${Math.round(analysis.centerDrift * 100)}% below threshold ${Math.round(adjustedCenterThreshold * 100)}%`,
      urgency: analysis.urgency,
      estimatedSavings: 0,
    };
  }

  // ============ Momentum Check ============
  // Don't rebalance INTO a strong trend - wait for reversal or stabilization

  const priceMovingTowardEdge = (
    (analysis.positionInRange < 0.5 && volatility.momentum < -0.3) || // Price falling, we're in lower half
    (analysis.positionInRange > 0.5 && volatility.momentum > 0.3)    // Price rising, we're in upper half
  );

  if (priceMovingTowardEdge && volatility.trendStrength > 0.6) {
    // Strong trend pushing us toward edge - wait for reversal
    // Exception: if we're critically close to edge, rebalance anyway
    if (analysis.centerDrift < 0.85) {
      return {
        shouldRebalance: false,
        reason: `Strong trend toward edge (momentum: ${volatility.momentum.toFixed(2)}, strength: ${volatility.trendStrength.toFixed(2)}) - waiting for reversal`,
        urgency: analysis.urgency,
        estimatedSavings: 0,
        waitRecommendation: 300, // Check again in 5 minutes
      };
    }
  }

  // ============ Optimal Timing Check ============
  // Prefer rebalancing when price is moving AWAY from edge (mean reversion)

  const priceMovingTowardCenter = (
    (analysis.positionInRange < 0.5 && volatility.momentum > 0.1) || // Price rising, we're in lower half
    (analysis.positionInRange > 0.5 && volatility.momentum < -0.1)   // Price falling, we're in upper half
  );

  // Calculate estimated savings
  const estimatedSavings = estimateILSavings(analysis, volatility);

  // Decision matrix
  if (analysis.centerDrift >= 0.85) {
    // Critical zone - rebalance regardless of momentum
    return {
      shouldRebalance: true,
      reason: `Critical drift ${Math.round(analysis.centerDrift * 100)}% - rebalancing to prevent out-of-range`,
      urgency: 90,
      estimatedSavings,
    };
  }

  if (analysis.centerDrift >= 0.65 && priceMovingTowardCenter) {
    // Good opportunity - price reverting while we're drifted
    return {
      shouldRebalance: true,
      reason: `Drift ${Math.round(analysis.centerDrift * 100)}% with favorable price movement - optimal rebalance timing`,
      urgency: 70,
      estimatedSavings,
    };
  }

  if (analysis.centerDrift >= 0.65) {
    // Significant drift but momentum not ideal
    // Still rebalance if drift is high enough
    if (analysis.centerDrift >= 0.75) {
      return {
        shouldRebalance: true,
        reason: `High drift ${Math.round(analysis.centerDrift * 100)}% - rebalancing despite neutral momentum`,
        urgency: 65,
        estimatedSavings,
      };
    }

    return {
      shouldRebalance: false,
      reason: `Moderate drift ${Math.round(analysis.centerDrift * 100)}% - waiting for better timing`,
      urgency: analysis.urgency,
      estimatedSavings: 0,
      waitRecommendation: 180, // Check again in 3 minutes
    };
  }

  // Default: no rebalance needed
  return {
    shouldRebalance: false,
    reason: analysis.reason,
    urgency: analysis.urgency,
    estimatedSavings: 0,
  };
}

/**
 * Estimate IL savings from rebalancing now vs waiting
 * Returns basis points of value saved
 */
function estimateILSavings(analysis: PositionAnalysis, volatility: VolatilityMetrics): number {
  // If already out of range, estimate based on how far out
  if (!analysis.inRange) {
    // Rough estimate: 1% IL for every 1% of range we're out
    const ticksOut = analysis.currentTick < analysis.tickLower
      ? analysis.tickLower - analysis.currentTick
      : analysis.currentTick - analysis.tickUpper;
    const percentOut = (ticksOut / analysis.rangeWidth) * 100;
    return Math.min(500, Math.round(percentOut * 10)); // Cap at 5%
  }

  // If in range, estimate based on drift and volatility
  // Higher drift = more to save by rebalancing
  // Higher volatility = more risk of going out of range
  const driftRisk = analysis.centerDrift * 100; // 0-100
  const volatilityRisk = Math.min(50, volatility.hourlyChange / 10); // Cap at 50

  // Estimated bps saved
  return Math.round(driftRisk * 0.5 + volatilityRisk * 0.3);
}

// ============ Per-Block Deduplication ============
// NOTE: Disabled to reduce RPC costs. The contract already prevents
// double-rebalances via MIN_REBALANCE_INTERVAL (1 hour), so this
// block-level deduplication is redundant in practice.

/**
 * Check if we can rebalance this position in this block
 * @deprecated Now always returns true - contract handles rate limiting
 */
export async function canRebalanceInCurrentBlock(_tokenId: string): Promise<boolean> {
  return true;
}

/**
 * Mark a position as rebalanced in current block
 * @deprecated No-op - contract handles rate limiting
 */
export async function markRebalancedInBlock(_tokenId: string): Promise<void> {
  // No-op - saves 1 RPC call per rebalance
}

// ============ Logging & Metrics ============

/**
 * Log analysis for debugging and monitoring
 */
export function logPositionAnalysis(analysis: PositionAnalysis, decision: RebalanceDecision): void {
  const level = decision.shouldRebalance ? 'info' : 'debug';

  smartLogger[level]({
    tokenId: analysis.tokenId,
    currentTick: analysis.currentTick,
    range: `[${analysis.tickLower}, ${analysis.tickUpper}]`,
    centerDrift: `${Math.round(analysis.centerDrift * 100)}%`,
    tokenRatio: `${Math.round(analysis.tokenRatio * 100)}% token1`,
    inRange: analysis.inRange,
    action: analysis.action,
    decision: decision.shouldRebalance ? 'REBALANCE' : 'HOLD',
    reason: decision.reason,
    urgency: decision.urgency,
    estimatedSavingsBps: decision.estimatedSavings,
  }, decision.shouldRebalance ? 'Position needs rebalancing' : 'Position status');
}

/**
 * Summary stats for all monitored positions
 */
export interface MonitoringSummary {
  totalPositions: number;
  inRange: number;
  outOfRange: number;
  needsRebalance: number;
  criticalDrift: number; // > 85%
  highDrift: number;     // 65-85%
  moderateDrift: number; // 45-65%
  wellCentered: number;  // < 45%
}

export function summarizePositions(analyses: PositionAnalysis[]): MonitoringSummary {
  return {
    totalPositions: analyses.length,
    inRange: analyses.filter(a => a.inRange).length,
    outOfRange: analyses.filter(a => !a.inRange).length,
    needsRebalance: analyses.filter(a => a.action === 'rebalance_now').length,
    criticalDrift: analyses.filter(a => a.centerDrift >= 0.85).length,
    highDrift: analyses.filter(a => a.centerDrift >= 0.65 && a.centerDrift < 0.85).length,
    moderateDrift: analyses.filter(a => a.centerDrift >= 0.45 && a.centerDrift < 0.65).length,
    wellCentered: analyses.filter(a => a.centerDrift < 0.45).length,
  };
}
