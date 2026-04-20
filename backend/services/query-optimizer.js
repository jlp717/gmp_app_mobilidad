/**
 * GMP App - Query Optimizer Service
 * ==================================
 * Query batching, caching, and performance optimization
 * Works with the existing ODBC connection pool
 * 
 * Enhanced with:
 * - Smart cache key generation (role, params hash, date range)
 * - Cache stampede prevention (mutex + stale-while-revalidate)
 * - Cache warming for hot queries
 * - Cache hit rate metrics
 * - Automatic invalidation (TTL + manual)
 */

const crypto = require('crypto');
const logger = require('../middleware/logger');
const { redisCache, TTL } = require('./redis-cache');

// Query statistics for optimization
const queryStats = new Map();
const STATS_RETENTION_MS = 3600000; // 1 hour

// Defensive: cached results may have been serialized before the DB-layer
// casing normalizer existed. Re-normalize on cache retrieval so every row
// exposes columns in both UPPERCASE and lowercase keys.
function normalizeCachedRowCasing(cached) {
    if (!Array.isArray(cached) || cached.length === 0) return cached;
    for (let i = 0; i < cached.length; i++) {
        const row = cached[i];
        if (!row || typeof row !== 'object') continue;
        const keys = Object.keys(row);
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const upper = key.toUpperCase();
            const lower = key.toLowerCase();
            if (upper !== key && !(upper in row)) row[upper] = row[key];
            if (lower !== key && !(lower in row)) row[lower] = row[key];
        }
    }
    return cached;
}

// Cache TTL categories (in seconds)
const CACHE_TTL = {
    SHORT: 60,        // 60s: Real-time metrics, pending orders
    MEDIUM: 300,     // 5min: Dashboard data, client summaries  
    LONG: 1800,       // 30min: Product catalogs, client lists
    STATIC: 3600,     // 1hr: Geographic data, configuration
};

// Cache key prefixes for invalidation tracking
const CACHE_PREFIXES = {
    DASHBOARD: 'dashboard',
    CLIENTS: 'clients',
    PEDIDOS: 'pedidos',
    ENTREGAS: 'entregas',
    COBROS: 'cobros',
    PRODUCTS: 'products',
    VENDEDORES: 'vendedores',
    COMMISSION: 'commission',
    ANALYTICS: 'analytics',
};

// Cache warming configuration
const WARM_QUERIES = [
    { prefix: CACHE_PREFIXES.DASHBOARD, pattern: 'metrics', ttl: CACHE_TTL.SHORT },
    { prefix: CACHE_PREFIXES.DASHBOARD, pattern: 'evolution', ttl: CACHE_TTL.MEDIUM },
    { prefix: CACHE_PREFIXES.CLIENTS, pattern: 'list', ttl: CACHE_TTL.LONG },
    { prefix: CACHE_PREFIXES.VENDEDORES, pattern: 'list', ttl: CACHE_TTL.STATIC },
];

/**
 * Cache stampede prevention - mutex locks for building cache
 */
class CacheStampedeLock {
    constructor() {
        this.locks = new Map();
        this.staleData = new Map();
        this.STALE_TTL_MS = 30000; // Serve stale for 30s while refreshing
    }

    /**
     * Try to acquire lock for cache key
     * @returns {boolean} true if lock acquired, false if already building
     */
    acquire(key) {
        if (this.locks.has(key)) {
            return false;
        }
        this.locks.set(key, Date.now());
        return true;
    }

    /**
     * Release lock and optionally store stale data
     */
    release(key, staleValue = null) {
        if (staleValue !== null) {
            this.staleData.set(key, {
                value: staleValue,
                expiry: Date.now() + this.STALE_TTL_MS
            });
        }
        this.locks.delete(key);
    }

    /**
     * Get stale data if available
     */
    getStale(key) {
        const stale = this.staleData.get(key);
        if (stale && Date.now() < stale.expiry) {
            return stale.value;
        }
        if (stale) {
            this.staleData.delete(key);
        }
        return null;
    }

    /**
     * Check if key is currently being built
     */
    isBuilding(key) {
        return this.locks.has(key);
    }

    /**
     * Get remaining lock time
     */
    getLockAge(key) {
        const lockTime = this.locks.get(key);
        if (lockTime) {
            return Date.now() - lockTime;
        }
        return 0;
    }
}

/**
 * Cache metrics collector
 */
