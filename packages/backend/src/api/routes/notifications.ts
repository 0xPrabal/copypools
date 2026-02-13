import { Router, Request, Response } from 'express';
import * as notifications from '../../services/notifications.js';
import { logger } from '../../utils/logger.js';
import { validateAddress } from '../middleware/production.js';

const router = Router();
const routeLogger = logger.child({ route: 'notifications' });

// Get notifications for a user
router.get('/:address', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = '50' } = req.query;
    const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 200);

    const userNotifications = await notifications.getNotifications(address, parsedLimit);
    const unreadCount = await notifications.getUnreadCount(address);

    res.json({
      notifications: userNotifications,
      unreadCount,
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get notifications');
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
router.post('/:address/read/:notificationId', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address, notificationId } = req.params;
    const success = await notifications.markAsRead(address, notificationId);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Notification not found' });
    }
  } catch (error) {
    routeLogger.error({ error }, 'Failed to mark notification as read');
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Mark all notifications as read
router.post('/:address/read-all', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const count = await notifications.markAllAsRead(address);

    res.json({ success: true, markedCount: count });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to mark all as read');
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Subscribe to webhooks
router.post('/:address/webhooks', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { url, events, secret } = req.body;

    if (!url || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'url and events array are required' });
    }

    // Validate URL and prevent SSRF
    try {
      const parsedUrl = new URL(url);
      // Only allow HTTPS webhooks
      if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Webhook URL must use HTTPS' });
      }
      // Block private/internal hostnames
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];
      if (blockedHosts.includes(parsedUrl.hostname)) {
        return res.status(400).json({ error: 'Webhook URL cannot point to localhost or internal addresses' });
      }
      // Block private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
      const ipMatch = parsedUrl.hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipMatch) {
        const [, a, b] = ipMatch.map(Number);
        if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
          return res.status(400).json({ error: 'Webhook URL cannot point to private/internal IP addresses' });
        }
      }
    } catch {
      return res.status(400).json({ error: 'Invalid webhook URL' });
    }

    // Validate events
    const validEvents = [
      'compound_profitable',
      'rebalance_needed',
      'position_out_of_range',
      'high_fees_accumulated',
      'gas_price_low',
      'position_liquidatable',
      'compound_executed',
      'rebalance_executed',
    ];

    const invalidEvents = events.filter((e: string) => !validEvents.includes(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({
        error: `Invalid events: ${invalidEvents.join(', ')}`,
        validEvents,
      });
    }

    const subscription = notifications.subscribeWebhook({
      url,
      events,
      owner: address,
      secret,
      active: true,
    });

    res.status(201).json(subscription);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to subscribe webhook');
    res.status(500).json({ error: 'Failed to subscribe webhook' });
  }
});

// Get webhook subscriptions
router.get('/:address/webhooks', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const subscriptions = notifications.getWebhookSubscriptions(address);

    // Don't expose secrets
    const sanitized = subscriptions.map((s) => ({
      ...s,
      secret: s.secret ? '***' : undefined,
    }));

    res.json(sanitized);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get webhooks');
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// Delete webhook subscription
router.delete('/:address/webhooks/:webhookId', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address, webhookId } = req.params;
    const success = notifications.unsubscribeWebhook(address, webhookId);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Webhook not found' });
    }
  } catch (error) {
    routeLogger.error({ error }, 'Failed to delete webhook');
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Test webhook (send test notification)
router.post('/:address/webhooks/:webhookId/test', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address, webhookId } = req.params;
    const subscriptions = notifications.getWebhookSubscriptions(address);
    const subscription = subscriptions.find((s) => s.id === webhookId);

    if (!subscription) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Create a test notification
    await notifications.createNotification({
      type: 'compound_profitable',
      severity: 'info',
      title: 'Test Notification',
      message: 'This is a test notification from your Pools webhook.',
      owner: address,
      data: { test: true },
    });

    res.json({ success: true, message: 'Test notification sent' });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to send test webhook');
    res.status(500).json({ error: 'Failed to send test' });
  }
});

// Get available notification types
router.get('/types/available', async (_req: Request, res: Response) => {
  res.json({
    notificationTypes: [
      { type: 'compound_profitable', description: 'When compounding becomes profitable' },
      { type: 'rebalance_needed', description: 'When a position needs rebalancing' },
      { type: 'position_out_of_range', description: 'When a position goes out of range' },
      { type: 'high_fees_accumulated', description: 'When fees exceed a threshold' },
      { type: 'gas_price_low', description: 'When gas prices are favorable for operations' },
      { type: 'position_liquidatable', description: 'When a loan becomes liquidatable' },
      { type: 'compound_executed', description: 'When an auto-compound is executed' },
      { type: 'rebalance_executed', description: 'When an auto-rebalance is executed' },
      { type: 'position_created', description: 'When a new position is created' },
      { type: 'liquidity_increased', description: 'When liquidity is added to a position' },
      { type: 'liquidity_decreased', description: 'When liquidity is removed from a position' },
      { type: 'fees_collected', description: 'When fees are collected from a position' },
      { type: 'position_closed', description: 'When a position is fully closed' },
      { type: 'auto_compound_enabled', description: 'When auto-compound is enabled' },
      { type: 'auto_compound_disabled', description: 'When auto-compound is disabled' },
      { type: 'auto_range_enabled', description: 'When auto-range is enabled' },
      { type: 'auto_range_disabled', description: 'When auto-range is disabled' },
    ],
    severities: ['info', 'warning', 'critical'],
  });
});

// Create a user action notification
router.post('/:address/activity', validateAddress, async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { type, title, message, positionId, txHash, data } = req.body;

    // Validate required fields
    if (!type || !title || !message) {
      return res.status(400).json({ error: 'type, title, and message are required' });
    }

    // Validate notification type
    const validUserTypes = [
      'position_created',
      'liquidity_increased',
      'liquidity_decreased',
      'fees_collected',
      'position_closed',
      'auto_compound_enabled',
      'auto_compound_disabled',
      'auto_range_enabled',
      'auto_range_disabled',
      'compound_executed',
      'rebalance_executed',
    ];

    if (!validUserTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid notification type for user activity: ${type}`,
        validTypes: validUserTypes,
      });
    }

    const notification = await notifications.createNotification({
      type,
      severity: 'info',
      title,
      message,
      owner: address,
      positionId,
      data: { ...data, txHash },
    });

    routeLogger.info({ address, type, positionId }, 'User activity notification created');
    res.status(201).json(notification);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to create activity notification');
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

export { router as notificationsRouter };
