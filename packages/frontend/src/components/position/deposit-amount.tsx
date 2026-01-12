'use client';

import { Loader2, Zap, AlertCircle, Info } from 'lucide-react';
import { formatUnits } from 'viem';
import { cn } from '@/lib/utils';

interface TokenData {
  symbol: string;
  address: string;
  decimals: number;
  isNative?: boolean;
}

interface DepositAmountProps {
  token0Data?: TokenData;
  token1Data?: TokenData;
  balance0?: bigint;
  balance1?: bigint;
  amount0: string;
  amount1: string;
  onAmount0Change: (value: string) => void;
  onAmount1Change: (value: string) => void;
  depositMode: 'single' | 'both';
  onDepositModeChange: (mode: 'single' | 'both') => void;
  singleTokenAddress: string;
  onSingleTokenChange: (address: string) => void;
  singleTokenAmount: string;
  onSingleTokenAmountChange: (value: string) => void;
  token0Price: number | null;
  token1Price: number | null;
  // Approval state
  isToken0Approved: boolean;
  isToken1Approved: boolean;
  isPendingApproval: boolean;
  onApproveToken0: () => void;
  onApproveToken1: () => void;
  // Transaction state
  isPending: boolean;
  isConfirming: boolean;
  onMint: () => void;
  onBack: () => void;
  // Zap state
  zapQuote: any;
  zapQuoteLoading: boolean;
  onZap: () => void;
  zapIsPending: boolean;
  zapIsConfirming: boolean;
  // Validation
  insufficientBalance0: boolean;
  insufficientBalance1: boolean;
  poolPriceValid: boolean;
}