class CacheMetrics {
    constructor() {
        this.metrics = {
            hits: { memory: 0, redis: 0, stale: 0 },
            misses: 0,
            sets: 0,
            invalidations: 0,
            stampedePrevention: 0,
            keyGenerations: 0,
        };
        this.queryTypeStats = new Map();
    }

    /**
     * Record a cache hit
     */
    recordHit(source, queryType = 'general') {
        if (source === 'memory') this.metrics.hits.memory++;
        else if (source === 'redis') this.metrics.hits.redis++;
        else if (source === 'stale') this.metrics.hits.stale++;
        this._updateQueryTypeStats(queryType, 'hit');
    }

    /**
     * Record a cache miss
     */
    recordMiss(queryType = 'general') {
        this.metrics.misses++;
        this._updateQueryTypeStats(queryType, 'miss');
    }

    /**
     * Record a cache set
     */
    recordSet(queryType = 'general') {
        this.metrics.sets++;
        this._updateQueryTypeStats(queryType, 'set');
    }

    /**
     * Record invalidation
     */
    recordInvalidation(count = 1) {
        this.metrics.invalidations += count;
    }

    /**
     * Record stampede prevention event
     */
    recordStampedePrevention() {
        this.metrics.stampedePrevention++;
    }

    /**
     * Update per-query-type statistics
     */
    _updateQueryTypeStats(queryType, event) {
        if (!this.queryTypeStats.has(queryType)) {
            this.queryTypeStats.set(queryType, { hits: 0, misses: 0, sets: 0 });
        }
        const stats = this.queryTypeStats.get(queryType);
        if (event === 'hit') stats.hits++;
        else if (event === 'miss') stats.misses++;
        else if (event === 'set') stats.sets++;
    }

    /**
     * Get hit rate percentage
     */
    getHitRate() {
        const total = this.getTotal();
        if (total === 0) return 0;
        return ((this.metrics.hits.memory + this.metrics.hits.redis) / total * 100).toFixed(2);
    }

    /**
     * Get total requests
     */
    getTotal() {
        return this.metrics.hits.memory + this.metrics.hits.redis + this.metrics.hits.stale + this.metrics.misses;
    }

    /**
     * Get full metrics report
     */
    getReport() {
        const total = this.getTotal();
        return {
            ...this.metrics,
            hitRate: this.getHitRate(),
            totalRequests: total,
            queryTypes: Object.fromEntries(this.queryTypeStats),
        };
    }

    /**
     * Reset metrics
     */
    reset() {
        this.metrics = {
            hits: { memory: 0, redis: 0, stale: 0 },
            misses: 0,
            sets: 0,
            invalidations: 0,
            stampedePrevention: 0,
            keyGenerations: 0,
        };
        this.queryTypeStats.clear();
    }
}

/**
 * Smart cache key generator
 */
class CacheKeyGenerator {
    /**
     * Generate a comprehensive cache key
     * @param {object} params - Key generation parameters
     * @returns {string} Generated cache key
     */
    static generate({ 
        prefix, 
        baseKey, 
        params = {}, 
        role = null, 
        vendorCode = 'ALL',
        dateFrom = null, 
        dateTo = null,
        extra = {}
    }) {
        const parts = [prefix, baseKey];

        if (role) {
            parts.push(`role:${role}`);
        }

        parts.push(`vendor:${vendorCode}`);

        if (dateFrom || dateTo) {
            const from = dateFrom ? new Date(dateFrom).toISOString().split('T')[0] : 'any';
            const to = dateTo ? new Date(dateTo).toISOString().split('T')[0] : 'any';
            parts.push(`range:${from}:${to}`);
        }

        if (Object.keys(params).length > 0) {
            const paramsHash = this._hashParams(params);
            parts.push(`params:${paramsHash}`);
        }

        if (Object.keys(extra).length > 0) {
            const extraHash = this._hashParams(extra);
            parts.push(`extra:${extraHash}`);
        }

        return parts.join(':');
    }

    /**
     * Hash parameters for consistent key generation
     */
    static _hashParams(params) {
        const sorted = JSON.stringify(params, Object.keys(params).sort());
        return crypto.createHash('md5').update(sorted).digest('hex').substring(0, 8);
    }

    /**
     * Generate pattern for invalidation
     */
    static generatePattern(prefix, baseKey = '*') {
        return `${prefix}:${baseKey}:*`;
    }
}

