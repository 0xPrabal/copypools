import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import compression from 'compression';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { positionsRouter } from './routes/positions.js';
import { poolsRouter } from './routes/pools.js';
import { analyticsRouter } from './routes/analytics.js';
import { automationRouter } from './routes/automation.js';
import { lendingRouter } from './routes/lending.js';
import { notificationsRouter } from './routes/notifications.js';
import { positionCacheRouter } from './routes/position-cache.js';
import { healthRouter } from './routes/health.js';
import { pricesRouter } from './routes/prices.js';
import { swapRouter } from './routes/swap.js';
import { initializeDatabase, healthCheck as dbHealthCheck, getStats as dbStats } from '../services/database.js';
import { memoryCache } from '../services/cache.js';
import { rpcManager } from '../services/rpc-manager.js';
import {
  apiRateLimiter,
  securityHeaders,
  requestTimeout,
} from './middleware/production.js';
import { correlationIdMiddleware } from './middleware/correlation.js';

const apiLogger = logger.child({ module: 'api' });

export function createServer() {
  const app = express();

  // Production middleware
  app.use(correlationIdMiddleware); // Add correlation ID to all requests
  app.use(securityHeaders);

  // CORS - whitelist known frontend origins, fallback to permissive for development
  const ALLOWED_ORIGINS = [
    'https://copypools.com',
    'https://www.copypools.com',
    'https://copypools-frontend.vercel.app',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: ALLOWED_ORIGINS.length > 0 && process.env.NODE_ENV === 'production'
      ? ALLOWED_ORIGINS
      : '*',
    credentials: ALLOWED_ORIGINS.length > 0 && process.env.NODE_ENV === 'production',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400, // Cache preflight for 24 hours
  }));
  app.use(compression() as unknown as RequestHandler); // Gzip compression for all responses
  app.use(express.json({ limit: '1mb' }));
  app.use(requestTimeout(30000)); // 30 second timeout
  app.use(apiRateLimiter); // Rate limiting

  // Note: Request logging is handled by correlationIdMiddleware

  // Health check routes (includes RPC health, rate limiting, cache status)
  app.use('/health', healthRouter);

  // Legacy detailed health check (for backwards compatibility)
  app.get('/health/detailed', async (_req: Request, res: Response) => {
    const dbHealth = await dbHealthCheck();
    const dbPoolStats = await dbStats();
    const cacheStats = memoryCache.getStats();
    const rpcStats = rpcManager.getStats();

    const hasHealthyRpc = rpcStats.rpcs.some(chain => chain.healthy > 0);
    const isHealthy = dbHealth.healthy && hasHealthyRpc;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: {
          ...dbHealth,
          pool: dbPoolStats,
        },
        cache: {
          size: cacheStats.size,
        },
        rpc: {
          status: hasHealthyRpc ? 'healthy' : 'degraded',
          chains: rpcStats.rpcs,
          rateLimit: rpcStats.rateLimit,
        },
      },
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      },
    });
  });

  // API routes
  app.use('/api/positions', positionsRouter);
  app.use('/api/pools', poolsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/automation', automationRouter);
  app.use('/api/lending', lendingRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/position-cache', positionCacheRouter);
  app.use('/api/prices', pricesRouter);
  app.use('/api/exchange', swapRouter); // Named 'exchange' to avoid ad blocker blocking 'swap' URLs

  // Error handling
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = (req as any).correlationId;
    apiLogger.error({ error: err.message, stack: err.stack, correlationId, path: req.path }, 'Request error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', requestId: correlationId });
    }
  });

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

export async function startServer() {
  // Initialize database for position caching
  try {
    await initializeDatabase();
    apiLogger.info('Database initialized for position caching');
  } catch (error) {
    apiLogger.warn({ error }, 'Database initialization failed - position caching disabled');
  }

  const app = createServer();
  // Railway sets PORT env var - use it directly, fallback to config
  const port = parseInt(process.env.PORT || config.PORT);
  const host = '0.0.0.0'; // Explicitly bind to all interfaces for Railway

  apiLogger.info({ port, host, envPort: process.env.PORT, configPort: config.PORT }, 'Starting HTTP server...');

  app.listen(port, host, () => {
    apiLogger.info({ port, host }, 'API server started and listening');
  });

  return app;
}
