'use strict';

const logger = require('../middleware/logger');

/**
 * Cross-worker stampede control for route-level Redis fills.
 * One worker computes; others wait on the same cache key instead of
 * launching a second LACLAE GROUP BY.
 */
async function beginRouteFill(cacheKey, {
  waitMs = 20000,
  lockTtlMs = 180000,
  pollMs = 400,
} = {}) {
  const { redisCache } = require('./redis-cache');
  const hit = await redisCache.get('route', cacheKey);
  if (hit) return { hit, fill: false, lock: null };

  const lock = await redisCache.acquireLock('route', `fill:${cacheKey}`, lockTtlMs);
  if (lock) {
    const again = await redisCache.get('route', cacheKey);
    if (again) {
      await redisCache.releaseLock('route', `fill:${cacheKey}`, lock);
      return { hit: again, fill: false, lock: null };
    }
    return { hit: null, fill: true, lock };
  }

  const started = Date.now();
  while (Date.now() - started < waitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const waited = await redisCache.get('route', cacheKey);
    if (waited) return { hit: waited, fill: false, lock: null };
  }
  logger.warn(`[RouteFill] Waited ${waitMs}ms without HIT for ${cacheKey}; computing`);
  return { hit: null, fill: true, lock: null };
}

async function endRouteFill(cacheKey, lock) {
  if (!lock) return;
  const { redisCache } = require('./redis-cache');
  await redisCache.releaseLock('route', `fill:${cacheKey}`, lock);
}

module.exports = { beginRouteFill, endRouteFill };
