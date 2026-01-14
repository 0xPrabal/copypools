import { logger } from '../utils/logger.js';
import * as subgraph from './subgraph.js';
import * as blockchain from './blockchain.js';
import * as analytics from './analytics.js';
import {
  createDbNotification,
  getDbNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
  cleanupOldNotifications,
  type DbNotification,
  type NotificationType,
} from './database.js';

const notificationLogger = logger.child({ module: 'notifications' });

// Re-export NotificationType from database
export { NotificationType };

// Types - compatible with database schema
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

// Webhook subscriptions still in-memory (can be migrated to DB later if needed)
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

// Create notification - stores in database
export async function createNotification(params: Omit<Notification, 'id' | 'timestamp' | 'read'>): Promise<Notification> {
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const owner = params.owner || 'global';

  // Store in database
  const dbNotification = await createDbNotification({
    id,
    type: params.type,
    severity: params.severity,
    title: params.title,
    message: params.message,
    positionId: params.positionId || null,
    owner: owner.toLowerCase(),
    data: params.data || null,
    read: false,
  });

  const notification: Notification = {
    ...params,
    id,
    timestamp: dbNotification?.timestamp.getTime() || Date.now(),
    read: false,
  };

  // Trigger webhooks
  triggerWebhooks(notification);

  notificationLogger.info({ notificationId: id, owner, type: params.type }, 'Notification created');

  return notification;
}

// Get notifications for a user from database
export async function getNotifications(owner: string, limit = 50): Promise<Notification[]> {
  const dbNotifications = await getDbNotifications(owner, limit);

  return dbNotifications.map(dbNotif => ({
    id: dbNotif.id,
    type: dbNotif.type,
    severity: dbNotif.severity,
    title: dbNotif.title,
    message: dbNotif.message,
    positionId: dbNotif.positionId || undefined,
    owner: dbNotif.owner,
    data: dbNotif.data || undefined,
    timestamp: dbNotif.timestamp.getTime(),
    read: dbNotif.read,
  }));
}

// Mark notification as read in database
export async function markAsRead(owner: string, notificationId: string): Promise<boolean> {
  return markNotificationAsRead(owner, notificationId);
}

// Mark all as read in database
export async function markAllAsRead(owner: string): Promise<number> {
  return markAllNotificationsAsRead(owner);
}

// Get unread count for a user
export async function getUnreadCount(owner: string): Promise<number> {
  return getUnreadNotificationCount(owner);
}

// Cleanup old notifications (call periodically)
export async function cleanup(daysOld: number = 30): Promise<number> {
  return cleanupOldNotifications(daysOld);
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
          await createNotification({
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
          await createNotification({
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
    cleanup(30), // Clean up notifications older than 30 days
  ]);

  notificationLogger.info('Notification checks completed');
}
