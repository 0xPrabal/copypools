'use client';

import { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { useChainId } from 'wagmi';
import {
  Calculator,
  TrendingUp,
  Zap,
  DollarSign,
  Info,
  ChevronRight,
  Sparkles,
  Clock,
  BarChart3
} from 'lucide-react';
import { CHAIN_IDS } from '@/config/contracts';

interface ProfitabilityCalculatorProps {
  tokenId: string;
  pendingFees?: [bigint, bigint];
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  liquidity: string;
  isCompoundEnabled?: boolean;
  positionAgeHours?: number; // Optional: hours since position created
}

interface EstimatedReturns {
  dailyFees: { token0: string; token1: string };
  weeklyFees: { token0: string; token1: string };
  monthlyFees: { token0: string; token1: string };
  yearlyFees: { token0: string; token1: string };
  compoundBoost: string;
  apr: string;
  currentFees: { token0: string; token1: string };
}

const timeframes = [
  { id: 'daily', label: '24H', icon: Clock },
  { id: 'weekly', label: '7D', icon: Clock },
  { id: 'monthly', label: '30D', icon: Clock },
  { id: 'yearly', label: '1Y', icon: BarChart3 },
] as const;

export function ProfitabilityCalculator({
  tokenId,
  pendingFees,
  token0Symbol,
  token1Symbol,
  token0Decimals,
  token1Decimals,
  liquidity,
  isCompoundEnabled,
  positionAgeHours = 24, // Default: assume position is 24 hours old for rate calculation
}: ProfitabilityCalculatorProps) {
  const chainId = useChainId();
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [estimates, setEstimates] = useState<EstimatedReturns | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    setIsCalculating(true);

    // Get accumulated fees (may be 0 for new positions)
    const accumulatedFee0 = pendingFees?.[0] || 0n;
    const accumulatedFee1 = pendingFees?.[1] || 0n;

    // Calculate hourly rate from accumulated fees
    // pendingFees is TOTAL accumulated, not daily rate
    // We estimate daily rate by dividing by position age
    const ageHours = Math.max(positionAgeHours, 1); // Minimum 1 hour to avoid division by zero

    // Calculate hourly fee rate (using bigint math with precision)
    const PRECISION = 1000000n; // 6 decimal precision
    const hourlyFee0 = (accumulatedFee0 * PRECISION) / BigInt(ageHours);
    const hourlyFee1 = (accumulatedFee1 * PRECISION) / BigInt(ageHours);

    // Calculate fees for different periods (keeping precision)
    const dailyFee0 = (hourlyFee0 * 24n) / PRECISION;
    const dailyFee1 = (hourlyFee1 * 24n) / PRECISION;

    const weeklyFee0 = (hourlyFee0 * 24n * 7n) / PRECISION;
    const weeklyFee1 = (hourlyFee1 * 24n * 7n) / PRECISION;

    const monthlyFee0 = (hourlyFee0 * 24n * 30n) / PRECISION;
    const monthlyFee1 = (hourlyFee1 * 24n * 30n) / PRECISION;

    const yearlyFee0 = (hourlyFee0 * 24n * 365n) / PRECISION;
    const yearlyFee1 = (hourlyFee1 * 24n * 365n) / PRECISION;

    const compoundBoostPercent = isCompoundEnabled ? '~10-15%' : '0%';

    // Calculate APR based on liquidity value
    // APR = (yearly fees / liquidity) * 100
    const liquidityValue = BigInt(liquidity || '0');
    let apr = '0.00';
    if (liquidityValue > 0n && (yearlyFee0 > 0n || yearlyFee1 > 0n)) {
      // Simplified APR: assume both tokens have similar value for estimation
      // In production, you'd want to use actual token prices
      const yearlyFeesNormalized = yearlyFee0 + yearlyFee1;

      // APR calculation - scale for display
      // Since liquidity is in sqrt(price) space, this is an approximation
      const aprBasisPoints = (yearlyFeesNormalized * 10000n) / liquidityValue;
      const aprValue = Number(aprBasisPoints) / 100;
      apr = aprValue < 0.01 && aprValue > 0 ? '<0.01' : aprValue.toFixed(2);
    }

    setEstimates({
      dailyFees: {
        token0: formatUnits(dailyFee0, token0Decimals),
        token1: formatUnits(dailyFee1, token1Decimals),
      },
      weeklyFees: {
        token0: formatUnits(weeklyFee0, token0Decimals),
        token1: formatUnits(weeklyFee1, token1Decimals),
      },
      monthlyFees: {
        token0: formatUnits(monthlyFee0, token0Decimals),
        token1: formatUnits(monthlyFee1, token1Decimals),
      },
      yearlyFees: {
        token0: formatUnits(yearlyFee0, token0Decimals),
        token1: formatUnits(yearlyFee1, token1Decimals),
      },
      currentFees: {
        token0: formatUnits(accumulatedFee0, token0Decimals),
        token1: formatUnits(accumulatedFee1, token1Decimals),
      },
      compoundBoost: compoundBoostPercent,
      apr,
    });

    setIsCalculating(false);
  }, [pendingFees, token0Decimals, token1Decimals, liquidity, isCompoundEnabled, positionAgeHours]);

  const getDisplayFees = () => {
    if (!estimates) return null;
    switch (timeframe) {
      case 'daily':
        return estimates.dailyFees;
      case 'weekly':
        return estimates.weeklyFees;
      case 'monthly':
        return estimates.monthlyFees;
      case 'yearly':
        return estimates.yearlyFees;
    }
  };

  const displayFees = getDisplayFees();

  return (
    <div className="card-gradient animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
            <Calculator className="text-cyan-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Earnings Forecast</h3>
            <p className="text-xs text-gray-400">Estimated returns based on current activity</p>
          </div>
        </div>
        {isCompoundEnabled && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30">
            <Zap size={12} className="text-purple-400" />
            <span className="text-xs font-medium text-purple-400">Auto-Compound</span>
          </div>
        )}
      </div>

      {/* Timeframe Selector */}
      <div className="flex gap-1 p-1 rounded-xl bg-gray-900/50 border border-gray-800/50 mb-6">
        {timeframes.map((tf) => (
          <button
            key={tf.id}
            onClick={() => setTimeframe(tf.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              timeframe === tf.id
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-white border border-cyan-500/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <tf.icon size={14} />
            {tf.label}
          </button>
        ))}
      </div>

      {/* Estimated Fees Display */}
      {estimates && (
        <div className="space-y-5">
          {/* Current Accumulated Fees - Always show */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={16} className="text-green-400" />
              <span className="text-sm font-medium text-gray-300">Current Unclaimed Fees</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500">{token0Symbol}</span>
                <p className="text-lg font-bold text-green-400">
                  {parseFloat(estimates.currentFees.token0).toFixed(8)}
                </p>
              </div>
              <div>
                <span className="text-xs text-gray-500">{token1Symbol}</span>
                <p className="text-lg font-bold text-green-400">
                  {parseFloat(estimates.currentFees.token1).toFixed(8)}
                </p>
              </div>
            </div>
          </div>

          {/* Projected Fees - Based on selected timeframe */}
          <div>
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">Projected Earnings ({timeframes.find(t => t.id === timeframe)?.label})</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="stat-card group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{token0Symbol}</span>
                  <ChevronRight size={14} className="text-gray-600 group-hover:text-cyan-400 transition-colors" />
                </div>
                <p className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  {displayFees ? parseFloat(displayFees.token0).toFixed(6) : '0.000000'}
                </p>
                <div className="mt-2 h-1 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-shimmer" />
                </div>
              </div>

              <div className="stat-card group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{token1Symbol}</span>
                  <ChevronRight size={14} className="text-gray-600 group-hover:text-cyan-400 transition-colors" />
                </div>
                <p className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  {displayFees ? parseFloat(displayFees.token1).toFixed(6) : '0.000000'}
                </p>
                <div className="mt-2 h-1 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-shimmer" />
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            {/* APR */}
            <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-blue-500/10 to-cyan-500/5 border border-blue-500/20">
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-2">
                <TrendingUp size={14} className="text-blue-400" />
                <span>Est. APR</span>
              </div>
              <p className="text-xl font-bold text-blue-400">{estimates?.apr}%</p>
            </div>

            {/* Compound Boost */}
            <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-purple-500/10 to-pink-500/5 border border-purple-500/20">
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-purple-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-2">
                <Sparkles size={14} className="text-purple-400" />
                <span>Compound Boost</span>
              </div>
              <p className="text-xl font-bold text-purple-400">{estimates?.compoundBoost}</p>
            </div>

            {/* Status */}
            <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20">
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-green-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="flex items-center gap-2 text-gray-400 text-xs font-medium mb-2">
                <DollarSign size={14} className="text-green-400" />
                <span>Mode</span>
              </div>
              <p className={`text-xl font-bold ${isCompoundEnabled ? 'text-green-400' : 'text-gray-400'}`}>
                {isCompoundEnabled ? 'Auto' : 'Manual'}
              </p>
            </div>
          </div>

          {/* Info Note */}
          <div className="flex items-start gap-3 text-xs text-gray-500 bg-gray-900/30 rounded-xl p-4 border border-gray-800/30">
            <div className="w-6 h-6 rounded-lg bg-gray-800/50 flex items-center justify-center flex-shrink-0">
              <Info size={12} className="text-gray-400" />
            </div>
            <p className="leading-relaxed">
              Estimates are based on current fee accumulation rate. Actual returns may vary based on
              trading volume, price movements, and time in range.
            </p>
          </div>
        </div>
      )}

      {isCalculating && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="w-10 h-10 rounded-xl bg-gray-800/50 flex items-center justify-center mb-3 animate-pulse">
            <Calculator size={20} />
          </div>
          <p className="text-sm">Calculating estimates...</p>
        </div>
      )}

      {!estimates && !isCalculating && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="w-12 h-12 rounded-xl bg-gray-800/50 flex items-center justify-center mb-3">
            <BarChart3 size={24} />
          </div>
          <p className="text-sm font-medium text-gray-300 mb-1">No fee data yet</p>
          <p className="text-xs text-gray-500 text-center px-4">
            Fees will accumulate as trades occur in your position&apos;s range.
            {chainId === CHAIN_IDS.SEPOLIA && ' On Sepolia testnet, trading volume is low so fees may be minimal.'}
          </p>
        </div>
      )}
    </div>
  );
}
