'use client';

import { useState } from 'react';
import { useChainId } from 'wagmi';
import { Loader2, Search, ExternalLink, Droplets, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { usePools, Pool } from '@/hooks/usePonderData';
import { CHAIN_IDS } from '@/config/contracts';

// Helper to format fee tier
function formatFee(fee: number): string {
  return `${(fee / 10000).toFixed(2)}%`;
}

// Helper to get block explorer URL
function getExplorerUrl(chainId: number, poolId: string): string {
  if (chainId === CHAIN_IDS.BASE) {
    return `https://basescan.org/address/0x498581fF718922c3f8e6A244956aF099B2652b2b#events`;
  }
  return `https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543#events`;
}

// Helper to truncate address
function truncateAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function PoolsPage() {
  const chainId = useChainId();
  const { data: pools, isLoading, error } = usePools();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'pair' | 'fee'>('pair');

  // Filter pools by search term
  const filteredPools = pools?.filter((pool) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      pool.token0Symbol.toLowerCase().includes(searchLower) ||
      pool.token1Symbol.toLowerCase().includes(searchLower) ||
      pool.currency0.toLowerCase().includes(searchLower) ||
      pool.currency1.toLowerCase().includes(searchLower)
    );
  }) || [];

  // Sort pools
  const sortedPools = [...filteredPools].sort((a, b) => {
    if (sortBy === 'fee') {
      return a.fee - b.fee;
    }
    // Sort by pair name
    const pairA = `${a.token0Symbol}/${a.token1Symbol}`;
    const pairB = `${b.token0Symbol}/${b.token1Symbol}`;
    return pairA.localeCompare(pairB);
  });

  const chainName = chainId === CHAIN_IDS.BASE ? 'Base' : chainId === CHAIN_IDS.SEPOLIA ? 'Sepolia' : 'Unknown';

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
            All available Uniswap V4 pools on {chainName}
          </p>
        </div>
        <Link
          href="/initiator"
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
        >
          + New Position
        </Link>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by token symbol or address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
          />
        </div>
        <button
          onClick={() => setSortBy(sortBy === 'pair' ? 'fee' : 'pair')}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:text-white transition-colors"
        >
          <ArrowUpDown className="h-4 w-4" />
          Sort by {sortBy === 'pair' ? 'Fee' : 'Pair'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Total Pools</p>
          <p className="text-2xl font-bold text-white">{pools?.length || 0}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Known Token Pairs</p>
          <p className="text-2xl font-bold text-white">
            {pools?.filter(p =>
              p.token0Symbol !== p.currency0.slice(0, 6) &&
              p.token1Symbol !== p.currency1.slice(0, 6)
            ).length || 0}
          </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">Network</p>
          <p className="text-2xl font-bold text-white">{chainName}</p>
        </div>
      </div>

      {/* Pools List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
          <span className="ml-3 text-gray-400">Loading pools...</span>
        </div>
      ) : error ? (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 text-red-400">
          Error loading pools. Please try again.
        </div>
      ) : sortedPools.length === 0 ? (
        <div className="bg-gray-800/50 rounded-lg p-8 text-center border border-gray-700">
          <Droplets className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">
            {searchTerm ? 'No pools found matching your search.' : 'No pools found on this network.'}
          </p>
        </div>
      ) : (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Pool</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Fee Tier</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Tick Spacing</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Current Tick</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Hooks</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPools.map((pool) => (
                <PoolRow key={pool.id} pool={pool} chainId={chainId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PoolRow({ pool, chainId }: { pool: Pool; chainId: number }) {
  const hasHooks = pool.hooks !== '0x0000000000000000000000000000000000000000';
  const isKnownPair = pool.token0Symbol !== pool.currency0.slice(0, 6) &&
                       pool.token1Symbol !== pool.currency1.slice(0, 6);

  return (
    <tr className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white border-2 border-gray-800">
              {pool.token0Symbol.slice(0, 2)}
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-xs font-bold text-white border-2 border-gray-800">
              {pool.token1Symbol.slice(0, 2)}
            </div>
          </div>
          <div>
            <p className={`font-medium ${isKnownPair ? 'text-white' : 'text-gray-400'}`}>
              {pool.token0Symbol}/{pool.token1Symbol}
            </p>
            <p className="text-xs text-gray-500">
              {truncateAddress(pool.currency0)} / {truncateAddress(pool.currency1)}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 rounded text-sm ${
          pool.fee === 500 ? 'bg-green-900/50 text-green-400' :
          pool.fee === 3000 ? 'bg-blue-900/50 text-blue-400' :
          pool.fee === 10000 ? 'bg-orange-900/50 text-orange-400' :
          'bg-gray-700 text-gray-300'
        }`}>
          {formatFee(pool.fee)}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-300">
        {pool.tickSpacing}
      </td>
      <td className="px-4 py-3 text-gray-300">
        {pool.tick.toLocaleString()}
      </td>
      <td className="px-4 py-3">
        {hasHooks ? (
          <span className="px-2 py-1 bg-purple-900/50 text-purple-400 rounded text-sm">
            {truncateAddress(pool.hooks)}
          </span>
        ) : (
          <span className="text-gray-500">None</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/initiator?token0=${pool.currency0}&token1=${pool.currency1}&fee=${pool.fee}`}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition-colors"
          >
            Add Liquidity
          </Link>
          <a
            href={getExplorerUrl(chainId, pool.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </td>
    </tr>
  );
}
