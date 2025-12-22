/**
 * RPC Manager with Circuit Breaker, Rate Limiting, and Health Monitoring
 *
 * Features:
 * - Circuit breaker pattern for automatic RPC failover
 * - Coordinated rate limiting across all services
 * - Health monitoring with automatic recovery
 * - Client cache with TTL and invalidation
 */

import { createPublicClient, http, fallback, PublicClient, Chain } from 'viem';
import { base, sepolia } from 'viem/chains';
import { logger } from '../utils/logger.js';
import { rpcConfigsPerChain, RpcConfig } from '../config/rpc.js';

const rpcLogger = logger.child({ module: 'rpc-manager' });

// ============ Configuration ============

const CONFIG = {
  // Circuit Breaker
  FAILURE_THRESHOLD: 3,           // Failures before marking RPC as unhealthy
  SUCCESS_THRESHOLD: 2,           // Successes before marking RPC as healthy again
  HEALTH_CHECK_INTERVAL: 300_000, // Check unhealthy RPCs every 5 minutes (was 60s)
  CIRCUIT_RESET_TIMEOUT: 600_000, // Try unhealthy RPCs again after 10 minutes (was 5min)

  // Rate Limiting (Token Bucket) - optimized for low usage
  TOKENS_PER_SECOND: 5,           // Max RPC calls per second globally (was 15)
  BUCKET_SIZE: 20,                // Max burst capacity (was 50)
  REFILL_INTERVAL: 200,           // Refill tokens every 200ms (was 100ms)

  // Client Cache
  CLIENT_TTL: 600_000,            // Refresh clients every 10 minutes (was 5min)
  REQUEST_TIMEOUT: 30_000,        // 30 second timeout for all RPC calls
  RETRY_COUNT: 2,                 // Retry failed requests twice
};

// ============ Types ============

interface RpcHealth {
  url: string;
  name: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  totalRequests: number;
  totalFailures: number;
  avgResponseTime: number;
  lastChecked: number;
}

interface CachedClient {
  client: PublicClient;
  createdAt: number;
  chainId: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

// ============ RPC Health Tracker ============

class RpcHealthTracker {
  private healthMap = new Map<string, RpcHealth>();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHealthChecks();
  }

  private getKey(chainId: number, url: string): string {
    return `${chainId}:${url}`;
  }

  initialize(chainId: number, rpcs: RpcConfig[]): void {
    for (const rpc of rpcs) {
      const key = this.getKey(chainId, rpc.url);
      if (!this.healthMap.has(key)) {
        this.healthMap.set(key, {
          url: rpc.url,
          name: rpc.name,
          isHealthy: true,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          lastFailure: null,
          lastSuccess: null,
          totalRequests: 0,
          totalFailures: 0,
          avgResponseTime: 0,
          lastChecked: Date.now(),
        });
      }
    }
  }

  recordSuccess(chainId: number, url: string, responseTime: number): void {
    const key = this.getKey(chainId, url);
    const health = this.healthMap.get(key);
    if (!health) return;

    health.consecutiveSuccesses++;
    health.consecutiveFailures = 0;
    health.lastSuccess = Date.now();
    health.totalRequests++;

    // Update rolling average response time
    health.avgResponseTime = health.avgResponseTime === 0
      ? responseTime
      : (health.avgResponseTime * 0.9) + (responseTime * 0.1);

    // Recover from unhealthy state after SUCCESS_THRESHOLD successes
    if (!health.isHealthy && health.consecutiveSuccesses >= CONFIG.SUCCESS_THRESHOLD) {
      health.isHealthy = true;
      rpcLogger.info({ chainId, url: health.name }, 'RPC recovered to healthy state');
    }
  }

  recordFailure(chainId: number, url: string, error: string): void {
    const key = this.getKey(chainId, url);
    const health = this.healthMap.get(key);
    if (!health) return;

    health.consecutiveFailures++;
    health.consecutiveSuccesses = 0;
    health.lastFailure = Date.now();
    health.totalRequests++;
    health.totalFailures++;

    // Mark as unhealthy after FAILURE_THRESHOLD failures
    if (health.isHealthy && health.consecutiveFailures >= CONFIG.FAILURE_THRESHOLD) {
      health.isHealthy = false;
      rpcLogger.warn(
        { chainId, url: health.name, failures: health.consecutiveFailures, error },
        'RPC marked as unhealthy'
      );
    }
  }

