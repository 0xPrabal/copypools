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
  compound: 'text-green-400 bg-green-500/10',
  rebalance: 'text-blue-400 bg-blue-500/10',
  exit: 'text-orange-400 bg-orange-500/10',
  deposit: 'text-green-400 bg-green-500/10',
  withdraw: 'text-red-400 bg-red-500/10',
  borrow: 'text-purple-400 bg-purple-500/10',
  repay: 'text-blue-400 bg-blue-500/10',
};

function ActivityItem({ activity }: { activity: Activity }) {
  const Icon = activityIcons[activity.type];
  const colorClass = activityColors[activity.type];
  const timeAgo = getTimeAgo(activity.timestamp);

  return (
    <div className="flex items-start gap-3 py-3">
      <div className={`p-2 rounded-lg ${colorClass}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium capitalize">{activity.type}</p>
        <p className="text-xs text-gray-400 truncate">{activity.details}</p>
      </div>
      <span className="text-xs text-gray-500">{timeAgo}</span>
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
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      ) : activities && activities.length > 0 ? (
        <div className="divide-y divide-gray-800">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400 text-sm">No recent activity</p>
        </div>
      )}
    </div>
  );
}
