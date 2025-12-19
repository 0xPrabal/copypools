'use client';

import { TrendingUp, Layers, RefreshCw, Activity } from 'lucide-react';
import { usePositions } from '@/hooks/usePonderData';

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
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-gray-800 rounded animate-pulse" />
          ) : (
            <p className={`text-2xl font-bold ${highlight ? 'text-green-400' : ''}`}>{value}</p>
          )}
          {subtext && (
            <p className="text-xs text-gray-500 mt-1">{subtext}</p>
          )}
        </div>
        <div className="p-3 bg-primary-500/10 rounded-lg text-primary-400">
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
