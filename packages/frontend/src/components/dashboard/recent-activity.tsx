'use client';

import { RefreshCw, TrendingUp, Shield, AlertTriangle, Zap, DollarSign, Fuel, Plus, Minus, X, Settings, LucideIcon } from 'lucide-react';
import { useNotifications, getTimeAgo, ActivityItem as Activity } from '@/hooks/useNotifications';
import { NotificationType } from '@/lib/backend';

const activityIcons: Record<NotificationType, LucideIcon> = {
  // Automated notifications
  compound_executed: RefreshCw,
  compound_profitable: Zap,
  rebalance_executed: TrendingUp,
  rebalance_needed: TrendingUp,
  position_out_of_range: AlertTriangle,
  high_fees_accumulated: DollarSign,
  gas_price_low: Fuel,
  position_liquidatable: Shield,
  // User action notifications
  position_created: Plus,
  liquidity_increased: Plus,
  liquidity_decreased: Minus,
  fees_collected: DollarSign,
  position_closed: X,
  auto_compound_enabled: Settings,
  auto_compound_disabled: Settings,
  auto_range_enabled: TrendingUp,
  auto_range_disabled: TrendingUp,
};

const activityColors: Record<NotificationType, string> = {
  // Automated notifications
  compound_executed: 'text-status-success bg-status-success/10',
  compound_profitable: 'text-status-success bg-status-success/10',
  rebalance_executed: 'text-brand-medium bg-brand-medium/10',
  rebalance_needed: 'text-status-warning bg-status-warning/10',
  position_out_of_range: 'text-status-warning bg-status-warning/10',
  high_fees_accumulated: 'text-status-success bg-status-success/10',
  gas_price_low: 'text-blue-400 bg-blue-500/10',
  position_liquidatable: 'text-status-error bg-status-error/10',
  // User action notifications
  position_created: 'text-status-success bg-status-success/10',
  liquidity_increased: 'text-status-success bg-status-success/10',
  liquidity_decreased: 'text-status-warning bg-status-warning/10',
  fees_collected: 'text-status-success bg-status-success/10',
  position_closed: 'text-gray-400 bg-gray-500/10',
  auto_compound_enabled: 'text-brand-medium bg-brand-medium/10',
  auto_compound_disabled: 'text-gray-400 bg-gray-500/10',
  auto_range_enabled: 'text-brand-medium bg-brand-medium/10',
  auto_range_disabled: 'text-gray-400 bg-gray-500/10',
};

function ActivityItemComponent({ activity }: { activity: Activity }) {
  const Icon = activityIcons[activity.type] || AlertTriangle;
  const colorClass = activityColors[activity.type] || 'text-text-muted bg-gray-500/10';
  const timeAgo = getTimeAgo(activity.timestamp);

  return (
    <div className="flex items-start gap-3 py-3">
      <div className={`p-2 rounded-xl ${colorClass}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{activity.label}</p>
        <p className="text-xs text-text-muted truncate">{activity.message}</p>
      </div>
      <span className="text-xs text-text-muted">{timeAgo}</span>
    </div>
  );
}

export function RecentActivity() {
  const { activities, isLoading, hasActivities } = useNotifications({ limit: 10 });

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
        ) : hasActivities ? (
          <div className="divide-y divide-gray-800/30">
            {activities.map((activity) => (
              <ActivityItemComponent key={activity.id} activity={activity} />
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
