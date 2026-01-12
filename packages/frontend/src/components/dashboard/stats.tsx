'use client';

import { TrendingUp, Layers, RefreshCw, Activity } from 'lucide-react';
import { usePositions } from '@/hooks/usePonderData';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  subtext?: string;
  icon: React.ReactNode;
  loading?: boolean;
  highlight?: boolean;
}

function StatCard({ title, value, subtext, icon, loading, highlight }: StatCardProps) {
  return (
    <div className="relative rounded-2xl bg-surface-card p-6 border border-gray-800/50 backdrop-blur-sm overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-medium/5 to-transparent pointer-events-none" />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm text-text-secondary font-medium mb-1">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-gray-800 rounded animate-pulse" />
          ) : (
            <p className={cn(
              'text-2xl font-bold',
              highlight ? 'text-status-success' : 'text-brand-medium'
            )}>
              {value}
            </p>
          )}
          {subtext && (
            <p className="text-xs text-text-muted mt-1">{subtext}</p>
          )}
        </div>
        <div className="p-3 bg-brand-medium/10 rounded-xl text-brand-medium">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function DashboardStats() {
  const { data: positions, isLoading } = usePositions();

  // Use already-fetched compoundConfig and rangeConfig from positions
  const compoundCount = positions?.filter(p => p.compoundConfig?.enabled).length || 0;
  const rangeCount = positions?.filter(p => p.rangeConfig?.enabled).length || 0;

  // Calculate user stats from positions
  const activePositions = positions?.length || 0;
  const inRangeCount = positions?.filter(p => p.inRange).length || 0;
  const outOfRangeCount = activePositions - inRangeCount;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Active Positions"
        value={activePositions.toString()}
        subtext={`${inRangeCount} in range, ${outOfRangeCount} out of range`}
        icon={<Layers size={24} />}
        loading={isLoading}
      />
      <StatCard
        title="In Range"
        value={inRangeCount.toString()}
        subtext="Earning fees"
        icon={<Activity size={24} />}
        loading={isLoading}
        highlight={inRangeCount > 0}
      />
      <StatCard
        title="Auto-Compound"
        value={compoundCount.toString()}
        subtext="Positions with fee reinvestment"
        icon={<TrendingUp size={24} />}
        loading={isLoading}
      />
      <StatCard
        title="Auto-Range"
        value={rangeCount.toString()}
        subtext="Positions with auto-rebalancing"
        icon={<RefreshCw size={24} />}
        loading={isLoading}
      />
    </div>
  );
}
