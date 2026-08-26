'use strict';
/**
 * Kubernetes-style health probes, single source of truth.
 * Mounted at /health/* AND delegated from the legacy /api/live + inline
 * endpoints in server.js so implementations cannot drift apart.
 */

const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

function checkTimeoutMs() {
  return Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 2000;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout after ' + ms + 'ms')), ms)),
  ]);
}

async function checkDatabase() {
  const start = Date.now();
  await withTimeout(query('SELECT 1 FROM SYSIBM.SYSDUMMY1 FETCH FIRST 1 ROW ONLY'), checkTimeoutMs(), 'database');
  return { status: 'connected', latencyMs: Date.now() - start };
}

async function checkRedis() {
  // Lazy require: cache may be disabled entirely.
  const redisCache = require('../services/redis-cache').redisCache;
  if (!redisCache || !redisCache.isConnected || !redisCache.client) {
    return { status: 'not_configured' };
  }
  const start = Date.now();
  await withTimeout(Promise.resolve(redisCache.client.ping()), checkTimeoutMs(), 'redis');
  return { status: 'connected', latencyMs: Date.now() - start };
}

/** GET /health/live — process is up. No external dependencies. */
router.get('/live', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

/** GET /health/ready — Redis ping + DB2 checkout, each within its own budget. */
router.get('/ready', async (req, res) => {
  const checks = {};
  let healthy = true;

  checks.database = await checkDatabase().catch((err) => {
    healthy = false;
    return { status: 'error', error: err.message };
  });
  checks.redis = await checkRedis().catch((err) => {
    healthy = false;
    return { status: 'error', error: err.message };
  });

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ready' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