// Singleton instances
const stampedeLock = new CacheStampedeLock();
const cacheMetrics = new CacheMetrics();

/**
 * Query metadata for optimization decisions
 */
class QueryOptimizer {
    constructor() {
        this.batchQueue = new Map();
        this.batchTimeout = 50; // ms to wait for batching
        this.maxBatchSize = 100;
        this.warmedKeys = new Set();
    }

    /**
     * Record query execution for analysis
     */
    recordQuery(sql, duration, rowCount) {
        const key = this._normalizeSQL(sql);
        const now = Date.now();

        let stats = queryStats.get(key);
        if (!stats) {
            stats = {
                count: 0,
                totalDuration: 0,
                avgDuration: 0,
                maxDuration: 0,
                minDuration: Infinity,
                lastRun: now,
                avgRows: 0,
                samples: [],
            };
            queryStats.set(key, stats);
        }

        stats.count++;
        stats.totalDuration += duration;
        stats.avgDuration = stats.totalDuration / stats.count;
        stats.maxDuration = Math.max(stats.maxDuration, duration);
        stats.minDuration = Math.min(stats.minDuration, duration);
        stats.lastRun = now;
        stats.avgRows = (stats.avgRows * (stats.count - 1) + rowCount) / stats.count;

        // Keep last 10 samples for analysis
        stats.samples.push({ duration, rowCount, timestamp: now });
        if (stats.samples.length > 10) {
            stats.samples.shift();
        }

        // Cleanup old entries
        this._cleanupStats();
    }

    /**
     * Normalize SQL for consistent hashing
     */
    _normalizeSQL(sql) {
        return sql
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 200);
    }

    /**
     * Cleanup old statistics
     */
    _cleanupStats() {
        const cutoff = Date.now() - STATS_RETENTION_MS;
        for (const [key, stats] of queryStats.entries()) {
            if (stats.lastRun < cutoff) {
                queryStats.delete(key);
            }
        }
    }

    /**
     * Get slow queries for analysis
     */
    getSlowQueries(thresholdMs = 1000) {
        const slow = [];
        for (const [sql, stats] of queryStats.entries()) {
            if (stats.avgDuration > thresholdMs) {
                slow.push({
                    sql,
                    avgDuration: Math.round(stats.avgDuration),
                    maxDuration: stats.maxDuration,
                    count: stats.count,
                    avgRows: Math.round(stats.avgRows),
                });
            }
        }
        return slow.sort((a, b) => b.avgDuration - a.avgDuration);
    }

    /**
     * Get query statistics
     */
    getStats() {
        const allStats = [];
        for (const [sql, stats] of queryStats.entries()) {
            allStats.push({
                sql: sql.substring(0, 50) + '...',
                count: stats.count,
                avgDuration: Math.round(stats.avgDuration),
                avgRows: Math.round(stats.avgRows),
            });
        }
        return allStats.sort((a, b) => b.count - a.count);
    }

    /**
     * Suggest indexes based on query patterns
     */
    suggestIndexes() {
        const suggestions = [];

        for (const [sql, stats] of queryStats.entries()) {
            // Only analyze frequently slow queries
            if (stats.count < 10 || stats.avgDuration < 500) continue;

            // Extract WHERE clause columns
            const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|GROUP|LIMIT|$)/i);
            if (whereMatch) {
                const whereClause = whereMatch[1];
                const columns = whereClause.match(/([A-Z_]+)\s*[=<>]/gi);
                if (columns) {
                    suggestions.push({
                        sql: sql.substring(0, 100),
                        avgDuration: Math.round(stats.avgDuration),
                        suggestedColumns: columns.map(c => c.replace(/[=<>\s]/g, '')),
                    });
                }
            }
        }

        return suggestions;
    }

    /**
     * Get cache metrics
     */
    getCacheMetrics() {
        return cacheMetrics.getReport();
    }

    /**
     * Reset cache metrics
     */
    resetCacheMetrics() {
        cacheMetrics.reset();
    }

    /**
     * Invalidate cache by prefix (for data mutations)
     */
    async invalidateByPrefix(prefix) {
        const pattern = `${prefix}:*`;
        await redisCache.invalidatePattern(pattern);
        cacheMetrics.recordInvalidation();
        logger.info(`[QueryOptimizer] 🗑️ Invalidated cache prefix: ${prefix}`);
    }

    /**
     * Invalidate cache by multiple prefixes
     */
    async invalidateByPrefixes(prefixes) {
        for (const prefix of prefixes) {
            await this.invalidateByPrefix(prefix);
        }
    }

    /**
     * Warm cache for hot queries
     * @param {Function} queryFn - Query function to warm cache
     * @param {Array} warmConfigs - Array of warm query configurations
     * @param {object} context - Context (role, vendorCode, etc.)
     */
    async warmCache(queryFn, warmConfigs, context = {}) {
        const results = [];
        
        for (const config of warmConfigs) {
            const cacheKey = CacheKeyGenerator.generate({
                prefix: config.prefix,
                baseKey: config.pattern,
                role: context.role,
                vendorCode: context.vendorCode || 'ALL',
                ...context
            });

            if (this.warmedKeys.has(cacheKey)) {
                logger.debug(`[QueryOptimizer] Cache already warmed: ${cacheKey}`);
                continue;
            }

            try {
                const cached = await redisCache.get('query', cacheKey);
                if (cached !== null) {
                    this.warmedKeys.add(cacheKey);
                    continue;
                }

                if (config.queryFn) {
                    const data = await config.queryFn();
                    await redisCache.set('query', cacheKey, data, config.ttl);
                    results.push({ key: cacheKey, success: true });
                    this.warmedKeys.add(cacheKey);
                    logger.info(`[QueryOptimizer] 🔥 Warmed cache: ${cacheKey}`);
                }
            } catch (error) {
                results.push({ key: cacheKey, success: false, error: error.message });
                logger.warn(`[QueryOptimizer] Cache warming failed for ${cacheKey}: ${error.message}`);
            }
        }

        return results;
    }

    /**
     * Get warmed cache keys
     */
    getWarmedKeys() {
        return Array.from(this.warmedKeys);
    }
}

