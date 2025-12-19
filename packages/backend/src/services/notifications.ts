import { logger } from '../utils/logger.js';
import * as subgraph from './subgraph.js';
import * as blockchain from './blockchain.js';
import * as analytics from './analytics.js';

const notificationLogger = logger.child({ module: 'notifications' });

// Types
export interface Notification {
  id: string;
  type: NotificationType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  positionId?: string;
  owner?: string;
  data?: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

export type NotificationType =
  | 'compound_profitable'
  | 'rebalance_needed'
  | 'position_out_of_range'
  | 'high_fees_accumulated'
  | 'gas_price_low'
  | 'position_liquidatable'
  | 'compound_executed'
  | 'rebalance_executed';

// In-memory notification store (in production, use Redis or database)
const notificationStore: Map<string, Notification[]> = new Map();
const webhookSubscriptions: Map<string, WebhookSubscription[]> = new Map();

export interface WebhookSubscription {
  id: string;
  url: string;
  events: NotificationType[];
  owner: string;
  secret?: string;
  active: boolean;
  createdAt: number;
}

// Create notification
export function createNotification(params: Omit<Notification, 'id' | 'timestamp' | 'read'>): Notification {
  const notification: Notification = {
    ...params,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    read: false,
  };

  // Store notification
  const owner = params.owner || 'global';
  const existing = notificationStore.get(owner) || [];
  existing.unshift(notification);

  // Keep only last 100 notifications per user
  if (existing.length > 100) {
    existing.pop();
  }

  notificationStore.set(owner, existing);

  // Trigger webhooks
  triggerWebhooks(notification);

  notificationLogger.info({ notification }, 'Notification created');

  return notification;
}

// Get notifications for a user
export function getNotifications(owner: string, limit = 50): Notification[] {
  const userNotifications = notificationStore.get(owner) || [];
  const globalNotifications = notificationStore.get('global') || [];

  return [...userNotifications, ...globalNotifications]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

// Mark notification as read
export function markAsRead(owner: string, notificationId: string): boolean {
  const notifications = notificationStore.get(owner);
  if (!notifications) return false;

  const notification = notifications.find((n) => n.id === notificationId);
  if (notification) {
    notification.read = true;
    return true;
  }

  return false;
}

// Mark all as read
export function markAllAsRead(owner: string): number {
  const notifications = notificationStore.get(owner);
  if (!notifications) return 0;

  let count = 0;
  notifications.forEach((n) => {
    if (!n.read) {
      n.read = true;
      count++;
    }
  });

  return count;
}

// Check for compound opportunities and create notifications
export async function checkCompoundOpportunities(): Promise<void> {
  try {
    const result = await subgraph.getCompoundablePositions('0', 100);
    const configs = (result as any)?.compoundConfigs || [];

    for (const config of configs) {
      if (!config.position) continue;

      try {
        const profitability = await analytics.checkCompoundProfitability(config.positionId);

        if (profitability.isProfitable) {
          createNotification({
            type: 'compound_profitable',
            severity: 'info',
            title: 'Compounding Profitable',
            message: `Position #${config.positionId} has accumulated enough fees for profitable compounding.`,
            positionId: config.positionId,
            owner: config.position.owner,
            data: {
              estimatedReward: profitability.estimatedReward,
              pendingFees: profitability.pendingFees,
            },
          });
        }
      } catch (e) {
        // Skip individual position errors
      }
    }
  } catch (error) {
    notificationLogger.error({ error }, 'Failed to check compound opportunities');
  }
}

// Check for rebalance needs and create notifications
export async function checkRebalanceNeeds(): Promise<void> {
  try {
    const result = await subgraph.getRebalanceablePositions(100);
    const configs = (result as any)?.rangeConfigs || [];

    for (const config of configs) {
      if (!config.position) continue;

      try {
        const rebalanceCheck = await analytics.checkRebalanceNeed(config.positionId);

        if (rebalanceCheck.needsRebalance) {
          createNotification({
            type: 'rebalance_needed',
            severity: 'warning',
            title: 'Rebalance Recommended',
            message: `Position #${config.positionId} is out of range. ${rebalanceCheck.reason}`,
            positionId: config.positionId,
            owner: config.position.owner,
            data: {
              reason: rebalanceCheck.reason,
            },
          });
        }
      } catch (e) {
        // Skip individual position errors
      }
    }
  } catch (error) {
    notificationLogger.error({ error }, 'Failed to check rebalance needs');
  }
}

// Webhook management
export function subscribeWebhook(subscription: Omit<WebhookSubscription, 'id' | 'createdAt'>): WebhookSubscription {
  const newSubscription: WebhookSubscription = {
    ...subscription,
    id: `wh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now(),
  };

  const existing = webhookSubscriptions.get(subscription.owner) || [];
  existing.push(newSubscription);
  webhookSubscriptions.set(subscription.owner, existing);

  notificationLogger.info({ subscriptionId: newSubscription.id }, 'Webhook subscribed');

  return newSubscription;
}

export function unsubscribeWebhook(owner: string, webhookId: string): boolean {
  const subscriptions = webhookSubscriptions.get(owner);
  if (!subscriptions) return false;

  const index = subscriptions.findIndex((s) => s.id === webhookId);
  if (index >= 0) {
    subscriptions.splice(index, 1);
    webhookSubscriptions.set(owner, subscriptions);
    return true;
  }

  return false;
}

export function getWebhookSubscriptions(owner: string): WebhookSubscription[] {
  return webhookSubscriptions.get(owner) || [];
}

// Trigger webhooks for a notification
async function triggerWebhooks(notification: Notification): Promise<void> {
  const owner = notification.owner || 'global';
  const subscriptions = webhookSubscriptions.get(owner) || [];

  for (const subscription of subscriptions) {
    if (!subscription.active) continue;
    if (!subscription.events.includes(notification.type)) continue;

    try {
      const payload = {
        event: notification.type,
        notification,
        timestamp: Date.now(),
      };

      // In production, use proper HTTP client with retries
      await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(subscription.secret && { 'X-Webhook-Secret': subscription.secret }),
        },
        body: JSON.stringify(payload),
      });

      notificationLogger.debug(
        { webhookId: subscription.id, event: notification.type },
        'Webhook triggered'
      );
    } catch (error) {
      notificationLogger.error(
        { webhookId: subscription.id, error },
        'Webhook trigger failed'
      );
    }
  }
}

// Notification service runner (to be called periodically)
export async function runNotificationChecks(): Promise<void> {
  notificationLogger.info('Running notification checks');

  await Promise.all([
    checkCompoundOpportunities(),
    checkRebalanceNeeds(),
  ]);

  notificationLogger.info('Notification checks completed');
}
