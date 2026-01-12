'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Token {
  symbol: string;
  address: string;
  decimals: number;
}

interface SelectTokensProps {
  tokens: Token[];
  token0: string;
  token1: string;
  fee: number;
  onToken0Change: (address: string) => void;
  onToken1Change: (address: string) => void;
  onFeeChange: (fee: number) => void;
  onContinue: () => void;
  isValid: boolean;
}

const FEE_TIERS = [
  { value: 500, label: '0.05%', description: 'Best for stable or low-volatility pairs' },
  { value: 3000, label: '0.30%', description: 'Balanced option for most pairs' },
  { value: 10000, label: '1.00%', description: 'Higher fees, higher risk, lower volume' },
];

export function SelectTokens({
  tokens,
  token0,
  token1,
  fee,
  onToken0Change,
  onToken1Change,
  onFeeChange,
  onContinue,
  isValid,
}: SelectTokensProps) {
  const token0Data = tokens.find((t) => t.address.toLowerCase() === token0.toLowerCase());
  const token1Data = tokens.find((t) => t.address.toLowerCase() === token1.toLowerCase());

  return (
    <div className="px-6 lg:px-10 py-10">
      <h3 className="text-base font-bold text-brand-medium mb-2">Select Tokens</h3>
      <p className="text-text-secondary text-sm font-medium mb-8">
        Choose the token pair and fee tier for your liquidity position
      </p>

      {/* Token selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10 max-w-xl">
        <TokenSelect
          label="Token 1"
          value={token0}
          tokens={tokens}
          selectedToken={token0Data}
          onChange={onToken0Change}
          excludeToken={token1}
        />
        <TokenSelect
          label="Token 2"
          value={token1}
          tokens={tokens}
          selectedToken={token1Data}
          onChange={onToken1Change}
          excludeToken={token0}
        />
      </div>

      {/* Fee tier */}
      <h3 className="text-base font-bold text-brand-medium mb-2">Fee Tier</h3>
      <p className="text-text-secondary text-sm font-medium mb-6 max-w-xl">
        Select how much trading fee you earn when users swap through this pool
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mb-12 max-w-3xl">
        {FEE_TIERS.map((tier) => (
          <FeeOption
            key={tier.value}
            active={fee === tier.value}
            title={tier.label}
            description={tier.description}
            onClick={() => onFeeChange(tier.value)}
          />
        ))}
      </div>

      <button
        onClick={onContinue}
        disabled={!isValid}
        className="w-full max-w-3xl py-3 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}

interface TokenSelectProps {
  label: string;
  value: string;
  tokens: Token[];
  selectedToken?: Token;
  onChange: (address: string) => void;
  excludeToken?: string;
}

function TokenSelect({ label, value, tokens, selectedToken, onChange, excludeToken }: TokenSelectProps) {
  return (
    <div>
      <label className="block text-xs text-text-secondary font-medium mb-2">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-surface-page dark:bg-gray-800 flex items-center justify-between rounded-xl px-4 py-3 text-text-primary text-sm font-medium border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-brand-medium appearance-none cursor-pointer"
        >
          <option value="">Select token</option>
          {tokens
            .filter((t) => !excludeToken || t.address.toLowerCase() !== excludeToken.toLowerCase())
            .map((token) => (
              <option key={token.address} value={token.address}>
                {token.symbol}
              </option>
            ))}
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
      </div>
    </div>
  );
}

function FeeOption({
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
          : 'border border-[#CDEEEE] dark:border-gray-700 text-brand-medium hover:border-brand-medium'
      )}
    >
      <h3 className={cn('text-base font-bold mb-2', active ? 'text-white' : 'text-text-primary')}>{title}</h3>
      <p className={cn('text-sm', active ? 'text-white/90' : 'text-text-secondary')}>{description}</p>
    </div>
  );
}