export function DepositAmount({
  token0Data,
  token1Data,
  balance0,
  balance1,
  amount0,
  amount1,
  onAmount0Change,
  onAmount1Change,
  depositMode,
  onDepositModeChange,
  singleTokenAddress,
  onSingleTokenChange,
  singleTokenAmount,
  onSingleTokenAmountChange,
  token0Price,
  token1Price,
  isToken0Approved,
  isToken1Approved,
  isPendingApproval,
  onApproveToken0,
  onApproveToken1,
  isPending,
  isConfirming,
  onMint,
  onBack,
  zapQuote,
  zapQuoteLoading,
  onZap,
  zapIsPending,
  zapIsConfirming,
  insufficientBalance0,
  insufficientBalance1,
  poolPriceValid,
}: DepositAmountProps) {
  const formatBalance = (balance: bigint | undefined, decimals: number) => {
    if (!balance) return '0';
    return parseFloat(formatUnits(balance, decimals)).toFixed(4);
  };

  const singleTokenData =
    singleTokenAddress === token0Data?.address ? token0Data : token1Data;
  const singleTokenBalance =
    singleTokenAddress === token0Data?.address ? balance0 : balance1;

  return (
    <section className="w-full p-6 lg:p-12">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-base font-bold text-brand-medium mb-2">Deposit Amount</h2>
        <p className="text-text-secondary text-sm font-medium">Choose how to provide liquidity</p>
      </div>

      {/* Deposit Mode Toggle */}
      <div className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-gray-800/50 rounded-xl w-fit mb-8">
        <button
          onClick={() => onDepositModeChange('single')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
            depositMode === 'single'
              ? 'bg-gradient-hard text-white shadow-lg'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          <Zap size={16} />
          Single Token
        </button>
        <button
          onClick={() => onDepositModeChange('both')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
            depositMode === 'both'
              ? 'bg-gradient-hard text-white shadow-lg'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          Both Tokens
        </button>
      </div>

      {/* Token Prices Info */}
      {token0Data && token1Data && (token0Price !== null || token1Price !== null) && (
        <div className="bg-brand-medium/10 border border-brand-medium/30 rounded-xl p-3 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Info className="text-brand-medium flex-shrink-0" size={16} />
            <span className="text-sm font-medium text-brand-medium">Token Prices</span>
          </div>
          <div className="flex gap-4 text-sm text-text-secondary">
            <span>
              {token0Data.symbol} ={' '}
              {token0Price !== null
                ? `$${token0Price.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: token0Price < 1 ? 4 : 2,
                  })}`
                : 'N/A'}
            </span>
            <span>
              {token1Data.symbol} ={' '}
              {token1Price !== null
                ? `$${token1Price.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: token1Price < 1 ? 4 : 2,
                  })}`
                : 'N/A'}
            </span>
          </div>
        </div>
      )}

      {/* Single Token Mode */}
      {depositMode === 'single' && (
        <div className="space-y-6 mb-8">
          <div className="bg-brand-soft/10 border border-brand-soft/30 rounded-xl p-3 flex items-start gap-2">
            <Zap className="text-brand-soft mt-0.5 flex-shrink-0" size={16} />
            <p className="text-xs text-brand-soft">
              Deposit a single token and we&apos;ll automatically swap a portion to create a balanced
              position.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-text-primary">Select Token</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => token0Data && onSingleTokenChange(token0Data.address)}
                className={cn(
                  'p-3 rounded-xl border transition-all',
                  singleTokenAddress === token0Data?.address
                    ? 'bg-brand-medium/10 border-brand-medium text-white'
                    : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 hover:border-gray-400 text-text-secondary'
                )}
              >
                {token0Data?.symbol || 'Token 0'}
              </button>
              <button
                onClick={() => token1Data && onSingleTokenChange(token1Data.address)}
                className={cn(
                  'p-3 rounded-xl border transition-all',
                  singleTokenAddress === token1Data?.address
                    ? 'bg-brand-medium/10 border-brand-medium text-white'
                    : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 hover:border-gray-400 text-text-secondary'
                )}
              >
                {token1Data?.symbol || 'Token 1'}
              </button>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-text-primary">Amount</label>
              {singleTokenData && (
                <span className="text-xs text-text-muted">
                  Balance: {formatBalance(singleTokenBalance, singleTokenData.decimals)}
                </span>
              )}
            </div>
            <input
              type="number"
              value={singleTokenAmount}
              onChange={(e) => onSingleTokenAmountChange(e.target.value)}
              placeholder="0.00"
              step="0.01"
              className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary"
            />
          </div>

          {/* Zap Quote Preview */}
          {zapQuoteLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-text-muted">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-sm">Getting quote...</span>
            </div>
          )}

          {zapQuote && singleTokenData && (
            <div className="bg-gray-100 dark:bg-gray-800/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700/50">
              <div className="flex items-center gap-2 mb-3">
                <Info size={14} className="text-brand-medium" />
                <span className="text-sm font-medium text-text-secondary">Position Preview</span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-text-muted">Your deposit</span>
                  <span className="text-text-primary font-medium">
                    {singleTokenAmount} {singleTokenData.symbol}
                  </span>
                </div>
                {zapQuote.priceImpact > 0 && (
                  <div className="flex justify-between pt-2">
                    <span className="text-text-muted">Price Impact</span>
                    <span className={zapQuote.priceImpact > 1 ? 'text-status-warning' : 'text-status-success'}>
                      {zapQuote.priceImpact.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Both Tokens Mode */}
      {depositMode === 'both' && (
        <div className="space-y-6 mb-8">
          {/* Token 0 Input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-text-primary">
                {token0Data?.symbol || 'Token 0'} Amount
              </label>
              {balance0 !== undefined && token0Data && (
                <button
                  onClick={() => onAmount0Change(formatUnits(balance0, token0Data.decimals))}
                  className="text-xs text-text-muted hover:text-brand-medium transition-colors"
                >
                  Balance: {formatBalance(balance0, token0Data.decimals)} (Max)
                </button>
              )}
            </div>
            <input
              type="number"
              value={amount0}
              onChange={(e) => onAmount0Change(e.target.value)}
              placeholder="0.00"
              step="0.01"
              className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary"
            />
            {insufficientBalance0 && (
              <div className="flex items-center gap-1 mt-1 text-status-error text-xs">
                <AlertCircle size={12} />
                <span>Insufficient balance</span>
              </div>
            )}
          </div>

          {/* Token 1 Input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-text-primary">
                {token1Data?.symbol || 'Token 1'} Amount
              </label>
              {balance1 !== undefined && token1Data && (
                <button
                  onClick={() => onAmount1Change(formatUnits(balance1, token1Data.decimals))}
                  className="text-xs text-text-muted hover:text-brand-medium transition-colors"
                >
                  Balance: {formatBalance(balance1, token1Data.decimals)} (Max)
                </button>
              )}
            </div>
            <input
              type="number"
              value={amount1}
              onChange={(e) => onAmount1Change(e.target.value)}
              placeholder="0.00"
              step="0.01"
              className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary"
            />
            {insufficientBalance1 && (
              <div className="flex items-center gap-1 mt-1 text-status-error text-xs">
                <AlertCircle size={12} />
                <span>Insufficient balance</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 border-2 border-brand-medium text-brand-medium hover:bg-brand-medium/10 rounded-xl font-medium transition-colors"
        >
          Back
        </button>

        {depositMode === 'single' ? (
          <button
            onClick={onZap}
            disabled={zapIsPending || zapIsConfirming || !singleTokenAmount || !zapQuote}
            className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {(zapIsPending || zapIsConfirming) && <Loader2 className="animate-spin" size={18} />}
            {zapIsPending ? 'Confirm in Wallet...' : zapIsConfirming ? 'Creating...' : (
              <>
                <Zap size={16} />
                Create Position
              </>
            )}
          </button>
        ) : (
          <>
            {!isToken0Approved || !isToken1Approved ? (
              <button
                onClick={!isToken0Approved ? onApproveToken0 : onApproveToken1}
                disabled={isPendingApproval}
                className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 transition-all"
              >
                {isPendingApproval && <Loader2 className="animate-spin" size={18} />}
                {isPendingApproval
                  ? 'Approving...'
                  : `Approve ${!isToken0Approved ? token0Data?.symbol : token1Data?.symbol}`}
              </button>
            ) : (
              <button
                onClick={onMint}
                disabled={isPending || isConfirming || !poolPriceValid || insufficientBalance0 || insufficientBalance1}
                className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {(isPending || isConfirming) && <Loader2 className="animate-spin" size={18} />}
                {isPending ? 'Confirm in Wallet...' : isConfirming ? 'Creating...' : 'Create Position'}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
