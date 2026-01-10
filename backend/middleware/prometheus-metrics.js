/**
 * GMP App - Prometheus Metrics Middleware
 * ========================================
 * Exposes Prometheus-compatible metrics for monitoring
 */

const logger = require('./logger');

// Metrics storage
const metrics = {
    // HTTP request metrics
    httpRequestsTotal: new Map(),
    httpRequestDuration: [],
    httpRequestSize: [],
    httpResponseSize: [],

    // Cache metrics
    cacheHits: 0,
    cacheMisses: 0,
    cacheSize: 0,

    // Database metrics
    dbQueriesTotal: 0,
    dbQueryDuration: [],
    dbErrorsTotal: 0,

    // Custom metrics
    activeConnections: 0,
    memoryUsage: [],

    // Timestamps
    startTime: Date.now(),
};

// Configuration
const CONFIG = {
    durationBuckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    sizeBuckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
    historyLimit: 10000,
};

/**
 * Increment counter metric
 */
function incrementCounter(name, labels = {}) {
    const key = `${name}${JSON.stringify(labels)}`;
    const current = metrics.httpRequestsTotal.get(key) || 0;
    metrics.httpRequestsTotal.set(key, current + 1);
}

/**
 * Record histogram value
 */
function recordHistogram(name, value) {
    const arr = metrics[name];
    if (arr) {
        arr.push({ value, timestamp: Date.now() });
        if (arr.length > CONFIG.historyLimit) {
            arr.shift();
        }
    }
}

/**
 * Calculate histogram buckets
 */
function calculateBuckets(values, buckets) {
    const result = {};
    for (const bucket of buckets) {
        result[bucket] = values.filter(v => v.value <= bucket).length;
    }
    result['+Inf'] = values.length;
    return result;
}

/**
 * Calculate percentiles
 */
function calculatePercentiles(values, percentiles = [50, 90, 95, 99]) {
    if (values.length === 0) return {};

    const sorted = [...values].map(v => v.value).sort((a, b) => a - b);
    const result = {};

    for (const p of percentiles) {
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        result[`p${p}`] = sorted[Math.max(0, idx)];
    }

    return result;
}

/**
 * Prometheus metrics middleware
 */
function prometheusMetrics(req, res, next) {
    const startTime = Date.now();
    const startHrTime = process.hrtime();

    // Track request
    metrics.activeConnections++;

    // Track request size
    const reqSize = parseInt(req.headers['content-length'] || '0', 10);
    recordHistogram('httpRequestSize', reqSize);

    // Capture response
    const originalEnd = res.end.bind(res);
    let responseSize = 0;

    res.end = function (chunk, encoding, callback) {
        if (chunk) {
            responseSize += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        }

        // Record metrics
        const duration = (Date.now() - startTime) / 1000; // seconds
        const hrDuration = process.hrtime(startHrTime);
        const durationMs = hrDuration[0] * 1000 + hrDuration[1] / 1e6;

        // Labels
        const labels = {
            method: req.method,
            path: normalizePath(req.path),
            status: res.statusCode,
        };

        // Increment request counter
        incrementCounter('http_requests_total', labels);

        // Record durations
        recordHistogram('httpRequestDuration', durationMs);
        recordHistogram('httpResponseSize', responseSize);

        // Track active connections
        metrics.activeConnections--;

        return originalEnd(chunk, encoding, callback);
    };

    next();
}

/**
 * Normalize path for metrics (replace dynamic segments)
 */
function normalizePath(path) {
    return path
        .replace(/\/\d+/g, '/:id')
        .replace(/\/[a-f0-9-]{36}/gi, '/:uuid')
        .replace(/\?.*/g, '');
}

/**
 * Record database query
 */
function recordDbQuery(duration, success = true) {
    metrics.dbQueriesTotal++;
    recordHistogram('dbQueryDuration', duration);
    if (!success) {
        metrics.dbErrorsTotal++;
    }
}

/**
 * Record cache access
 */
function recordCacheAccess(hit, size = 0) {
    if (hit) {
        metrics.cacheHits++;
    } else {
        metrics.cacheMisses++;
    }
    metrics.cacheSize = size;
}

/**
 * Get metrics in Prometheus format
 */
