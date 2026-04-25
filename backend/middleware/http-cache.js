/**
 * GMP App - HTTP Cache Middleware
 * ================================
 * In-memory caching with TTL, ETag support, and cache invalidation
 */

const crypto = require('crypto');

const MAX_ENTRY_SIZE = 1024 * 1024;
const MAX_TOTAL_CACHE = 50 * 1024 * 1024;
const CACHE_TTL = {
    metrics: 60,
    clients: 300,
    products: 600,
};

const cache = new Map();
let totalCacheSize = 0;

function getCacheStats() {
    return {
        entries: cache.size,
        totalSize: totalCacheSize,
        maxSize: MAX_TOTAL_CACHE,
        hitRate: calculateHitRate(),
    };
}

function calculateHitRate() {
    if (totalHits === 0) return 0;
    return ((totalHits - totalMisses) / totalHits * 100).toFixed(2);
}

let totalHits = 0;
let totalMisses = 0;

function generateETag(data) {
    return `"${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').substring(0, 16)}"`;
}

function getAuthScope(req) {
    const userScope = req.user?.codigo || req.user?.code || req.user?.id;
    if (userScope) return String(userScope);

    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return null;

    return crypto
        .createHash('sha256')
        .update(authorization)
        .digest('hex')
        .substring(0, 16);
}

function getCacheKey(prefix, req) {
    const authScope = getAuthScope(req);
    if (!authScope) return null;
    return `${prefix}:${authScope}:${req.path}:${JSON.stringify(req.query)}`;
}

function serialize(value) {
    return JSON.stringify(value);
}

function deserialize(str) {
    return JSON.parse(str);
}

function evictIfNeeded(requiredSpace) {
    while (totalCacheSize + requiredSpace > MAX_TOTAL_CACHE && cache.size > 0) {
        const oldestKey = cache.keys().next().value;
        const entry = cache.get(oldestKey);
        totalCacheSize -= entry.size;
        cache.delete(oldestKey);
    }
}

function set(key, data, ttlSeconds) {
    const serialized = serialize(data);
    const size = Buffer.byteLength(serialized, 'utf8');

    if (size > MAX_ENTRY_SIZE) {
        return false;
    }

    evictIfNeeded(size);

    cache.set(key, {
        data: deserialize(serialized),
        expiresAt: Date.now() + (ttlSeconds * 1000),
        size,
        createdAt: Date.now(),
    });

    totalCacheSize += size;
    return true;
}

function get(key) {
    const entry = cache.get(key);

    if (!entry) {
        totalMisses++;
        return null;
    }

    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        totalCacheSize -= entry.size;
        totalMisses++;
        return null;
    }

    totalHits++;
    return entry.data;
}

function invalidate(pattern) {
    let count = 0;
    for (const key of cache.keys()) {
        if (key.startsWith(pattern)) {
            const entry = cache.get(key);
            totalCacheSize -= entry.size;
            cache.delete(key);
            count++;
        }
    }
    return count;
}

function invalidateAll() {
    cache.clear();
    totalCacheSize = 0;
}

function cached(cachePrefix, ttlSeconds) {
    return (req, res, next) => {
        if (req.method !== 'GET') {
            return next();
        }

        const cacheKey = getCacheKey(cachePrefix, req);
        if (!cacheKey) {
            return next();
        }
        const cachedData = get(cacheKey);

        const etag = cachedData ? generateETag(cachedData) : null;
        const ifNoneMatch = req.headers['if-none-match'];

        if (cachedData) {
            res.setHeader('X-Cache-Status', 'HIT');
            res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', 'private, max-age=' + Math.floor(ttlSeconds * 0.5));

            if (ifNoneMatch === etag) {
                return res.status(304).end();
            }

            return res.json(cachedData);
        }

        res.setHeader('X-Cache-Status', 'MISS');

        const originalJson = res.json.bind(res);
        res.json = function (data) {
            if (
                res.statusCode >= 200 &&
                res.statusCode < 300 &&
                data &&
                typeof data === 'object' &&
                !data.error
            ) {
                set(cacheKey, data, ttlSeconds);
            }
            res.setHeader('ETag', generateETag(data));
            res.setHeader('Cache-Control', 'private, max-age=' + Math.floor(ttlSeconds * 0.5));
            return originalJson(data);
        };

        next();
    };
}

function cacheMiddleware(req, res, next) {
    if (req.method === 'GET') {
        const path = req.path;

        if (path.includes('/dashboard/metrics')) {
            return cached('metrics', CACHE_TTL.metrics)(req, res, next);
        }
        if (path.includes('/clients')) {
            return cached('clients', CACHE_TTL.clients)(req, res, next);
        }
        if (path.includes('/products') && !path.includes('/image') && !path.includes('/ficha')) {
            return cached('products', CACHE_TTL.products)(req, res, next);
        }
    }

    next();
}

function invalidationMiddleware(req, res, next) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const path = req.path;

        if (path.includes('/clients')) {
            invalidate('clients:');
        }
        if (path.includes('/products')) {
            invalidate('products:');
        }
        if (path.includes('/dashboard')) {
            invalidate('metrics:');
        }
    }
    next();
}

module.exports = {
    cached,
    cacheMiddleware,
    invalidationMiddleware,
    getCacheStats,
    invalidate,
    invalidateAll,
    CACHE_TTL,
    MAX_ENTRY_SIZE,
    MAX_TOTAL_CACHE,
};
