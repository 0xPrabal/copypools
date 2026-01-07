'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { V4PoolItem, PoolSortField } from '@/lib/backend';
import Image from 'next/image';

interface PoolTableProps {
  pools: V4PoolItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  sortBy: PoolSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: PoolSortField) => void;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

// Format large numbers (e.g., $46.6M)
function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

// Format percentage
function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(2)}%`;
}

// Format volume/TVL ratio
function formatRatio(value: number): string {
  return value.toFixed(2);
}

// Token logo component with fallback
function TokenLogo({ src, symbol, size = 24 }: { src: string | null; symbol: string; size?: number }) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div
        className="rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={symbol}
      width={size}
      height={size}
      className="rounded-full"
      onError={() => setError(true)}
    />
  );
}

// Sort header component
function SortHeader({
  label,
  field,
  currentSort,
  sortOrder,
  onSort,
  align = 'left',
}: {
  label: string;
  field: PoolSortField;
  currentSort: PoolSortField;
  sortOrder: 'asc' | 'desc';
  onSort: (field: PoolSortField) => void;
  align?: 'left' | 'right';
}) {
  const isActive = currentSort === field;

  return (
    <th
      className={`px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <div className="flex flex-col">
          <ChevronUp
            className={`h-3 w-3 ${isActive && sortOrder === 'asc' ? 'text-purple-400' : 'text-gray-600'}`}
          />
          <ChevronDown
            className={`h-3 w-3 -mt-1 ${isActive && sortOrder === 'desc' ? 'text-purple-400' : 'text-gray-600'}`}
          />
        </div>
      </div>
    </th>
  );
}

export function PoolTable({
  pools,
  pagination,
  sortBy,
  sortOrder,
  onSort,
  onPageChange,
  isLoading,
}: PoolTableProps) {
  const router = useRouter();

  const handleRowClick = (pool: V4PoolItem) => {
    const params = new URLSearchParams({
      token0: pool.token0Address,
      token1: pool.token1Address,
      fee: String(pool.fee),
    });
    router.push(`/initiator?${params.toString()}`);
  };

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/80">
              <th className="px-4 py-3 text-left text-gray-400 font-medium w-12">#</th>
              <th className="px-4 py-3 text-left text-gray-400 font-medium">Pool</th>
              <th className="px-4 py-3 text-left text-gray-400 font-medium">Protocol</th>
              <SortHeader
                label="Fee tier"
                field="fee"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
              <SortHeader
                label="TVL"
                field="tvl"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="Pool APR"
                field="apr"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
                align="right"
              />
              <th className="px-4 py-3 text-right text-gray-400 font-medium">Reward APR</th>
              <SortHeader
                label="1D vol"
                field="volume1d"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="30D vol"
                field="volume30d"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
                align="right"
              />
              <th className="px-4 py-3 text-right text-gray-400 font-medium">1D vol/TVL</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-700/50">
                  <td colSpan={10} className="px-4 py-4">
                    <div className="h-6 bg-gray-700/50 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : pools.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                  No pools found
                </td>
              </tr>
            ) : (
              pools.map((pool) => (
                <tr
                  key={pool.id}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer transition-colors"
                  onClick={() => handleRowClick(pool)}
                >
                  <td className="px-4 py-3 text-gray-500">{pool.rank}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-2">
                        <TokenLogo src={pool.token0Logo} symbol={pool.token0Symbol} />
                        <TokenLogo src={pool.token1Logo} symbol={pool.token1Symbol} />
                      </div>
                      <span className="font-medium text-white">
                        {pool.token0Symbol}/{pool.token1Symbol}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-purple-900/50 text-purple-400 rounded text-sm">
                      {pool.protocol}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-sm ${
                        pool.fee <= 500
                          ? 'bg-green-900/50 text-green-400'
                          : pool.fee <= 3000
                          ? 'bg-blue-900/50 text-blue-400'
                          : 'bg-orange-900/50 text-orange-400'
                      }`}
                    >
                      {pool.feeTier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-white">{formatUsd(pool.tvlUsd)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={pool.poolApr > 10 ? 'text-green-400' : 'text-white'}>
                      {formatPercent(pool.poolApr)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {pool.rewardApr ? formatPercent(pool.rewardApr) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-white">{formatUsd(pool.volume1dUsd)}</td>
                  <td className="px-4 py-3 text-right text-white">{formatUsd(pool.volume30dUsd)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{formatRatio(pool.volume1dTvlRatio)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
          <div className="text-sm text-gray-400">
            Showing {(pagination.page - 1) * pagination.limit + 1} -{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} pools
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-2 rounded bg-gray-700 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.totalPages) }).map((_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (pagination.page <= 3) {
                  pageNum = i + 1;
                } else if (pagination.page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = pagination.page - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange(pageNum)}
                    className={`w-8 h-8 rounded text-sm ${
                      pageNum === pagination.page
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    } transition-colors`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 rounded bg-gray-700 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
