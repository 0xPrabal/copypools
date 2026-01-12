'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TokenData {
  symbol: string;
  address: string;
  decimals: number;
}

interface PositionSummaryCardProps {
  currentStep: number;
  token0Data?: TokenData;
  token1Data?: TokenData;
  fee: number;
  rangeStrategy?: string;
  minPrice?: string;
  maxPrice?: string;
  currentPrice?: string;
  isInRange?: boolean;
}

export function PositionSummaryCard({
  currentStep,
  token0Data,
  token1Data,
  fee,
  rangeStrategy,
  minPrice,
  maxPrice,
  currentPrice,
  isInRange = true,
}: PositionSummaryCardProps) {
  const feePercent = (fee / 10000).toFixed(2);
  const feeDescription =
    fee === 500
      ? 'Best for stable or low-volatility pairs'
      : fee === 3000
      ? 'Balanced option for most pairs'
      : 'Higher fees, higher risk, lower volume';

  return (
    <section className="w-full max-w-md border border-[#6EE7DF] dark:border-brand-medium/50 rounded-[28px] p-8 text-text-secondary">
      {/* Selected Tokens */}
      <h3 className="text-sm font-bold text-brand-medium mb-4">Selected Tokens</h3>

      <div className="flex items-center gap-6 mb-8">
        <TokenItem label={token0Data?.symbol || 'Token 1'} />
        <TokenItem label={token1Data?.symbol || 'Token 2'} />
      </div>

      {/* Fee Tier */}
      <h3 className="text-sm font-bold text-brand-medium mb-2">Fee Tier</h3>
      <p className="text-text-muted text-[13px] font-medium mb-6">
        {feePercent}% - {feeDescription}
      </p>

      {currentStep >= 2 && rangeStrategy && (
        <>
          <div className="h-px bg-[#C5ECEB] dark:bg-gray-700 my-6" />

          {/* Range details */}
          <div className="space-y-3 text-sm">
            <DetailRow label="Range Strategy" value={rangeStrategy} />
            {minPrice && <DetailRow label="Min Price" value={minPrice} />}
            {maxPrice && <DetailRow label="Max Price" value={maxPrice} />}
            {currentPrice && <DetailRow label="Current Price" value={currentPrice} />}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[13px] text-text-primary">Status:</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[13px] font-medium',
                isInRange ? 'text-status-success' : 'text-status-warning'
              )}
            >
              <Check className="h-4 w-4" />
              {isInRange ? 'In Range' : 'Out of Range'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function TokenItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-text-primary">
        {label.charAt(0)}
      </span>
      <span className="text-text-primary text-sm font-semibold">{label}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[13px] font-medium flex items-center gap-2">
      <span className="text-text-primary">{label}:</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}
