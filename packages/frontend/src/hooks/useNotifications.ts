'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { fetchNotifications, Notification, NotificationType } from '@/lib/backend';

// Map notification types to user-friendly display labels
export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  // Automated notifications
  compound_executed: 'Fees Compounded',
  rebalance_executed: 'Position Rebalanced',
  position_out_of_range: 'Out of Range',
  compound_profitable: 'Compound Ready',
  rebalance_needed: 'Rebalance Needed',
  high_fees_accumulated: 'High Fees',
  gas_price_low: 'Low Gas',
  position_liquidatable: 'Liquidation Risk',
  // User action notifications
  position_created: 'Position Created',
  liquidity_increased: 'Liquidity Added',
  liquidity_decreased: 'Liquidity Removed',
  fees_collected: 'Fees Collected',
  position_closed: 'Position Closed',
  auto_compound_enabled: 'Auto-Compound Enabled',
  auto_compound_disabled: 'Auto-Compound Disabled',
  auto_range_enabled: 'Auto-Range Enabled',
  auto_range_disabled: 'Auto-Range Disabled',
};

// Activity item for UI display
export interface ActivityItem {
  id: string;
  type: NotificationType;
  label: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  positionId?: string;
  read: boolean;
}

// Convert notification to activity item
function toActivityItem(notification: Notification): ActivityItem {
  return {
    id: notification.id,
    type: notification.type,
    label: NOTIFICATION_LABELS[notification.type] || notification.title,
    message: notification.message,
    severity: notification.severity,
    timestamp: notification.timestamp,
    positionId: notification.positionId,
    read: notification.read,
  };
}

// Format relative time
export function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface UseNotificationsOptions {
  limit?: number;
  enabled?: boolean;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { limit = 10, enabled = true } = options;
  const { address } = useAccount();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['notifications', address, limit],
    queryFn: async () => {
      if (!address) return { notifications: [], unreadCount: 0 };
      return fetchNotifications(address, limit);
    },
    enabled: enabled && !!address,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });

  const activities: ActivityItem[] = (data?.notifications || []).map(toActivityItem);
  const unreadCount = data?.unreadCount || 0;

  return {
    activities,
    unreadCount,
    isLoading,
    error,
    refetch,
    hasActivities: activities.length > 0,
  };
}
