/**
 * GMP App - Network Optimizer Middleware
 * =======================================
 * HTTP/2 push hints, compression optimization, feature flags
 */

const logger = require('./logger');
const crypto = require('crypto');

/**
 * Feature flags for gradual rollout (OPTIMIZED v3)
 */
const FEATURE_FLAGS = {
    HTTP2_PUSH: process.env.ENABLE_HTTP2_PUSH === 'true',
    AGGRESSIVE_COMPRESSION: process.env.ENABLE_AGGRESSIVE_COMPRESSION !== 'false',
    ETAG_CACHING: process.env.ENABLE_ETAG_CACHING !== 'false',
    RESPONSE_COALESCING: process.env.ENABLE_RESPONSE_COALESCING !== 'false',
    PREFETCH_HINTS: process.env.ENABLE_PREFETCH_HINTS === 'true',
    FAST_304: true, // Quick 304 responses
};

/**
 * Compression thresholds by content type (OPTIMIZED)
 */
const COMPRESSION_CONFIG = {
    threshold: parseInt(process.env.HTTP_COMPRESSION_THRESHOLD, 10) || 1024,
    level: parseInt(process.env.HTTP_COMPRESSION_LEVEL, 10) || 6,
    memLevel: parseInt(process.env.HTTP_COMPRESSION_MEM_LEVEL, 10) || 8,
    contentTypes: [
        'application/json',
        'text/plain',
        'text/html',
        'text/css',
        'application/javascript',
    ],
};

/**
 * Cache control headers by route pattern
 */
const CACHE_CONTROL = {
    '/api/products': 'private, max-age=600, stale-while-revalidate=60',
    '/api/vendedores': 'private, max-age=600, stale-while-revalidate=60',
    '/api/dashboard/metrics': 'private, max-age=60, stale-while-revalidate=30',
    '/api/dashboard/sales-evolution': 'private, max-age=300, stale-while-revalidate=60',
    '/api/dashboard/matrix-data': 'private, max-age=300, stale-while-revalidate=60',
    '/api/clients': 'private, max-age=300, stale-while-revalidate=60',
    '/api/commissions': 'private, max-age=900, stale-while-revalidate=300',
    '/api/analytics': 'private, max-age=300, stale-while-revalidate=60',
    '/api/objectives': 'private, max-age=180, stale-while-revalidate=60',
    '/api/rutero/day': 'private, max-age=300, stale-while-revalidate=60',
    '/api/rutero/week': 'private, max-age=900, stale-while-revalidate=300',
    default: 'private, no-cache',
};

/**
 * Prefetch hints for related resources
 */
const PREFETCH_HINTS = {
    '/api/dashboard/metrics': [
        '/api/dashboard/sales-evolution',
        '/api/dashboard/recent-sales',
    ],
    '/api/clients': [
        '/api/vendedores',
        '/api/products',
    ],
};

/**
 * Response coalescing - combine similar requests
 */
const pendingRequests = new Map();
const COALESCE_WINDOW_MS = 50;
const MAX_PENDING_REQUESTS = parseInt(process.env.HTTP_COALESCE_MAX_PENDING, 10) || 1000;
const MAX_ETAG_BYTES = parseInt(process.env.HTTP_ETAG_MAX_BYTES, 10) || 256 * 1024;
const MAX_ETAG_ARRAY_ITEMS = parseInt(process.env.HTTP_ETAG_MAX_ARRAY_ITEMS, 10) || 200;
const MAX_PENDING_AGE_MS = 60000; // 60s — heavy DB2 queries (commissions ALL, clients) need this

setInterval(() => {
    const now = Date.now();
    for (const [sig, entry] of pendingRequests) {
        if (now - (entry.createdAt || 0) > MAX_PENDING_AGE_MS) {
            // Suppress unhandled rejection — the .catch() at line 222 handles it
            entry.promise.catch(() => {});
            entry.reject(new Error('Coalescing request timed out'));
            pendingRequests.delete(sig);
        }
    }
}, 10000).unref();

/**
 * Main network optimizer middleware
 */
function networkOptimizer(req, res, next) {
    const startTime = Date.now();

    // Add performance headers
    res.setHeader('X-Response-Time-Start', startTime.toString());

    // Enable CORS preflight caching
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Max-Age', '86400');
    }

    // Apply cache control headers
    applyCacheControl(req, res);

    // Add prefetch hints
    if (FEATURE_FLAGS.PREFETCH_HINTS) {
        addPrefetchHints(req, res);
    }

    // Add ETag support
    if (FEATURE_FLAGS.ETAG_CACHING) {
        setupETagSupport(req, res);
    }

    // Log slow responses on finish (can't set headers here, response already sent)
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        // res.setHeader('X-Response-Time', `${duration}ms`); // REMOVED: Cannot set items after send

        // Log slow responses
        if (duration > 1000) {
            logger.warn(`[NetworkOptimizer] Slow response: ${req.method} ${req.path} took ${duration}ms`);
        }
    });

    next();
}

