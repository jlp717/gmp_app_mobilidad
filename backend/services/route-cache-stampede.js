'use strict';

const logger = require('../middleware/logger');

/**
 * Cross-worker stampede control for route-level Redis fills.
 * One worker computes; others wait on the same cache key instead of
 * launching a second LACLAE GROUP BY.
 *
 * If the waiter exceeds waitMs while the filler lock is still held,
 * it must NOT start a second SQL. Routes should 503 + Retry-After.
 */
async function beginRouteFill(cacheKey, {
  waitMs = 45000,
  lockTtlMs = 180000,
  pollMs = 400,
} = {}) {
  const { redisCache } = require('./redis-cache');
  const hit = await redisCache.get('route', cacheKey);
  if (hit) return { hit, fill: false, lock: null, busy: false };

  const lock = await redisCache.acquireLock('route', `fill:${cacheKey}`, lockTtlMs);
  if (lock) {
    const again = await redisCache.get('route', cacheKey);
    if (again) {
      await redisCache.releaseLock('route', `fill:${cacheKey}`, lock);
      return { hit: again, fill: false, lock: null, busy: false };
    }
    return { hit: null, fill: true, lock, busy: false };
  }

  const started = Date.now();
  while (Date.now() - started < waitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const waited = await redisCache.get('route', cacheKey);
    if (waited) return { hit: waited, fill: false, lock: null, busy: false };
  }

  const stillHeld = await redisCache.hasLock('route', `fill:${cacheKey}`);
  if (stillHeld) {
    logger.warn(`[RouteFill] Waited ${waitMs}ms; filler still holds ${cacheKey}; not computing`);
    return { hit: null, fill: false, lock: null, busy: true };
  }

  const takeover = await redisCache.acquireLock('route', `fill:${cacheKey}`, lockTtlMs);
  if (takeover) {
    const afterCrash = await redisCache.get('route', cacheKey);
    if (afterCrash) {
      await redisCache.releaseLock('route', `fill:${cacheKey}`, takeover);
      return { hit: afterCrash, fill: false, lock: null, busy: false };
    }
    logger.warn(`[RouteFill] Filler lock expired for ${cacheKey}; taking over`);
    return { hit: null, fill: true, lock: takeover, busy: false };
  }

  logger.warn(`[RouteFill] Waited ${waitMs}ms without HIT for ${cacheKey}; lock contended`);
  return { hit: null, fill: false, lock: null, busy: true };
}

async function endRouteFill(cacheKey, lock) {
  if (!lock) return;
  const { redisCache } = require('./redis-cache');
  await redisCache.releaseLock('route', `fill:${cacheKey}`, lock);
}

function sendFillBusy(res) {
  res.set('Retry-After', '2');
  return res.status(503).json({
    success: false,
    error: 'El recálculo sigue en curso. Reintenta en un momento.',
    code: 'ROUTE_FILL_BUSY',
    retryAfterSec: 2,
  });
}

module.exports = { beginRouteFill, endRouteFill, sendFillBusy };
