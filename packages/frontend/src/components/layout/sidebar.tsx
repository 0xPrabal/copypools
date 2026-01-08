'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Layers,
  Plus,
  RefreshCw,
  TrendingUp,
  Shield,
  Wallet,
  BarChart3,
  Loader2,
  Droplets,
} from 'lucide-react';
import { usePositions } from '@/hooks/usePonderData';
import { getPositionValueUsd } from '@/utils/tickMath';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Pools', href: '/pools', icon: Droplets },
  { name: 'Positions', href: '/positions', icon: Layers },
  { name: 'Initiator', href: '/initiator', icon: Plus },
  { name: 'Auto-Compound', href: '/compound', icon: RefreshCw },
  { name: 'Auto-Range', href: '/range', icon: TrendingUp },
  { name: 'Auto-Exit', href: '/exit', icon: Shield },
  { name: 'Lending', href: '/lend', icon: Wallet },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
];


export function Sidebar() {
  const pathname = usePathname();
  const { data: positions, isLoading: positionsLoading } = usePositions();

  // Calculate total TVL from all positions
  const totalTVL = useMemo(() => {
    if (!positions || positions.length === 0) return 0;

    return positions.reduce((total, position) => {
      try {
        const sqrtPriceX96 = BigInt(position.sqrtPriceX96 || '0');
        const liquidity = BigInt(position.liquidity || '0');

        if (liquidity === 0n || sqrtPriceX96 === 0n) return total;

        const { valueUsd } = getPositionValueUsd(
          liquidity,
          sqrtPriceX96,
          position.tickLower,
          position.tickUpper,
          position.pool.token0.decimals,
          position.pool.token1.decimals,
          0, // Let it derive from pool price
          1  // Assume token1 is stablecoin at $1
        );

        return total + (isFinite(valueUsd) ? valueUsd : 0);
      } catch {
        return total;
      }
    }, 0);
  }, [positions]);

  // Format TVL for display
  const formatTVL = (value: number): string => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  };

  return (
    <aside className="w-64 glass-panel border-r border-white/5 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-white/5">
        <Link href="/" className="flex items-center group">
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-accent-400 group-hover:from-primary-300 group-hover:to-accent-300 transition-all">CopyPools</span>
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-primary-500/10 text-primary-300 border border-primary-500/20 shadow-[0_0_15px_rgba(139,92,246,0.15)]'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon size={20} className={isActive ? 'text-primary-400' : ''} />
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Stats */}
      <div className="px-4 py-4 border-t border-white/5">
        <div className="bg-black/20 border border-white/5 backdrop-blur-md rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Protocol TVL</p>
          {positionsLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="animate-spin text-accent-400" size={16} />
              <span className="text-sm text-gray-500">Loading...</span>
            </div>
          ) : (
            <p className="text-lg font-bold text-accent-400 neon-text-accent">
              {formatTVL(totalTVL)}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