/**
 * Apply cache control headers based on route
 */
function applyCacheControl(req, res) {
    // Skip for mutations
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        res.setHeader('Cache-Control', 'no-store');
        return;
    }

    // Find matching cache control rule
    for (const [pattern, value] of Object.entries(CACHE_CONTROL)) {
        if (pattern !== 'default' && req.path.startsWith(pattern)) {
            res.setHeader('Cache-Control', value);
            return;
        }
    }

    res.setHeader('Cache-Control', CACHE_CONTROL.default);
}

/**
 * Add Link headers for resource prefetching (HTTP/2 Push hints)
 */
function addPrefetchHints(req, res) {
    const hints = PREFETCH_HINTS[req.path];
    if (hints && hints.length > 0) {
        const linkHeader = hints
            .map(path => `<${path}>; rel=prefetch`)
            .join(', ');
        res.setHeader('Link', linkHeader);
    }
}

/**
 * Setup ETag support for conditional requests
 */
function hasLargeArrayPayload(data) {
    if (Array.isArray(data)) {
        return data.length > MAX_ETAG_ARRAY_ITEMS;
    }
    if (!data || typeof data !== 'object') {
        return false;
    }
    return Object.values(data).some(value => Array.isArray(value) && value.length > MAX_ETAG_ARRAY_ITEMS);
}

function setupETagSupport(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return;
    }

    const originalJson = res.json.bind(res);

    res.json = function (data) {
        if (res.statusCode >= 400 || hasLargeArrayPayload(data)) {
            return originalJson(data);
        }

        let payload;
        try {
            payload = JSON.stringify(data);
        } catch (_) {
            return originalJson(data);
        }

        if (Buffer.byteLength(payload, 'utf8') > MAX_ETAG_BYTES) {
            return originalJson(data);
        }

        // Generate ETag from response data
        const etag = crypto
            .createHash('md5')
            .update(payload)
            .digest('hex')
            .substring(0, 16);

        const fullEtag = `"${etag}"`;
        res.setHeader('ETag', fullEtag);

        // Check If-None-Match header
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch === fullEtag) {
            return res.status(304).end();
        }

        return originalJson(data);
    };
}

/**
 * Response coalescing middleware
 * Combines identical concurrent requests into one
 */
function hasNoCacheDirective(value) {
    return String(value || '')
        .toLowerCase()
        .split(',')
        .map(part => part.trim())
        .some(part => part === 'no-cache' || part === 'no-store' || part === 'max-age=0');
}

function isCoalescingBypass(req) {
    const query = req.query || {};
    const headers = req.headers || {};
    if (query.forceRefresh != null || query.refresh != null || query._ts != null) return true;
    if (hasNoCacheDirective(headers['cache-control'])) return true;
    if (String(headers.pragma || '').toLowerCase() === 'no-cache') return true;
    const forceHeader = String(headers['x-force-refresh'] || '').toLowerCase();
    return forceHeader === 'true' || forceHeader === '1' || forceHeader === 'yes';
}

function isJsonCoalescibleRequest(req) {
    const path = `${req.path || ''} ${req.originalUrl || ''}`.toLowerCase();
    const accept = String(req.get?.('accept') || req.headers?.accept || '').toLowerCase();

    if (path.includes('/pdf') || path.includes('/download') || path.includes('/export')) {
        return false;
    }
    if (accept.includes('application/pdf') || accept.includes('application/octet-stream')) {
        return false;
    }
    return true;
}

function stableQueryString(query = {}) {
    return JSON.stringify(
        Object.keys(query)
            .sort()
            .reduce((acc, key) => {
                acc[key] = query[key];
                return acc;
            }, {})
    );
}

