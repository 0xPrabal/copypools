'use client';

import { useState, useEffect } from 'react';
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Settings,
  Zap,
  Shield,
  Target,
  Rocket,
  Sliders,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { useV4AutoRange } from '@/hooks/useV4AutoRange';

// Preset strategies
const STRATEGIES = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Wide range, less rebalancing, lower fees',
    icon: Shield,
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'from-blue-500/20 to-cyan-500/20',
    borderColor: 'border-blue-500/30',
    lowerDelta: 1000,
    upperDelta: 1000,
    rebalanceThreshold: 200,
    minInterval: 14400,
    risk: 'Low',
    frequency: 'Rare',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Medium range, moderate rebalancing',
    icon: Target,
    color: 'from-purple-500 to-pink-500',
    bgColor: 'from-purple-500/20 to-pink-500/20',
    borderColor: 'border-purple-500/30',
    lowerDelta: 600,
    upperDelta: 600,
    rebalanceThreshold: 100,
    minInterval: 7200,
    risk: 'Medium',
    frequency: 'Moderate',
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Tight range, higher fees, frequent rebalancing',
    icon: Rocket,
    color: 'from-orange-500 to-red-500',
    bgColor: 'from-orange-500/20 to-red-500/20',
    borderColor: 'border-orange-500/30',
    lowerDelta: 300,
    upperDelta: 300,
    rebalanceThreshold: 50,
    minInterval: 3600,
    risk: 'High',
    frequency: 'Frequent',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Configure your own parameters',
    icon: Sliders,
    color: 'from-gray-400 to-gray-500',
    bgColor: 'from-gray-500/20 to-gray-600/20',
    borderColor: 'border-gray-500/30',
    lowerDelta: 600,
    upperDelta: 600,
    rebalanceThreshold: 100,
    minInterval: 3600,
    risk: 'Custom',
    frequency: 'Custom',
  },
];

interface RangeStrategyBuilderProps {
  tokenId: bigint;
  currentTick?: number;
  tickLower?: number;
  tickUpper?: number;
  tickSpacing?: number;
  isEnabled?: boolean;
  currentConfig?: {
    lowerDelta: number;
    upperDelta: number;
    rebalanceThreshold: number;
  };
  onSuccess?: () => void;
}

