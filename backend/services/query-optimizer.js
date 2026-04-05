/**
 * GMP App - Query Optimizer Service
 * ==================================
 * Query batching, caching, and performance optimization
 * Works with the existing ODBC connection pool
 */

const logger = require('../middleware/logger');
const { redisCache, TTL } = require('./redis-cache');

// Query statistics for optimization
const queryStats = new Map();
const STATS_RETENTION_MS = 3600000; // 1 hour

/**
 * Query metadata for optimization decisions
 */
class QueryOptimizer {
    constructor() {
        this.batchQueue = new Map();
        this.batchTimeout = 50; // ms to wait for batching
        this.maxBatchSize = 100;
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
}

// Create singleton instance
const queryOptimizer = new QueryOptimizer();

/**
 * Cached query wrapper
 * Automatically caches query results based on SQL
 */
async function cachedQuery(queryFn, sql, cacheKey, ttl = TTL.MEDIUM) {
    // Try cache first
    const cached = await redisCache.get('query', cacheKey);
    if (cached) {
        logger.info(`[QueryOptimizer] 📦 Cache HIT: ${cacheKey}`);
        return cached;
    }

    // Execute query
    const start = Date.now();
    const result = await queryFn(sql);
    const duration = Date.now() - start;

    // Record stats
    queryOptimizer.recordQuery(sql, duration, result.length || 0);

    // Cache result
    await redisCache.set('query', cacheKey, result, ttl);
    logger.info(`[QueryOptimizer] 💾 Cached: ${cacheKey} (${result.length} rows, ${duration}ms)`);

    return result;
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
                        await redisCache.set('query', cacheKey, result, TTL.MEDIUM);
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
                ttl = TTL.MEDIUM,
                logQuery = true,
            } = options;

            if (cache && cacheKey) {
                return cachedQuery(originalQueryFn, sql, cacheKey, ttl);
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
    };
}

module.exports = {
    queryOptimizer,
    cachedQuery,
    QueryBatcher,
    createOptimizedQuery,
};