function responseCoalescing(req, res, next) {
    if (!FEATURE_FLAGS.RESPONSE_COALESCING) {
        return next();
    }

    // Only coalesce GET requests
    if (req.method !== 'GET') {
        return next();
    }

    if (!isJsonCoalescibleRequest(req)) {
        return next();
    }

    if (isCoalescingBypass(req) || pendingRequests.size >= MAX_PENDING_REQUESTS) {
        return next();
    }

    // Create request signature
    const authFingerprint = crypto
        .createHash('sha256')
        .update(req.get('authorization') || '')
        .digest('hex')
        .slice(0, 16);
    const signature = `${authFingerprint}:${req.path}?${stableQueryString(req.query)}`;

    // Check if identical request is pending
    if (pendingRequests.has(signature)) {
        const pending = pendingRequests.get(signature);

        // Wait for pending request to complete
        pending.promise
            .then(result => {
                res.setHeader('X-Coalesced', 'true');
                if (result.cacheControl) {
                    res.setHeader('Cache-Control', result.cacheControl);
                }
                res.status(result.statusCode || 200).json(result.data);
            })
            .catch(err => {
                res.status(500).json({ error: 'Request coalescing failed', code: 'COALESCING_ERROR' });
            });

        return; // Don't call next
    }

    // Create pending entry
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    pendingRequests.set(signature, {
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
        createdAt: Date.now(),
        settled: false,
    });

    // Override res.json to capture response
    const originalJson = res.json.bind(res);
    res.json = function (data) {
        // Resolve pending requests
        const pending = pendingRequests.get(signature);
        if (pending) {
            pending.settled = true;
            pending.resolve({
                statusCode: res.statusCode,
                cacheControl: res.getHeader ? res.getHeader('Cache-Control') : null,
                data,
            });

            // Clean up after coalesce window
            setTimeout(() => {
                pendingRequests.delete(signature);
            }, COALESCE_WINDOW_MS);
        }

        return originalJson(data);
    };

    // Handle errors
    res.on('error', (err) => {
        const pending = pendingRequests.get(signature);
        if (pending) {
            pending.reject(err);
            pendingRequests.delete(signature);
        }
    });

    res.on('finish', () => {
        const pending = pendingRequests.get(signature);
        if (pending && !pending.settled) {
            pending.reject(new Error('Coalesced request finished without JSON response'));
            pendingRequests.delete(signature);
        }
    });

    next();
}

/**
 * Request deduplication middleware
 * Prevents duplicate requests from being processed
 */
const recentRequests = new Map();
const DEDUP_WINDOW_MS = 100;

function requestDeduplication(req, res, next) {
    if (req.method !== 'GET') {
        return next();
    }

    if (!isJsonCoalescibleRequest(req)) {
        return next();
    }

    const signature = `${req.ip}:${req.path}:${JSON.stringify(req.query)}`;

    if (recentRequests.has(signature)) {
        const cached = recentRequests.get(signature);
        res.setHeader('X-Deduplicated', 'true');
        return res.json(cached);
    }

    // Capture response for deduplication
    const originalJson = res.json.bind(res);
    res.json = function (data) {
        recentRequests.set(signature, data);

        setTimeout(() => {
            recentRequests.delete(signature);
        }, DEDUP_WINDOW_MS);

        return originalJson(data);
    };

    next();
}

/**
 * Compression stats middleware
 */
function compressionStats(req, res, next) {
    if (!FEATURE_FLAGS.AGGRESSIVE_COMPRESSION) {
        return next();
    }

    const originalEnd = res.end.bind(res);
    let uncompressedSize = 0;

    // Track original response size
    const originalWrite = res.write.bind(res);
    res.write = function (chunk, ...args) {
        if (chunk) {
            uncompressedSize += Buffer.byteLength(chunk);
        }
        return originalWrite(chunk, ...args);
    };

    res.end = function (chunk, ...args) {
        if (chunk) {
            uncompressedSize += Buffer.byteLength(chunk);
        }

        // Log compression ratio for large responses
        if (uncompressedSize > 10000) {
            const contentLength = res.getHeader('content-length');
            if (contentLength) {
                const ratio = (1 - contentLength / uncompressedSize) * 100;
                logger.info(`[Compression] ${req.path}: ${uncompressedSize}B → ${contentLength}B (${ratio.toFixed(1)}% saved)`);
            }
        }

        return originalEnd(chunk, ...args);
    };

    next();
}

/**
 * Get feature flag status
 */
function getFeatureFlags() {
    return { ...FEATURE_FLAGS };
}

/**
 * Toggle feature flag
 */
function setFeatureFlag(flag, value) {
    if (flag in FEATURE_FLAGS) {
        FEATURE_FLAGS[flag] = value;
        logger.info(`[NetworkOptimizer] Feature flag ${flag} set to ${value}`);
        return true;
    }
    return false;
}

module.exports = {
    networkOptimizer,
    responseCoalescing,
    requestDeduplication,
    compressionStats,
    isJsonCoalescibleRequest,
    getFeatureFlags,
    setFeatureFlag,
    COMPRESSION_CONFIG,
};
