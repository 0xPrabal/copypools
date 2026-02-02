import { logger } from '../utils/logger.js';

const cacheLogger = logger.child({ module: 'cache' });

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
    // Clean up expired entries periodically
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

    // Update access tracking for LRU
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.metrics.hits++;

    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    const now = Date.now();

    // Check if we need to evict entries before adding
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

  // Delete all keys matching a pattern (e.g., "position_cache_0x...")
  deletePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Evict the least recently used entry
   */
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

  /**
   * Clean up expired entries
   */
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

  /**
   * Get basic stats for health checks
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Get detailed metrics for observability
   */
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

    // Find oldest and newest entries
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

    // Count entries by prefix
    const entriesByPrefix: Record<string, number> = {};
    for (const key of this.cache.keys()) {
      // Extract prefix (everything before the first underscore or first 20 chars)
      const underscoreIndex = key.indexOf('_');
      const prefix =
        underscoreIndex > 0
          ? key.substring(0, underscoreIndex + 1)
          : key.substring(0, Math.min(20, key.length));

      entriesByPrefix[prefix] = (entriesByPrefix[prefix] || 0) + 1;
    }

    // Rough memory estimate (very approximate)
    let memoryEstimate = 0;
    for (const [key, entry] of this.cache.entries()) {
      // Key size + overhead
      memoryEstimate += key.length * 2 + 50;
      // Value size estimate
      try {
        memoryEstimate += JSON.stringify(entry.data).length * 2;
      } catch {
        memoryEstimate += 100; // fallback
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

  /**
   * Reset metrics (useful for monitoring windows)
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };
    cacheLogger.info('Cache metrics reset');
  }

  /**
   * Check if a key exists without updating access time
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get time until a key expires (in ms)
   * Returns -1 if key doesn't exist
   */
  getTTL(key: string): number {
    const entry = this.cache.get(key);
    if (!entry) return -1;
    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : -1;
  }

  /**
   * Clear all entries
   */
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

// Singleton cache instance
export const memoryCache = new InMemoryCache();

// Cache keys
export const CACHE_KEYS = {
  positionCache: (address: string, chainId: number) =>
    `position_cache_${address.toLowerCase()}_${chainId}`,
  indexerState: () => 'indexer_state',
  poolTick: (poolId: string) => `pool_tick_${poolId}`,
  positionInfo: (tokenId: string) => `position_info_${tokenId}`,
  tokenPrice: (chainId: number, address: string) =>
    `price_${chainId}_${address.toLowerCase()}`,
};

// Default TTLs
export const CACHE_TTL = {
  POSITION_CACHE: 60 * 1000, // 60 seconds - increased from 30s
  INDEXER_STATE: 60 * 1000, // 1 minute
  POOL_DATA: 5 * 60 * 1000, // 5 minutes - pools don't change often
  POOL_TICK: 15 * 1000, // 15 seconds - current tick changes frequently but not every call
  POSITION_INFO: 60 * 1000, // 60 seconds - position tick range doesn't change
  TOKEN_PRICE: 5 * 60 * 1000, // 5 minutes - prices don't need real-time accuracy
};