  getHealthyRpcs(chainId: number): RpcConfig[] {
    const allRpcs = rpcConfigsPerChain[chainId] || [];
    const validRpcs = allRpcs.filter(r => r.url && r.url.length > 0);

    const healthyRpcs = validRpcs.filter(rpc => {
      const key = this.getKey(chainId, rpc.url);
      const health = this.healthMap.get(key);

      // If not tracked yet, assume healthy
      if (!health) return true;

      // Allow retry after CIRCUIT_RESET_TIMEOUT even if unhealthy
      if (!health.isHealthy && health.lastFailure) {
        const timeSinceFailure = Date.now() - health.lastFailure;
        if (timeSinceFailure > CONFIG.CIRCUIT_RESET_TIMEOUT) {
          rpcLogger.debug({ chainId, url: health.name }, 'Allowing unhealthy RPC retry after timeout');
          return true;
        }
      }

      return health.isHealthy;
    });

    // If all RPCs are unhealthy, return all to avoid complete failure
    if (healthyRpcs.length === 0) {
      rpcLogger.warn({ chainId }, 'All RPCs unhealthy, returning all for fallback');
      return validRpcs;
    }

    // Sort by response time (fastest first)
    return healthyRpcs.sort((a, b) => {
      const healthA = this.healthMap.get(this.getKey(chainId, a.url));
      const healthB = this.healthMap.get(this.getKey(chainId, b.url));
      return (healthA?.avgResponseTime || 0) - (healthB?.avgResponseTime || 0);
    });
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, CONFIG.HEALTH_CHECK_INTERVAL);
  }

  private async performHealthChecks(): Promise<void> {
    const unhealthyRpcs: Array<{ chainId: number; url: string; name: string }> = [];

    for (const [key, health] of this.healthMap.entries()) {
      if (!health.isHealthy) {
        const [chainIdStr] = key.split(':');
        unhealthyRpcs.push({
          chainId: parseInt(chainIdStr),
          url: health.url,
          name: health.name,
        });
      }
    }

    if (unhealthyRpcs.length === 0) return;

    rpcLogger.debug({ count: unhealthyRpcs.length }, 'Performing health checks on unhealthy RPCs');

    for (const rpc of unhealthyRpcs) {
      try {
        const start = Date.now();
        const response = await fetch(rpc.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = await response.json() as { result?: string };
          if (data.result) {
            this.recordSuccess(rpc.chainId, rpc.url, Date.now() - start);
          }
        }
      } catch {
        // Still unhealthy, no action needed
      }
    }
  }

  getStats(): Record<string, RpcHealth> {
    const stats: Record<string, RpcHealth> = {};
    for (const [key, health] of this.healthMap.entries()) {
      stats[key] = { ...health };
    }
    return stats;
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}

// ============ Rate Limiter (Token Bucket) ============

class RateLimiter {
  private state: RateLimitState;
  private refillInterval: NodeJS.Timeout | null = null;
  private waitingQueue: Array<{ resolve: () => void; timestamp: number }> = [];

  constructor() {
    this.state = {
      tokens: CONFIG.BUCKET_SIZE,
      lastRefill: Date.now(),
    };
    this.startRefillInterval();
  }

  private startRefillInterval(): void {
    this.refillInterval = setInterval(() => {
      this.refill();
      this.processQueue();
    }, CONFIG.REFILL_INTERVAL);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.state.lastRefill;
    const tokensToAdd = (elapsed / 1000) * CONFIG.TOKENS_PER_SECOND;

    this.state.tokens = Math.min(CONFIG.BUCKET_SIZE, this.state.tokens + tokensToAdd);
    this.state.lastRefill = now;
  }

