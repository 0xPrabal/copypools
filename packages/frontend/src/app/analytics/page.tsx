'use client';

import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  BarChart3,
  Wallet,
  Activity,
  Zap,
  RefreshCw,
  Target,
  PieChart,
  ArrowUpRight,
  Loader2,
  Layers,
  Sparkles
} from 'lucide-react';
import { usePositions, Position } from '@/hooks/usePonderData';
import { useQueryClient } from '@tanstack/react-query';

interface PositionWithAutomation extends Position {
  hasCompound: boolean;
  hasRange: boolean;
}

export default function AnalyticsPage() {
  const { isConnected } = useAccount();
  const queryClient = useQueryClient();
  const { data: positions, isLoading, refetch: refetchPositions } = usePositions();
  const [activeTab, setActiveTab] = useState<'protocol' | 'portfolio'>('portfolio');

  // Map positions to include hasCompound and hasRange from already-fetched data
  const positionsWithAutomation: PositionWithAutomation[] | undefined = useMemo(() => {
    if (!positions) return undefined;
    return positions.map(position => ({
      ...position,
      hasCompound: position.compoundConfig?.enabled || false,
      hasRange: position.rangeConfig?.enabled || false,
    }));
  }, [positions]);

  const handleRefresh = () => {
    refetchPositions();
    queryClient.invalidateQueries({ queryKey: ['positionsWithAutomation'] });
  };

  // Calculate portfolio analytics from positions
  const portfolioAnalytics = useMemo(() => {
    if (!positionsWithAutomation || positionsWithAutomation.length === 0) {
      return {
        totalPositions: 0,
        activePositions: 0,
        inRangeCount: 0,
        outOfRangeCount: 0,
        compoundEnabledCount: 0,
        rangeEnabledCount: 0,
      };
    }

    const activePositions = positionsWithAutomation.filter(p => BigInt(p.liquidity || '0') > 0n);
    const inRange = positionsWithAutomation.filter(p => p.inRange);
    const outOfRange = positionsWithAutomation.filter(p => !p.inRange);
    const compoundEnabled = positionsWithAutomation.filter(p => p.hasCompound);
    const rangeEnabled = positionsWithAutomation.filter(p => p.hasRange);

    return {
      totalPositions: positionsWithAutomation.length,
      activePositions: activePositions.length,
      inRangeCount: inRange.length,
      outOfRangeCount: outOfRange.length,
      compoundEnabledCount: compoundEnabled.length,
      rangeEnabledCount: rangeEnabled.length,
    };
  }, [positionsWithAutomation]);

  // Group positions by pool pair
  const poolBreakdown = useMemo(() => {
    if (!positionsWithAutomation || positionsWithAutomation.length === 0) return [];

    const pools: Record<string, { name: string; count: number }> = {};

    positionsWithAutomation.forEach(p => {
      const poolName = `${p.pool.token0.symbol}/${p.pool.token1.symbol}`;
      if (!pools[poolName]) {
        pools[poolName] = { name: poolName, count: 0 };
      }
      pools[poolName].count++;
    });

    return Object.values(pools).sort((a, b) => b.count - a.count);
  }, [positionsWithAutomation]);

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Analytics
          </h1>
          <p className="text-gray-400">
            Detailed analytics and performance metrics
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tab Selector */}
      <div className="flex gap-1 p-1 rounded-xl bg-gray-900/50 border border-gray-800/50 w-fit">
        <button
          onClick={() => setActiveTab('protocol')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'protocol'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-white border border-cyan-500/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
          }`}
        >
          <Layers size={16} />
          Protocol
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === 'portfolio'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-white border border-cyan-500/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
          }`}
        >
          <Wallet size={16} />
          My Portfolio
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="card-gradient flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-cyan-400" size={40} />
            <p className="text-gray-400">Loading analytics from blockchain...</p>
          </div>
        </div>
      )}

      {/* Protocol Analytics */}
      {!isLoading && activeTab === 'protocol' && (
        <div className="space-y-6">
          {/* Info Banner */}
          <div className="card-gradient border-cyan-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <Sparkles className="text-cyan-400" size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Protocol Analytics</h3>
                <p className="text-sm text-gray-400">
                  Live data from blockchain (your positions)
                </p>
              </div>
            </div>
          </div>

          {/* Main Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Positions */}
            <div className="stat-card group">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                  <Layers className="text-indigo-400" size={20} />
                </div>
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <ArrowUpRight size={12} />
                  Live
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Total Positions</p>
              <p className="text-2xl font-bold text-white">
                {portfolioAnalytics.totalPositions}
              </p>
            </div>

            {/* In Range Positions */}
            <div className="stat-card group">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                  <Activity className="text-green-400" size={20} />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">In Range</p>
              <p className="text-2xl font-bold text-green-400">
                {portfolioAnalytics.inRangeCount}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {portfolioAnalytics.outOfRangeCount} out of range
              </p>
            </div>

            {/* Compound Configs */}
            <div className="stat-card group">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <Zap className="text-purple-400" size={20} />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Auto-Compound</p>
              <p className="text-2xl font-bold text-purple-400">
                {portfolioAnalytics.compoundEnabledCount}
              </p>
            </div>

            {/* Range Configs */}
            <div className="stat-card group">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                  <Target className="text-cyan-400" size={20} />
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Auto-Range</p>
              <p className="text-2xl font-bold text-cyan-400">
                {portfolioAnalytics.rangeEnabledCount}
              </p>
            </div>
          </div>

          {/* Automation Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Compound Stats */}
            <div className="card-gradient">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <Zap className="text-purple-400" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Auto-Compound</h3>
                  <p className="text-xs text-gray-400">Fee reinvestment automation</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-900/50 border border-gray-800/50">
                  <span className="text-gray-400">Positions Enabled</span>
                  <span className="text-xl font-bold text-purple-400">{portfolioAnalytics.compoundEnabledCount}</span>
                </div>
              </div>
            </div>

            {/* Rebalance Stats */}
            <div className="card-gradient">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                  <Target className="text-cyan-400" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Auto-Range</h3>
                  <p className="text-xs text-gray-400">Position rebalancing automation</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-900/50 border border-gray-800/50">
                  <span className="text-gray-400">Positions Enabled</span>
                  <span className="text-xl font-bold text-cyan-400">{portfolioAnalytics.rangeEnabledCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pool Breakdown */}
          {poolBreakdown.length > 0 && (
            <div className="card-gradient">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center">
                  <PieChart className="text-orange-400" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Positions by Pool</h3>
                  <p className="text-xs text-gray-400">Distribution across liquidity pools</p>
                </div>
              </div>

              <div className="space-y-3">
                {poolBreakdown.map((pool) => (
                  <div key={pool.name} className="flex items-center justify-between p-4 rounded-xl bg-gray-900/50 border border-gray-800/50">
                    <span className="font-medium text-white">{pool.name}</span>
                    <span className="text-lg font-bold text-orange-400">{pool.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Portfolio Analytics */}
      {!isLoading && activeTab === 'portfolio' && (
        <div className="space-y-6">
          {!isConnected ? (
            <div className="card-gradient flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mb-4">
                <Wallet className="text-cyan-400" size={32} />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Connect Your Wallet</h3>
              <p className="text-gray-400 text-center max-w-md">
                Connect your wallet to view your portfolio analytics and position performance
              </p>
            </div>
          ) : (
            <>
              {/* Portfolio Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total Positions */}
                <div className="stat-card">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                      <Layers className="text-indigo-400" size={20} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Total Positions</p>
                  <p className="text-2xl font-bold text-white">
                    {portfolioAnalytics.totalPositions}
                  </p>
                  <p className="text-xs text-green-400 mt-1">
                    {portfolioAnalytics.activePositions} active
                  </p>
                </div>

                {/* In Range */}
                <div className="stat-card">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                      <Target className="text-green-400" size={20} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Active</p>
                  <p className="text-2xl font-bold text-green-400">
                    {portfolioAnalytics.activePositions}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    earning fees
                  </p>
                </div>

                {/* Compound Enabled */}
                <div className="stat-card">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                      <Zap className="text-purple-400" size={20} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Compounding</p>
                  <p className="text-2xl font-bold text-purple-400">
                    {portfolioAnalytics.compoundEnabledCount}
                  </p>
                </div>

                {/* Range Enabled */}
                <div className="stat-card">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                      <Target className="text-cyan-400" size={20} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Auto-Range</p>
                  <p className="text-2xl font-bold text-cyan-400">
                    {portfolioAnalytics.rangeEnabledCount}
                  </p>
                </div>
              </div>

              {/* Position Breakdown */}
              <div className="card-gradient">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center">
                    <PieChart className="text-orange-400" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Position Breakdown</h3>
                    <p className="text-xs text-gray-400">Overview of your positions status</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-green-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      Active
                    </div>
                    <p className="text-2xl font-bold text-green-400">
                      {portfolioAnalytics.activePositions}
                    </p>
                  </div>

                  <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-gray-500/10 to-gray-600/5 border border-gray-500/20">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-gray-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                      Closed
                    </div>
                    <p className="text-2xl font-bold text-gray-400">
                      {portfolioAnalytics.totalPositions - portfolioAnalytics.activePositions}
                    </p>
                  </div>

                  <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-purple-500/10 to-pink-500/5 border border-purple-500/20">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-purple-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <Zap size={12} className="text-purple-400" />
                      Compounding
                    </div>
                    <p className="text-2xl font-bold text-purple-400">
                      {portfolioAnalytics.compoundEnabledCount}
                    </p>
                  </div>

                  <div className="relative overflow-hidden rounded-xl p-4 bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-cyan-500/20">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-cyan-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <Target size={12} className="text-cyan-400" />
                      Auto-Range
                    </div>
                    <p className="text-2xl font-bold text-cyan-400">
                      {portfolioAnalytics.rangeEnabledCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Positions List */}
              {positionsWithAutomation && positionsWithAutomation.length > 0 && (
                <div className="card-gradient">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center">
                      <BarChart3 className="text-blue-400" size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Your Positions</h3>
                      <p className="text-xs text-gray-400">Live data from blockchain</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {positionsWithAutomation.map((pos) => (
                      <div key={pos.id} className="flex items-center justify-between p-4 rounded-xl bg-gray-900/50 border border-gray-800/50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                            <span className="text-xs font-bold text-indigo-400">#{pos.tokenId}</span>
                          </div>
                          <div>
                            <span className="font-medium text-white">{pos.pool.token0.symbol}/{pos.pool.token1.symbol}</span>
                            <p className="text-xs text-gray-500">
                              Range: {pos.tickLower} to {pos.tickUpper}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pos.hasCompound && (
                            <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-400 text-xs">
                              <Zap size={10} className="inline mr-1" />
                              Compound
                            </span>
                          )}
                          {pos.hasRange && (
                            <span className="px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-400 text-xs">
                              <Target size={10} className="inline mr-1" />
                              Range
                            </span>
                          )}
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            pos.inRange
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {pos.inRange ? 'In Range' : 'Out of Range'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {portfolioAnalytics.totalPositions === 0 && (
                <div className="card-gradient flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-700/50 to-gray-800/50 flex items-center justify-center mb-4">
                    <Layers className="text-gray-400" size={32} />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">No Positions Yet</h3>
                  <p className="text-gray-400 text-center max-w-md mb-4">
                    Create your first position to start seeing analytics
                  </p>
                  <a href="/initiator" className="btn-primary">
                    Create Position
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