// Create singleton instance
const queryOptimizer = new QueryOptimizer();

/**
 * Smart cached query with stampede prevention
 * @param {Function} queryFn - Query function to execute
 * @param {string} sql - SQL query string
 * @param {object} options - Cache options
 * @param {string} options.cacheKey - Base cache key
 * @param {string} options.prefix - Cache prefix (for invalidation)
 * @param {number} options.ttl - TTL in seconds
 * @param {string} options.role - User role (JEFE_VENTAS, COMERCIAL, REPARTIDOR)
 * @param {string} options.vendorCode - Vendor code
 * @param {object} options.params - Query parameters for key generation
 * @param {string} options.dateFrom - Date range start
 * @param {string} options.dateTo - Date range end
 * @param {string} options.queryType - Query type for metrics
 * @param  {...any} args - Additional arguments passed to queryFn
 */
async function cachedQuery(queryFn, sql, options = {}, ...args) {
    const {
        cacheKey = 'default',
        prefix = 'query',
        ttl = CACHE_TTL.MEDIUM,
        role = null,
        vendorCode = 'ALL',
        params = {},
        dateFrom = null,
        dateTo = null,
        queryType = 'general',
        skipCache = false,
    } = options;

    if (skipCache) {
        const start = Date.now();
        const result = await queryFn(sql, ...args);
        const duration = Date.now() - start;
        queryOptimizer.recordQuery(sql, duration, result.length || 0);
        return result;
    }

    const fullCacheKey = CacheKeyGenerator.generate({
        prefix,
        baseKey: cacheKey,
        params,
        role,
        vendorCode,
        dateFrom,
        dateTo,
    });

    // Try cache first
    const cached = await redisCache.get('query', fullCacheKey);
    if (cached !== null) {
        logger.debug(`[QueryOptimizer] Cache HIT: ${fullCacheKey}`);
        cacheMetrics.recordHit('redis', queryType);
        return normalizeCachedRowCasing(cached);
    }

    // Check if another process is building this cache (stampede prevention)
    if (stampedeLock.isBuilding(fullCacheKey)) {
        const staleData = stampedeLock.getStale(fullCacheKey);
        if (staleData !== null) {
            cacheMetrics.recordHit('stale', queryType);
            logger.debug(`[QueryOptimizer] Serving stale data while refreshing: ${fullCacheKey}`);
            return staleData;
        }

        // Wait briefly for cache to be built
        const lockAge = stampedeLock.getLockAge(fullCacheKey);
        if (lockAge < 5000) { // Max wait 5s
            await new Promise(resolve => setTimeout(resolve, 100));
            const retryCached = await redisCache.get('query', fullCacheKey);
            if (retryCached !== null) {
                cacheMetrics.recordHit('redis', queryType);
                return retryCached;
            }
        }

        cacheMetrics.recordStampedePrevention();
        logger.debug(`[QueryOptimizer] Stampede prevention triggered: ${fullCacheKey}`);
    }

    // Try to acquire lock
    if (!stampedeLock.acquire(fullCacheKey)) {
        // Return stale if available, otherwise execute without caching
        const staleData = stampedeLock.getStale(fullCacheKey);
        if (staleData !== null) {
            cacheMetrics.recordHit('stale', queryType);
            return staleData;
        }
    }

    try {
        // Execute query
        const start = Date.now();
        const result = await queryFn(sql, ...args);
        const duration = Date.now() - start;

        // Record stats
        queryOptimizer.recordQuery(sql, duration, result.length || 0);

        // Cache result
        await redisCache.set('query', fullCacheKey, result, ttl);
        cacheMetrics.recordSet(queryType);
        logger.info(`[QueryOptimizer] 💾 Cached: ${fullCacheKey} (${result.length} rows, ${duration}ms)`);

        return result;
    } catch (error) {
        throw error;
    } finally {
        // Release lock
        stampedeLock.release(fullCacheKey);
    }
}

