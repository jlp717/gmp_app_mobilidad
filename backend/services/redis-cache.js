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

function serializeForRedis(value) {
    return JSON.stringify(value, (_key, item) => {
        if (typeof item !== 'bigint') return item;
        const numeric = Number(item);
        return Number.isSafeInteger(numeric) ? numeric : String(item);
    });
}

// Configuration from environment - Redis connection settings
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_CONNECT_TIMEOUT_MS = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10) || 5000;
const REDIS_COMMAND_TIMEOUT_MS = parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS, 10) || 1000;

const REDIS_CONFIG = {
    url: process.env.REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`,
    password: REDIS_PASSWORD,
    disableOfflineQueue: process.env.REDIS_DISABLE_OFFLINE_QUEUE !== 'false',
    enableOfflineQueue: false,
    pingInterval: parseInt(process.env.REDIS_PING_INTERVAL_MS, 10) || 60000,
    socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        keepAlive: true,
        keepAliveInitialDelay: 10000,
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
const L1_MAX_SIZE = parseInt(process.env.L1_CACHE_MAX_SIZE, 10) || 10000;
const L1_TTL_MS = parseInt(process.env.L1_CACHE_TTL_MS, 10) || 60000;
const L1_STALE_TTL_MS = 3600000; // 1 hour — serve stale data for up to 1h while background refresh runs

// Pre-warm cache with frequently accessed keys
const FREQUENTLY_ACCESSED_KEYS = new Set([
    'dashboard:metrics:*:*:ALL:curr',
    'dashboard:metrics:*:*:ALL:prev',
    'dashboard:evolution:*',
    'clients:list:v6:ALL:',
    'master:vendedores:*',
    'master:products:*'
]);

class RedisCacheService {
    constructor() {
        this.client = null;
        this.subscriber = null;
        this.isConnected = false;
        this.pendingCommands = [];
        // Pattern subscribers: callbacks invoked on every received
        // cache:invalidate message whose pattern matches. Lets in-process
        // caches that live OUTSIDE this module (e.g. laclae ruteroConfigCache)
        // react to cross-instance invalidations without a require cycle.
        this._patternHooks = [];
        this.stats = {
            hits: { l1: 0, l2: 0 },
            misses: 0,
            sets: 0,
            invalidations: 0,
            byNamespace: {},
        };
    }

    _recordNamespace(namespace, field) {
        if (!namespace) return;
        if (!this.stats.byNamespace[namespace]) {
            this.stats.byNamespace[namespace] = { hits: 0, misses: 0, sets: 0 };
        }
        this.stats.byNamespace[namespace][field]++;
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
            // Main client for read/write
            this.client = Redis.createClient(REDIS_CONFIG);

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
            await this._withTimeout(this.client.connect(), REDIS_CONNECT_TIMEOUT_MS, 'connect');

            // Setup pub/sub only if connected
            try {
                this.subscriber = this.client.duplicate();
                await this._withTimeout(this.subscriber.connect(), REDIS_CONNECT_TIMEOUT_MS, 'subscriber connect');
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

                // Fan-out to external in-process caches (e.g. laclae
                // ruteroConfigCache) so they converge with this instance.
                if (pattern) {
                    for (const hook of this._patternHooks) {
                        try {
                            hook(pattern);
                        } catch (hookError) {
                            logger.warn(`[RedisCache] Pattern hook failed for ${pattern}: ${hookError.message}`);
                        }
                    }
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

    async _withTimeout(promise, timeoutMs, operation) {
        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`Redis ${operation} timeout after ${timeoutMs}ms`)),
                        timeoutMs
                    );
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
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
            L1_CACHE.delete(key);
            L1_CACHE.set(key, entry);
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
            this._recordNamespace(namespace, 'hits');
            return l1Value;
        }

        // Try L2 (Redis)
        if (this.isConnected) {
            try {
                const l2Value = await this._withTimeout(
                    this.client.get(fullKey),
                    REDIS_COMMAND_TIMEOUT_MS,
                    'get'
                );
                if (l2Value !== null) {
                    const parsed = JSON.parse(l2Value);
                    this.stats.hits.l2++;
                    this._recordNamespace(namespace, 'hits');
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
            this._recordNamespace(namespace, 'hits');
            logger.debug(`[RedisCache] Serving stale data for: ${fullKey}`);
            return staleValue;
        }

        this.stats.misses++;
        this._recordNamespace(namespace, 'misses');
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
        this._recordNamespace(namespace, 'sets');

        // Set L2 if connected
        if (!this.isConnected) {
            return true;
        }

        try {
            await this._withTimeout(
                this.client.setEx(fullKey, ttl, serializeForRedis(value)),
                REDIS_COMMAND_TIMEOUT_MS,
                'set'
            );
            return true;
        } catch (error) {
            logger.warn(`[RedisCache] Set error: ${error.message}`);
            return false;
        }
    }

    /**
     * Read an L2 value without consulting L1. This is intentionally narrow:
     * version markers used for atomic cache writes must always come from the
     * shared Redis instance, otherwise a PM2 worker could use an old marker.
     * Returns undefined when Redis is unavailable and null for a missing key.
     */
    async getRemote(namespace, key) {
        if (!this.isConnected || !this.client) return undefined;
        try {
            return await this._withTimeout(
                this.client.get(this._generateKey(namespace, key)),
                REDIS_COMMAND_TIMEOUT_MS,
                'remote get',
            );
        } catch (_) {
            return undefined;
        }
    }

    /**
     * Read a value only when its shared generation marker still matches.
     * The marker and payload are read in one Redis script so a PM2 worker
     * cannot observe a valid marker and then return an older payload after a
     * concurrent invalidation.
     * Returns undefined when Redis is unavailable, or an object describing a
     * version mismatch / matching cached value otherwise.
     */
    async getIfVersion(namespace, key, versionNamespace, versionKey, expectedVersion) {
        if (!this.isConnected || !this.client || typeof this.client.eval !== 'function') {
            return undefined;
        }
        const cacheFullKey = this._generateKey(namespace, key);
        const versionFullKey = this._generateKey(versionNamespace, versionKey);
        const script = [
            'local version = redis.call("GET", KEYS[1])',
            'if not version then version = "0" end',
            'if version ~= ARGV[1] then return {0, version} end',
            'local payload = redis.call("GET", KEYS[2])',
            'if not payload then return {1} end',
            'return {1, payload}',
        ].join('\n');
        try {
            const result = await this._withTimeout(
                this.client.eval(script, {
                    keys: [versionFullKey, cacheFullKey],
                    arguments: [String(expectedVersion)],
                }),
                REDIS_COMMAND_TIMEOUT_MS,
                'conditional get',
            );
            if (!Array.isArray(result) || result.length === 0) return undefined;
            if (Number(result[0]) !== 1) {
                return {
                    matched: false,
                    version: result[1] == null ? null : String(result[1]),
                };
            }
            if (result.length < 2 || result[1] == null) {
                this._recordNamespace(namespace, 'misses');
                return { matched: true, value: null };
            }
            const value = JSON.parse(String(result[1]));
            this.stats.hits.l2++;
            this._recordNamespace(namespace, 'hits');
            this._setL1(cacheFullKey, value, L1_TTL_MS);
            return { matched: true, value };
        } catch (_) {
            return undefined;
        }
    }

    /**
     * Increment a shared cache-generation marker. INCR is atomic across PM2
     * workers; the marker is deliberately outside normal finance key families.
     */
    async incrementVersion(namespace, key, ttl = TTL.LONG) {
        if (!this.isConnected || !this.client || typeof this.client.incr !== 'function') {
            return false;
        }
        let next;
        try {
            next = await this._withTimeout(
                this.client.incr(this._generateKey(namespace, key)),
                REDIS_COMMAND_TIMEOUT_MS,
                'version increment',
            );
        } catch (_) {
            return false;
        }
        try {
            await this._withTimeout(
                this.client.expire(this._generateKey(namespace, key), ttl),
                REDIS_COMMAND_TIMEOUT_MS,
                'version expiry',
            );
        } catch (_) {
            // A missing expiry is safe for correctness; the marker remains
            // monotonic and avoids serving an old snapshot.
        }
        return String(next);
    }

    /**
     * Atomically SETEX a cache value only while a shared version marker has
     * the expected value. This closes the delete-vs-in-flight-SET race that
     * ordinary pattern invalidation cannot close across PM2 workers.
     * Returns true when stored, false when the marker changed, and null when
     * Redis/EVAL is unavailable.
     */
    async setIfVersion(namespace, key, value, ttl, versionNamespace, versionKey, expectedVersion) {
        if (!this.isConnected || !this.client || typeof this.client.eval !== 'function') {
            return null;
        }
        const cacheFullKey = this._generateKey(namespace, key);
        const versionFullKey = this._generateKey(versionNamespace, versionKey);
        const script = [
            'local version = redis.call("GET", KEYS[1])',
            'if not version and ARGV[1] == "0" then',
            '  redis.call("SETEX", KEYS[1], ARGV[4], "0")',
            '  version = "0"',
            'end',
            'if version == ARGV[1] then',
            '  redis.call("SETEX", KEYS[2], ARGV[2], ARGV[3])',
            '  return 1',
            'end',
            'return 0',
        ].join('\n');
        try {
            const result = await this._withTimeout(
                this.client.eval(script, {
                    keys: [versionFullKey, cacheFullKey],
                    arguments: [
                        String(expectedVersion),
                        String(ttl),
                        serializeForRedis(value),
                        String(TTL.LONG),
                    ],
                }),
                REDIS_COMMAND_TIMEOUT_MS,
                'conditional set',
            );
            if (Number(result) !== 1) return false;
            const l1Key = cacheFullKey;
            this._setL1(l1Key, value, Number(ttl) * 1000);
            this.stats.sets++;
            this._recordNamespace(namespace, 'sets');
            return true;
        } catch (_) {
            return null;
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
                await this._withTimeout(
                    this.client.del(fullKey),
                    REDIS_COMMAND_TIMEOUT_MS,
                    'delete'
                );
            } catch (error) {
                logger.warn(`[RedisCache] Delete error: ${error.message}`);
            }
        }
    }

    /**
     * Acquire a short-lived distributed lock. Returns a token on success.
     */
    async acquireLock(namespace, key, ttlMs = 10000) {
        if (!this.isConnected) return null;
        const fullKey = this._generateKey(namespace, `lock:${key}`);
        const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

        try {
            const result = await this._withTimeout(
                this.client.set(fullKey, token, { NX: true, PX: ttlMs }),
                REDIS_COMMAND_TIMEOUT_MS,
                'lock'
            );
            return result === 'OK' ? token : null;
        } catch (error) {
            logger.debug(`[RedisCache] Lock unavailable for ${fullKey}: ${error.message}`);
            return null;
        }
    }

    /**
     * Release a distributed lock only when owned by the caller.
     */
    async releaseLock(namespace, key, token) {
        if (!this.isConnected || !token) return false;
        const fullKey = this._generateKey(namespace, `lock:${key}`);

        try {
            const current = await this._withTimeout(
                this.client.get(fullKey),
                REDIS_COMMAND_TIMEOUT_MS,
                'lock get'
            );
            if (current !== token) return false;
            await this._withTimeout(
                this.client.del(fullKey),
                REDIS_COMMAND_TIMEOUT_MS,
                'lock release'
            );
            return true;
        } catch (error) {
            logger.debug(`[RedisCache] Lock release failed for ${fullKey}: ${error.message}`);
            return false;
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
                await this._withTimeout(
                    this.client.publish('cache:invalidate', JSON.stringify({ pattern: fullPattern })),
                    REDIS_COMMAND_TIMEOUT_MS,
                    'publish invalidation'
                );

                const keys = [];
                // scanIterator only — a KEYS() fallback would block Redis O(N)
                // server-side on a big keyspace and leave L2 un-invalidated when
                // it times out. If the client lacks scanIterator, log and skip
                // rather than risk blocking the shared instance.
                if (typeof this.client.scanIterator === 'function') {
                    for await (const key of this.client.scanIterator({ MATCH: fullPattern, COUNT: 500 })) {
                        keys.push(key);
                        if (keys.length >= 500) {
                            await this._withTimeout(
                                this.client.del(keys.splice(0, keys.length)),
                                REDIS_COMMAND_TIMEOUT_MS,
                                'delete pattern batch'
                            );
                        }
                    }
                } else {
                    logger.warn(
                        `[RedisCache] scanIterator unavailable — skipping non-blocking pattern invalidation: ${pattern}`
                    );
                }
                if (keys.length > 0) {
                    await this._withTimeout(
                        this.client.del(keys),
                        REDIS_COMMAND_TIMEOUT_MS,
                        'delete pattern'
                    );
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

    async setMany(namespace, entries, ttl = TTL.DEFAULT) {
        if (!Array.isArray(entries) || entries.length === 0) return true;

        for (const { key, value } of entries) {
            this._setL1(this._generateKey(namespace, key), value, ttl * 1000);
            this.stats.sets++;
            this._recordNamespace(namespace, 'sets');
        }

        if (!this.isConnected) return true;

        try {
            const multi = this.client.multi();
            for (const { key, value } of entries) {
                multi.setEx(this._generateKey(namespace, key), ttl, serializeForRedis(value));
            }
            await this._withTimeout(multi.exec(), REDIS_COMMAND_TIMEOUT_MS, 'setMany');
            return true;
        } catch (error) {
            logger.warn(`[RedisCache] SetMany error: ${error.message}`);
            return false;
        }
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
                const keys = await this._withTimeout(
                    this.client.keys('gmp:*'),
                    REDIS_COMMAND_TIMEOUT_MS,
                    'keys flush'
                );
                if (keys.length > 0) {
                    await this._withTimeout(
                        this.client.del(keys),
                        REDIS_COMMAND_TIMEOUT_MS,
                        'flush delete'
                    );
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

    /**
     * Register a pattern hook: called with every invalidation pattern
     * received over the pub/sub channel, including ones published by other
     * instances. Intended for in-process caches living outside this module
     * (laclae ruteroConfigCache) so they can converge cluster-wide without
     * a require cycle into this file.
     * @param {(pattern: string) => void} hook
     * @returns {() => void} unregister function
     */
    onInvalidationPattern(hook) {
        if (typeof hook !== 'function') {
            throw new TypeError('onInvalidationPattern expects a function');
        }
        this._patternHooks.push(hook);
        return () => {
            const idx = this._patternHooks.indexOf(hook);
            if (idx !== -1) this._patternHooks.splice(idx, 1);
        };
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
    setManyCache: (ns, entries, ttl) => redisCache.setMany(ns, entries, ttl),
    deleteCache: (ns, key) => redisCache.delete(ns, key),
    invalidateCache: (pattern) => redisCache.invalidatePattern(pattern),
    invalidateCachePattern: (pattern) => redisCache.invalidatePattern(pattern),
    deleteCachePattern: (pattern) => redisCache.invalidatePattern(pattern), // Alias for clarity
    onInvalidationPattern: (hook) => redisCache.onInvalidationPattern(hook),
    getOrSetCache: (ns, key, fn, ttl) => redisCache.getOrSet(ns, key, fn, ttl),
    getCacheStats: () => redisCache.getStats(),
    getRedisClient: () => redisCache.client,
};
