/**
 * GMP App - Network Optimizer Middleware
 * =======================================
 * HTTP/2 push hints, compression optimization, feature flags
 */

const logger = require('./logger');

/**
 * Feature flags for gradual rollout
 */
const FEATURE_FLAGS = {
    HTTP2_PUSH: process.env.ENABLE_HTTP2_PUSH === 'true',
    AGGRESSIVE_COMPRESSION: process.env.ENABLE_AGGRESSIVE_COMPRESSION !== 'false',
    ETAG_CACHING: true,
    RESPONSE_COALESCING: true,
    PREFETCH_HINTS: true,
};

/**
 * Compression thresholds by content type
 */
const COMPRESSION_CONFIG = {
    threshold: 1024, // Min bytes to compress
    level: 6, // zlib compression level (1-9)
    memLevel: 8,
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
    '/api/products': 'public, max-age=86400, stale-while-revalidate=3600',
    '/api/vendedores': 'public, max-age=86400, stale-while-revalidate=3600',
    '/api/dashboard/metrics': 'private, max-age=60, stale-while-revalidate=30',
    '/api/clients': 'private, max-age=300, stale-while-revalidate=60',
    '/api/objectives': 'private, max-age=180, stale-while-revalidate=60',
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

    // Calculate response time on finish
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        res.setHeader('X-Response-Time', `${duration}ms`);

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
function setupETagSupport(req, res) {
    const originalJson = res.json.bind(res);

    res.json = function (data) {
        // Generate ETag from response data
        const crypto = require('crypto');
        const etag = crypto
            .createHash('md5')
            .update(JSON.stringify(data))
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
function responseCoalescing(req, res, next) {
    if (!FEATURE_FLAGS.RESPONSE_COALESCING) {
        return next();
    }

    // Only coalesce GET requests
    if (req.method !== 'GET') {
        return next();
    }

    // Create request signature
    const signature = `${req.path}?${JSON.stringify(req.query)}`;

    // Check if identical request is pending
    if (pendingRequests.has(signature)) {
        const pending = pendingRequests.get(signature);

        // Wait for pending request to complete
        pending.promise
            .then(result => {
                res.setHeader('X-Coalesced', 'true');
                res.json(result);
            })
            .catch(err => {
                res.status(500).json({ error: err.message });
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

    pendingRequests.set(signature, { promise, resolve: resolvePromise, reject: rejectPromise });

    // Override res.json to capture response
    const originalJson = res.json.bind(res);
    res.json = function (data) {
        // Resolve pending requests
        const pending = pendingRequests.get(signature);
        if (pending) {
            pending.resolve(data);

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
    getFeatureFlags,
    setFeatureFlag,
    COMPRESSION_CONFIG,
};
