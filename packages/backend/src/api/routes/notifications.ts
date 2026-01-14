import { Router, Request, Response } from 'express';
import * as notifications from '../../services/notifications.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const routeLogger = logger.child({ route: 'notifications' });

// Get notifications for a user
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = '50' } = req.query;

    const userNotifications = await notifications.getNotifications(address, parseInt(limit as string));
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
router.post('/:address/read/:notificationId', async (req: Request, res: Response) => {
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
router.post('/:address/read-all', async (req: Request, res: Response) => {
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
router.post('/:address/webhooks', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { url, events, secret } = req.body;

    if (!url || !events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'url and events array are required' });
    }

    // Validate URL
    try {
      new URL(url);
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
router.get('/:address/webhooks', async (req: Request, res: Response) => {
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
router.delete('/:address/webhooks/:webhookId', async (req: Request, res: Response) => {
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
router.post('/:address/webhooks/:webhookId/test', async (req: Request, res: Response) => {
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
    ],
    severities: ['info', 'warning', 'critical'],
  });
});

export { router as notificationsRouter };
