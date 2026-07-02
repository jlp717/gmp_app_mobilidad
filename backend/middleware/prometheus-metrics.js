/**
 * GMP App - Prometheus Metrics Middleware
 * ========================================
 * Exposes Prometheus-compatible metrics for monitoring
 */

const crypto = require('crypto');
const logger = require('./logger');

class CircularBuffer {
    constructor(size) {
        this.size = size;
        this.buffer = new Array(size);
        this.head = 0;
        this.count = 0;
    }

    push(item) {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.size;
        if (this.count < this.size) {
            this.count++;
        }
    }

    toArray() {
        if (this.count === 0) return [];
        if (this.count < this.size) {
            return this.buffer.slice(0, this.count);
        }
        return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
    }

    get length() {
        return this.count;
    }

    clear() {
        this.buffer = new Array(this.size);
        this.head = 0;
        this.count = 0;
    }
}

// Metrics storage
const metrics = {
    // HTTP request metrics
    httpRequestsTotal: new Map(),
    httpRequestDuration: new CircularBuffer(1000),
    httpRequestSize: new CircularBuffer(1000),
    httpResponseSize: new CircularBuffer(1000),

    // Cache metrics
    cacheHits: 0,
    cacheMisses: 0,
    cacheSize: 0,

    // Database metrics
    dbQueriesTotal: 0,
    dbQueryDuration: new CircularBuffer(1000),
    dbErrorsTotal: 0,

    // Custom metrics
    activeConnections: 0,
    memoryUsage: new CircularBuffer(1000),

    // Timestamps
    startTime: Date.now(),
};

// Configuration
const CONFIG = {
    durationBuckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    sizeBuckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
};

function getHeader(req, name) {
    if (typeof req.get === 'function') return req.get(name);
    const headers = req.headers || {};
    return headers[name.toLowerCase()] || headers[name] || '';
}

function normalizeIp(value = '') {
    return String(value).replace(/^::ffff:/, '');
}

function isLoopbackIp(value = '') {
    const ip = normalizeIp(value);
    return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.');
}

function configuredInternalTokens() {
    return [
        process['env'].INTERNAL_API_TOKEN,
        process['env'].INTERNAL_METRICS_TOKEN,
        process['env'].METRICS_TOKEN,
        process['env'].INTERNAL_HEALTH_TOKEN,
        process['env'].HEALTHCHECK_TOKEN,
    ].filter(Boolean);
}

function safeEquals(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function providedInternalToken(req) {
    const authorization = getHeader(req, 'authorization');
    const bearer = authorization && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';
    return getHeader(req, 'x-internal-token')
        || getHeader(req, 'x-metrics-token')
        || getHeader(req, 'x-healthcheck-token')
        || bearer;
}

function hasInternalToken(req) {
    const provided = providedInternalToken(req);
    return Boolean(provided) && configuredInternalTokens().some(token => safeEquals(provided, token));
}

function isInternalRequest(req) {
    return isLoopbackIp(req.ip)
        || isLoopbackIp(req.socket?.remoteAddress)
        || isLoopbackIp(req.connection?.remoteAddress)
        || hasInternalToken(req);
}

function canSeeInternalDetails(req) {
    return isInternalRequest(req);
}

function requireInternalMetricsAccess(req, res, next) {
    if (isInternalRequest(req)) return next();
    return res.status(403).json({
        success: false,
        error: 'Metrics endpoint requires internal access',
        code: 'METRICS_FORBIDDEN',
    });
}
// Periodic cleanup - remove entries older than 1 hour
const CLEANUP_INTERVAL_MS = 60000;
const MAX_METRIC_AGE_MS = 3600000;
let cleanupTimer = null;

function startPeriodicCleanup() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(performMetricCleanup, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
}

function performMetricCleanup() {
    const now = Date.now();
    const cutoff = now - MAX_METRIC_AGE_MS;

    for (const metricName of ['httpRequestDuration', 'httpRequestSize', 'httpResponseSize', 'dbQueryDuration', 'memoryUsage']) {
        const buffer = metrics[metricName];
        const arr = buffer.toArray();
        const filtered = arr.filter(item => item.timestamp > cutoff);
        if (filtered.length !== arr.length) {
            buffer.clear();
            for (const item of filtered) {
                buffer.push(item);
            }
        }
    }
}

function stopPeriodicCleanup() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

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
    const buffer = metrics[name];
    if (buffer && typeof buffer.push === 'function') {
        buffer.push({ value, timestamp: Date.now() });
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
    startPeriodicCleanup();
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
        const durationArr = metrics.httpRequestDuration.toArray();
        const buckets = calculateBuckets(durationArr, CONFIG.durationBuckets.map(b => b * 1000));
        for (const [bucket, count] of Object.entries(buckets)) {
            lines.push(`http_request_duration_ms_bucket{le="${bucket}"} ${count}`);
        }
        const sum = durationArr.reduce((acc, v) => acc + v.value, 0);
        lines.push(`http_request_duration_ms_sum ${sum}`);
        lines.push(`http_request_duration_ms_count ${durationArr.length}`);
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
    const recentDurations = metrics.httpRequestDuration.toArray();

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
            latency: calculatePercentiles(metrics.dbQueryDuration.toArray()),
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
    metrics.httpRequestDuration.clear();
    metrics.httpRequestSize.clear();
    metrics.httpResponseSize.clear();
    metrics.cacheHits = 0;
    metrics.cacheMisses = 0;
    metrics.dbQueriesTotal = 0;
    metrics.dbQueryDuration.clear();
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
    requireInternalMetricsAccess,
    isInternalRequest,
    canSeeInternalDetails,
    resetMetrics,
    stopPeriodicCleanup,
};
