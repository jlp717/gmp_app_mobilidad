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
const PREWARM_DEFAULT_CONCURRENCY = 5;
const PREWARM_MAX_CONCURRENCY = 10;

function getRedisCacheAdapter() {
  const redisCache = global.redisCache;
  if (!redisCache || typeof redisCache !== 'object') return null;

  const get = typeof redisCache.get === 'function'
    ? function getValue(key) { return redisCache.get(key); }
    : null;
  const set = typeof redisCache.setex === 'function'
    ? function setWithTtl(key, ttlSeconds, value) { return redisCache.setex(key, ttlSeconds, value); }
    : (typeof redisCache.set === 'function'
      ? async function setWithFallback(key, ttlSeconds, value) {
          try {
            return await redisCache.set(key, value, 'EX', ttlSeconds);
          } catch (_err) {
            return redisCache.set(key, value);
          }
        }
      : null);
  const del = typeof redisCache.del === 'function'
    ? function deleteKeyOrPattern(keyOrPattern) { return redisCache.del(keyOrPattern); }
    : null;

  if (!get && !set && !del) return null;
  return { get, set, del };
}
function parseCachedPayload(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

function safeFireAndForget(promiseLike) {
  if (promiseLike && typeof promiseLike.catch === 'function') {
    promiseLike.catch(() => {});
  }
}

class PerformanceCache {
  constructor() {
    this._l1Cache = new Map();
    this._l1AccessOrder = [];
    this._pendingFetches = new Map();
    this._stats = {
      l1Hits: 0,
      l2Hits: 0,
      coalesced: 0,
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
   * Compatibility wrapper for getOrFetch() — called by ddd-adapters.js
   * Handles multiple calling patterns:
   *   (key, fetchFn)           → default COMERCIAL TTL
   *   (key, fetchFn, number)   → convert seconds to ttlConfig
   *   (key, fetchFn, {l1,l2,l3}) → pass through to get()
   *   (key, fetchFn, {role, isAllQuery}) → compute TTL from role/query type
   */
  async getOrFetch(key, fetchFn, ttlSecOrConfig) {
    let ttlConfig;
    if (ttlSecOrConfig == null) {
      ttlConfig = TTL_CONFIG.COMERCIAL;
    } else if (typeof ttlSecOrConfig === 'number') {
      const s = Math.max(1, Math.floor(ttlSecOrConfig));
      ttlConfig = { l1: Math.min(s, 30), l2: s, l3: s * 2 };
    } else if (ttlSecOrConfig && typeof ttlSecOrConfig === 'object') {
      if (ttlSecOrConfig.l1 != null && ttlSecOrConfig.l2 != null) {
        ttlConfig = ttlSecOrConfig;
      } else if (ttlSecOrConfig.role) {
        const role = ttlSecOrConfig.role || 'COMERCIAL';
        ttlConfig = this.getTTL(role, !!ttlSecOrConfig.isAllQuery);
      } else {
        ttlConfig = TTL_CONFIG.COMERCIAL;
      }
    } else {
      ttlConfig = TTL_CONFIG.COMERCIAL;
    }
    return this.get(key, fetchFn, ttlConfig);
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
    const redisCache = getRedisCacheAdapter();
    if (redisCache?.get) {
      try {
        const l2Data = await redisCache.get(key);
        if (l2Data) {
          this._stats.l2Hits++;
          const parsed = parseCachedPayload(l2Data);
          this.setL1(key, parsed, ttlConfig.l1); // Populate L1 from L2
          return { data: parsed, source: 'L2', cached: true };
        }
      } catch (err) {
        // Redis unavailable, continue to fetch
      }
    }

    // Fetch fresh data
    const pendingFetch = this._pendingFetches.get(key);
    if (pendingFetch) {
      this._stats.coalesced++;
      const data = await pendingFetch;
      if (this._pendingFetches.get(key) === pendingFetch) {
        this.setL1(key, data, ttlConfig.l1);
      }
      return { data, source: 'COALESCED', cached: true };
    }

    this._stats.misses++;
    const fetchPromise = Promise.resolve().then(fetchFn);
    this._pendingFetches.set(key, fetchPromise);

    try {
      const data = await fetchPromise;

      if (this._pendingFetches.get(key) === fetchPromise) {
        // Populate both caches
        this.setL1(key, data, ttlConfig.l1);
        if (redisCache?.set) {
          try {
            await redisCache.set(key, ttlConfig.l2, JSON.stringify(data));
          } catch (err) {
            // Redis unavailable, L1 only
          }
        }
      }

      return { data, source: 'FETCH', cached: false };
    } finally {
      if (this._pendingFetches.get(key) === fetchPromise) {
        this._pendingFetches.delete(key);
      }
    }
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
    for (const key of this._pendingFetches.keys()) {
      if (key.includes(pattern)) {
        this._pendingFetches.delete(key);
      }
    }

    // L2 invalidation
    const redisCache = getRedisCacheAdapter();
    if (redisCache?.del) {
      safeFireAndForget(redisCache.del(pattern));
    }
  }

  /**
   * Invalidate ALL cache (for when data changes significantly)
   */
  invalidateAll() {
    this._l1Cache.clear();
    this._l1AccessOrder = [];
    this._pendingFetches.clear();
    const redisCache = getRedisCacheAdapter();
    if (redisCache?.del) {
      ['ALL:*', 'JEFE_VENTAS:*', 'ADMIN:*', 'COMERCIAL:*', 'REPARTIDOR:*'].forEach((safePattern) => {
        safeFireAndForget(redisCache.del(safePattern));
      });
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
      pendingFetches: this._pendingFetches.size,
      l1MaxEntries: MAX_L1_ENTRIES
    };
  }

  /**
   * Pre-warm cache for ALL queries (called during off-peak hours)
   */
  async preWarmAllQueries(fetchFns, options = {}) {
    const allTTL = TTL_CONFIG.JEFE_ALL;
    const redisCache = getRedisCacheAdapter();
    const configuredConcurrency = parseInt(options.batchSize ?? globalThis.process?.env?.PERFORMANCE_CACHE_PREWARM_BATCH_SIZE, 10);
    const batchSize = Math.min(
      PREWARM_MAX_CONCURRENCY,
      Math.max(1, Number.isFinite(configuredConcurrency) ? configuredConcurrency : PREWARM_DEFAULT_CONCURRENCY)
    );
    const warmCacheEntry = async function warmCacheEntry(entry) {
      const key = entry[0];
      const fetchFn = entry[1];
      try {
        const data = await fetchFn();
        this.setL1(`ALL:${key}`, data, allTTL.l1);
        if (redisCache?.set) {
          await redisCache.set(`ALL:${key}`, allTTL.l2, JSON.stringify(data));
        }
      } catch (err) {
        const logger = require("../../../../middleware/logger");
        logger.warn(`[PerformanceCache] Cache pre-warm failed for ${key}: ${err.message}`);
      }
    };
    const entries = Object.entries(fetchFns || {});
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize).map(function buildWarmTask(entry) {
        return warmCacheEntry.call(this, entry);
      }, this);
      await Promise.allSettled(batch);
    }
  }
}

// Singleton export
const performanceCache = new PerformanceCache();
module.exports = { performanceCache, TTL_CONFIG };