function getPrometheusMetrics() {
    const lines = [];
    const now = Date.now();

    // Process uptime
    lines.push('# HELP process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${(now - metrics.startTime) / 1000}`);

    // Memory usage
    const mem = process.memoryUsage();
    lines.push('# HELP process_memory_bytes Process memory usage');
    lines.push('# TYPE process_memory_bytes gauge');
    lines.push(`process_memory_bytes{type="rss"} ${mem.rss}`);
    lines.push(`process_memory_bytes{type="heap_total"} ${mem.heapTotal}`);
    lines.push(`process_memory_bytes{type="heap_used"} ${mem.heapUsed}`);
    lines.push(`process_memory_bytes{type="external"} ${mem.external}`);

    // HTTP requests total
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, value] of metrics.httpRequestsTotal) {
        const labels = key.replace(/[{}]/g, '').replace(/"/g, '');
        lines.push(`http_requests_total{${labels}} ${value}`);
    }

    // HTTP request duration
    if (metrics.httpRequestDuration.length > 0) {
        lines.push('# HELP http_request_duration_ms HTTP request duration in ms');
        lines.push('# TYPE http_request_duration_ms histogram');
        const buckets = calculateBuckets(metrics.httpRequestDuration, CONFIG.durationBuckets.map(b => b * 1000));
        for (const [bucket, count] of Object.entries(buckets)) {
            lines.push(`http_request_duration_ms_bucket{le="${bucket}"} ${count}`);
        }
        const sum = metrics.httpRequestDuration.reduce((acc, v) => acc + v.value, 0);
        lines.push(`http_request_duration_ms_sum ${sum}`);
        lines.push(`http_request_duration_ms_count ${metrics.httpRequestDuration.length}`);
    }

    // Cache metrics
    lines.push('# HELP cache_hits_total Cache hits');
    lines.push('# TYPE cache_hits_total counter');
    lines.push(`cache_hits_total ${metrics.cacheHits}`);

    lines.push('# HELP cache_misses_total Cache misses');
    lines.push('# TYPE cache_misses_total counter');
    lines.push(`cache_misses_total ${metrics.cacheMisses}`);

    const cacheHitRate = metrics.cacheHits + metrics.cacheMisses > 0
        ? metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)
        : 0;
    lines.push('# HELP cache_hit_rate Cache hit rate');
    lines.push('# TYPE cache_hit_rate gauge');
    lines.push(`cache_hit_rate ${cacheHitRate.toFixed(4)}`);

    // Database metrics
    lines.push('# HELP db_queries_total Total database queries');
    lines.push('# TYPE db_queries_total counter');
    lines.push(`db_queries_total ${metrics.dbQueriesTotal}`);

    lines.push('# HELP db_errors_total Database errors');
    lines.push('# TYPE db_errors_total counter');
    lines.push(`db_errors_total ${metrics.dbErrorsTotal}`);

    // Active connections
    lines.push('# HELP http_active_connections Active HTTP connections');
    lines.push('# TYPE http_active_connections gauge');
    lines.push(`http_active_connections ${metrics.activeConnections}`);

    return lines.join('\n');
}

/**
 * Get metrics in JSON format (for internal dashboard)
 */
function getJsonMetrics() {
    const recentDurations = metrics.httpRequestDuration.slice(-1000);

    return {
        uptime: Date.now() - metrics.startTime,
        memory: process.memoryUsage(),
        requests: {
            total: Array.from(metrics.httpRequestsTotal.values()).reduce((a, b) => a + b, 0),
            byEndpoint: Object.fromEntries(metrics.httpRequestsTotal),
        },
        latency: {
            count: recentDurations.length,
            ...calculatePercentiles(recentDurations),
            avg: recentDurations.length > 0
                ? recentDurations.reduce((acc, v) => acc + v.value, 0) / recentDurations.length
                : 0,
        },
        cache: {
            hits: metrics.cacheHits,
            misses: metrics.cacheMisses,
            hitRate: metrics.cacheHits + metrics.cacheMisses > 0
                ? (metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses) * 100).toFixed(2) + '%'
                : '0%',
            size: metrics.cacheSize,
        },
        database: {
            queries: metrics.dbQueriesTotal,
            errors: metrics.dbErrorsTotal,
            latency: calculatePercentiles(metrics.dbQueryDuration.slice(-1000)),
        },
        connections: {
            active: metrics.activeConnections,
        },
    };
}

/**
 * Metrics endpoint handler
 */
function metricsHandler(req, res) {
    const format = req.query.format || 'prometheus';

    if (format === 'json') {
        res.json(getJsonMetrics());
    } else {
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(getPrometheusMetrics());
    }
}

/**
 * Reset metrics (for testing)
 */
function resetMetrics() {
    metrics.httpRequestsTotal.clear();
    metrics.httpRequestDuration.length = 0;
    metrics.httpRequestSize.length = 0;
    metrics.httpResponseSize.length = 0;
    metrics.cacheHits = 0;
    metrics.cacheMisses = 0;
    metrics.dbQueriesTotal = 0;
    metrics.dbQueryDuration.length = 0;
    metrics.dbErrorsTotal = 0;
    metrics.startTime = Date.now();
}

module.exports = {
    prometheusMetrics,
    recordDbQuery,
    recordCacheAccess,
    getPrometheusMetrics,
    getJsonMetrics,
    metricsHandler,
    resetMetrics,
};
