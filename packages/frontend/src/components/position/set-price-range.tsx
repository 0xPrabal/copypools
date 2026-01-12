'use client';

import { Info, Check, AlertTriangle } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

type RangeStrategy = 'full' | 'wide' | 'concentrated' | 'custom';

interface SetPriceRangeProps {
  strategy: RangeStrategy;
  onStrategyChange: (strategy: RangeStrategy) => void;
  minPrice: number;
  maxPrice: number;
  currentPrice: number;
  absoluteMin: number;
  absoluteMax: number;
  onRangeChange: (min: number, max: number) => void;
  onBack: () => void;
  onContinue: () => void;
  isInRange: boolean;
  token0Symbol?: string;
  token1Symbol?: string;
}

export function SetPriceRange({
  strategy,
  onStrategyChange,
  minPrice,
  maxPrice,
  currentPrice,
  absoluteMin,
  absoluteMax,
  onRangeChange,
  onBack,
  onContinue,
  isInRange,
  token0Symbol = 'Token0',
  token1Symbol = 'Token1',
}: SetPriceRangeProps) {
  const formatPrice = (price: number) => {
    if (price >= 1000000) return `$${(price / 1000000).toFixed(2)}M`;
    if (price >= 1000) return `$${price.toLocaleString()}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(6)}`;
  };

  const handleSliderChange = (values: number[]) => {
    onRangeChange(values[0], values[1]);
    onStrategyChange('custom');
  };

  return (
    <section className="w-full p-6 lg:p-12">
      {/* Header */}
      <div className="mb-10">
        <h2 className="text-base font-bold text-brand-medium mb-2">Set Price Range</h2>
        <p className="text-text-secondary text-sm font-medium">
          Choose a range strategy for your liquidity position
        </p>
      </div>

      {/* Price scale */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-sm text-text-primary">Min price</div>
            <div className="text-brand-medium font-semibold">{formatPrice(minPrice)}</div>
          </div>

          <span className="text-xs font-medium text-[#2C6E68] dark:text-brand-soft bg-[#C5ECEB] dark:bg-brand-medium/20 rounded-xl px-2 py-1 text-center">
            <span className="block">Current price</span>
            <span className="block">{formatPrice(currentPrice)}</span>
          </span>

          <div className="text-right">
            <div className="text-sm text-text-primary">Max price</div>
            <div className="text-brand-medium font-semibold">{formatPrice(maxPrice)}</div>
          </div>
        </div>

        {/* Interactive Slider */}
        <div className="relative py-2">
          <Slider
            min={absoluteMin}
            max={absoluteMax}
            step={Math.max(1, Math.floor((absoluteMax - absoluteMin) / 1000))}
            value={[minPrice, maxPrice]}
            onValueChange={handleSliderChange}
            className="w-full"
          />
        </div>

        {/* Labels */}
        <div className="flex justify-between text-sm text-text-muted mt-3">
          <span>{formatPrice(absoluteMin)}</span>
          <span>{formatPrice(absoluteMax)}</span>
        </div>
      </div>

      {/* Status - dynamic */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gray-100 dark:bg-gray-800/50 px-6 py-4 mb-6">
        <div className="flex items-center gap-4">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full text-sm font-medium',
              isInRange ? 'text-status-success' : 'text-status-warning'
            )}
          >
            {isInRange ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {isInRange ? 'In Range' : 'Out of Range'}
          </span>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span
              className={cn('h-2.5 w-2.5 rounded-full', isInRange ? 'bg-status-success' : 'bg-status-warning')}
            />
            {isInRange ? 'Earning fees' : 'Not earning fees'}
          </div>
        </div>
        <div className="text-sm text-text-secondary">
          Your range:{' '}
          <span className="font-semibold">
            {formatPrice(minPrice)} – {formatPrice(maxPrice)}
          </span>
        </div>
      </div>

      <p className="text-sm text-text-muted mb-10">
        Fees are earned while the market price stays between your Min and Max
      </p>

      {/* How it works */}
      <div className="flex gap-4 rounded-2xl bg-gray-100 dark:bg-gray-800/50 p-6 mb-12">
        <Info className="h-5 w-5 text-brand-medium flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-bold text-base text-text-primary mb-1">How it works</div>
          <p className="text-[13px] text-text-secondary font-medium">
            While the market price is between your Min and Max, your liquidity is active and earning fees.
            Price moves outside? Earned fees pause.
          </p>
        </div>
      </div>

      {/* Range strategy */}
      <div className="mb-12">
        <h3 className="text-base font-bold text-brand-medium mb-2">Range Strategy</h3>
        <p className="text-text-secondary text-sm font-medium mb-6">
          Pick a ready-made range based on your risk level
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
          <StrategyCard
            active={strategy === 'full'}
            title="Full range"
            description="Liquidity at all prices. Lowest fees, lowest risks"
            onClick={() => onStrategyChange('full')}
          />
          <StrategyCard
            active={strategy === 'wide'}
            title="Wide range"
            description="50% around current price. Balanced approach"
            onClick={() => onStrategyChange('wide')}
          />
          <StrategyCard
            active={strategy === 'concentrated'}
            title="Concentrated"
            description="10% around current price. Higher fees, higher risk"
            onClick={() => onStrategyChange('concentrated')}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 border-2 border-brand-medium text-brand-medium hover:bg-brand-medium/10 rounded-xl font-medium transition-colors"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="flex-1 py-3 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white"
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function StrategyCard({
  title,
  description,
  active = false,
  onClick,
}: {
  title: string;
  description: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl p-6 cursor-pointer transition-all',
        active
          ? 'bg-gradient-hard text-white'
          : 'border border-[#CDEEEE] dark:border-gray-700 text-text-primary hover:border-brand-medium'
      )}
    >
      <div className="text-lg font-semibold mb-2">{title}</div>
      <p className={cn('text-sm', active ? 'text-white/90' : 'text-text-muted')}>{description}</p>
    </div>
  );
}