/**
 * Legacy cached query wrapper for backward compatibility
 */
async function cachedQueryLegacy(queryFn, sql, cacheKey, ttl = TTL.MEDIUM, ...args) {
    return cachedQuery(queryFn, sql, {
        cacheKey,
        ttl,
        params: args.length > 0 ? { args } : {},
    }, ...args);
}

/**
 * Batch similar queries to reduce database load
 */
class QueryBatcher {
    constructor(queryFn) {
        this.queryFn = queryFn;
        this.queue = new Map();
        this.timer = null;
        this.batchDelay = 50;
    }

    /**
     * Queue a query for batching
     * Works for queries that differ only in ID parameter
     */
    async queueById(sql, id, cacheKey) {
        return new Promise((resolve, reject) => {
            const batchKey = this._extractBatchKey(sql);

            if (!this.queue.has(batchKey)) {
                this.queue.set(batchKey, {
                    sql,
                    ids: [],
                    callbacks: [],
                });
            }

            const batch = this.queue.get(batchKey);
            batch.ids.push(id);
            batch.callbacks.push({ id, resolve, reject, cacheKey });

            // Schedule processing
            if (!this.timer) {
                this.timer = setTimeout(() => this._processBatches(), this.batchDelay);
            }
        });
    }

    /**
     * Extract batch key from SQL (ignoring specific IDs)
     */
    _extractBatchKey(sql) {
        return sql.replace(/='[^']+'/g, '=?').replace(/=\d+/g, '=?');
    }

    /**
     * Process all pending batches
     */
    async _processBatches() {
        this.timer = null;

        for (const [batchKey, batch] of this.queue.entries()) {
            try {
                // Convert single-ID query to IN-list query
                const batchedSql = this._createBatchedSQL(batch.sql, batch.ids);

                const start = Date.now();
                const results = await this.queryFn(batchedSql);
                const duration = Date.now() - start;

                logger.info(`[QueryBatcher] ⚡ Batched ${batch.ids.length} queries into 1 (${duration}ms)`);

                // Distribute results to callbacks
                for (const { id, resolve, cacheKey } of batch.callbacks) {
                    const result = results.filter(r => this._matchesId(r, id));

                    // Cache individual result
                    if (cacheKey) {
                        await redisCache.set('query', cacheKey, result, CACHE_TTL.MEDIUM);
                    }

                    resolve(result);
                }
            } catch (error) {
                // Reject all callbacks
                for (const { reject } of batch.callbacks) {
                    reject(error);
                }
            }
        }

        this.queue.clear();
    }

    /**
     * Convert single-value query to IN query
     */
    _createBatchedSQL(sql, ids) {
        // Find pattern like "= 'value'" or "= value"
        const uniqueIds = [...new Set(ids)];
        const inList = uniqueIds.map(id => typeof id === 'string' ? `'${id}'` : id).join(',');

        // Replace single comparison with IN list
        return sql.replace(/=\s*['"]?[^'")\s]+['"]?(\s|$)/i, `IN (${inList})$1`);
    }

