/**
 * QUERY CACHE - Two-Tier Caching (L1 In-Memory + L2 Redis)
 *
 * Wraps any async fetcher with automatic cache:
 *   - L1: In-memory Map (60s TTL, max 500 entries, LRU eviction)
 *   - L2: Redis (configurable TTL, persistent across restarts)
 *   - Graceful degradation: works without Redis (L1 only)
 *
 * Usage:
 *   const data = await queryCache.getOrSet('gmp:dashboard:02', () => fetchFromDB(), TTL.MEDIUM);
 */

import { createClient, RedisClientType } from 'redis';
import { config } from '../config/env';
import { logger } from './logger';

// ============================================
// TTL CONSTANTS (seconds)
// ============================================

export const TTL = {
  REALTIME: 60,       // 1 min   - live metrics, entregas status
  SHORT: 120,         // 2 min   - ventas hoy, albaranes pendientes
  MEDIUM: 300,        // 5 min   - dashboard, facturas list
  LONG: 1800,         // 30 min  - rutero, conductores, formas pago
  STATIC: 86400,      // 24 h    - productos catalog, familias
  DEFAULT: config.redis.ttl.default,
} as const;

// ============================================
// L1 IN-MEMORY CACHE
// ============================================

interface L1Entry {
  value: string;       // JSON-serialized
  expiresAt: number;   // Date.now() + ttl
}

const L1_MAX_SIZE = 500;
const L1_TTL_MS = 60_000; // 1 minute

class L1Cache {
  private store = new Map<string, L1Entry>();

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: string): void {
    // LRU eviction when at capacity
    if (this.store.size >= L1_MAX_SIZE && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + L1_TTL_MS,
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  invalidatePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let count = 0;
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ============================================
// QUERY CACHE SERVICE
// ============================================

class QueryCacheService {
  private l1 = new L1Cache();
  private redis: RedisClientType | null = null;
  private isRedisConnected = false;
  private stats = {
    hits: { l1: 0, l2: 0 },
    misses: 0,
    sets: 0,
    errors: 0,
    invalidations: 0,
  };

  /**
   * Initialize Redis connection (non-blocking, graceful degradation)
   */
  async init(): Promise<void> {
    try {
      this.redis = createClient({
        url: config.redis.url,
        password: config.redis.password,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > 20) {
              logger.error('[CACHE] Max Redis reconnection attempts reached');
              return new Error('Max reconnection attempts');
            }
            return Math.min(retries * 100, 5000);
          },
        },
      });

      this.redis.on('connect', () => {
        logger.info('[CACHE] Redis connected');
        this.isRedisConnected = true;
      });

      this.redis.on('error', (err) => {
        if (this.isRedisConnected) {
          logger.warn(`[CACHE] Redis error: ${err.message}`);
        }
        this.isRedisConnected = false;
      });

      this.redis.on('reconnecting', () => {
        logger.debug('[CACHE] Redis reconnecting...');
      });

      await this.redis.connect();
    } catch (error) {
      logger.warn('[CACHE] Redis not available, using L1 (in-memory) only');
      this.redis = null;
      this.isRedisConnected = false;
    }
  }

  /**
   * Core cache-aside pattern: get from cache or fetch + store
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = TTL.DEFAULT
  ): Promise<T> {
    // 1. Try L1 (in-memory)
    const l1Value = this.l1.get(key);
    if (l1Value !== null) {
      this.stats.hits.l1++;
      return JSON.parse(l1Value) as T;
    }

    // 2. Try L2 (Redis)
    if (this.isRedisConnected && this.redis) {
      try {
        const l2Value = await this.redis.get(key);
        if (l2Value !== null) {
          this.stats.hits.l2++;
          // Promote to L1
          this.l1.set(key, l2Value);
          return JSON.parse(l2Value) as T;
        }
      } catch (err) {
        this.stats.errors++;
        // Redis error, continue to fetcher
      }
    }

    // 3. Cache miss - fetch from source
    this.stats.misses++;
    const result = await fetcher();

    // 4. Store in both tiers
    const serialized = JSON.stringify(result);
    this.l1.set(key, serialized);

    if (this.isRedisConnected && this.redis) {
      try {
        await this.redis.setEx(key, ttlSeconds, serialized);
        this.stats.sets++;
      } catch {
        this.stats.errors++;
      }
    }

    return result;
  }

  /**
   * Invalidate a specific key from both tiers
   */
  async invalidate(key: string): Promise<void> {
    this.l1.delete(key);

    if (this.isRedisConnected && this.redis) {
      try {
        await this.redis.del(key);
        this.stats.invalidations++;
      } catch {
        this.stats.errors++;
      }
    }
  }

  /**
   * Invalidate all keys matching a glob pattern
   * Pattern: 'gmp:dashboard:*' invalidates all dashboard cache
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let count = this.l1.invalidatePattern(pattern);

    if (this.isRedisConnected && this.redis) {
      try {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(keys);
          count += keys.length;
        }
        this.stats.invalidations += keys.length;
      } catch {
        this.stats.errors++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    hits: { l1: number; l2: number; total: number };
    misses: number;
    hitRate: string;
    sets: number;
    errors: number;
    invalidations: number;
    l1Size: number;
    redisConnected: boolean;
  } {
    const totalHits = this.stats.hits.l1 + this.stats.hits.l2;
    const totalRequests = totalHits + this.stats.misses;

    return {
      hits: {
        l1: this.stats.hits.l1,
        l2: this.stats.hits.l2,
        total: totalHits,
      },
      misses: this.stats.misses,
      hitRate: totalRequests > 0
        ? `${((totalHits / totalRequests) * 100).toFixed(1)}%`
        : '0.0%',
      sets: this.stats.sets,
      errors: this.stats.errors,
      invalidations: this.stats.invalidations,
      l1Size: this.l1.size,
      redisConnected: this.isRedisConnected,
    };
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
        logger.info('[CACHE] Redis disconnected');
      } catch {
        // Ignore close errors
      }
    }
    this.l1.clear();
  }

  /**
   * Check if cache service is operational (at least L1)
   */
  get isReady(): boolean {
    return true; // L1 always available
  }

  /**
   * Check if Redis L2 is connected
   */
  get hasRedis(): boolean {
    return this.isRedisConnected;
  }
}

// Singleton export
export const queryCache = new QueryCacheService();
