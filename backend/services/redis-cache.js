/**
 * GMP App - Redis Cache Service
 * ==============================
 * Multi-layer caching with Redis (L2) and in-memory (L1)
 * Includes pub/sub for cache invalidation
 */

let Redis;
try {
    Redis = require('redis');
} catch (_) {
    Redis = null;
}
const logger = require('../middleware/logger');

// Configuration from environment - Redis connection settings
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

const REDIS_CONFIG = {
    url: process.env.REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`,
    password: REDIS_PASSWORD,
    socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                logger.warn('[RedisCache] Max retries reached, continuing without Redis');
                return false; // Stop reconnecting
            }
            return Math.min(retries * 200, 3000);
        },
    },
};

// TTL defaults (in seconds)
const TTL = {
    DEFAULT: parseInt(process.env.REDIS_TTL_DEFAULT, 10) || 3600,
    SHORT: 300,      // 5 minutes
    MEDIUM: 1800,    // 30 minutes
    LONG: 86400,     // 24 hours
    REALTIME: 60,    // 1 minute
};

// L1 In-Memory Cache (OPTIMIZED v3 - Maximum Performance)
const L1_CACHE = new Map();
const L1_STALE_CACHE = new Map(); // Stale-while-revalidate: serve expired data while refreshing
const L1_MAX_SIZE = 10000; // Doubled for JEFE_VENTAS + COMMERCIAL workloads
const L1_TTL_MS = 180000; // 3 minutes (increased for better cache utilization)
const L1_STALE_TTL_MS = 3600000; // 1 hour — serve stale data for up to 1h while background refresh runs

// Pre-warm cache with frequently accessed keys
const FREQUENTLY_ACCESSED_KEYS = new Set([
    'dashboard:metrics:*:*:ALL:curr',
    'dashboard:metrics:*:*:ALL:prev',
    'dashboard:evolution:*',
    'clients:list:v5:ALL:',
    'master:vendedores:*',
    'master:products:*'
]);

class RedisCacheService {
    constructor() {
        this.client = null;
        this.subscriber = null;
        this.isConnected = false;
        this.pendingCommands = [];
        this.stats = {
            hits: { l1: 0, l2: 0 },
            misses: 0,
            sets: 0,
            invalidations: 0,
        };
    }

    /**
     * Initialize Redis connection with OPTIMIZED pool settings
     */
    async init() {
        // Silently skip Redis init if the package failed to load
        if (!Redis) {
            logger.warn('[RedisCache] ⚠️ Redis package not available, using L1 cache only');
            return true;
        }
        try {
            // Optimized Redis config for high throughput
            const optimizedConfig = {
                ...REDIS_CONFIG,
                // Connection pool settings for high throughput
                connect_timeout: 10000,
                lazyConnect: false,
                // Keep-alive settings
                keepAlive: true,
                keepAliveInitialDelay: 10000,
                // Retry strategy for resilience
                max_retries_per_request: 3,
                enable_ready_check: true,
                enable_offline_queue: true,
            };

            // Main client for read/write
            this.client = Redis.createClient(optimizedConfig);

            // Event handlers
            this.client.on('connect', () => {
                logger.info('[RedisCache] ✅ Connected to Redis');
                this.isConnected = true;
                this._flushPendingCommands();
            });

            this.client.on('ready', () => {
                logger.info('[RedisCache] ✅ Redis ready for operations');
            });

            this.client.on('error', (err) => {
                // Only log critical errors, not connection issues
                if (err.message && !err.message.includes('ECONNREFUSED') && !err.message.includes('ETIMEDOUT')) {
                    logger.warn(`[RedisCache] ⚠️ Redis error: ${err.message}`);
                }
                this.isConnected = false;
            });

            this.client.on('reconnecting', () => {
                logger.warn('[RedisCache] 🔄 Redis reconnecting...');
            });

            // Connect with timeout
            await Promise.race([
                this.client.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 5000))
            ]);

            // Setup pub/sub only if connected
            try {
                this.subscriber = this.client.duplicate();
                await this._setupInvalidationChannel();
            } catch (e) {
                logger.warn('[RedisCache] ⚠️ Pub/sub unavailable, continuing without');
            }

            logger.info('[RedisCache] ✅ Redis cache service initialized');
            return true;
        } catch (error) {
            logger.warn(`[RedisCache] ⚠️ Redis unavailable, using L1 cache only: ${error.message}`);
            this.isConnected = false;
            // Continue without throwing - L1 cache still works
            return true;
        }
    }

    /**
     * Setup pub/sub for cache invalidation
     */
    async _setupInvalidationChannel() {
        const channel = 'cache:invalidate';

        await this.subscriber.subscribe(channel, (message) => {
            try {
                const { pattern, keys } = JSON.parse(message);

                if (pattern) {
                    this._invalidateL1ByPattern(pattern);
                } else if (keys) {
                    keys.forEach(key => L1_CACHE.delete(key));
                }

                this.stats.invalidations++;
                logger.info(`[RedisCache] 📢 Cache invalidation received: ${pattern || keys.join(', ')}`);
            } catch (e) {
                logger.warn(`[RedisCache] Invalid invalidation message: ${message}`);
            }
        });

        logger.info('[RedisCache] 📡 Subscribed to invalidation channel');
    }

    /**
     * Invalidate L1 cache by pattern
     */
    _invalidateL1ByPattern(pattern) {
        const escaped = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
        const regex = new RegExp(`^${escaped}$`);
        for (const cache of [L1_CACHE, L1_STALE_CACHE]) {
            for (const key of cache.keys()) {
                if (regex.test(key)) {
                    cache.delete(key);
                }
            }
        }
    }

    /**
     * Flush pending commands when connection is restored
     */
    async _flushPendingCommands() {
        while (this.pendingCommands.length > 0) {
            const { resolve, reject, fn } = this.pendingCommands.shift();
            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
    }

    /**
     * Generate cache key with namespace
     */
    _generateKey(namespace, key) {
        return `gmp:${namespace}:${key}`;
    }

    /**
     * Get from L1 cache
     */
    _getL1(key) {
        const entry = L1_CACHE.get(key);
        if (entry && Date.now() < entry.expiry) {
            this.stats.hits.l1++;
            return entry.value;
        }
        if (entry) {
            // Expired — move to stale cache for stale-while-revalidate
            L1_STALE_CACHE.set(key, {
                value: entry.value,
                expiry: Date.now() + L1_STALE_TTL_MS,
            });
            L1_CACHE.delete(key);
        }
        return null;
    }

    _getStale(key) {
        const stale = L1_STALE_CACHE.get(key);
        if (stale && Date.now() < stale.expiry) {
            return stale.value;
        }
        if (stale) L1_STALE_CACHE.delete(key);
        return null;
    }

    /**
     * Set in L1 cache with LRU eviction
     */
    _setL1(key, value, ttlMs = L1_TTL_MS) {
        // LRU eviction if at capacity
        if (L1_CACHE.size >= L1_MAX_SIZE) {
            const firstKey = L1_CACHE.keys().next().value;
            L1_CACHE.delete(firstKey);
        }

        L1_CACHE.set(key, {
            value,
            expiry: Date.now() + ttlMs,
        });
    }

    /**
     * Get value from cache (L1 -> L2)
     * @param {string} namespace - Cache namespace
     * @param {string} key - Cache key
     * @returns {Promise<any>} Cached value or null
     */
    async get(namespace, key) {
        const fullKey = this._generateKey(namespace, key);

        // Try L1 first
        const l1Value = this._getL1(fullKey);
        if (l1Value !== null) {
            return l1Value;
        }

        // Try L2 (Redis)
        if (this.isConnected) {
            try {
                const l2Value = await this.client.get(fullKey);
                if (l2Value !== null) {
                    const parsed = JSON.parse(l2Value);
                    this.stats.hits.l2++;
                    // Promote to L1 with full TTL
                    this._setL1(fullKey, parsed, L1_TTL_MS);
                    return parsed;
                }
            } catch (error) {
                logger.warn(`[RedisCache] Get error: ${error.message}`);
            }
        }

        // Stale-while-revalidate: serve expired data when fresh unavailable
        const staleValue = this._getStale(fullKey);
        if (staleValue !== null) {
            this.stats.hits.l1++; // Count as hit (better than nothing)
            logger.debug(`[RedisCache] Serving stale data for: ${fullKey}`);
            return staleValue;
        }

        this.stats.misses++;
        return null;
    }

    /**
     * Set value in cache (L1 + L2)
     * @param {string} namespace - Cache namespace
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - TTL in seconds (default: TTL.DEFAULT)
     */
    async set(namespace, key, value, ttl = TTL.DEFAULT) {
        const fullKey = this._generateKey(namespace, key);

        // Always set L1
        this._setL1(fullKey, value, ttl * 1000);
        this.stats.sets++;

        // Set L2 if connected
        if (!this.isConnected) {
            return true;
        }

        try {
            await this.client.setEx(fullKey, ttl, JSON.stringify(value));
            return true;
        } catch (error) {
            logger.warn(`[RedisCache] Set error: ${error.message}`);
            return false;
        }
    }

    /**
     * Delete value from cache
     * @param {string} namespace - Cache namespace
     * @param {string} key - Cache key
     */
    async delete(namespace, key) {
        const fullKey = this._generateKey(namespace, key);

        // Delete from L1
        L1_CACHE.delete(fullKey);

        // Delete from L2
        if (this.isConnected) {
            try {
                await this.client.del(fullKey);
            } catch (error) {
                logger.warn(`[RedisCache] Delete error: ${error.message}`);
            }
        }
    }

    /**
     * Invalidate by pattern (publishes to all instances)
     * @param {string} pattern - Pattern to match (e.g., "clients:*")
     */
    async invalidatePattern(pattern) {
        // Invalidate local L1
        const fullPattern = `gmp:${pattern}`;
        this._invalidateL1ByPattern(fullPattern);

        // Publish to all instances
        if (this.isConnected) {
            try {
                await this.client.publish('cache:invalidate', JSON.stringify({ pattern: fullPattern }));

                const keys = [];
                if (typeof this.client.scanIterator === 'function') {
                    for await (const key of this.client.scanIterator({ MATCH: fullPattern, COUNT: 500 })) {
                        keys.push(key);
                        if (keys.length >= 500) {
                            await this.client.del(keys.splice(0, keys.length));
                        }
                    }
                } else {
                    keys.push(...await this.client.keys(fullPattern));
                }
                if (keys.length > 0) await this.client.del(keys);

                logger.info(`[RedisCache] 🧹 Invalidated pattern: ${pattern} (${keys.length} keys)`);
            } catch (error) {
                logger.warn(`[RedisCache] Invalidate pattern error: ${error.message}`);
            }
        }

        this.stats.invalidations++;
    }

    /**
     * Get or set with callback (cache-aside pattern)
     * @param {string} namespace - Cache namespace
     * @param {string} key - Cache key
     * @param {Function} fetchFn - Function to fetch data if not cached
     * @param {number} ttl - TTL in seconds
     */
    async getOrSet(namespace, key, fetchFn, ttl = TTL.DEFAULT) {
        // Try cache first (includes stale-while-revalidate via get())
        const cached = await this.get(namespace, key);
        if (cached !== null) {
            return cached;
        }

        // Fetch fresh data
        const freshData = await fetchFn();

        // Cache the result (L1 + L2)
        await this.set(namespace, key, freshData, ttl);

        return freshData;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const totalHits = this.stats.hits.l1 + this.stats.hits.l2;
        const totalRequests = totalHits + this.stats.misses;

        return {
            ...this.stats,
            hitRate: totalRequests > 0 ? (totalHits / totalRequests * 100).toFixed(2) : 0,
            l1Size: L1_CACHE.size,
            l1MaxSize: L1_MAX_SIZE,
            isConnected: this.isConnected,
        };
    }

    /**
     * Clear all caches
     */
    async flush() {
        L1_CACHE.clear();

        if (this.isConnected) {
            try {
                const keys = await this.client.keys('gmp:*');
                if (keys.length > 0) {
                    await this.client.del(keys);
                }
                logger.info(`[RedisCache] 🧹 Flushed all caches (${keys.length} keys)`);
            } catch (error) {
                logger.warn(`[RedisCache] Flush error: ${error.message}`);
            }
        }
    }

    /**
     * Close connections
     */
    async close() {
        if (this.subscriber) {
            await this.subscriber.quit();
        }
        if (this.client) {
            await this.client.quit();
        }
        this.isConnected = false;
        logger.info('[RedisCache] Connections closed');
    }
}

// Singleton instance
const redisCache = new RedisCacheService();

// Export TTL constants and service
module.exports = {
    redisCache,
    TTL,
    // Convenience methods
    initCache: () => redisCache.init(),
    getCache: (ns, key) => redisCache.get(ns, key),
    setCache: (ns, key, val, ttl) => redisCache.set(ns, key, val, ttl),
    deleteCache: (ns, key) => redisCache.delete(ns, key),
    invalidateCache: (pattern) => redisCache.invalidatePattern(pattern),
    invalidateCachePattern: (pattern) => redisCache.invalidatePattern(pattern),
    deleteCachePattern: (pattern) => redisCache.invalidatePattern(pattern), // Alias for clarity
    getOrSetCache: (ns, key, fn, ttl) => redisCache.getOrSet(ns, key, fn, ttl),
    getCacheStats: () => redisCache.getStats(),
};
