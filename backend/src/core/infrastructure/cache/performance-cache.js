/**
 * Performance Cache Manager - Multi-tier caching for JEFE DE VENTAS optimization
 * L1: In-memory Map (hot data, 30s TTL for ALL role)
 * L2: Redis (warm data, 5min TTL for ALL role)
 * L3: Flutter Hive (persistent cache on device)
 */

const TTL_CONFIG = {
  JEFE_ALL: { l1: 30, l2: 300, l3: 300 },       // 30s L1, 5min L2, 5min L3 for ALL queries
  JEFE_INDIVIDUAL: { l1: 60, l2: 600, l3: 1800 }, // 1min L1, 10min L2, 30min L3
  COMERCIAL: { l1: 120, l2: 900, l3: 3600 },      // 2min L1, 15min L2, 1h L3
  REPARTIDOR: { l1: 60, l2: 300, l3: 1800 }       // 1min L1, 5min L2, 30min L3
};

const MAX_L1_ENTRIES = 1000;
const MAX_L2_ENTRIES = 5000;

class PerformanceCache {
  constructor() {
    this._l1Cache = new Map();
    this._l1AccessOrder = [];
    this._stats = {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
      totalRequests: 0
    };
  }

  /**
   * Generate cache key optimized for role-based caching
   */
  generateKey(endpoint, params, role) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');
    
    const isAllQuery = params.vendedorCodes === 'ALL';
    const prefix = isAllQuery ? 'ALL:' : `${role}:`;
    
    return `${prefix}${endpoint}?${sortedParams}`;
  }

  /**
   * Get TTL configuration based on role and query type
   */
  getTTL(role, isAllQuery) {
    const config = TTL_CONFIG[role] || TTL_CONFIG.COMERCIAL;
    return isAllQuery ? { l1: config.l1, l2: config.l2, l3: config.l3 } : config;
  }

  /**
   * L1 Cache - Ultra-fast in-memory (Map-based with LRU eviction)
   */
  getL1(key) {
    const entry = this._l1Cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiry) {
      this._l1Cache.delete(key);
      return null;
    }

    // Update access order for LRU
    const idx = this._l1AccessOrder.indexOf(key);
    if (idx > -1) this._l1AccessOrder.splice(idx, 1);
    this._l1AccessOrder.push(key);

    return entry.data;
  }

  setL1(key, data, ttlSeconds = 60) {
    // LRU eviction
    if (this._l1Cache.size >= MAX_L1_ENTRIES) {
      const oldest = this._l1AccessOrder.shift();
      if (oldest) this._l1Cache.delete(oldest);
    }

    this._l1Cache.set(key, {
      data,
      expiry: Date.now() + (ttlSeconds * 1000),
      createdAt: Date.now()
    });
    this._l1AccessOrder.push(key);
  }

  /**
   * Get with cascade: L1 → L2 → fetch
   */
  async get(key, fetchFn, ttlConfig) {
    this._stats.totalRequests++;

    // L1 Check
    const l1Data = this.getL1(key);
    if (l1Data) {
      this._stats.l1Hits++;
      return { data: l1Data, source: 'L1', cached: true };
    }

    // L2 Check (Redis if available)
    if (global.redisCache) {
      try {
        const l2Data = await global.redisCache.get(key);
        if (l2Data) {
          this._stats.l2Hits++;
          const parsed = JSON.parse(l2Data);
          this.setL1(key, parsed, ttlConfig.l1); // Populate L1 from L2
          return { data: parsed, source: 'L2', cached: true };
        }
      } catch (err) {
        // Redis unavailable, continue to fetch
      }
    }

    // Fetch fresh data
    this._stats.misses++;
    const data = await fetchFn();

    // Populate both caches
    this.setL1(key, data, ttlConfig.l1);
    if (global.redisCache) {
      try {
        await global.redisCache.setex(key, ttlConfig.l2, JSON.stringify(data));
      } catch (err) {
        // Redis unavailable, L1 only
      }
    }

    return { data, source: 'FETCH', cached: false };
  }

  /**
   * Invalidate cache by pattern (for ALL queries, invalidate aggressively)
   */
  invalidate(pattern) {
    // L1 invalidation
    for (const key of this._l1Cache.keys()) {
      if (key.includes(pattern)) {
        this._l1Cache.delete(key);
        const idx = this._l1AccessOrder.indexOf(key);
        if (idx > -1) this._l1AccessOrder.splice(idx, 1);
      }
    }

    // L2 invalidation
    if (global.redisCache) {
      global.redisCache.del(pattern).catch(() => {});
    }
  }

  /**
   * Invalidate ALL cache (for when data changes significantly)
   */
  invalidateAll() {
    this._l1Cache.clear();
    this._l1AccessOrder = [];
    if (global.redisCache) {
      global.redisCache.flushdb().catch(() => {});
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this._stats.totalRequests || 1;
    return {
      ...this._stats,
      l1HitRate: ((this._stats.l1Hits / total) * 100).toFixed(1) + '%',
      l2HitRate: ((this._stats.l2Hits / total) * 100).toFixed(1) + '%',
      missRate: ((this._stats.misses / total) * 100).toFixed(1) + '%',
      l1Size: this._l1Cache.size,
      l1MaxEntries: MAX_L1_ENTRIES
    };
  }

  /**
   * Pre-warm cache for ALL queries (called during off-peak hours)
   */
  async preWarmAllQueries(fetchFns) {
    const allTTL = TTL_CONFIG.JEFE_ALL;
    for (const [key, fetchFn] of Object.entries(fetchFns)) {
      try {
        const data = await fetchFn();
        this.setL1(`ALL:${key}`, data, allTTL.l1);
        if (global.redisCache) {
          await global.redisCache.setex(`ALL:${key}`, allTTL.l2, JSON.stringify(data));
        }
      } catch (err) {
        console.error(`Cache pre-warm failed for ${key}:`, err.message);
      }
    }
  }
}

// Singleton export
const performanceCache = new PerformanceCache();
module.exports = { performanceCache, TTL_CONFIG };
