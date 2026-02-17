import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

const cacheLogger = logger.child({ module: 'cache' });

const REDIS_PREFIX = 'copypools:';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
}

interface CacheConfig {
  maxSize: number;
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 1000,
  cleanupIntervalMs: 60000,
};

// ============ L1: In-Memory Cache (sync reads, fast) ============

class InMemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: CacheConfig;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };
  private createdAt: number = Date.now();

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      this.config.cleanupIntervalMs
    );
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.metrics.misses++;
      this.metrics.expirations++;
      return null;
    }

    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.metrics.hits++;

    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    const now = Date.now();

    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data,
      expiresAt: now + ttlMs,
      createdAt: now,
      lastAccessed: now,
      accessCount: 1,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  deletePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.metrics.evictions++;
      cacheLogger.debug({ key: oldestKey }, 'LRU eviction');
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
        this.metrics.expirations++;
      }
    }

    if (cleaned > 0) {
      cacheLogger.debug(
        { cleaned, remaining: this.cache.size },
        'Cache cleanup completed'
      );
    }
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  getDetailedMetrics(): {
    size: number;
    maxSize: number;
    hitRate: number;
    missRate: number;
    hits: number;
    misses: number;
    evictions: number;
    expirations: number;
    oldestEntry: string | null;
    newestEntry: string | null;
    entriesByPrefix: Record<string, number>;
    memoryEstimateBytes: number;
    uptimeMs: number;
  } {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const hitRate = totalRequests > 0 ? this.metrics.hits / totalRequests : 0;
    const missRate = totalRequests > 0 ? this.metrics.misses / totalRequests : 0;

    let oldestEntry: { key: string; time: number } | null = null;
    let newestEntry: { key: string; time: number } | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldestEntry || entry.createdAt < oldestEntry.time) {
        oldestEntry = { key, time: entry.createdAt };
      }
      if (!newestEntry || entry.createdAt > newestEntry.time) {
        newestEntry = { key, time: entry.createdAt };
      }
    }

    const entriesByPrefix: Record<string, number> = {};
    for (const key of this.cache.keys()) {
      const underscoreIndex = key.indexOf('_');
      const prefix =
        underscoreIndex > 0
          ? key.substring(0, underscoreIndex + 1)
          : key.substring(0, Math.min(20, key.length));

      entriesByPrefix[prefix] = (entriesByPrefix[prefix] || 0) + 1;
    }

    let memoryEstimate = 0;
    for (const [key, entry] of this.cache.entries()) {
      memoryEstimate += key.length * 2 + 50;
      try {
        memoryEstimate += JSON.stringify(entry.data).length * 2;
      } catch {
        memoryEstimate += 100;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: Math.round(hitRate * 10000) / 10000,
      missRate: Math.round(missRate * 10000) / 10000,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      evictions: this.metrics.evictions,
      expirations: this.metrics.expirations,
      oldestEntry: oldestEntry
        ? new Date(oldestEntry.time).toISOString()
        : null,
      newestEntry: newestEntry
        ? new Date(newestEntry.time).toISOString()
        : null,
      entriesByPrefix,
      memoryEstimateBytes: memoryEstimate,
      uptimeMs: Date.now() - this.createdAt,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };
    cacheLogger.info('Cache metrics reset');
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  getTTL(key: string): number {
    const entry = this.cache.get(key);
    if (!entry) return -1;
    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : -1;
  }

  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    cacheLogger.info({ cleared: size }, 'Cache cleared');
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// ============ L2: Redis-Backed Cache (L1 in-memory + L2 Redis) ============

class RedisBackedCache {
  private l1: InMemoryCache;
  private redis: Redis | null = null;
  private connected: boolean = false;

  constructor() {
    this.l1 = new InMemoryCache();
  }

  async connect(url?: string): Promise<void> {
    if (!url) {
      cacheLogger.info('No REDIS_URL configured — using in-memory cache only');
      return;
    }

    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 10) return null; // Stop retrying after 10 attempts
          return Math.min(times * 200, 5000);
        },
        lazyConnect: true,
      });

      this.redis.on('connect', () => {
        this.connected = true;
        cacheLogger.info('Redis cache connected');
      });

      this.redis.on('error', (err) => {
        cacheLogger.warn({ err: err.message }, 'Redis error — falling back to in-memory');
        this.connected = false;
      });

      this.redis.on('close', () => {
        this.connected = false;
        cacheLogger.warn('Redis connection closed');
      });

      this.redis.on('reconnecting', () => {
        cacheLogger.info('Redis reconnecting...');
      });

      await this.redis.connect();
      this.connected = true;
    } catch (err) {
      cacheLogger.warn({ err }, 'Redis connection failed — using in-memory cache only');
      this.redis = null;
      this.connected = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // Ignore errors on shutdown
      }
      this.redis = null;
      this.connected = false;
      cacheLogger.info('Redis cache disconnected');
    }
    this.l1.destroy();
  }

  isRedisConnected(): boolean {
    return this.connected;
  }

  // ---- Sync API (reads L1 only — no caller changes needed) ----

  get<T>(key: string): T | null {
    return this.l1.get<T>(key);
  }

  // ---- Async API (L1 first, then L2 on miss) ----

  async getAsync<T>(key: string): Promise<T | null> {
    // Try L1 first
    const l1Value = this.l1.get<T>(key);
    if (l1Value !== null) return l1Value;

    // Try L2 (Redis)
    if (!this.connected || !this.redis) return null;

    try {
      const raw = await this.redis.get(REDIS_PREFIX + key);
      if (raw === null) return null;

      const data = JSON.parse(raw) as T;
      // Warm L1 with remaining TTL
      const ttl = await this.redis.pttl(REDIS_PREFIX + key);
      if (ttl > 0) {
        this.l1.set(key, data, ttl);
      }
      return data;
    } catch (err) {
      cacheLogger.debug({ err, key }, 'Redis getAsync error');
      return null;
    }
  }

  // ---- Write API (writes to both L1 and L2) ----

  set<T>(key: string, data: T, ttlMs: number): void {
    // Always write L1 (sync)
    this.l1.set(key, data, ttlMs);

    // Write L2 (fire-and-forget)
    if (this.connected && this.redis) {
      try {
        const serialized = JSON.stringify(data);
        this.redis.set(REDIS_PREFIX + key, serialized, 'PX', ttlMs).catch((err) => {
          cacheLogger.debug({ err, key }, 'Redis set error');
        });
      } catch (err) {
        cacheLogger.debug({ err, key }, 'Redis serialization error');
      }
    }
  }

  delete(key: string): void {
    this.l1.delete(key);

    if (this.connected && this.redis) {
      this.redis.del(REDIS_PREFIX + key).catch((err) => {
        cacheLogger.debug({ err, key }, 'Redis delete error');
      });
    }
  }

  deletePattern(pattern: string): void {
    // L1: regex-based
    this.l1.deletePattern(pattern);

    // L2: SCAN-based
    if (this.connected && this.redis) {
      const redisPattern = REDIS_PREFIX + pattern.replace(/\.\*/g, '*').replace(/\.\+/g, '*');
      const stream = this.redis.scanStream({ match: redisPattern, count: 100 });
      const keysToDelete: string[] = [];

      stream.on('data', (keys: string[]) => {
        keysToDelete.push(...keys);
      });

      stream.on('end', () => {
        if (keysToDelete.length > 0) {
          const pipeline = this.redis!.pipeline();
          for (const key of keysToDelete) {
            pipeline.del(key);
          }
          pipeline.exec().catch((err) => {
            cacheLogger.debug({ err, pattern }, 'Redis deletePattern pipeline error');
          });
        }
      });
    }
  }

  has(key: string): boolean {
    return this.l1.has(key);
  }

  getTTL(key: string): number {
    return this.l1.getTTL(key);
  }

  clear(): void {
    this.l1.clear();

    if (this.connected && this.redis) {
      const stream = this.redis.scanStream({ match: REDIS_PREFIX + '*', count: 100 });
      const keysToDelete: string[] = [];

      stream.on('data', (keys: string[]) => {
        keysToDelete.push(...keys);
      });

      stream.on('end', () => {
        if (keysToDelete.length > 0 && this.redis) {
          const pipeline = this.redis.pipeline();
          for (const key of keysToDelete) {
            pipeline.del(key);
          }
          pipeline.exec().catch((err) => {
            cacheLogger.debug({ err }, 'Redis clear pipeline error');
          });
        }
      });
    }
  }

  destroy(): void {
    this.l1.destroy();
  }

  // ---- Metrics ----

  getStats(): { size: number; keys: string[]; redisConnected: boolean } {
    const l1Stats = this.l1.getStats();
    return {
      ...l1Stats,
      redisConnected: this.connected,
    };
  }

  getDetailedMetrics() {
    const l1Metrics = this.l1.getDetailedMetrics();
    return {
      ...l1Metrics,
      redisConnected: this.connected,
      cacheMode: this.connected ? 'redis+memory' : 'memory-only',
    };
  }

  resetMetrics(): void {
    this.l1.resetMetrics();
  }
}

