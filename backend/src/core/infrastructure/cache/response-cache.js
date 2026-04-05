/**
 * Response Cache - L1/L2 caching for API endpoints
 * L1: In-memory Map (fast, per-process)
 * L2: Redis (shared across processes, if available)
 */
const logger = require('../../../middleware/logger');

class ResponseCache {
  constructor() {
    this._l1Cache = new Map();
    this._l2Client = null;
    this._defaultTtl = 300000; // 5 minutes
  }

  async initialize(redisClient) {
    this._l2Client = redisClient;
    logger.info('[Cache] Response cache initialized');
  }

  async get(key) {
    // L1 check
    const l1Entry = this._l1Cache.get(key);
    if (l1Entry && l1Entry.expiresAt > Date.now()) {
      return l1Entry.data;
    }
    if (l1Entry) {
      this._l1Cache.delete(key);
    }

    // L2 check (Redis)
    if (this._l2Client) {
      try {
        const l2Data = await this._l2Client.get(key);
        if (l2Data) {
          const parsed = JSON.parse(l2Data);
          this._l1Cache.set(key, {
            data: parsed,
            expiresAt: Date.now() + this._defaultTtl
          });
          return parsed;
        }
      } catch (err) {
        logger.debug(`[Cache] L2 read error: ${err.message}`);
      }
    }

    return null;
  }

  async set(key, data, ttl) {
    const expiresAt = Date.now() + (ttl || this._defaultTtl);

    // L1 store
    this._l1Cache.set(key, { data, expiresAt });

    // L2 store (Redis)
    if (this._l2Client) {
      try {
        const ttlSeconds = Math.floor((ttl || this._defaultTtl) / 1000);
        await this._l2Client.setex(key, ttlSeconds, JSON.stringify(data));
      } catch (err) {
        logger.debug(`[Cache] L2 write error: ${err.message}`);
      }
    }
  }

  invalidate(key) {
    this._l1Cache.delete(key);
    if (this._l2Client) {
      this._l2Client.del(key).catch(() => {});
    }
  }

  invalidatePattern(pattern) {
    for (const key of this._l1Cache.keys()) {
      if (key.includes(pattern)) {
        this._l1Cache.delete(key);
      }
    }
    if (this._l2Client) {
      this._l2Client.keys(`${pattern}*`).then(keys => {
        if (keys.length > 0) {
          this._l2Client.del(keys).catch(() => {});
        }
      }).catch(() => {});
    }
  }

  clear() {
    this._l1Cache.clear();
  }

  getStats() {
    return {
      l1Size: this._l1Cache.size,
      l2Available: !!this._l2Client,
      defaultTtl: this._defaultTtl
    };
  }
}

module.exports = { ResponseCache };
