/**
 * GMP App - Redis Cache Service
 * ==============================
 * Multi-layer caching with Redis (L2) and in-memory (L1)
 * Includes pub/sub for cache invalidation
 */

const Redis = require('redis');
const logger = require('../middleware/logger');

// Configuration from environment
const REDIS_CONFIG = {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 20) {
                logger.error('[RedisCache] Max reconnection attempts reached');
                return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 100, 5000);
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

// L1 In-Memory Cache
const L1_CACHE = new Map();
const L1_MAX_SIZE = 500;
const L1_TTL_MS = 60000; // 1 minute

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
     * Initialize Redis connection
     */
    async init() {
        try {
            // Main client for read/write
            this.client = Redis.createClient(REDIS_CONFIG);

            // Subscriber client for pub/sub
            this.subscriber = this.client.duplicate();

            // Event handlers
            this.client.on('connect', () => {
                logger.info('[RedisCache] ✅ Connected to Redis');
                this.isConnected = true;
                this._flushPendingCommands();
            });

            this.client.on('error', (err) => {
                logger.error(`[RedisCache] ❌ Error: ${err.message}`);
                this.isConnected = false;
            });

            this.client.on('reconnecting', () => {
                logger.warn('[RedisCache] 🔄 Reconnecting...');
            });

            // Connect both clients
            await Promise.all([
                this.client.connect(),
                this.subscriber.connect(),
            ]);

            // Setup cache invalidation channel
            await this._setupInvalidationChannel();

            logger.info('[RedisCache] ✅ Redis cache service initialized');
            return true;
        } catch (error) {
            logger.warn(`[RedisCache] ⚠️ Redis unavailable, using L1 only: ${error.message}`);
            this.isConnected = false;
            return false;
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
        const regex = new RegExp(pattern.replace('*', '.*'));
        for (const key of L1_CACHE.keys()) {
            if (regex.test(key)) {
                L1_CACHE.delete(key);
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
            L1_CACHE.delete(key); // Expired
        }
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
        if (!this.isConnected) {
            this.stats.misses++;
            return null;
        }

        try {
            const l2Value = await this.client.get(fullKey);

            if (l2Value !== null) {
                const parsed = JSON.parse(l2Value);
                this.stats.hits.l2++;

                // Promote to L1
                this._setL1(fullKey, parsed);

                return parsed;
            }

            this.stats.misses++;
            return null;
        } catch (error) {
            logger.warn(`[RedisCache] Get error: ${error.message}`);
            this.stats.misses++;
            return null;
        }
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
        this._invalidateL1ByPattern(`gmp:${pattern}`);

        // Publish to all instances
        if (this.isConnected) {
            try {
                await this.client.publish('cache:invalidate', JSON.stringify({ pattern: `gmp:${pattern}` }));

                // Also delete from Redis
                const keys = await this.client.keys(`gmp:${pattern}`);
                if (keys.length > 0) {
                    await this.client.del(keys);
                }

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
        // Try cache first
        const cached = await this.get(namespace, key);
        if (cached !== null) {
            return cached;
        }

        // Fetch fresh data
        const freshData = await fetchFn();

        // Cache it
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
    deleteCachePattern: (pattern) => redisCache.invalidatePattern(pattern), // Alias for clarity
    getOrSetCache: (ns, key, fn, ttl) => redisCache.getOrSet(ns, key, fn, ttl),
    getCacheStats: () => redisCache.getStats(),
};
