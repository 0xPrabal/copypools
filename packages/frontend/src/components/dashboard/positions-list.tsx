'use client';

import { useAccount } from 'wagmi';
import Link from 'next/link';
import { ExternalLink, MoreVertical, TrendingUp, RefreshCw, Shield, Layers, Loader2 } from 'lucide-react';
import { usePositions, Position } from '@/hooks/usePonderData';
import { getPositionValueUsd } from '@/utils/tickMath';

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
    <div className="flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors rounded-lg">
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
          <div className="flex items-center gap-2">
            <span className="font-medium">{pairName}</span>
            <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{feeTier}%</span>
          </div>
          <p className="text-sm text-gray-400">ID: {position.tokenId}</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Position Value */}
        <div className="text-right min-w-[100px]">
          <p className="font-semibold text-green-400">{formatValue(positionValue.valueUsd)}</p>
          <p className="text-xs text-gray-500">
            {positionValue.amount0 > 0.0001 ? positionValue.amount0.toFixed(4) : '< 0.0001'} {position.pool.token0.symbol}
          </p>
        </div>

        {/* Range Status */}
        <div className="text-center">
          <span className={`badge-${position.inRange ? 'success' : 'warning'}`}>
            {position.inRange ? 'In Range' : 'Out of Range'}
          </span>
        </div>

        {/* Automations */}
        <div className="flex items-center gap-2">
          {position.compoundConfig?.enabled && (
            <div className="p-1.5 bg-green-500/10 rounded text-green-400" title="Auto-Compound Active">
              <RefreshCw size={14} />
            </div>
          )}
          {position.rangeConfig?.enabled && (
            <div className="p-1.5 bg-blue-500/10 rounded text-blue-400" title="Auto-Range Active">
              <TrendingUp size={14} />
            </div>
          )}
          {position.exitConfig && position.exitConfig.exitType > 0 && (
            <div className="p-1.5 bg-orange-500/10 rounded text-orange-400" title="Auto-Exit Active">
              <Shield size={14} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Link
            href={`/positions/${position.tokenId}`}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <ExternalLink size={16} />
          </Link>
          <button className="p-2 text-gray-400 hover:text-white transition-colors">
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
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Your Positions</h2>
        <Link href="/initiator" className="btn-primary text-sm">
          + New Position
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <Loader2 className="mx-auto mb-3 animate-spin text-primary-500" size={32} />
          <p className="text-gray-400">Loading your positions...</p>
        </div>
      ) : positions && positions.length > 0 ? (
        <div className="space-y-2">
          {positions.map((position) => (
            <PositionRow key={position.id} position={position} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Layers className="mx-auto mb-4 text-gray-600" size={48} />
          <p className="text-gray-400 mb-4">No positions found</p>
          <Link href="/initiator" className="btn-primary">
            Create Your First Position
          </Link>
        </div>
      )}
    </div>
  );
}
