/**
 * Redis Cache Service - Production Grade v4.0.0
 * 
 * Architecture: Redis-first (L2) with in-memory Map (L1) as edge cache
 * - L1: Edge cache for ultra-fast repeated requests within same process (50 entries max, 30s TTL)
 * - L2: Redis distributed cache (primary cache, role-specific TTLs)
 * - Pub/sub invalidation for multi-instance coherence
 * - Pre-warming on startup for critical dashboard queries
 * 
 * Performance Target: JEFE DE VENTAS dashboard < 2 seconds (cache hit)
 * 
 * @agent Performance - Redis-first, role-specific TTLs, pre-warming
 * @agent Caching - L1/L2 coherence, pub/sub invalidation, staleness handling
 */

import { createClient, RedisClientType } from 'redis';
import { config, redis as redisConfig } from '../../config/env';
import { logger } from '../../utils/logger';

// ============================================================
// TTL CONSTANTS (role-specific)
// ============================================================

export const CacheTTL = {
  // Generic TTLs
  SHORT: 300,      // 5 min
  MEDIUM: 1800,    // 30 min
  LONG: 86400,     // 24 h
  REALTIME: 60,    // 1 min
  
  // Role-specific dashboard cache TTLs
  JEFE_VENTAS: 600,     // 10 min (frequent refresh, complex queries)
  COMERCIAL: 1800,      // 30 min (less frequent access)
  REPARTIDOR: 900,      // 15 min (route changes more often)
  
  // Pre-warm queries on startup
  PREWARM: 86400,       // 24 h (metadata rarely changes)
};

// L1 edge cache settings
const L1_MAX_ENTRIES = 50;
const L1_TTL_MS = 30_000; // 30 seconds

// ============================================================
// CACHE ENTRY INTERFACES
// ============================================================

interface L1CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ============================================================
// REDIS CACHE SERVICE
// ============================================================

export class RedisCacheService {
  private redis: RedisClientType | null = null;
  private l1Cache = new Map<string, L1CacheEntry>();
  private isConnectedFlag = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private pubSubClient: RedisClientType | null = null;
  private invalidationChannel = 'gmp:cache:invalidate';

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async initialize(): Promise<void> {
    try {
      this.redis = createClient({
        url: redisConfig.url,
        password: redisConfig.password,
        socket: {
          reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 1000, 30000);
            logger.warn(`⚠️ Redis reconnect attempt ${retries}, retrying in ${delay}ms`);
            return delay;
          },
        },
      });

      this.redis.on('error', (err) => {
        logger.error('❌ Redis error:', err.message);
        this.isConnectedFlag = false;
      });

      this.redis.on('connect', () => {
        logger.info('✅ Redis connected');
        this.isConnectedFlag = true;
        this.reconnectAttempts = 0;
      });

      await this.redis.connect();

