'use client';

import { useAccount, useChainId } from 'wagmi';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Loader2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Activity,
  Target,
  Zap,
  Clock,
  TrendingDown,
  Minus,
  RefreshCw,
} from 'lucide-react';
import { usePositions } from '@/hooks/usePonderData';
import { useV4AutoRange } from '@/hooks/useV4AutoRange';
import { useNFTApproval } from '@/hooks/useNFTApproval';
import { getContracts } from '@/config/contracts';
import { backendApi, SmartAnalysis, BatchSmartAnalysis } from '@/lib/backend';

// Action badge colors
const actionColors = {
  hold: 'bg-green-500/20 text-green-400 border-green-500/30',
  monitor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  rebalance_soon: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  rebalance_now: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const actionLabels = {
  hold: 'Hold',
  monitor: 'Monitor',
  rebalance_soon: 'Rebalance Soon',
  rebalance_now: 'Rebalance Now',
};

// Center drift indicator component
function CenterDriftIndicator({ drift, inRange }: { drift: number; inRange: boolean }) {
  // drift: 0-100 (0 = center, 100 = edge)
  const getColor = () => {
    if (!inRange) return 'bg-red-500';
    if (drift < 45) return 'bg-green-500';
    if (drift < 65) return 'bg-yellow-500';
    if (drift < 85) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getColor()} transition-all duration-300`}
          style={{ width: `${Math.min(100, drift)}%` }}
        />
      </div>
      <span className="text-xs text-gray-400">{drift}%</span>
    </div>
  );
}

// Token composition bar
function TokenCompositionBar({
  token0Percent,
  token1Percent,
  token0Symbol,
  token1Symbol,
}: {
  token0Percent: number;
  token1Percent: number;
  token0Symbol: string;
  token1Symbol: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{token0Symbol}: {token0Percent}%</span>
        <span>{token1Symbol}: {token1Percent}%</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden">
        <div
          className="bg-blue-500 transition-all duration-300"
          style={{ width: `${token0Percent}%` }}
        />
        <div
          className="bg-purple-500 transition-all duration-300"
          style={{ width: `${token1Percent}%` }}
        />
      </div>
    </div>
  );
}

// Price momentum indicator
function MomentumIndicator({ direction }: { direction: 'rising' | 'falling' | 'stable' }) {
  if (direction === 'rising') {
    return (
      <div className="flex items-center gap-1 text-green-400 text-xs">
        <TrendingUp size={12} />
        <span>Rising</span>
      </div>
    );
  }
  if (direction === 'falling') {
    return (
      <div className="flex items-center gap-1 text-red-400 text-xs">
        <TrendingDown size={12} />
        <span>Falling</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-gray-400 text-xs">
      <Minus size={12} />
      <span>Stable</span>
    </div>
  );
}

// Smart analysis card for a position
function SmartAnalysisCard({
  position,
  analysis,
  onRebalance,
  onDisable,
  isNFTApproved,
  isPending,
}: {
  position: any;
  analysis: BatchSmartAnalysis['positions'][0] | null;
  onRebalance: (tokenId: string) => void;
  onDisable: (tokenId: string) => void;
  isNFTApproved: boolean;
  isPending: boolean;
}) {
  const [detailedAnalysis, setDetailedAnalysis] = useState<SmartAnalysis | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const loadDetails = async () => {
    if (detailedAnalysis) {
      setShowDetails(!showDetails);
      return;
    }
    setLoadingDetails(true);
    const data = await backendApi.getSmartAnalysis(position.tokenId);
    setDetailedAnalysis(data);
    setShowDetails(true);
    setLoadingDetails(false);
  };

  const action = analysis?.action || 'hold';
  const centerDrift = analysis?.centerDrift || 0;
  const shouldRebalance = analysis?.shouldRebalance || false;

  return (
    <div className="p-4 bg-gray-800/50 rounded-lg space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
              {position.pool.token0.symbol.slice(0, 2)}
            </div>
            <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
              {position.pool.token1.symbol.slice(0, 2)}
            </div>
          </div>
          <div>
            <p className="font-medium">{position.pool.token0.symbol}/{position.pool.token1.symbol}</p>
            <p className="text-sm text-gray-400">ID: #{position.tokenId}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs border ${actionColors[action]}`}>
            {actionLabels[action]}
          </span>
          {!analysis?.inRange && (
            <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 border border-red-500/30">
              Out of Range
            </span>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      {analysis && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">Center Drift</p>
            <CenterDriftIndicator drift={centerDrift} inRange={analysis.inRange} />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Token Composition</p>
            <TokenCompositionBar
              token0Percent={analysis.tokenComposition?.token0Percent || 50}
              token1Percent={analysis.tokenComposition?.token1Percent || 50}
              token0Symbol={position.pool.token0.symbol}
              token1Symbol={position.pool.token1.symbol}
            />
          </div>
        </div>
      )}

      {/* Reason */}
      {analysis?.reason && (
        <p className="text-sm text-gray-400">{analysis.reason}</p>
      )}

      {/* Detailed Analysis (expandable) */}
      {showDetails && detailedAnalysis && (
        <div className="mt-4 p-3 bg-gray-900/50 rounded-lg space-y-3">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Current Tick</p>
              <p className="font-mono">{detailedAnalysis.analysis.currentTick}</p>
            </div>
            <div>
              <p className="text-gray-400">Range</p>
              <p className="font-mono">[{detailedAnalysis.analysis.tickLower}, {detailedAnalysis.analysis.tickUpper}]</p>
            </div>
            <div>
              <p className="text-gray-400">Center</p>
              <p className="font-mono">{detailedAnalysis.analysis.rangeCenter}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Volatility</p>
              <p>{detailedAnalysis.volatility.tickVolatility.toFixed(2)} ticks</p>
            </div>
            <div>
              <p className="text-gray-400">Momentum</p>
              <MomentumIndicator direction={detailedAnalysis.volatility.priceDirection} />
            </div>
            <div>
              <p className="text-gray-400">Cooldown</p>
              <p className={detailedAnalysis.cooldownRemaining > 0 ? 'text-yellow-400' : 'text-green-400'}>
                {detailedAnalysis.cooldownRemaining > 0
                  ? `${Math.floor(detailedAnalysis.cooldownRemaining / 60)}m remaining`
                  : 'Ready'}
              </p>
            </div>
          </div>

          {detailedAnalysis.decision && (
            <div className="pt-2 border-t border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {detailedAnalysis.decision.shouldRebalance ? '🔄 Recommended: Rebalance' : '✓ Recommended: Hold'}
                  </p>
                  <p className="text-xs text-gray-400">{detailedAnalysis.decision.reason}</p>
                </div>
                {detailedAnalysis.decision.estimatedSavingsBps > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Est. IL Savings</p>
                    <p className="text-green-400 font-medium">{detailedAnalysis.decision.estimatedSavingsBps} bps</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={loadDetails}
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1"
        >
          {loadingDetails ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Activity size={14} />
          )}
          {showDetails ? 'Hide Details' : 'View Details'}
        </button>

        <div className="flex items-center gap-2">
          {shouldRebalance && (
            <button
              onClick={() => onRebalance(position.tokenId)}
              disabled={isPending || !isNFTApproved}
              className="btn-primary text-sm px-3 py-1 bg-yellow-500 hover:bg-yellow-600 flex items-center gap-1"
            >
              <Zap size={14} />
              {!isNFTApproved ? 'Approve First' : 'Rebalance Now'}
            </button>
          )}
          <button
            onClick={() => onDisable(position.tokenId)}
            disabled={isPending || !isNFTApproved}
            className="btn-secondary text-sm px-3 py-1"
          >
            Disable
          </button>
          <Link href={`/positions/${position.tokenId}`} className="p-2 text-gray-400 hover:text-white">
            <ExternalLink size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RangeContent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { data: positions, isLoading } = usePositions();

  const [batchAnalysis, setBatchAnalysis] = useState<BatchSmartAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const {
    configureRange,
    removeRange,
    executeRebalance,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useV4AutoRange();

  const {
    approveAll: approveNFT,
    isApprovedForAll: isNFTApproved,
    isPending: nftApprovalPending,
    isConfirming: nftApprovalConfirming,
    refetch: refetchNFTApproval,
  } = useNFTApproval(CONTRACTS.V4_AUTO_RANGE);

  const isAnyPending = isPending || nftApprovalPending;
  const isAnyConfirming = isConfirming || nftApprovalConfirming;

  // Filter positions
  const rangeEnabled = positions?.filter(p => p.rangeConfig?.enabled) || [];
  const rangeDisabled = positions?.filter(p => !p.rangeConfig?.enabled) || [];

  // Load batch analysis for enabled positions
  useEffect(() => {
    const loadAnalysis = async () => {
      if (rangeEnabled.length === 0) return;

      setAnalysisLoading(true);
      const tokenIds = rangeEnabled.map(p => p.tokenId);
      const analysis = await backendApi.getBatchSmartAnalysis(tokenIds);
      setBatchAnalysis(analysis);
      setAnalysisLoading(false);
    };

    loadAnalysis();
  }, [rangeEnabled.length]);

  const refreshAnalysis = async () => {
    if (rangeEnabled.length === 0) return;
    setAnalysisLoading(true);
    const tokenIds = rangeEnabled.map(p => p.tokenId);
    const analysis = await backendApi.getBatchSmartAnalysis(tokenIds);
    setBatchAnalysis(analysis);
    setAnalysisLoading(false);
  };

  const getAnalysisForPosition = (tokenId: string) => {
    return batchAnalysis?.positions.find(p => p.tokenId === tokenId) || null;
  };

  const handleEnableAutoRange = async (tokenId: string) => {
    await configureRange({
      tokenId: BigInt(tokenId),
      config: {
        enabled: true,
        lowerDelta: 600,
        upperDelta: 600,
        rebalanceThreshold: 100,
        minRebalanceInterval: 3600,
        collectFeesOnRebalance: true,
        maxSwapSlippage: BigInt(100),
      },
    });
  };

  const handleExecuteRebalance = async (tokenId: string) => {
    await executeRebalance(BigInt(tokenId));
  };

  const handleDisableAutoRange = async (tokenId: string) => {
    await removeRange(BigInt(tokenId));
  };

  // Summary stats
  const needsRebalanceCount = batchAnalysis?.positions.filter(p => p.shouldRebalance).length || 0;
  const outOfRangeCount = batchAnalysis?.positions.filter(p => !p.inRange).length || 0;
  const avgCenterDrift = batchAnalysis?.positions.length
    ? Math.round(batchAnalysis.positions.reduce((sum, p) => sum + (p.centerDrift || 0), 0) / batchAnalysis.positions.length)
    : 0;

  if (!address) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Smart Auto-Range</h1>
          <p className="text-gray-400">
            Proactive rebalancing with center-drift detection and momentum awareness
          </p>
        </div>
        <div className="card text-center py-12">
          <TrendingUp className="mx-auto mb-4 text-gray-600" size={48} />
          <p className="text-gray-400">Connect your wallet to manage auto-range settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Smart Auto-Range</h1>
          <p className="text-gray-400">
            Proactive rebalancing with center-drift detection and momentum awareness
          </p>
        </div>
        <button
          onClick={refreshAnalysis}
          disabled={analysisLoading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} className={analysisLoading ? 'animate-spin' : ''} />
          Refresh Analysis
        </button>
      </div>

      {/* Summary Stats */}
      {rangeEnabled.length > 0 && batchAnalysis && (
        <div className="grid grid-cols-4 gap-4">
          <div className="card bg-gray-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Target size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{rangeEnabled.length}</p>
                <p className="text-sm text-gray-400">Monitored</p>
              </div>
            </div>
          </div>
          <div className="card bg-gray-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Activity size={20} className="text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{avgCenterDrift}%</p>
                <p className="text-sm text-gray-400">Avg Drift</p>
              </div>
            </div>
          </div>
          <div className="card bg-gray-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Zap size={20} className="text-yellow-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{needsRebalanceCount}</p>
                <p className="text-sm text-gray-400">Need Rebalance</p>
              </div>
            </div>
          </div>
          <div className="card bg-gray-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <AlertCircle size={20} className="text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{outOfRangeCount}</p>
                <p className="text-sm text-gray-400">Out of Range</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NFT Approval Banner */}
      {!isNFTApproved && (
        <div className="card bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-yellow-400" size={24} />
              <div>
                <p className="font-semibold text-yellow-400">NFT Approval Required</p>
                <p className="text-sm text-gray-400">
                  V4AutoRange needs permission to manage your positions. This is a one-time approval.
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                await approveNFT();
                refetchNFTApproval();
              }}
              disabled={isAnyPending || isAnyConfirming}
              className="btn-primary bg-yellow-500 hover:bg-yellow-600 whitespace-nowrap"
            >
              {nftApprovalPending || nftApprovalConfirming ? 'Approving...' : 'Approve V4AutoRange'}
            </button>
          </div>
        </div>
      )}

      {/* Transaction Status */}
      {(isAnyPending || isAnyConfirming || isSuccess || error) && (
        <div className={`p-4 rounded-lg ${
          error ? 'bg-red-500/10 border border-red-500/20' :
          isSuccess ? 'bg-green-500/10 border border-green-500/20' :
          'bg-blue-500/10 border border-blue-500/20'
        }`}>
          <div className="flex items-center gap-3">
            {isAnyPending && <Loader2 className="animate-spin text-blue-400" size={20} />}
            {isAnyConfirming && <Loader2 className="animate-spin text-blue-400" size={20} />}
            {isSuccess && <CheckCircle className="text-green-400" size={20} />}
            {error && <AlertCircle className="text-red-400" size={20} />}
            <span>
              {isAnyPending && 'Waiting for wallet confirmation...'}
              {isAnyConfirming && 'Transaction confirming...'}
              {isSuccess && 'Transaction successful!'}
              {error && `Error: ${error.message}`}
            </span>
          </div>
        </div>
      )}

      {/* Auto-Range Enabled Positions with Smart Analysis */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-blue-400" size={20} />
            <h2 className="text-lg font-semibold">Smart Monitored ({rangeEnabled.length})</h2>
          </div>
          {analysisLoading && <Loader2 size={16} className="animate-spin text-gray-400" />}
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="mx-auto animate-spin text-primary-500" size={32} />
          </div>
        ) : rangeEnabled.length > 0 ? (
          <div className="space-y-4">
            {rangeEnabled.map((position) => (
              <SmartAnalysisCard
                key={position.id}
                position={position}
                analysis={getAnalysisForPosition(position.tokenId)}
                onRebalance={handleExecuteRebalance}
                onDisable={handleDisableAutoRange}
                isNFTApproved={isNFTApproved}
                isPending={isAnyPending || isAnyConfirming}
              />
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-center py-4">No positions with auto-range enabled</p>
        )}
      </div>

      {/* Available Positions */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Available Positions ({rangeDisabled.length})</h2>

        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="mx-auto animate-spin text-primary-500" size={32} />
          </div>
        ) : rangeDisabled.length > 0 ? (
          <div className="space-y-3">
            {rangeDisabled.map((position) => (
              <div key={position.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
                      {position.pool.token0.symbol.slice(0, 2)}
                    </div>
                    <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
                      {position.pool.token1.symbol.slice(0, 2)}
                    </div>
                  </div>
                  <div>
                    <p className="font-medium">{position.pool.token0.symbol}/{position.pool.token1.symbol}</p>
                    <p className="text-sm text-gray-400">ID: #{position.tokenId}</p>
                  </div>
                  <span className={`badge-${position.inRange ? 'success' : 'warning'} text-xs`}>
                    {position.inRange ? 'In Range' : 'Out of Range'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEnableAutoRange(position.tokenId)}
                    disabled={isAnyPending || isAnyConfirming || !isNFTApproved}
                    className="btn-primary text-sm px-3 py-1"
                  >
                    {!isNFTApproved ? 'Approve First' : 'Enable Smart Auto-Range'}
                  </button>
                  <Link href={`/positions/${position.tokenId}`} className="p-2 text-gray-400 hover:text-white">
                    <ExternalLink size={16} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">No positions available</p>
            <Link href="/initiator" className="btn-primary">
              Create Your First Position
            </Link>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="card bg-blue-500/10 border border-blue-500/20">
        <h3 className="font-semibold text-blue-400 mb-2">Smart Rebalancing</h3>
        <div className="grid grid-cols-2 gap-4 text-sm text-gray-300">
          <div>
            <p className="font-medium mb-1">Center-Based Detection</p>
            <p className="text-gray-400">Rebalances when position drifts from center, not just at edges</p>
          </div>
          <div>
            <p className="font-medium mb-1">Momentum Awareness</p>
            <p className="text-gray-400">Avoids rebalancing into strong price trends</p>
          </div>
          <div>
            <p className="font-medium mb-1">Volatility Adjusted</p>
            <p className="text-gray-400">Higher volatility = more patient thresholds</p>
          </div>
          <div>
            <p className="font-medium mb-1">Optimal Timing</p>
            <p className="text-gray-400">Prefers rebalancing during price reversions</p>
          </div>
        </div>
      </div>
    </div>
  );
}
