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

const apiLogger = logger.child({ module: 'api' });

export function createServer() {
  const app = express();

  // Production middleware
  app.use(securityHeaders);
  app.use(cors());
  app.use(compression() as unknown as RequestHandler); // Gzip compression for all responses
  app.use(express.json({ limit: '1mb' }));
  app.use(requestTimeout(30000)); // 30 second timeout
  app.use(apiRateLimiter); // Rate limiting

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    apiLogger.debug({ method: req.method, path: req.path }, 'Request received');
    next();
  });

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
  app.use('/api/swap', swapRouter);

  // Error handling
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    apiLogger.error({ error: err.message }, 'Request error');
    res.status(500).json({ error: 'Internal server error' });
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
  const port = parseInt(config.PORT);

  app.listen(port, () => {
    apiLogger.info({ port }, 'API server started');
  });

  return app;
}
