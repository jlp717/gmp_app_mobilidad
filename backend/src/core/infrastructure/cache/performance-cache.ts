/**
 * Performance Cache Manager - Production Grade v4.0.0
 * 
 * Architecture: Redis-only (NO in-memory Map for production)
 * - L1: Redis distributed cache (primary)
 * - L2: Flutter Hive (device persistent)
 * 
 * NO in-memory Map L1 — forbidden in production per user requirement.
 * Role-specific TTLs: JEFE_ALL=300s, JEFE_INDIVIDUAL=600s, COMERCIAL=900s, REPARTIDOR=300s
 * 
 * @agent Performance - Redis-only, no Map, role-based TTLs
 */

import { redisCache, CacheTTL } from './redis-cache';
import { logger } from '../../../utils/logger';

// ============================================================
// TTL CONFIG (role-based, in seconds)
// ============================================================

const TTL_CONFIG = {
  JEFE_ALL: 300,           // 5min for ALL queries (Jefe de Ventas)
  JEFE_INDIVIDUAL: 600,    // 10min for individual vendor queries
  COMERCIAL: 900,          // 15min
  REPARTIDOR: 300,         // 5min
};

const MAX_RETRIES = 3;

// ============================================================
// PERFORMANCE CACHE
// ============================================================

export class PerformanceCache {
  private stats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
  };

  /**
   * Generate cache key for role-based caching
   */
  generateKey(endpoint: string, params: Record<string, string>, role: string): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');

    const isAllQuery = params.vendedorCodes === 'ALL';
    const prefix = isAllQuery ? 'ALL:' : `${role}:`;

    return `perf:${prefix}${endpoint}?${sortedParams}`;
  }

  /**
   * Get TTL for role and query type
   */
  getTTL(role: string, isAllQuery: boolean): number {
    if (role === 'JEFE_VENTAS' || role === 'JEFE') {
      return isAllQuery ? TTL_CONFIG.JEFE_ALL : TTL_CONFIG.JEFE_INDIVIDUAL;
    }
    if (role === 'REPARTIDOR') {
      return TTL_CONFIG.REPARTIDOR;
    }
    return TTL_CONFIG.COMERCIAL;
  }

  /**
   * Get cached data (Redis only)
   */
  async get<T>(key: string): Promise<T | null> {
    this.stats.totalRequests++;

    try {
      const data = await redisCache.get<T>(key);
      if (data) {
        this.stats.hits++;
        return data;
      }
    } catch (err) {
      logger.warn('PerformanceCache get error:', err);
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Set cached data (Redis only)
   */
  async set(key: string, data: unknown, ttl: number): Promise<void> {
    try {
      await redisCache.set(key, data, ttl);
    } catch (err) {
      logger.warn('PerformanceCache set error:', err);
    }
  }

  /**
   * Get with cascade: Redis → fetch → cache
   */
  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number
  ): Promise<{ data: T; source: string; cached: boolean }> {
    // Check cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return { data: cached, source: 'cache', cached: true };
    }

    // Fetch fresh data
    const data = await fetchFn();

    // Cache it
    await this.set(key, data, ttl);

    return { data, source: 'fetch', cached: false };
  }

  /**
   * Invalidate by pattern
   */
  async invalidate(pattern: string): Promise<number> {
    return redisCache.invalidatePattern(pattern);
  }

  /**
   * Invalidate ALL performance caches
   */
  async invalidateAll(): Promise<void> {
    await redisCache.invalidatePattern('perf:');
    logger.info('🗑️ Performance cache invalidated');
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, string | number> {
    const total = this.stats.totalRequests || 1;
    return {
      ...this.stats,
      hitRate: `${((this.stats.hits / total) * 100).toFixed(1)}%`,
      missRate: `${((this.stats.misses / total) * 100).toFixed(1)}%`,
    };
  }

  /**
   * Pre-warm critical queries
   */
  async preWarm(entries: Array<{ key: string; fetchFn: () => Promise<unknown>; ttl: number }>): Promise<void> {
    for (const entry of entries) {
      try {
        const data = await entry.fetchFn();
        await this.set(entry.key, data, entry.ttl);
        logger.info(`🔥 Pre-warmed: ${entry.key}`);
      } catch (err) {
        logger.warn(`Pre-warm failed for ${entry.key}:`, err);
      }
    }
  }
}

// Singleton
export const performanceCache = new PerformanceCache();
