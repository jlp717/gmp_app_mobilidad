'use strict';

const path = require('path');
require('./config/load-env').loadEnv(__dirname);

const {
  resolveRepartoRuntime,
  resolveRepartoRouteMode,
} = require('./config/reparto-runtime');
const { assertRepartoStartupMutationPolicy } = require('./config/reparto-startup-mutation-policy');

const repartoRouteMode = resolveRepartoRouteMode(process.env);
if (!repartoRouteMode.valid) {
  const error = new Error(`Invalid reparto route mode: ${repartoRouteMode.errors.join('; ')}`);
  error.code = 'INVALID_REPARTO_ROUTE_MODE';
  throw error;
}
const repartoRuntime = resolveRepartoRuntime(process.env);
assertRepartoStartupMutationPolicy({ env: process.env, repartoRuntime });

const Sentry = require('./instrument');
global.__GMP_SENTRY__ = Sentry;
require('./telemetry/otel');
const app = require('./app');
const { monitorEventLoopDelay } = require('perf_hooks');
const logger = require('./middleware/logger');
const { initDb, closePool } = require('./config/db');
const { initCache, redisCache } = require('./services/redis-cache');
const { preloadCache } = require('./services/cache-preloader');
const { loadMetadataCache } = require('./services/metadataCache');
const { initSchemaCheck } = require('./utils/delivery-status-check');
const {
  startNetworkOptimizerCleanup,
  stopNetworkOptimizerCleanup,
} = require('./middleware/network-optimizer');

const PORT = process.env.PORT || 3335;
const allowedBindHosts = new Set(['0.0.0.0', '127.0.0.1', '::', '::1']);
const BIND_HOST = String(process.env.GMP_BIND_HOST || '0.0.0.0').trim();
if (!allowedBindHosts.has(BIND_HOST)) {
  throw new Error('GMP_BIND_HOST must be an explicit local or wildcard address');
}
const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS, 10) || 30000;
const canonicalLiquidacionBootstrap = app.locals.canonicalLiquidacionBootstrap;
let runtimeMonitoringTimer = null;
let eventLoopDelay = null;
let isShuttingDown = false;

async function startServer() {
  const { validateConfig } = require('./config/env');
  validateConfig();
  logger.info('✅ Configuration validated successfully');

  await initDb();
  if (canonicalLiquidacionBootstrap.diagnostic.configured === true) {
    try {
      await canonicalLiquidacionBootstrap.verifyCatalogReadOnly();
    } catch (error) {
      logger.warn('[REPARTIDOR_LIQUIDACION_RUNTIME] catalog verification failed', {
        code: String(error?.code || 'LIQUIDACION_CAPABILITY_UNAVAILABLE'),
      });
    }
  }
  try { await initSchemaCheck(); } catch (error) { logger.warn(`DELIVERY_STATUS schema check skipped: ${error.message}`); }
  try { await initCache(); } catch (error) { logger.warn(`Redis unavailable (using L1 only): ${error.message}`); }
  try { await preloadCache(PORT); } catch (error) { logger.warn(`LACLAE preload skipped: ${error.message}`); }
  try { await loadMetadataCache(); } catch (error) { logger.warn(`Metadata cache skipped: ${error.message}`); }

  startNetworkOptimizerCleanup();
  startRuntimeMonitoring();
  const server = app.listen(PORT, BIND_HOST, () => {
    global.__httpServer = server;
    if (process.send) process.send('ready');
    try {
      require('./services/reparto-notification-scheduler').startRepartoNotificationScheduler();
    } catch (error) {
      logger.warn(`Reparto notification scheduler unavailable: ${error.message}`);
    }
  });
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(65000, HTTP_REQUEST_TIMEOUT_MS + 5000);
  server.keepAliveTimeout = parseInt(process.env.HTTP_KEEPALIVE_TIMEOUT_MS, 10) || 5000;
  return server;
}

function startRuntimeMonitoring() {
  if (runtimeMonitoringTimer) return runtimeMonitoringTimer;
  eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();
  app.locals.setEventLoopDelayMonitor(eventLoopDelay);
  const intervalMs = parseInt(process.env.MEMORY_LOG_INTERVAL_MS, 10) || 300000;
  runtimeMonitoringTimer = setInterval(() => {
    const usage = process.memoryUsage();
    const p95 = Math.round(eventLoopDelay.percentile(95) / 1e6);
    logger.info(`[RUNTIME] heap=${Math.round(usage.heapUsed / 1024 / 1024)}MB rss=${Math.round(usage.rss / 1024 / 1024)}MB eventLoopP95=${p95}ms`);
    eventLoopDelay.reset();
  }, intervalMs);
  runtimeMonitoringTimer.unref?.();
  return runtimeMonitoringTimer;
}

function stopRuntimeMonitoring() {
  if (runtimeMonitoringTimer) clearInterval(runtimeMonitoringTimer);
  runtimeMonitoringTimer = null;
  eventLoopDelay?.disable();
  eventLoopDelay = null;
  app.locals.setEventLoopDelayMonitor(null);
}

async function gracefulShutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  stopNetworkOptimizerCleanup();
  stopRuntimeMonitoring();
  try {
    require('./services/reparto-notification-scheduler').stopRepartoNotificationScheduler();
  } catch (error) {
    logger.warn(`Reparto scheduler stop error: ${error.message}`);
  }
  if (global.__httpServer?.close) {
    await new Promise((resolve) => global.__httpServer.close(resolve));
  }
  try { await closePool(); } catch (error) { logger.warn(`DB close error: ${error.message}`); }
  try { await redisCache?.close?.(); } catch (error) { logger.warn(`Redis close error: ${error.message}`); }
  logger.info(`Graceful shutdown complete (${signal})`);
  if (require.main === module) process.exit(exitCode);
}

// app requestTimeoutMiddleware preserves requestTimedOut and LATE_RESPONSE_SUPPRESSED behavior.
module.exports = { app, startServer, gracefulShutdown };

if (require.main === module) {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  startServer().catch((error) => {
    logger.error(`Failed to start server: ${error.message}`);
    stopNetworkOptimizerCleanup();
    stopRuntimeMonitoring();
    process.exit(1);
  });
}
