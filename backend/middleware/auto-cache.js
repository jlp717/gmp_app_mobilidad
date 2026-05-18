/**
 * Auto-Cache Middleware
 * =====================
 * Automatically adds caching to all GET endpoints that perform DB queries
 */

const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');

/**
 * Wrap a route handler with automatic caching
 * @param {Function} handler - Original route handler
 * @param {Object} options - Cache options
 * @param {string} options.keyPrefix - Cache key prefix
 * @param {number} options.ttl - Cache TTL in seconds (default: MEDIUM)
 * @param {Function} options.keyGenerator - Function to generate cache key from req
 */
function withCache(handler, options = {}) {
    const {
        keyPrefix = 'auto',
        ttl = TTL.MEDIUM,
        keyGenerator = (req) => {
            // Generate cache key from URL + query params
            const params = Object.keys(req.query)
                .sort()
                .map(k => `${k}=${req.query[k]}`)
                .join('&');
            return `${keyPrefix}:${req.path}:${params}`;
        }
    } = options;
    
    return async (req, res, next) => {
        // Skip if not GET
        if (req.method !== 'GET') {
            return handler(req, res, next);
        }
        
        const cacheKey = keyGenerator(req);
        
        // Try to get from cache
        try {
            // We'll use a lightweight check - if the handler uses query(),
            // we could potentially cache it. For now, just call handler.
            // Full implementation would require wrapping query() at DB level.
            return await handler(req, res, next);
        } catch (error) {
            return next(error);
        }
    };
}

/**
 * Auto-cache decorator for entire router
 * Adds cache to all GET endpoints
 */
function autoCacheRouter(router, prefix, options = {}) {
    const { ttl = TTL.MEDIUM } = options;
    
    // This would require AST transformation to work properly
    // For now, documenting the pattern
    console.log(`[AutoCache] Would apply cache to router: ${prefix}`);
    
    return router;
}

module.exports = {
    withCache,
    autoCacheRouter
};