// Singleton cache instance
export const memoryCache = new RedisBackedCache();

// Cache keys
export const CACHE_KEYS = {
  positionCache: (address: string, chainId: number) =>
    `position_cache_${address.toLowerCase()}_${chainId}`,
  indexerState: () => 'indexer_state',
  poolTick: (poolId: string) => `pool_tick_${poolId}`,
  poolSlot0: (poolId: string) => `pool_slot0_${poolId}`,
  positionInfo: (tokenId: string) => `position_info_${tokenId}`,
  tokenPrice: (chainId: number, address: string) =>
    `price_${chainId}_${address.toLowerCase()}`,
  compoundProfitable: (tokenId: string) => `compound_profitable_${tokenId}`,
  pendingFees: (tokenId: string) => `pending_fees_${tokenId}`,
  gasPrice: () => 'gas_price',
  checkRebalance: (tokenId: string) => `check_rebalance_${tokenId}`,
  positionStatus: (tokenId: string) => `position_status_${tokenId}`,
  rangeConfig: (tokenId: string) => `range_config_${tokenId}`,
  rebalancedTo: (tokenId: string) => `rebalanced_to_${tokenId}`,
  positionLiquidity: (tokenId: string) => `position_liquidity_${tokenId}`,
};

// Default TTLs (aligned with bot intervals - bots run every 15 min, so short TTLs waste RPC)
export const CACHE_TTL = {
  POSITION_CACHE: 2 * 60 * 1000, // 2 minutes
  INDEXER_STATE: 60 * 1000, // 1 minute
  POOL_DATA: 5 * 60 * 1000, // 5 minutes - pools don't change often
  POOL_TICK: 3 * 60 * 1000, // 3 minutes (was 30s) - bots run every 15min, tick drift is gradual
  POOL_SLOT0: 3 * 60 * 1000, // 3 minutes (was 30s) - same data as pool tick
  POSITION_INFO: 5 * 60 * 1000, // 5 minutes (was 2min) - position tick range doesn't change
  TOKEN_PRICE: 5 * 60 * 1000, // 5 minutes - prices don't need real-time accuracy
  COMPOUND_PROFITABLE: 5 * 60 * 1000, // 5 minutes (was 60s) - aligns with bot interval
  PENDING_FEES: 3 * 60 * 1000, // 3 minutes (was 30s) - fees accrue slowly per block
  GAS_PRICE: 60 * 1000, // 1 minute (was 15s) - gas on Base is stable
  CHECK_REBALANCE: 5 * 60 * 1000, // 5 minutes (was 30s) - aligns with bot interval
  POSITION_STATUS: 3 * 60 * 1000, // 3 minutes (was 30s) - tick position changes slowly
  RANGE_CONFIG: 10 * 60 * 1000, // 10 minutes (was 2min) - config rarely changes
  REBALANCED_TO: 30 * 60 * 1000, // 30 minutes (was 5min) - immutable once set
  POSITION_LIQUIDITY: 3 * 60 * 1000, // 3 minutes (was 30s) - only changes on user actions
  CALCULATE_OPTIMAL_RANGE: 5 * 60 * 1000, // 5 minutes - depends on current tick, cached per bot run
  LAST_REBALANCE_TIME: 10 * 60 * 1000, // 10 minutes - only changes on rebalance
};
