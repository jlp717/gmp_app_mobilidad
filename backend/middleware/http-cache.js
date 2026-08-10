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
    const total = totalHits + totalMisses;
    if (total === 0) return 0;
    return (totalHits / total * 100).toFixed(2);
}

let totalHits = 0;
let totalMisses = 0;

function getRequestPath(req) {
    return (req.originalUrl || req.path || '').split('?')[0];
}

function isApiRequest(req) {
    const path = getRequestPath(req);
    return [path === '/api', path.startsWith('/api/'), req.baseUrl === '/api'].some(Boolean);
}

function isPublicApiRequest(req) {
    const path = getRequestPath(req);
    if (path.startsWith('/api/auth')) return true;
    return ['/api/health', '/api/metrics', '/api/app/version', '/api/health/version-check'].includes(path);
}

function requiresVerifiedUserForCache(req) {
    return isApiRequest(req) ? !isPublicApiRequest(req) : false;
}

function isSensitiveRepartoPath(req) {
    const path = getRequestPath(req);
    return path.includes('/repartidor-finanzas/rutero/evidence/')
        || /\/repartidor-finanzas\/rutero\/confirmations(?:\/[^/]+)?\/receipt$/.test(path);
}

function generateETag(data) {
    return `"${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex').substring(0, 16)}"`;
}

function getAuthScope(req) {
    const headers = req.headers || {};
    const user = req.user || null;
    const userScope = user?.codigo || user?.code || user?.id;
    if (userScope) {
        const scopePayload = {
            id: String(userScope),
            role: String(user.role || user.userRole || ''),
            isJefeVentas: Boolean(user.isJefeVentas),
            vendedorCode: String(user.vendedorCode || user.codigoVendedor || ''),
            vendedorCodes: Array.isArray(user.vendedorCodes)
                ? user.vendedorCodes.map(String).sort()
                : String(user.vendedorCodes || ''),
            viewAs: String(user.viewAs || user.view_as || headers['x-view-as'] || ''),
        };
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(scopePayload))
            .digest('hex')
            .substring(0, 24);
    }

    if (requiresVerifiedUserForCache(req)) return null;

    const authorization = headers.authorization || '';
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
    return `${prefix}:${authScope}:${req.path}:${JSON.stringify(getCacheQuery(req.query))}`;
}

function getCacheQuery(query = {}) {
    return Object.keys(query)
        .filter(key => !['forceRefresh', 'refresh', '_ts'].includes(key))
        .sort()
        .reduce((normalized, key) => {
            normalized[key] = query[key];
            return normalized;
        }, {});
}

function hasNoCacheDirective(value) {
    return String(value || '')
        .toLowerCase()
        .split(',')
        .map(part => part.trim())
        .some(part => part === 'no-cache' || part === 'no-store' || part === 'max-age=0');
}

function isCacheBypassRequest(req) {
    const query = req.query || {};
    const headers = req.headers || {};
    if (query.forceRefresh != null || query.refresh != null || query._ts != null) {
        return true;
    }

    if (hasNoCacheDirective(headers['cache-control'])) return true;
    if (String(headers.pragma || '').toLowerCase() === 'no-cache') return true;

    const forceHeader = String(headers['x-force-refresh'] || '').toLowerCase();
    return forceHeader === 'true' || forceHeader === '1' || forceHeader === 'yes';
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

    const existing = cache.get(key);
    if (existing) {
        totalCacheSize -= existing.size;
        cache.delete(key);
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

function deleteKey(key) {
    const entry = cache.get(key);
    if (!entry) return false;
    totalCacheSize -= entry.size;
    return cache.delete(key);
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
        const bypassCache = isCacheBypassRequest(req);
        if (bypassCache) {
            deleteKey(cacheKey);
            res.setHeader('X-Cache-Status', 'BYPASS');
        }

        const cachedData = bypassCache ? null : get(cacheKey);

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

        if (!bypassCache) {
            res.setHeader('X-Cache-Status', 'MISS');
        }

        const originalJson = res.json.bind(res);
        res.json = function (data) {
            if (res.headersSent || res.writableEnded || res.locals?.requestTimedOut) {
                return res;
            }
            const cacheControl = String(res.getHeader('Cache-Control') || '').toLowerCase();
            const responseForbidsStorage = cacheControl.split(',')
                .map(value => value.trim())
                .includes('no-store');
            if (
                !responseForbidsStorage &&
                res.statusCode >= 200 &&
                res.statusCode < 300 &&
                data &&
                typeof data === 'object' &&
                !data.error
            ) {
                set(cacheKey, data, ttlSeconds);
            }
            if (!responseForbidsStorage) {
                res.setHeader('ETag', generateETag(data));
                res.setHeader('Cache-Control', 'private, max-age=' + Math.floor(ttlSeconds * 0.5));
            }
            return originalJson(data);
        };

        next();
    };
}

function cacheMiddleware(req, res, next) {
    if (req.method === 'GET') {
        if (requiresVerifiedUserForCache(req) ? !req.user : false) {
            res.setHeader('Cache-Control', 'no-store');
            return next();
        }

        const path = req.path;

        if (isSensitiveRepartoPath(req)) {
            res.setHeader('Cache-Control', 'private, no-store');
            return next();
        }

        if (path.includes('/dashboard/metrics')) {
            return cached('metrics', CACHE_TTL.metrics)(req, res, next);
        }
        if (path.includes('/dashboard/sales-evolution')) {
            return cached('evolution', 300)(req, res, next);
        }
        if (path.includes('/dashboard/matrix-data')) {
            return cached('matrix', 300)(req, res, next);
        }
        if (path.includes('/clients')) {
            return cached('clients', CACHE_TTL.clients)(req, res, next);
        }
        if (path.includes('/products') && !path.includes('/image') && !path.includes('/ficha')) {
            return cached('products', CACHE_TTL.products)(req, res, next);
        }
        if (path.includes('/analytics')) {
            return cached('analytics', 300)(req, res, next);
        }
        if (path.includes('/commissions') && !path.includes('/pay')) {
            return cached('commissions', 900)(req, res, next);
        }
        if (path.includes('/objectives')) {
            return cached('objectives', 180)(req, res, next);
        }
        if (path.includes('/rutero')) {
            return cached('rutero', 300)(req, res, next);
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
            invalidate('evolution:');
            invalidate('matrix:');
        }
        if (path.includes('/commissions')) {
            invalidate('commissions:');
        }
        if (path.includes('/objectives')) {
            invalidate('objectives:');
        }
        if (path.includes('/rutero')) {
            invalidate('rutero:');
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
    isCacheBypassRequest,
    isSensitiveRepartoPath,
    CACHE_TTL,
    MAX_ENTRY_SIZE,
    MAX_TOTAL_CACHE,
};