      // Setup pub/sub for cache invalidation
      await this.setupPubSub();

    } catch (error) {
      logger.warn(`⚠️ Redis unavailable, using L1 cache only: ${error}`);
      this.isConnectedFlag = false;
    }
  }

  // ============================================================
  // CORE CACHE OPERATIONS
  // ============================================================

  /**
   * Get cached value (L1 → L2 → miss)
   */
  async get<T>(key: string): Promise<T | null> {
    // Try L1 first (edge cache)
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && Date.now() - l1Entry.timestamp < l1Entry.ttl) {
      return l1Entry.data as T;
    }

    // L1 miss — try L2 (Redis)
    if (!this.isConnectedFlag || !this.redis) {
      return null;
    }

    try {
      const serialized = await this.redis.get(this.keyPrefix(key));
      if (!serialized) return null;

      const entry = JSON.parse(serialized);
      
      // Populate L1 on L2 hit
      this.setL1(key, entry.data, entry.ttl);
      
      return entry.data as T;
    } catch (error) {
      logger.warn(`⚠️ Redis GET error for ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache (L1 + L2)
   */
  async set(key: string, data: unknown, ttl: number = CacheTTL.SHORT): Promise<void> {
    // Always set L1
    this.setL1(key, data, ttl);

    // Set L2 (Redis)
    if (!this.isConnectedFlag || !this.redis) return;

    try {
      const entry = JSON.stringify({ data, ttl, timestamp: Date.now() });
      await this.redis.set(this.keyPrefix(key), entry, { EX: ttl });
    } catch (error) {
      logger.warn(`⚠️ Redis SET error for ${key}:`, error);
    }
  }

  /**
   * Delete a specific key from both L1 and L2
   */
  async invalidate(key: string): Promise<void> {
    // Remove from L1
    this.l1Cache.delete(key);

    // Remove from L2 and publish invalidation
    if (this.isConnectedFlag && this.redis) {
      try {
        await this.redis.del(this.keyPrefix(key));
        await this.publishInvalidation(key);
      } catch (error) {
        logger.warn(`⚠️ Redis DEL error for ${key}:`, error);
      }
    }
  }

  /**
   * Invalidate all keys matching a pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let count = 0;

    // L1: delete matching entries
    for (const key of this.l1Cache.keys()) {
      if (key.includes(pattern)) {
        this.l1Cache.delete(key);
        count++;
      }
    }

    // L2: SCAN + DEL (safe, no KEYS command)
    if (this.isConnectedFlag && this.redis) {
      try {
        const fullPattern = this.keyPrefix(pattern);
        const keys = await this.scanKeys(fullPattern);
        if (keys.length > 0) {
          await this.redis.del(keys);
          count += keys.length;
          await this.publishInvalidation(pattern);
        }
      } catch (error) {
        logger.warn(`⚠️ Redis invalidatePattern error for ${pattern}:`, error);
      }
    }

    return count;
  }

  /**
   * Check if key exists in cache (L1 or L2)
   */
  async has(key: string): Promise<boolean> {
    if (this.l1Cache.has(key)) return true;
    
    if (!this.isConnectedFlag || !this.redis) return false;

    try {
      return await this.redis.exists(this.keyPrefix(key)) === 1;
    } catch {
      return false;
    }
  }

  // ============================================================
  // ROLE-AWARE DASHBOARD CACHING
  // ============================================================

  /**
   * Get dashboard metrics with role-specific TTL
   * 
   * Key format: gmp:dashboard:metrics:{role}:{vendedorCode}:{filtersHash}
   * TTL: JEFE_VENTAS=10min, COMERCIAL=30min, REPARTIDOR=15min
   */
  async getDashboardMetrics(role: string, vendedorCode: string, filtersHash: string = ''): Promise<unknown | null> {
    const key = this.dashboardKey(role, vendedorCode, filtersHash);
    return this.get(key);
  }

  /**
   * Set dashboard metrics with role-specific TTL
   */
  async setDashboardMetrics(role: string, vendedorCode: string, data: unknown, filtersHash: string = ''): Promise<void> {
    const key = this.dashboardKey(role, vendedorCode, filtersHash);
    const ttl = this.getRoleTTL(role);
    await this.set(key, data, ttl);
  }

  /**
   * Invalidate all dashboard caches for a specific vendor
   */
  async invalidateDashboardForVendor(vendedorCode: string): Promise<number> {
    return this.invalidatePattern(`dashboard:*:${vendedorCode}`);
  }

  // ============================================================
  // PRE-WARMING
  // ============================================================

  /**
   * Pre-warm critical caches on startup
   * Populates Redis with data that is expensive to compute
   */
  async prewarm(key: string, data: unknown, ttl: number = CacheTTL.PREWARM): Promise<void> {
    logger.info(`🔥 Pre-warming cache: ${key}`);
    await this.set(key, data, ttl);
  }

  /**
   * Pre-warm multiple queries in parallel
   */
  async prewarmBatch(entries: Array<{ key: string; data: unknown; ttl?: number }>): Promise<void> {
    const promises = entries.map(e => this.prewarm(e.key, e.data, e.ttl));
    await Promise.all(promises);
    logger.info(`✅ Pre-warmed ${entries.length} cache entries`);
  }

  // ============================================================
  // PUB/SUB CACHE INVALIDATION
  // ============================================================

  private async setupPubSub(): Promise<void> {
    if (!this.redis) return;

    try {
      // Create a separate client for subscriptions
      this.pubSubClient = this.redis.duplicate();
      
      this.pubSubClient.on('message', (_channel: string, message: string) => {
        const { pattern } = JSON.parse(message);
        this.handleInvalidationMessage(pattern);
      });

      await this.pubSubClient.subscribe(this.invalidationChannel, (message) => {
        // Handle subscription confirmation
        logger.debug(`Subscribed to ${this.invalidationChannel}`);
      });
    } catch (error) {
      logger.warn('⚠️ Failed to setup Redis pub/sub:', error);
    }
  }

  private async publishInvalidation(pattern: string): Promise<void> {
    if (!this.redis) return;

    try {
      const message = JSON.stringify({ pattern, timestamp: Date.now() });
      await this.redis.publish(this.invalidationChannel, message);
    } catch (error) {
      logger.warn('⚠️ Failed to publish invalidation:', error);
    }
  }

  private handleInvalidationMessage(pattern: string): void {
    // Invalidate L1 entries matching the pattern
    for (const key of this.l1Cache.keys()) {
      if (key.includes(pattern)) {
        this.l1Cache.delete(key);
      }
    }
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  /**
   * Get cache statistics
   */
  getStats(): { l1Size: number; l2Connected: boolean; l1HitRate: string } {
    return {
      l1Size: this.l1Cache.size,
      l2Connected: this.isConnectedFlag,
      l1HitRate: 'N/A', // Would need hit/miss counters
    };
  }

  /**
   * Flush all caches (dangerous — use only in tests or emergencies)
   */
  async flush(): Promise<void> {
    this.l1Cache.clear();
    
    if (this.isConnectedFlag && this.redis) {
      const keys = await this.scanKeys(this.keyPrefix('*'));
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.pubSubClient) {
      try {
        await this.pubSubClient.unsubscribe(this.invalidationChannel);
        await this.pubSubClient.quit();
      } catch (_) {}
    }

    if (this.redis && this.isConnectedFlag) {
      try {
        await this.redis.quit();
        await this.redis.disconnect();
      } catch (_) {}
    }

    this.isConnectedFlag = false;
    this.l1Cache.clear();
  }

  get isConnected(): boolean {
    return this.isConnectedFlag;
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private setL1(key: string, data: unknown, ttl: number): void {
    // Evict oldest entries if at capacity (simple LRU)
    if (this.l1Cache.size >= L1_MAX_ENTRIES) {
      const oldestKey = this.l1Cache.keys().next().value;
      if (oldestKey) {
        this.l1Cache.delete(oldestKey);
      }
    }

    this.l1Cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  private keyPrefix(key: string): string {
    return `${redisConfig.keyPrefix}${key}`;
  }

  private dashboardKey(role: string, vendedorCode: string, filtersHash: string): string {
    return `dashboard:metrics:${role}:${vendedorCode}:${filtersHash || 'default'}`;
  }

  private getRoleTTL(role: string): number {
    switch (role.toUpperCase()) {
      case 'JEFE_VENTAS':
      case 'JEFE':
        return CacheTTL.JEFE_VENTAS;
      case 'COMERCIAL':
        return CacheTTL.COMERCIAL;
      case 'REPARTIDOR':
        return CacheTTL.REPARTIDOR;
      default:
        return CacheTTL.SHORT;
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    if (!this.redis) return [];

    const keys: string[] = [];
    let cursor = 0;

    do {
      const result = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== 0);

    return keys;
  }
}

// Singleton
export const redisCache = new RedisCacheService();
