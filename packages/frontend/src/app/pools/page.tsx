'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Droplets, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { PoolTable } from '@/components/pools/pool-table';
import { fetchV4Pools, V4PoolsResponse, PoolSortField, POOL_CHAIN_IDS } from '@/lib/backend';

export default function PoolsPage() {
  const [data, setData] = useState<V4PoolsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<PoolSortField>('apr');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [chainId, setChainId] = useState(POOL_CHAIN_IDS.BASE);
  const limit = 20;

  const loadPools = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchV4Pools({
        chainId,
        page,
        limit,
        sortBy,
        sortOrder,
      });
      setData(result);
    } catch (err) {
      setError('Failed to load pools. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [chainId, page, sortBy, sortOrder]);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  const handleSort = (field: PoolSortField) => {
    if (field === sortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filter pools by search term (client-side for now)
  const filteredPools = data?.pools.filter((pool) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      pool.token0Symbol.toLowerCase().includes(term) ||
      pool.token1Symbol.toLowerCase().includes(term) ||
      pool.token0Address.toLowerCase().includes(term) ||
      pool.token1Address.toLowerCase().includes(term)
    );
  }) || [];

  // Calculate stats
  const totalTvl = data?.pools.reduce((sum, p) => sum + p.tvlUsd, 0) || 0;
  const avgApr = data?.pools.length
    ? data.pools.reduce((sum, p) => sum + p.poolApr, 0) / data.pools.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Droplets className="h-6 w-6 text-purple-400" />
            V4 Pools
          </h1>
          <p className="text-gray-400 mt-1">
            Discover and add liquidity to Uniswap V4 pools on Base
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadPools}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/initiator"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            + New Position
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Pools</p>
          <p className="text-2xl font-bold text-white">{data?.pagination.total || 0}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Total TVL (Top 20)</p>
          <p className="text-2xl font-bold text-white">
            ${totalTvl >= 1e6 ? `${(totalTvl / 1e6).toFixed(1)}M` : totalTvl.toLocaleString()}
          </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Avg Pool APR</p>
          <p className="text-2xl font-bold text-green-400">{avgApr.toFixed(2)}%</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Network</p>
          <p className="text-2xl font-bold text-white">{data?.chainName || 'Base'}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by token symbol or address..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Pool Table */}
      {!error && (
        <PoolTable
          pools={searchTerm ? filteredPools : (data?.pools || [])}
          pagination={
            searchTerm
              ? { page: 1, limit: filteredPools.length, total: filteredPools.length, totalPages: 1 }
              : (data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })
          }
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onPageChange={handlePageChange}
          isLoading={isLoading && !data}
        />
      )}

      {/* Info */}
      <div className="text-center text-gray-500 text-sm">
        Pool data syncs automatically every 15 minutes. Click any row to add liquidity.
      </div>
    </div>
  );
}
