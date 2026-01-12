'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { RefreshCw, TrendingUp, Shield, ArrowUpRight, ArrowDownRight, Wallet } from 'lucide-react';

interface Activity {
  id: string;
  type: 'compound' | 'rebalance' | 'exit' | 'deposit' | 'withdraw' | 'borrow' | 'repay';
  timestamp: number;
  tokenId: string;
  details: string;
  txHash: string;
}

const activityIcons = {
  compound: RefreshCw,
  rebalance: TrendingUp,
  exit: Shield,
  deposit: ArrowDownRight,
  withdraw: ArrowUpRight,
  borrow: Wallet,
  repay: Wallet,
};

const activityColors = {
  compound: 'text-status-success bg-status-success/10',
  rebalance: 'text-brand-medium bg-brand-medium/10',
  exit: 'text-status-warning bg-status-warning/10',
  deposit: 'text-status-success bg-status-success/10',
  withdraw: 'text-status-error bg-status-error/10',
  borrow: 'text-purple-400 bg-purple-500/10',
  repay: 'text-brand-medium bg-brand-medium/10',
};

function ActivityItem({ activity }: { activity: Activity }) {
  const Icon = activityIcons[activity.type];
  const colorClass = activityColors[activity.type];
  const timeAgo = getTimeAgo(activity.timestamp);

  return (
    <div className="flex items-start gap-3 py-3">
      <div className={`p-2 rounded-xl ${colorClass}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary capitalize">{activity.type}</p>
        <p className="text-xs text-text-muted truncate">{activity.details}</p>
      </div>
      <span className="text-xs text-text-muted">{timeAgo}</span>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function RecentActivity() {
  const { address } = useAccount();

  const { data: activities, isLoading } = useQuery({
    queryKey: ['activities', address],
    queryFn: async () => {
      // Fetch from API
      return [] as Activity[];
    },
    enabled: !!address,
  });

  return (
    <div className="rounded-2xl bg-surface-card border border-gray-800/50 overflow-hidden">
      <div className="p-6 border-b border-gray-800/30">
        <h2 className="text-lg font-bold text-text-primary">Recent Activity</h2>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-800/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activities && activities.length > 0 ? (
          <div className="divide-y divide-gray-800/30">
            {activities.map((activity) => (
              <ActivityItem key={activity.id} activity={activity} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-text-muted text-sm">No recent activity</p>
          </div>
        )}
      </div>
    </div>
  );
}
