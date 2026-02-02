/**
 * Health and monitoring endpoints
 * Provides system health, RPC status, cache metrics, and memory usage
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

    // Add Retry-After header if degraded
    if (health.status === 'degraded') {
      res.setHeader('Retry-After', '30');
    }

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
 * Detailed cache metrics endpoint (Phase 4.1)
 * GET /health/cache
 */
router.get('/cache', async (_req: Request, res: Response) => {
  try {
    const metrics = memoryCache.getDetailedMetrics();

    res.json({
      size: metrics.size,
      maxSize: metrics.maxSize,
      hitRate: metrics.hitRate,
      missRate: metrics.missRate,
      hits: metrics.hits,
      misses: metrics.misses,
      evictions: metrics.evictions,
      expirations: metrics.expirations,
      oldestEntry: metrics.oldestEntry,
      newestEntry: metrics.newestEntry,
      entriesByPrefix: metrics.entriesByPrefix,
      memoryEstimateBytes: metrics.memoryEstimateBytes,
      memoryEstimateMB: Math.round(metrics.memoryEstimateBytes / 1024 / 1024 * 100) / 100,
      uptimeMs: metrics.uptimeMs,
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get cache metrics');
    res.status(500).json({ error: 'Failed to get cache metrics' });
  }
});

/**
 * Detailed RPC health status (Phase 4.2)
 * GET /health/rpc
 */
router.get('/rpc', async (_req: Request, res: Response) => {
  try {
    const detailedHealth = rpcManager.getDetailedHealth();
    const rateLimitStats = rpcManager.getRateLimitStats();
    const summaryStats = rpcManager.getStats();

    // Determine overall health status
    const healthy = detailedHealth.summary.healthyEndpoints > 0;

    // Group endpoints by chain
    const byChain: Record<number, {
      healthy: string[];
      unhealthy: string[];
      avgResponseTime: number;
    }> = {};

    for (const endpoint of detailedHealth.endpoints) {
      if (!byChain[endpoint.chainId]) {
        byChain[endpoint.chainId] = { healthy: [], unhealthy: [], avgResponseTime: 0 };
      }

      if (endpoint.healthy) {
        byChain[endpoint.chainId].healthy.push(endpoint.name);
      } else {
        byChain[endpoint.chainId].unhealthy.push(endpoint.name);
      }

      // Track average response time
      if (endpoint.latencyMs > 0) {
        const current = byChain[endpoint.chainId].avgResponseTime;
        const count = byChain[endpoint.chainId].healthy.length + byChain[endpoint.chainId].unhealthy.length;
        byChain[endpoint.chainId].avgResponseTime = current + (endpoint.latencyMs - current) / count;
      }
    }

    res.json({
      healthy,
      endpoints: detailedHealth.endpoints,
      summary: detailedHealth.summary,
      byChain,
      rateLimiter: {
        tokensAvailable: rateLimitStats.tokens,
        queueLength: rateLimitStats.queueLength,
        status: rateLimitStats.queueLength > 10 ? 'congested' : 'normal',
      },
      circuitBreaker: {
        state: healthy ? 'closed' : 'open',
        healthyEndpoints: detailedHealth.summary.healthyEndpoints,
        unhealthyEndpoints: detailedHealth.summary.unhealthyEndpoints,
      },
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get RPC health');
    res.status(500).json({ error: 'Failed to get RPC health' });
  }
});

/**
 * Memory usage endpoint (Phase 4.4)
 * GET /health/memory
 */
router.get('/memory', async (_req: Request, res: Response) => {
  try {
    const memUsage = process.memoryUsage();
    const cacheMetrics = memoryCache.getDetailedMetrics();

    res.json({
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal),
      heapUsedBytes: memUsage.heapUsed,
      heapTotalBytes: memUsage.heapTotal,
      external: formatBytes(memUsage.external),
      externalBytes: memUsage.external,
      rss: formatBytes(memUsage.rss),
      rssBytes: memUsage.rss,
      arrayBuffers: formatBytes(memUsage.arrayBuffers || 0),
      cacheSize: formatBytes(cacheMetrics.memoryEstimateBytes),
      cacheSizeBytes: cacheMetrics.memoryEstimateBytes,
      cacheEntries: cacheMetrics.size,
      uptime: process.uptime(),
      uptimeFormatted: formatUptime(process.uptime()),
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get memory stats');
    res.status(500).json({ error: 'Failed to get memory stats' });
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
 * Database health and query metrics
 * GET /health/database
 */
router.get('/database', async (_req: Request, res: Response) => {
  try {
    const dbHealth = await database.healthCheck();
    const dbStats = await database.getStats();
    const queryMetrics = database.getQueryMetrics();

    res.json({
      status: dbHealth.healthy ? 'healthy' : 'unhealthy',
      latencyMs: dbHealth.latencyMs,
      error: dbHealth.error,
      pool: {
        totalConnections: dbStats.totalConnections,
        idleConnections: dbStats.idleConnections,
        waitingClients: dbStats.waitingClients,
      },
      queries: {
        total: queryMetrics.totalQueries,
        slow: queryMetrics.slowQueries,
        errors: queryMetrics.errors,
        avgDurationMs: queryMetrics.avgDurationMs,
      },
    });
  } catch (error) {
    healthLogger.error({ error }, 'Failed to get database health');
    res.status(500).json({ error: 'Failed to get database health' });
  }
});

/**
 * Full system status (combines all health checks)
 * GET /health/full
 */
router.get('/full', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const [dbHealth, dbStats, queryMetrics, rpcStats, cacheMetrics, rateLimitStats] = await Promise.all([
      database.healthCheck(),
      database.getStats(),
      Promise.resolve(database.getQueryMetrics()),
      Promise.resolve(rpcManager.getStats()),
      Promise.resolve(memoryCache.getDetailedMetrics()),
      Promise.resolve(rpcManager.getRateLimitStats()),
    ]);

    const hasHealthyRpc = rpcStats.rpcs.some(chain => chain.healthy > 0);
    const isHealthy = dbHealth.healthy && hasHealthyRpc && rateLimitStats.queueLength < 50;

    const memUsage = process.memoryUsage();

    const response = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      uptime: process.uptime(),
      memory: {
        heapUsed: formatBytes(memUsage.heapUsed),
        heapTotal: formatBytes(memUsage.heapTotal),
        rss: formatBytes(memUsage.rss),
        external: formatBytes(memUsage.external),
      },
      services: {
        database: {
          status: dbHealth.healthy ? 'healthy' : 'unavailable',
          latencyMs: dbHealth.latencyMs,
          pool: dbStats,
          queries: queryMetrics,
        },
        rpc: {
          status: hasHealthyRpc ? 'healthy' : 'degraded',
          chains: rpcStats.rpcs,
          rateLimit: rpcStats.rateLimit,
        },
        cache: {
          status: 'healthy',
          size: cacheMetrics.size,
          maxSize: cacheMetrics.maxSize,
          hitRate: cacheMetrics.hitRate,
          evictions: cacheMetrics.evictions,
        },
        rateLimit: {
          status: rateLimitStats.queueLength < 20 ? 'normal' : 'congested',
          tokens: rateLimitStats.tokens,
          queueLength: rateLimitStats.queueLength,
        },
      },
    };

    // Add Retry-After header if degraded
    if (!isHealthy) {
      res.setHeader('Retry-After', '30');
    }

    res.status(isHealthy ? 200 : 503).json(response);
  } catch (error) {
    healthLogger.error({ error }, 'Full health check failed');
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format uptime to human-readable string
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export { router as healthRouter };
