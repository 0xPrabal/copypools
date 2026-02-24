import { logger } from '../utils/logger.js';
import * as subgraph from './subgraph.js';
import * as blockchain from './blockchain.js';
import * as analytics from './analytics.js';
import { memoryCache } from './cache.js';
import {
  createDbNotification,
  getDbNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
  cleanupOldNotifications,
  createWebhookSubscription,
  getAllActiveWebhooks,
  deleteWebhookSubscription,
  upsertWebhookDelivery,
  cleanupOldDeliveries,
  cleanupOldPriceSamples,
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

// Webhook subscriptions: in-memory Map backed by PostgreSQL for persistence across restarts
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

/**
 * Load all active webhook subscriptions from the database into memory.
 * Call this on startup after initializeDatabase().
 */
export async function initializeWebhooks(): Promise<void> {
  try {
    const dbSubs = await getAllActiveWebhooks();
    for (const dbSub of dbSubs) {
      const sub: WebhookSubscription = {
        id: dbSub.id,
        url: dbSub.url,
        events: dbSub.events as NotificationType[],
        owner: dbSub.owner,
        secret: dbSub.secret,
        active: dbSub.active,
        createdAt: dbSub.createdAt.getTime(),
      };
      const existing = webhookSubscriptions.get(sub.owner) || [];
      existing.push(sub);
      webhookSubscriptions.set(sub.owner, existing);
    }
    notificationLogger.info({ count: dbSubs.length }, 'Webhook subscriptions loaded from database');
  } catch (error) {
    notificationLogger.warn({ error }, 'Failed to load webhook subscriptions from database');
  }
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
    notificationLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to check compound opportunities');
  }
}