    /**
     * Check if result row matches ID
     */
    _matchesId(row, id) {
        // Check common ID fields
        return row.id === id ||
            row.ID === id ||
            row.code === id ||
            row.CODE === id ||
            row.CUSTOMER_CODE === id;
    }
}

/**
 * Create query wrapper with caching and stats
 */
function createOptimizedQuery(originalQueryFn) {
    const batcher = new QueryBatcher(originalQueryFn);

    return {
        /**
         * Execute query with optional caching
         */
        async query(sql, options = {}) {
            const {
                cache = true,
                cacheKey = null,
                ttl = CACHE_TTL.MEDIUM,
                logQuery = true,
                prefix = 'query',
                role = null,
                vendorCode = 'ALL',
                params = {},
                dateFrom = null,
                dateTo = null,
                queryType = 'general',
            } = options;

            if (cache && cacheKey) {
                return cachedQuery(originalQueryFn, sql, {
                    cacheKey,
                    prefix,
                    ttl,
                    role,
                    vendorCode,
                    params,
                    dateFrom,
                    dateTo,
                    queryType,
                });
            }

            const start = Date.now();
            const result = await originalQueryFn(sql, logQuery);
            const duration = Date.now() - start;

            queryOptimizer.recordQuery(sql, duration, result.length || 0);

            return result;
        },

        /**
         * Queue query for batching (for similar queries with different IDs)
         */
        queueById(sql, id, cacheKey) {
            return batcher.queueById(sql, id, cacheKey);
        },

        /**
         * Get slow queries
         */
        getSlowQueries: (threshold) => queryOptimizer.getSlowQueries(threshold),

        /**
         * Get all query stats
         */
        getStats: () => queryOptimizer.getStats(),

        /**
         * Get index suggestions
         */
        suggestIndexes: () => queryOptimizer.suggestIndexes(),

        /**
         * Get cache metrics
         */
        getCacheMetrics: () => queryOptimizer.getCacheMetrics(),

        /**
         * Reset cache metrics
         */
        resetCacheMetrics: () => queryOptimizer.resetCacheMetrics(),

        /**
         * Invalidate cache by prefix
         */
        invalidateByPrefix: (prefix) => queryOptimizer.invalidateByPrefix(prefix),

        /**
         * Warm cache for hot queries
         */
        warmCache: (configs, context) => queryOptimizer.warmCache(originalQueryFn, configs, context),
    };
}

/**
 * Invalidate cache when data mutations occur
 * Call this after INSERT, UPDATE, DELETE operations
 */
async function invalidateOnMutation(tableName, recordId = null) {
    const prefixMap = {
        PEDIDOS: CACHE_PREFIXES.PEDIDOS,
        ALBARANES: CACHE_PREFIXES.ENTREGAS,
        ENTREGAS: CACHE_PREFIXES.ENTREGAS,
        COBROS: CACHE_PREFIXES.COBROS,
        CLIENTES: CACHE_PREFIXES.CLIENTS,
        PRODUCTOS: CACHE_PREFIXES.PRODUCTS,
        VENDEDORES: CACHE_PREFIXES.VENDEDORES,
    };

    const prefix = prefixMap[tableName.toUpperCase()];
    if (prefix) {
        await queryOptimizer.invalidateByPrefix(prefix);
        
        if (recordId) {
            await redisCache.delete('query', `record:${tableName}:${recordId}`);
        }

        logger.info(`[QueryOptimizer] 🔄 Cache invalidated on mutation: ${tableName}`);
    }
}

/**
 * Get cache statistics summary
 */
function getCacheStats() {
    return {
        optimizer: {
            queryStats: queryOptimizer.getStats().slice(0, 10),
            slowQueries: queryOptimizer.getSlowQueries().slice(0, 5),
        },
        cache: redisCache.getStats(),
        cacheMetrics: queryOptimizer.getCacheMetrics(),
        warmedKeys: queryOptimizer.getWarmedKeys(),
    };
}

module.exports = {
    queryOptimizer,
    cachedQuery,
    cachedQueryLegacy,
    QueryBatcher,
    createOptimizedQuery,
    invalidateOnMutation,
    getCacheStats,
    CACHE_TTL,
    CACHE_PREFIXES,
    WARM_QUERIES,
    CacheKeyGenerator,
    stampedeLock,
    cacheMetrics,
};
