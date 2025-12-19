import { logger } from '../utils/logger.js';

const cacheLogger = logger.child({ module: 'cache' });

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class InMemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
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

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      cacheLogger.debug({ cleaned, remaining: this.cache.size }, 'Cache cleanup completed');
    }
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
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
};

// Default TTLs
export const CACHE_TTL = {
  POSITION_CACHE: 60 * 1000, // 60 seconds - increased from 30s
  INDEXER_STATE: 60 * 1000, // 1 minute
  POOL_DATA: 5 * 60 * 1000, // 5 minutes - pools don't change often
  POOL_TICK: 15 * 1000, // 15 seconds - current tick changes frequently but not every call
  POSITION_INFO: 60 * 1000, // 60 seconds - position tick range doesn't change
};