export function RangeStrategyBuilder({
  tokenId,
  currentTick,
  tickLower,
  tickUpper,
  tickSpacing = 60,
  isEnabled,
  currentConfig,
  onSuccess,
}: RangeStrategyBuilderProps) {
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGIES[1]);
  const [customConfig, setCustomConfig] = useState({
    lowerDelta: 600,
    upperDelta: 600,
    rebalanceThreshold: 100,
    minInterval: 3600,
    collectFees: true,
    maxSlippage: 100,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    configureRange,
    removeRange,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useV4AutoRange();

  useEffect(() => {
    if (selectedStrategy.id !== 'custom') {
      setCustomConfig((prev) => ({
        ...prev,
        lowerDelta: selectedStrategy.lowerDelta,
        upperDelta: selectedStrategy.upperDelta,
        rebalanceThreshold: selectedStrategy.rebalanceThreshold,
        minInterval: selectedStrategy.minInterval,
      }));
    }
  }, [selectedStrategy]);

  useEffect(() => {
    if (isSuccess && onSuccess) {
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const handleEnableStrategy = async () => {
    const config = selectedStrategy.id === 'custom' ? customConfig : selectedStrategy;

    await configureRange({
      tokenId,
      config: {
        enabled: true,
        lowerDelta: config.lowerDelta,
        upperDelta: config.upperDelta,
        rebalanceThreshold: config.rebalanceThreshold,
        minRebalanceInterval: customConfig.minInterval,
        collectFeesOnRebalance: customConfig.collectFees,
        maxSwapSlippage: BigInt(customConfig.maxSlippage),
      },
    });
  };

  const handleDisable = async () => {
    await removeRange(tokenId);
  };

  const lowerPercent = ((1.0001 ** -customConfig.lowerDelta) - 1) * 100;
  const upperPercent = ((1.0001 ** customConfig.upperDelta) - 1) * 100;

  const isProcessing = isPending || isConfirming;

  return (
    <div className="card-gradient animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
            <TrendingUp className="text-indigo-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Range Strategy</h3>
            <p className="text-xs text-gray-400">Configure automatic rebalancing</p>
          </div>
        </div>
        {isEnabled && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-green-400">Active</span>
          </div>
        )}
      </div>

      {/* Strategy Presets */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {STRATEGIES.map((strategy) => {
          const Icon = strategy.icon;
          const isSelected = selectedStrategy.id === strategy.id;

          return (
            <button
              key={strategy.id}
              onClick={() => setSelectedStrategy(strategy)}
              className={`relative overflow-hidden rounded-xl p-4 text-left transition-all duration-300 ${
                isSelected
                  ? `bg-gradient-to-br ${strategy.bgColor} ${strategy.borderColor} border`
                  : 'bg-gray-800/30 border border-gray-700/50 hover:border-gray-600/50'
              }`}
            >
              {isSelected && (
                <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${strategy.bgColor} rounded-full -translate-y-1/2 translate-x-1/2 opacity-50`} />
              )}
              <div className="relative">
                <div className={`w-10 h-10 rounded-xl mb-3 flex items-center justify-center ${
                  isSelected ? `bg-gradient-to-br ${strategy.bgColor}` : 'bg-gray-800/50'
                }`}>
                  <Icon className={isSelected ? `bg-gradient-to-r ${strategy.color} text-white` : 'text-gray-400'} size={20} />
                </div>
                <p className="font-semibold text-white mb-1">{strategy.name}</p>
                <p className="text-xs text-gray-400 line-clamp-2">{strategy.description}</p>

                {strategy.id !== 'custom' && (
                  <div className="flex items-center gap-2 mt-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      strategy.risk === 'Low' ? 'bg-blue-500/20 text-blue-400' :
                      strategy.risk === 'Medium' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-orange-500/20 text-orange-400'
                    }`}>
                      {strategy.risk} Risk
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Strategy Details Preview */}
      <div className="relative overflow-hidden rounded-xl bg-gray-900/50 border border-gray-800/50 p-5 mb-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 mb-2">
              <ChevronDown className="text-red-400" size={18} />
            </div>
            <p className="text-xs text-gray-400 mb-1">Lower Range</p>
            <p className="text-lg font-bold text-red-400">{lowerPercent.toFixed(1)}%</p>
            <p className="text-[10px] text-gray-500">{customConfig.lowerDelta} ticks</p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-yellow-500/10 mb-2">
              <Zap className="text-yellow-400" size={18} />
            </div>
            <p className="text-xs text-gray-400 mb-1">Rebalance At</p>
            <p className="text-lg font-bold text-yellow-400">{customConfig.rebalanceThreshold}</p>
            <p className="text-[10px] text-gray-500">ticks out of range</p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-green-500/10 mb-2">
              <ChevronUp className="text-green-400" size={18} />
            </div>
            <p className="text-xs text-gray-400 mb-1">Upper Range</p>
            <p className="text-lg font-bold text-green-400">+{upperPercent.toFixed(1)}%</p>
            <p className="text-[10px] text-gray-500">{customConfig.upperDelta} ticks</p>
          </div>
        </div>
      </div>

      {/* Custom Configuration */}
      {selectedStrategy.id === 'custom' && (
        <div className="space-y-4 mb-5 p-5 rounded-xl bg-gray-900/30 border border-gray-800/30">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={16} className="text-gray-400" />
            <h4 className="text-sm font-semibold text-white">Custom Configuration</h4>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Lower Delta (ticks)</label>
              <input
                type="number"
                value={customConfig.lowerDelta}
                onChange={(e) => setCustomConfig({ ...customConfig, lowerDelta: Number(e.target.value) })}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Upper Delta (ticks)</label>
              <input
                type="number"
                value={customConfig.upperDelta}
                onChange={(e) => setCustomConfig({ ...customConfig, upperDelta: Number(e.target.value) })}
                className="input text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Rebalance Threshold (ticks)</label>
            <input
              type="number"
              value={customConfig.rebalanceThreshold}
              onChange={(e) => setCustomConfig({ ...customConfig, rebalanceThreshold: Number(e.target.value) })}
              className="input text-sm"
            />
          </div>
        </div>
      )}

      {/* Advanced Options Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-900/30 border border-gray-800/30 mb-5 transition-colors hover:bg-gray-900/50"
      >
        <div className="flex items-center gap-2">
          <Sliders size={14} className="text-gray-400" />
          <span className="text-sm text-gray-400">Advanced Options</span>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      {showAdvanced && (
        <div className="space-y-4 mb-5 p-5 rounded-xl bg-gray-900/30 border border-gray-800/30 animate-fade-in-up">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Minimum Rebalance Interval</label>
            <select
              value={customConfig.minInterval}
              onChange={(e) => setCustomConfig({ ...customConfig, minInterval: Number(e.target.value) })}
              className="input text-sm"
            >
              <option value={3600}>1 hour</option>
              <option value={7200}>2 hours</option>
              <option value={14400}>4 hours</option>
              <option value={28800}>8 hours</option>
              <option value={86400}>24 hours</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Max Swap Slippage</label>
            <select
              value={customConfig.maxSlippage}
              onChange={(e) => setCustomConfig({ ...customConfig, maxSlippage: Number(e.target.value) })}
              className="input text-sm"
            >
              <option value={50}>0.5%</option>
              <option value={100}>1%</option>
              <option value={200}>2%</option>
              <option value={300}>3%</option>
            </select>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/30">
            <input
              type="checkbox"
              id="collectFees"
              checked={customConfig.collectFees}
              onChange={(e) => setCustomConfig({ ...customConfig, collectFees: e.target.checked })}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500/20"
            />
            <label htmlFor="collectFees" className="text-sm text-gray-300">
              Collect fees during rebalance
            </label>
          </div>
        </div>
      )}

      {/* Transaction Status */}
      {(isPending || isConfirming || isSuccess || error) && (
        <div className={`mb-5 p-4 rounded-xl animate-scale-in ${
          error ? 'bg-gradient-to-r from-red-500/10 to-red-600/5 border border-red-500/20' :
          isSuccess ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/5 border border-green-500/20' :
          'bg-gradient-to-r from-blue-500/10 to-cyan-500/5 border border-blue-500/20'
        }`}>
          <div className="flex items-center gap-3">
            {(isPending || isConfirming) && (
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-400" size={16} />
              </div>
            )}
            {isSuccess && (
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="text-green-400" size={16} />
              </div>
            )}
            {error && (
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="text-red-400" size={16} />
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-white">
                {isPending && 'Awaiting wallet confirmation...'}
                {isConfirming && 'Configuring strategy...'}
                {isSuccess && 'Strategy configured successfully!'}
                {error && 'Configuration failed'}
              </p>
              {error && <p className="text-xs text-red-400 mt-0.5">{error.message}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        {!isEnabled ? (
          <button
            onClick={handleEnableStrategy}
            disabled={isProcessing}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Processing...
              </>
            ) : (
              <>
                <Zap size={16} />
                Enable {selectedStrategy.name} Strategy
              </>
            )}
          </button>
        ) : (
          <>
            <button
              onClick={handleEnableStrategy}
              disabled={isProcessing}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Processing...
                </>
              ) : (
                <>
                  <Settings size={16} />
                  Update Strategy
                </>
              )}
            </button>
            <button
              onClick={handleDisable}
              disabled={isProcessing}
              className="btn-secondary w-full"
            >
              Disable Auto-Range
            </button>
          </>
        )}
      </div>

      {/* Info Note */}
      <div className="flex items-start gap-3 text-xs text-gray-500 mt-5 pt-5 border-t border-gray-800/30">
        <div className="w-6 h-6 rounded-lg bg-gray-800/50 flex items-center justify-center flex-shrink-0">
          <Info size={12} className="text-gray-400" />
        </div>
        <p className="leading-relaxed">
          Auto-range will automatically rebalance your position when it moves out of the configured range, optimizing fee capture.
        </p>
      </div>
    </div>
  );
}
