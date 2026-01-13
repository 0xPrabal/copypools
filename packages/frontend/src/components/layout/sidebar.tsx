'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { usePositions } from '@/hooks/usePonderData';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { useNotifications, getTimeAgo } from '@/hooks/useNotifications';
import { getPositionValueUsd } from '@/utils/tickMath';
import { cn } from '@/lib/utils';
import {
  LayoutIcon,
  StackIcon,
  CirclesIcon,
  RotateClockwiseIcon,
  BadgeUpIcon,
  SidebarLeftIcon,
  TransferIcon,
  FileIcon,
  ArrowRightIcon,
} from '@/components/icons';

// Navigation items with descriptions
const NAV_ITEMS = [
  {
    name: 'Dashboard',
    href: '/',
    description: 'Find and copy working strategies',
    icon: LayoutIcon,
  },
  {
    name: 'Pools',
    href: '/pools',
    description: 'Find pools to start earning from swaps',
    icon: CirclesIcon,
  },
  {
    name: 'Positions',
    href: '/positions',
    description: 'View and manage your liquidity',
    icon: StackIcon,
  },
  {
    name: 'Initiator',
    href: '/initiator',
    description: 'Create a new liquidity position',
    icon: StackIcon,
  },
  {
    name: 'Auto-Compound',
    href: '/compound',
    description: 'Reinvest fees automatically',
    icon: RotateClockwiseIcon,
  },
  {
    name: 'Auto-Range',
    href: '/range',
    description: 'Keep your position in range',
    icon: BadgeUpIcon,
  },
  {
    name: 'Auto-Exit',
    href: '/exit',
    description: 'Exit positions based on rules',
    icon: SidebarLeftIcon,
  },
  {
    name: 'Lending',
    href: '/lend',
    description: 'Earn by lending idle assets',
    icon: TransferIcon,
  },
  {
    name: 'Analytics',
    href: '/analytics',
    description: 'Track performance and earnings',
    icon: FileIcon,
  },
];


export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: positions, isLoading: positionsLoading } = usePositions();
  const { isFullyConnected, address } = useWalletConnection();
  const { activities, isLoading: activitiesLoading, hasActivities } = useNotifications({ limit: 4 });

  // Handle activity item click - navigate to position if available
  const handleActivityClick = (activity: { positionId?: string }) => {
    if (activity.positionId) {
      router.push(`/positions/${activity.positionId}`);
    }
  };

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
          0,
          1
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

  // Format address for display
  const formatAddress = (addr: string): string => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <aside className="w-72 bg-surface-card flex flex-col h-screen sticky top-0 border-r border-gray-800/50">
      {/* Logo Section */}
      <div className="p-5 border-b border-gray-800/30">
        <Link href="/" className="block">
          <h1 className="text-2xl font-bold text-gradient-medium font-heading">
            CopyPools
          </h1>
        </Link>
        <p className="mt-1 text-xs text-text-secondary font-medium">
          Liquidity Management for Uniswap V4
        </p>
      </div>

      {/* Profile Section */}
      <div className="px-4 py-4 border-b border-gray-800/30">
        <div className="rounded-xl bg-gray-900/50 p-4 text-center">
          <div className="mx-auto mb-3 h-16 w-16 rounded-full bg-gradient-hard flex items-center justify-center">
            {isFullyConnected && address ? (
              <span className="text-white text-xl font-bold">
                {address.slice(2, 4).toUpperCase()}
              </span>
            ) : (
              <span className="text-white text-sm">?</span>
            )}
          </div>
          <p className="text-sm font-medium text-text-primary">
            {isFullyConnected && address ? formatAddress(address) : 'Not Connected'}
          </p>
        </div>

        {/* TVL Display */}
        <div className="mt-3 rounded-xl border border-gray-700/50 p-3 flex justify-between items-center">
          <span className="text-xs text-text-secondary font-medium">
            Protocol TVL
          </span>
          {positionsLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="animate-spin text-brand-medium" size={14} />
            </div>
          ) : (
            <span className="text-sm text-brand-medium font-bold">
              {formatTVL(totalTVL)}
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto hide-scrollbar">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'block px-4 py-3 transition-all duration-200',
                isActive
                  ? 'bg-gradient-hard'
                  : 'hover:bg-gray-800/30'
              )}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Icon isActive={isActive} className="h-5 w-5 text-text-primary" />
                  <span className={cn(
                    'text-sm font-semibold',
                    isActive ? 'text-white' : 'text-text-primary'
                  )}>
                    {item.name}
                  </span>
                </div>
                <p className={cn(
                  'text-xs pl-7',
                  isActive ? 'text-white/80' : 'text-text-secondary'
                )}>
                  {item.description}
                </p>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Recent Activities */}
      <div className="border-t border-gray-800/30 p-4">
        <h3 className="mb-3 text-sm font-bold text-text-primary">
          Recent Activities
        </h3>
        {activitiesLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="animate-spin text-brand-medium" size={16} />
          </div>
        ) : hasActivities ? (
          <ul className="space-y-2">
            {activities.map((activity) => (
              <li
                key={activity.id}
                onClick={() => handleActivityClick(activity)}
                className={`flex items-center justify-between text-xs px-2 py-1.5 rounded-lg transition-colors ${
                  activity.positionId
                    ? 'cursor-pointer hover:bg-gray-800/30'
                    : 'cursor-default'
                }`}
              >
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-text-primary font-medium truncate">{activity.label}</span>
                  <span className="text-text-secondary truncate text-[10px]">{getTimeAgo(activity.timestamp)}</span>
                </div>
                {activity.positionId && <ArrowRightIcon className="h-4 w-4 flex-shrink-0" />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-muted text-xs text-center py-4">No recent activity</p>
        )}
      </div>
    </aside>
  );
}
