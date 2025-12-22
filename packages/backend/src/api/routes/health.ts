/**
 * Health and monitoring endpoints
 * Provides system health, RPC status, and rate limit information
 */

import { Router, Request, Response } from 'express';
import { rpcManager } from '../../services/rpc-manager.js';
import { memoryCache } from '../../services/cache.js';
import * as database from '../../services/database.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const healthLogger = logger.child({ route: 'health' });

/**
 * Basic health check
 * GET /health
 */
router.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Check database connectivity
    const dbHealthy = database.isDatabaseAvailable();

    // Get RPC stats
    const rpcStats = rpcManager.getStats();

    // Check if any RPCs are healthy
    const hasHealthyRpc = rpcStats.rpcs.some(chain => chain.healthy > 0);

    const health = {
      status: dbHealthy && hasHealthyRpc ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: Date.now() - startTime,
      services: {
        database: dbHealthy ? 'healthy' : 'unavailable',
        rpc: hasHealthyRpc ? 'healthy' : 'degraded',
      },
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    healthLogger.error({ error }, 'Health check failed');
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

/**
 * Detailed RPC health status
 * GET /health/rpc
 */
router.get('/rpc', async (_req: Request, res: Response) => {
  try {
    const stats = rpcManager.getStats();
    const detailedHealth = rpcManager.getHealthStats();

    // Group by chain
    const byChain: Record<number, {
      healthy: string[];
      unhealthy: string[];
      avgResponseTime: number;
    }> = {};

    for (const [key, health] of Object.entries(detailedHealth)) {
      const [chainIdStr] = key.split(':');
      const chainId = parseInt(chainIdStr);

      if (!byChain[chainId]) {
        byChain[chainId] = { healthy: [], unhealthy: [], avgResponseTime: 0 };
      }

      if (health.isHealthy) {
        byChain[chainId].healthy.push(health.name);
      } else {
        byChain[chainId].unhealthy.push(health.name);
      }

      // Track average response time
      if (health.avgResponseTime > 0) {
        const current = byChain[chainId].avgResponseTime;
        const count = byChain[chainId].healthy.length + byChain[chainId].unhealthy.length;
        byChain[chainId].avgResponseTime = current + (health.avgResponseTime - current) / count;
      }
    }

    res.json({
      summary: stats,
      byChain,
      detailed: detailedHealth,
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get RPC health');
    res.status(500).json({ error: 'Failed to get RPC health' });
  }
});

/**
 * Rate limiter status
 * GET /health/rate-limit
 */
router.get('/rate-limit', async (_req: Request, res: Response) => {
  try {
    const stats = rpcManager.getRateLimitStats();

    res.json({
      availableTokens: stats.tokens,
      queueLength: stats.queueLength,
      status: stats.queueLength > 10 ? 'congested' : 'normal',
      recommendation: stats.queueLength > 20
        ? 'High queue length - consider reducing request volume'
        : 'Operating normally',
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get rate limit status');
    res.status(500).json({ error: 'Failed to get rate limit status' });
  }
});

/**
 * Cache status
 * GET /health/cache
 */
router.get('/cache', async (_req: Request, res: Response) => {
  try {
    const cacheStats = memoryCache.getStats();

    res.json({
      memoryCache: {
        size: cacheStats.size,
        keys: cacheStats.keys.length > 20
          ? cacheStats.keys.slice(0, 20).concat(['... and more'])
          : cacheStats.keys,
      },
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get cache status');
    res.status(500).json({ error: 'Failed to get cache status' });
  }
});

/**
 * Full system status (combines all health checks)
 * GET /health/full
 */
router.get('/full', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const [dbHealthy, rpcStats, cacheStats, rateLimitStats] = await Promise.all([
      Promise.resolve(database.isDatabaseAvailable()),
      Promise.resolve(rpcManager.getStats()),
      Promise.resolve(memoryCache.getStats()),
      Promise.resolve(rpcManager.getRateLimitStats()),
    ]);

    const hasHealthyRpc = rpcStats.rpcs.some(chain => chain.healthy > 0);
    const isHealthy = dbHealthy && hasHealthyRpc && rateLimitStats.queueLength < 50;

    res.json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      },
      services: {
        database: {
          status: dbHealthy ? 'healthy' : 'unavailable',
        },
        rpc: {
          status: hasHealthyRpc ? 'healthy' : 'degraded',
          chains: rpcStats.rpcs,
        },
        cache: {
          status: 'healthy',
          size: cacheStats.size,
        },
        rateLimit: {
          status: rateLimitStats.queueLength < 20 ? 'normal' : 'congested',
          tokens: rateLimitStats.tokens,
          queueLength: rateLimitStats.queueLength,
        },
      },
    });
  } catch (error) {
    healthLogger.error({ error }, 'Full health check failed');
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

export { router as healthRouter };
