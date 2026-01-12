'use client';

import { useAccount } from 'wagmi';
import Link from 'next/link';
import { ExternalLink, MoreVertical, TrendingUp, RefreshCw, Shield, Layers, Loader2 } from 'lucide-react';
import { usePositions, Position } from '@/hooks/usePonderData';
import { getPositionValueUsd } from '@/utils/tickMath';
import { cn } from '@/lib/utils';
import { TokenPair } from '@/components/ui';

function PositionRow({ position }: { position: Position }) {
  const feeTier = (position.pool.fee / 10000).toFixed(2);
  const pairName = `${position.pool.token0.symbol}/${position.pool.token1.symbol}`;

  // Calculate position value
  const positionValue = (() => {
    const liquidityBigInt = BigInt(position.liquidity || '0');
    const sqrtPriceX96 = BigInt(position.sqrtPriceX96 || '0');

    if (sqrtPriceX96 === 0n || liquidityBigInt === 0n) {
      return { amount0: 0, amount1: 0, valueUsd: 0, token0PriceUsed: 0 };
    }

    // Use pool price for ETH/USDC pools (pass 0 to derive from sqrtPriceX96)
    const isToken0Eth = position.pool.token0.symbol === 'ETH' || position.pool.token0.symbol === 'WETH';
    const isToken1Stable = position.pool.token1.symbol === 'USDC' || position.pool.token1.symbol === 'USDT';
    const token0PriceUsd = isToken0Eth && isToken1Stable ? 0 : 1; // 0 = derive from pool
    const token1PriceUsd = isToken1Stable ? 1 : 0;

    return getPositionValueUsd(
      liquidityBigInt,
      sqrtPriceX96,
      position.tickLower,
      position.tickUpper,
      position.pool.token0.decimals,
      position.pool.token1.decimals,
      token0PriceUsd,
      token1PriceUsd
    );
  })();

  const formatValue = (value: number) => {
    if (value > 1000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (value > 1) return `$${value.toFixed(2)}`;
    if (value > 0.01) return `$${value.toFixed(4)}`;
    return '< $0.01';
  };

  return (
    <div className="flex items-center justify-between p-4 hover:bg-gray-800/30 transition-colors rounded-xl border border-transparent hover:border-gray-700/50">
      <div className="flex items-center gap-4">
        <TokenPair
          frontSymbol={position.pool.token0.symbol}
          backSymbol={position.pool.token1.symbol}
          size="md"
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{pairName}</span>
            <span className="text-xs text-text-secondary bg-gray-800 px-2 py-0.5 rounded-lg">
              {feeTier}%
            </span>
          </div>
          <p className="text-sm text-text-muted">ID: {position.tokenId}</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Position Value */}
        <div className="text-right min-w-[100px]">
          <p className="font-semibold text-brand-medium">{formatValue(positionValue.valueUsd)}</p>
          <p className="text-xs text-text-muted">
            {positionValue.amount0 > 0.0001 ? positionValue.amount0.toFixed(4) : '< 0.0001'} {position.pool.token0.symbol}
          </p>
        </div>

        {/* Range Status */}
        <div className="text-center">
          <span className={cn(
            'inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium',
            position.inRange
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-warning/10 text-status-warning'
          )}>
            {position.inRange ? 'In Range' : 'Out of Range'}
          </span>
        </div>

        {/* Automations */}
        <div className="flex items-center gap-2">
          {position.compoundConfig?.enabled && (
            <div className="p-1.5 bg-status-success/10 rounded-lg text-status-success" title="Auto-Compound Active">
              <RefreshCw size={14} />
            </div>
          )}
          {position.rangeConfig?.enabled && (
            <div className="p-1.5 bg-brand-medium/10 rounded-lg text-brand-medium" title="Auto-Range Active">
              <TrendingUp size={14} />
            </div>
          )}
          {position.exitConfig && position.exitConfig.exitType > 0 && (
            <div className="p-1.5 bg-status-warning/10 rounded-lg text-status-warning" title="Auto-Exit Active">
              <Shield size={14} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Link
            href={`/positions/${position.tokenId}`}
            className="p-2 text-text-secondary hover:text-brand-medium transition-colors rounded-lg hover:bg-gray-800/50"
          >
            <ExternalLink size={16} />
          </Link>
          <button className="p-2 text-text-secondary hover:text-text-primary transition-colors rounded-lg hover:bg-gray-800/50">
            <MoreVertical size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function PositionsList() {
  const { address } = useAccount();
  const { data: positions, isLoading } = usePositions();

  return (
    <div className="rounded-2xl bg-surface-card border border-gray-800/50 overflow-hidden">
      <div className="flex items-center justify-between p-6 border-b border-gray-800/30">
        <h2 className="text-lg font-bold text-text-primary">Your Positions</h2>
        <Link
          href="/initiator"
          className="flex items-center gap-2 px-4 py-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white text-sm"
        >
          + New Position
        </Link>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="mx-auto mb-3 animate-spin text-brand-medium" size={32} />
            <p className="text-text-secondary">Loading your positions...</p>
          </div>
        ) : positions && positions.length > 0 ? (
          <div className="space-y-2">
            {positions.map((position) => (
              <PositionRow key={position.id} position={position} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-brand-medium/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Layers className="text-brand-medium" size={32} />
            </div>
            <p className="text-text-secondary mb-4">No positions found</p>
            <Link
              href="/initiator"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white"
            >
              Create Your First Position
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