  private processQueue(): void {
    while (this.waitingQueue.length > 0 && this.state.tokens >= 1) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        this.state.tokens--;
        waiter.resolve();
      }
    }
  }

  async acquire(): Promise<void> {
    // Try to get a token immediately
    if (this.state.tokens >= 1) {
      this.state.tokens--;
      return;
    }

    // Wait for a token
    return new Promise((resolve) => {
      this.waitingQueue.push({ resolve, timestamp: Date.now() });
    });
  }

  tryAcquire(): boolean {
    if (this.state.tokens >= 1) {
      this.state.tokens--;
      return true;
    }
    return false;
  }

  getStats(): { tokens: number; queueLength: number } {
    return {
      tokens: Math.floor(this.state.tokens),
      queueLength: this.waitingQueue.length,
    };
  }

  destroy(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
    }
    // Resolve all waiting promises
    for (const waiter of this.waitingQueue) {
      waiter.resolve();
    }
    this.waitingQueue = [];
  }
}

// ============ Client Cache ============

class ClientCache {
  private cache = new Map<number, CachedClient>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [chainId, cached] of this.cache.entries()) {
        if (now - cached.createdAt > CONFIG.CLIENT_TTL) {
          rpcLogger.debug({ chainId }, 'Invalidating cached client (TTL expired)');
          this.cache.delete(chainId);
        }
      }
    }, 60_000); // Check every minute
  }

  get(chainId: number): PublicClient | null {
    const cached = this.cache.get(chainId);
    if (!cached) return null;

    // Check if expired
    if (Date.now() - cached.createdAt > CONFIG.CLIENT_TTL) {
      this.cache.delete(chainId);
      return null;
    }

    return cached.client;
  }

  set(chainId: number, client: PublicClient): void {
    this.cache.set(chainId, {
      client,
      createdAt: Date.now(),
      chainId,
    });
  }

  invalidate(chainId: number): void {
    this.cache.delete(chainId);
    rpcLogger.debug({ chainId }, 'Client cache invalidated');
  }

  invalidateAll(): void {
    this.cache.clear();
    rpcLogger.info('All client caches invalidated');
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// ============ RPC Manager ============

class RpcManager {
  private healthTracker: RpcHealthTracker;
  private rateLimiter: RateLimiter;
  private clientCache: ClientCache;
  private chainDefinitions: Record<number, Chain> = {
    8453: base,
    11155111: sepolia,
  };

  constructor() {
    this.healthTracker = new RpcHealthTracker();
    this.rateLimiter = new RateLimiter();
    this.clientCache = new ClientCache();

    // Initialize health tracking for all configured chains
    for (const chainId of Object.keys(rpcConfigsPerChain)) {
      const id = parseInt(chainId);
      const rpcs = rpcConfigsPerChain[id] || [];
      const validRpcs = rpcs.filter(r => r.url && r.url.length > 0);
      this.healthTracker.initialize(id, validRpcs);
    }

    rpcLogger.info('RPC Manager initialized with circuit breaker and rate limiting');
  }

  /**
   * Get a public client for a chain with health-aware RPC selection
   */
  getClient(chainId: number): PublicClient {
    // Check cache first
    const cached = this.clientCache.get(chainId);
    if (cached) {
      return cached;
    }

    // Get healthy RPCs sorted by performance
    const healthyRpcs = this.healthTracker.getHealthyRpcs(chainId);

    if (healthyRpcs.length === 0) {
      throw new Error(`No RPCs available for chain ${chainId}`);
    }

    const chain = this.chainDefinitions[chainId];
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Create transport with healthy RPCs
    const transport = fallback(
      healthyRpcs.map(rpc =>
        http(rpc.url, {
          timeout: CONFIG.REQUEST_TIMEOUT,
          retryCount: CONFIG.RETRY_COUNT,
          onFetchRequest: async () => {
            // Rate limit before making request
            await this.rateLimiter.acquire();
          },
          onFetchResponse: async (response) => {
            // Track success or failure based on response status
            if (response.ok) {
              this.healthTracker.recordSuccess(chainId, rpc.url, 0);
            } else {
              // Record failure for non-OK HTTP responses (4xx, 5xx)
              this.healthTracker.recordFailure(
                chainId,
                rpc.url,
                `HTTP ${response.status}: ${response.statusText}`
              );
              // Invalidate client cache to force RPC re-selection on next call
              this.clientCache.invalidate(chainId);
            }
          },
        })
      ),
      { rank: true }
    );

    const client = createPublicClient({
      chain,
      transport,
    });

    // Cache the client
    this.clientCache.set(chainId, client);

    return client;
  }

  /**
   * Execute an RPC call with rate limiting and health tracking
   */
  async executeWithTracking<T>(
    chainId: number,
    rpcUrl: string,
    operation: () => Promise<T>
  ): Promise<T> {
    // Acquire rate limit token
    await this.rateLimiter.acquire();

    const start = Date.now();
    try {
      const result = await operation();
      this.healthTracker.recordSuccess(chainId, rpcUrl, Date.now() - start);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.healthTracker.recordFailure(chainId, rpcUrl, errorMessage);

      // Invalidate client cache on failure to force RPC re-selection
      this.clientCache.invalidate(chainId);

      throw error;
    }
  }

  /**
   * Invalidate client cache for a chain (useful when RPCs fail)
   */
  invalidateClient(chainId: number): void {
    this.clientCache.invalidate(chainId);
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats(): { tokens: number; queueLength: number } {
    return this.rateLimiter.getStats();
  }

  /**
   * Acquire a rate limit token (blocks until available)
   */
  async acquireRateLimit(): Promise<void> {
    return this.rateLimiter.acquire();
  }

  /**
   * Get health stats for all RPCs
   */
  getHealthStats(): Record<string, RpcHealth> {
    return this.healthTracker.getStats();
  }

  /**
   * Get summary stats
   */
  getStats(): {
    rateLimit: { tokens: number; queueLength: number };
    rpcs: {
      chainId: number;
      healthy: number;
      unhealthy: number;
      total: number;
    }[];
  } {
    const healthStats = this.healthTracker.getStats();
    const chainStats: Record<number, { healthy: number; unhealthy: number; total: number }> = {};

    for (const [key, health] of Object.entries(healthStats)) {
      const chainId = parseInt(key.split(':')[0]);
      if (!chainStats[chainId]) {
        chainStats[chainId] = { healthy: 0, unhealthy: 0, total: 0 };
      }
      chainStats[chainId].total++;
      if (health.isHealthy) {
        chainStats[chainId].healthy++;
      } else {
        chainStats[chainId].unhealthy++;
      }
    }

    return {
      rateLimit: this.rateLimiter.getStats(),
      rpcs: Object.entries(chainStats).map(([chainId, stats]) => ({
        chainId: parseInt(chainId),
        ...stats,
      })),
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.healthTracker.destroy();
    this.rateLimiter.destroy();
    this.clientCache.destroy();
    rpcLogger.info('RPC Manager destroyed');
  }
}

// ============ Singleton Export ============

export const rpcManager = new RpcManager();

// ============ Utility Functions ============

/**
 * Get a rate-limited, health-aware public client
 */
export function getHealthyClient(chainId: number): PublicClient {
  return rpcManager.getClient(chainId);
}

/**
 * Execute an operation with rate limiting (for batch operations)
 */
export async function withRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const limiter = rpcManager.getRateLimitStats();

  // Log warning if queue is building up
  if (limiter.queueLength > 10) {
    rpcLogger.warn({ queueLength: limiter.queueLength }, 'Rate limit queue building up');
  }

  // Acquire rate limit token before executing operation
  await rpcManager.acquireRateLimit();

  return operation();
}

/**
 * Execute batch operations with controlled concurrency
 */
export async function executeBatch<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  options: { batchSize?: number; delayBetweenBatches?: number } = {}
): Promise<R[]> {
  const { batchSize = 5, delayBetweenBatches = 200 } = options;
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await operation(item);
        } catch (error) {
          rpcLogger.error({ error, item }, 'Batch operation failed for item');
          return null as R;
        }
      })
    );

    results.push(...batchResults);

    // Delay between batches to avoid rate limiting
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return results;
}

/**
 * Cleanup on process exit
 */
process.on('SIGINT', () => {
  rpcManager.destroy();
});

process.on('SIGTERM', () => {
  rpcManager.destroy();
});
