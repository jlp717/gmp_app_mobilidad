/**
 * Advanced Rate Limiter - Per-role, per-IP, per-user rate limiting
 * Prevents abuse while allowing legitimate heavy usage (JEFE ALL queries)
 */

const rateLimitStore = new Map();

const ROLE_LIMITS = {
  JEFE_VENTAS: {
    windowMs: 60000,       // 1 minute window
    maxRequests: 500,       // Increased from 200 to support multi-vendor queries
    maxAllQueries: 100,     // Increased from 30 for jefe with many vendors
    maxConcurrent: 10       // Increased from 5 for parallel loading
  },
  COMERCIAL: {
    windowMs: 60000,
    maxRequests: 300,       // Increased from 150
    maxAllQueries: 50,      // Increased from 10
    maxConcurrent: 5        // Increased from 3
  },
  REPARTIDOR: {
    windowMs: 60000,
    maxRequests: 200,       // Increased from 100
    maxAllQueries: 30,      // Increased from 5
    maxConcurrent: 5        // Increased from 2
  }
};

const IP_LIMITS = {
  windowMs: 900000,     // 15 minutes
  maxRequests: 1000
};

class AdvancedRateLimiter {
  constructor() {
    this._userStore = new Map();
    this._ipStore = new Map();
    this._endpointStore = new Map();
    this._concurrentStore = new Map();
  }

  /**
   * Clean expired entries periodically
   */
  cleanup() {
    const now = Date.now();
    for (const [key, store] of Object.entries({
      user: this._userStore,
      ip: this._ipStore,
      endpoint: this._endpointStore
    })) {
      for (const [k, entry] of store.entries()) {
        if (now > entry.windowEnd) {
          store.delete(k);
        }
      }
    }
  }

  /**
   * Check rate limit for a request
   */
  check(req, role = 'COMERCIAL') {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.code || 'anonymous';
    const endpoint = req.path;
    const isAllQuery = req.query.vendedorCodes === 'ALL';

    const roleLimits = ROLE_LIMITS[role] || ROLE_LIMITS.COMERCIAL;

    // IP-based check
    const ipKey = ip;
    const ipEntry = this._getOrCreateEntry(this._ipStore, ipKey, IP_LIMITS.windowMs);
    if (ipEntry.count >= IP_LIMITS.maxRequests) {
      return {
        allowed: false,
        reason: 'IP_RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((ipEntry.windowEnd - now) / 1000)
      };
    }
    ipEntry.count++;

    // User-based check
    const userKey = `${userId}:${role}`;
    const userEntry = this._getOrCreateEntry(this._userStore, userKey, roleLimits.windowMs);
    if (userEntry.count >= roleLimits.maxRequests) {
      return {
        allowed: false,
        reason: 'USER_RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((userEntry.windowEnd - now) / 1000)
      };
    }
    userEntry.count++;

    // ALL query check (stricter limit)
    if (isAllQuery) {
      const allKey = `${userId}:ALL`;
      const allEntry = this._getOrCreateEntry(this._endpointStore, allKey, roleLimits.windowMs);
      if (allEntry.count >= roleLimits.maxAllQueries) {
        return {
          allowed: false,
          reason: 'ALL_QUERY_RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((allEntry.windowEnd - now) / 1000),
          hint: 'Use cached data or wait for cache refresh'
        };
      }
      allEntry.count++;
    }

    // Concurrent request check
    const concurrentKey = userId;
    const concurrentCount = this._concurrentStore.get(concurrentKey) || 0;
    if (concurrentCount >= roleLimits.maxConcurrent) {
      return {
        allowed: false,
        reason: 'MAX_CONCURRENT_REQUESTS_EXCEEDED',
        retryAfter: 1
      };
    }
    this._concurrentStore.set(concurrentKey, concurrentCount + 1);

    return { allowed: true };
  }

  /**
   * Release concurrent request slot
   */
  release(userId) {
    const count = this._concurrentStore.get(userId) || 0;
    if (count > 0) {
      this._concurrentStore.set(userId, count - 1);
    }
  }

  _getOrCreateEntry(store, key, windowMs) {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now > entry.windowEnd) {
      entry = { count: 0, windowEnd: now + windowMs };
      store.set(key, entry);
    }
    return entry;
  }

  /**
   * Express middleware
   */
  middleware() {
    // Cleanup every 5 minutes
    setInterval(() => this.cleanup(), 300000);

    return (req, res, next) => {
      const role = req.user?.role || 'COMERCIAL';
      const result = this.check(req, role);

      if (!result.allowed) {
        res.set({
          'Retry-After': result.retryAfter,
          'X-RateLimit-Reason': result.reason
        });
        return res.status(429).json({
          error: 'Too Many Requests',
          reason: result.reason,
          retryAfter: result.retryAfter,
          hint: result.hint
        });
      }

      // Release concurrent slot when response finishes
      const userId = req.user?.code;
      if (userId) {
        res.on('finish', () => this.release(userId));
      }

      next();
    };
  }
}

module.exports = { AdvancedRateLimiter, ROLE_LIMITS, IP_LIMITS };