// Check for rebalance needs and create notifications
export async function checkRebalanceNeeds(): Promise<void> {
  try {
    const result = await subgraph.getRebalanceablePositions(100);
    const configs = (result as any)?.rangeConfigs || [];

    for (const config of configs) {
      if (!config.position) continue;

      const tokenId = config.position.tokenId;
      if (!tokenId) continue;

      try {
        const rebalanceCheck = await analytics.checkRebalanceNeed(tokenId);

        if (rebalanceCheck.needsRebalance) {
          await createNotification({
            type: 'rebalance_needed',
            severity: 'warning',
            title: 'Rebalance Recommended',
            message: `Position #${tokenId} is out of range. ${rebalanceCheck.reason}`,
            positionId: tokenId,
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
    notificationLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to check rebalance needs');
  }
}

// Webhook management (write-through: DB first, then in-memory)
export async function subscribeWebhook(subscription: Omit<WebhookSubscription, 'id' | 'createdAt'>): Promise<WebhookSubscription> {
  const newSubscription: WebhookSubscription = {
    ...subscription,
    id: `wh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: Date.now(),
  };

  // Persist to database first
  await createWebhookSubscription({
    id: newSubscription.id,
    url: newSubscription.url,
    events: newSubscription.events as string[],
    owner: newSubscription.owner,
    secret: newSubscription.secret,
    active: newSubscription.active,
  });

  // Then update in-memory Map
  const existing = webhookSubscriptions.get(subscription.owner) || [];
  existing.push(newSubscription);
  webhookSubscriptions.set(subscription.owner, existing);

  notificationLogger.info({ subscriptionId: newSubscription.id }, 'Webhook subscribed');

  return newSubscription;
}

export async function unsubscribeWebhook(owner: string, webhookId: string): Promise<boolean> {
  // Delete from database first
  await deleteWebhookSubscription(webhookId, owner);

  // Then remove from in-memory Map
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

// Webhook retry configuration
const WEBHOOK_RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1 second
  maxDelayMs: 4000, // 4 seconds
};

// Track webhook delivery status
interface WebhookDeliveryStatus {
  webhookId: string;
  notificationId: string;
  attempts: number;
  lastAttempt: number;
  status: 'pending' | 'success' | 'failed';
  lastError?: string;
}

const MAX_DELIVERY_LOG_SIZE = 500;
const webhookDeliveryLog: Map<string, WebhookDeliveryStatus> = new Map();

/**
 * Attempt to deliver a webhook with exponential backoff retry
 */
async function deliverWebhookWithRetry(
  subscription: WebhookSubscription,
  payload: Record<string, unknown>,
  notificationId: string
): Promise<boolean> {
  const deliveryKey = `${subscription.id}:${notificationId}`;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= WEBHOOK_RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(subscription.secret && { 'X-Webhook-Secret': subscription.secret }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        // Evict oldest entries if map is too large
        if (webhookDeliveryLog.size >= MAX_DELIVERY_LOG_SIZE) {
          const firstKey = webhookDeliveryLog.keys().next().value;
          if (firstKey) webhookDeliveryLog.delete(firstKey);
        }
        // Success - log and return
        webhookDeliveryLog.set(deliveryKey, {
          webhookId: subscription.id,
          notificationId,
          attempts: attempt,
          lastAttempt: Date.now(),
          status: 'success',
        });

        // Fire-and-forget: persist to DB
        upsertWebhookDelivery({
          webhookId: subscription.id,
          notificationId,
          attempts: attempt,
          status: 'success',
        }).catch(() => {});

        notificationLogger.debug(
          { webhookId: subscription.id, notificationId, attempt },
          'Webhook delivered successfully'
        );
        return true;
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
      notificationLogger.warn(
        { webhookId: subscription.id, attempt, status: response.status },
        'Webhook delivery failed, will retry'
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      notificationLogger.warn(
        { webhookId: subscription.id, attempt, error: lastError },
        'Webhook delivery error, will retry'
      );
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s)
    if (attempt < WEBHOOK_RETRY_CONFIG.maxAttempts) {
      const delay = Math.min(
        WEBHOOK_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
        WEBHOOK_RETRY_CONFIG.maxDelayMs
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Evict oldest entries if map is too large
  if (webhookDeliveryLog.size >= MAX_DELIVERY_LOG_SIZE) {
    const firstKey = webhookDeliveryLog.keys().next().value;
    if (firstKey) webhookDeliveryLog.delete(firstKey);
  }

  // All retries failed
  webhookDeliveryLog.set(deliveryKey, {
    webhookId: subscription.id,
    notificationId,
    attempts: WEBHOOK_RETRY_CONFIG.maxAttempts,
    lastAttempt: Date.now(),
    status: 'failed',
    lastError,
  });

  // Fire-and-forget: persist failure to DB
  upsertWebhookDelivery({
    webhookId: subscription.id,
    notificationId,
    attempts: WEBHOOK_RETRY_CONFIG.maxAttempts,
    status: 'failed',
    lastError,
  }).catch(() => {});

  notificationLogger.error(
    {
      webhookId: subscription.id,
      notificationId,
      attempts: WEBHOOK_RETRY_CONFIG.maxAttempts,
      lastError,
    },
    'Webhook delivery failed after all retries'
  );

  return false;
}

/**
 * Get recent webhook delivery failures for debugging
 */
export function getRecentWebhookFailures(limit: number = 20): WebhookDeliveryStatus[] {
  const failures: WebhookDeliveryStatus[] = [];
  for (const status of webhookDeliveryLog.values()) {
    if (status.status === 'failed') {
      failures.push(status);
    }
  }
  // Sort by lastAttempt descending and limit
  return failures
    .sort((a, b) => b.lastAttempt - a.lastAttempt)
    .slice(0, limit);
}

// Trigger webhooks for a notification with retry logic
async function triggerWebhooks(notification: Notification): Promise<void> {
  const owner = notification.owner || 'global';
  const subscriptions = webhookSubscriptions.get(owner) || [];

  const payload = {
    event: notification.type,
    notification,
    timestamp: Date.now(),
  };

  // Process webhooks in parallel (fire-and-forget with logging)
  const deliveryPromises = subscriptions
    .filter(sub => sub.active && sub.events.includes(notification.type))
    .map(subscription =>
      deliverWebhookWithRetry(subscription, payload, notification.id)
    );

  // Wait for all webhook deliveries to complete (or fail)
  // This is fire-and-forget from the notification creation perspective
  Promise.all(deliveryPromises).catch(error => {
    notificationLogger.error({ error }, 'Unexpected error in webhook delivery');
  });
}

// Notification service runner (to be called periodically)
// Deduplicates with bot runs - if bots recently checked the same positions,
// the blockchain calls will hit cache instead of making fresh RPC calls
const NOTIFICATION_CHECK_CACHE_KEY = 'notification_check_last_run';
const NOTIFICATION_CHECK_MIN_INTERVAL = 8 * 60 * 1000; // 8 minutes minimum between runs
let notificationCheckRunning = false; // Atomic lock to prevent concurrent runs

export async function runNotificationChecks(): Promise<void> {
  // Atomic lock — prevent concurrent execution from overlapping schedulers
  if (notificationCheckRunning) {
    notificationLogger.debug('Skipping notification checks - already running');
    return;
  }

  // Skip if we ran recently (prevents overlapping with bot cycles)
  const lastRun = memoryCache.get<number>(NOTIFICATION_CHECK_CACHE_KEY);
  if (lastRun && Date.now() - lastRun < NOTIFICATION_CHECK_MIN_INTERVAL) {
    notificationLogger.debug('Skipping notification checks - ran recently');
    return;
  }

  notificationCheckRunning = true;
  try {
    notificationLogger.info('Running notification checks');

    // Mark as running to prevent overlap
    memoryCache.set(NOTIFICATION_CHECK_CACHE_KEY, Date.now(), NOTIFICATION_CHECK_MIN_INTERVAL);

    await Promise.all([
      checkCompoundOpportunities(),
      checkRebalanceNeeds(),
      cleanup(30), // Clean up notifications older than 30 days
      cleanupOldDeliveries(7), // Clean up webhook deliveries older than 7 days
      cleanupOldPriceSamples(24), // Clean up price samples older than 24 hours
    ]);

    notificationLogger.info('Notification checks completed');
  } finally {
    notificationCheckRunning = false;
  }
}
