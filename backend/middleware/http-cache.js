/**
 * GMP App - HTTP Cache Middleware
 * ================================
 * In-memory caching with TTL, ETag support, and cache invalidation
 *
 * CACHE CONTRACT (read-only doc — do NOT change TTLs/invalidation here without
 * a matching contract test in backend/tests/cache-contract.test.js):
 *
 * Layers (three independent TTL namespaces, deliberately NOT unified):
 *   1. This file: per-process in-memory Map (MAX 50MB / 1MB per entry, LRU-ish
 *      re-insert on hit). CACHE_TTL = { metrics: 60, clients: 300, products: 600 }
 *      plus inline family TTLs in cacheMiddleware (evolution/matrix/analytics/
 *      rutero 300, commissions 900, objectives 180, facturas/pedidos 30).
 *      Keys are per-auth-scope (getAuthScope) + path + normalized query.
 *   2. services/redis-cache.js: shared Redis. TTL = { SHORT: 300, MEDIUM: 1800,
 *      LONG: 86400, REALTIME: 60 } with MONEY/COBROS pinned to REALTIME (60s).
 *      Namespaces 'route' (route handlers) and 'query' (cachedQuery).
 *   3. services/query-optimizer.js cachedQuery: Redis 'query' namespace with its
 *      OWN scale — CACHE_TTL = { SHORT: 60, MEDIUM: 300, LONG: 1800, STATIC: 3600 }.
 *      Same names, different seconds than layer 2: compare numbers, not names.
 *
 * Read order for GET /api/* (app.js: verifyToken -> cacheMiddleware at :770):
 *   bypass? (forceRefresh/refresh/_ts, no-cache/no-store headers, x-force-refresh)
 *   -> sensitive/money? no-store, next() (never stored, never served)
 *   -> family cached()? HIT (ETag/304) or MISS -> handler
 *   -> handler may use Redis 'route' cache and/or cachedQuery ('query' ns)
 *   -> DB2. MISS responses are stored unless no-store/error/non-2xx.
 *
 * Who invalidates what (no TTL change needed because invalidation is explicit):
 *   - invalidationMiddleware (app.js:410, all POST/PUT/PATCH/DELETE): drops local
 *     family prefixes (clients/products/metrics/evolution/matrix/commissions/
 *     objectives/rutero/cobros/pedidos/facturas) AND publishes to Redis.
 *   - ensureHttpCacheClusterInvalidation: Redis invalidation events drop local keys.
 *   - Query layer: invalidateByPrefix / patternFor() — cachedQuery keys live under
 *     the doubled "query:query:<family>:" prefix; patterns missing it are silent
 *     no-ops (see patternFor docs in query-optimizer.js).
 *   - Money writes invalidate 'cobros' (+ query-layer COBROS prefix on mutation).
 *
 * Money is ALWAYS no-store at this layer — isMoneyNoStorePath():
 *   /api/cobros*, *repartidor-finanzas*, *liquidaciones*, *entregas/pendientes*
 *   -> `Cache-Control: private, no-store`, next(), no X-Cache-Status.
 * Why: money must never serve a stale HTTP snapshot. The query layer already
 * holds bounded staleness for money (COBROS_MONEY_TTL = REALTIME 60s,
 * routes/cobros.js) with explicit invalidation on mutation, and the app-side
 * portfolio scans are deliberately UNCACHED (routes/cobros.js NOTE) because
 * cache-assisted money reads proved nondeterministic against legacy-contract
 * tests. Caching money HERE would multiply the staleness windows
 * (query TTL x HTTP TTL) and risk cross-scope reads, so this layer opts out
 * entirely. Same treatment for per-recipient reparto evidence/receipt paths
 * (isSensitiveRepartoPath) for privacy.
 * NOTE: /api/repartidor-finanzas mounts BEFORE cacheMiddleware (app.js:762 vs
 * :770), so its handlers usually never reach this middleware; the money match
 * stays as defense-in-depth for every money path that does.
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

function isMoneyNoStorePath(req) {
    const path = getRequestPath(req);
    return (
        path === '/api/cobros'
        || path.startsWith('/api/cobros/')
        || path.includes('/repartidor-finanzas')
        || path.includes('/liquidaciones')
        || path.includes('/entregas/pendientes')
    );
}

let httpCacheInvalidationHooked = false;
function ensureHttpCacheClusterInvalidation() {
    if (httpCacheInvalidationHooked) return;
    httpCacheInvalidationHooked = true;
    try {
        const { onInvalidationPattern } = require('../services/redis-cache');
        onInvalidationPattern((pattern) => {
            const prefix = String(pattern || '')
                .replace(/^gmp:/, '')
                .replace(/\*$/, '');
            if (prefix) invalidate(prefix, false);
        });
    } catch (_) {
        // Redis optional — workers still invalidate locally
    }
}

ensureHttpCacheClusterInvalidation();

const ETAG_MAX_BYTES = 256 * 1024;

function generateETag(data) {
    let serialized;
    try {
        serialized = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (_) {
        return null;
    }
    if (serialized == null) return null;
    if (Buffer.byteLength(serialized, 'utf8') >= ETAG_MAX_BYTES) return null;
    return `"${crypto.createHash('md5').update(serialized).digest('hex').substring(0, 16)}"`;
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
            activeMode: String(user.activeMode || user.active_mode || ''),
            repartidorCodes: Array.isArray(user.repartidorCodes)
                ? user.repartidorCodes.map(String).sort()
                : String(user.repartidorCodes || ''),
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
    // LRU refresh: re-insert the entry so evictIfNeeded (insertion-order
    // eviction) drops cold keys first. Mirrors the L1 pattern in redis-cache.
    cache.delete(key);
    cache.set(key, entry);
    return entry.data;
}

function deleteKey(key) {
    const entry = cache.get(key);
    if (!entry) return false;
    totalCacheSize -= entry.size;
    return cache.delete(key);
}

function invalidate(pattern, publishRemote = true) {
    let count = 0;
    for (const key of cache.keys()) {
        if (key.startsWith(pattern)) {
            const entry = cache.get(key);
            totalCacheSize -= entry.size;
            cache.delete(key);
            count++;
        }
    }
    if (publishRemote) {
        try {
            const { invalidateCache } = require('../services/redis-cache');
            const redisPattern = pattern.endsWith('*') ? pattern : `${pattern}*`;
            Promise.resolve(invalidateCache(redisPattern)).catch(() => {});
        } catch (_) {
            // Redis optional
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
            if (etag) res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', 'private, max-age=' + Math.floor(ttlSeconds * 0.5));

            if (etag && ifNoneMatch === etag) {
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
                const freshEtag = generateETag(data);
                if (freshEtag) res.setHeader('ETag', freshEtag);
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

        if (isSensitiveRepartoPath(req) || isMoneyNoStorePath(req)) {
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
        if (path.includes('/facturas')) {
            return cached('facturas', 30)(req, res, next);
        }
        if (path.includes('/pedidos')) {
            return cached('pedidos', 30)(req, res, next);
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
        if (path.includes('/cobros')) {
            invalidate('cobros:');
        }
        if (path.includes('/pedidos')) {
            invalidate('pedidos:');
        }
        if (path.includes('/facturas')) {
            invalidate('facturas:');
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
    isMoneyNoStorePath,
    CACHE_TTL,
    MAX_ENTRY_SIZE,
    MAX_TOTAL_CACHE,
};
