'use strict';

/** Express application composition. Importing this module never opens a listener or starts schedulers. */

// Route selection is a security boundary. Resolve it before loading any
// database, route, or observability dependency so contradictory settings fail
// before the process can create a listener or select a fallback route family.
const {
  resolveRepartoRuntime,
  resolveRepartoRouteMode,
  sanitizedRepartoDiagnostic,
  createRepartoWriteGuard,
} = require('./config/reparto-runtime');
const repartoRouteMode = resolveRepartoRouteMode(process.env);
if (!repartoRouteMode.valid) {
  const error = new Error(`Invalid reparto route mode: ${repartoRouteMode.errors.join('; ')}`);
  error.code = 'INVALID_REPARTO_ROUTE_MODE';
  throw error;
}
const repartoRuntime = resolveRepartoRuntime(process.env);
const repartoConfirmationWriteGuard = createRepartoWriteGuard(
  repartoRuntime,
  { requiredCapability: 'confirmation' },
);
const repartoFinanceWriteGuard = createRepartoWriteGuard(
  repartoRuntime,
  { requiredCapability: 'finance' },
);
const repartoWritesEnabledGuard = createRepartoWriteGuard(
  repartoRuntime,
  { requiredCapability: null },
);
function repartoFinanzasWriteGuard(req, res, next) {
  const isConfirmationWrite = req.path === '/rutero/confirm-delivery-cobro'
    || req.path.startsWith('/rutero/evidence/');
  return (isConfirmationWrite ? repartoConfirmationWriteGuard : repartoFinanceWriteGuard)(req, res, next);
}
function repartoFamilyWriteGuard(req, res, next) {
  if (req.path === '/document/send-email') {
    return repartoFinanceWriteGuard(req, res, next);
  }
  // Day-scoped rutero order is app routing metadata, not confirmation ledger.
  if (req.path.startsWith('/rutero/order') || req.path.startsWith('/rutero/tracking')) {
    return repartoWritesEnabledGuard(req, res, next);
  }
  return repartoConfirmationWriteGuard(req, res, next);
}
const USE_TS_ROUTES = repartoRouteMode.useTsRoutes;
const USE_DDD_ROUTES = repartoRouteMode.useDddRoutes;

const Sentry = global.__GMP_SENTRY__ || null;
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { createCanonicalConfirmationBootstrap } = require('./config/reparto-confirmation-bootstrap');
const { createRepartidorLiquidacionBootstrap } = require('./config/repartidor-liquidacion-bootstrap');
const logger = require('./middleware/logger');
const docsRoutes = require('./routes/docs');
const rateLimit = require('express-rate-limit');
const { verifyToken, getSessionStoreReadiness } = require('./middleware/auth');
const {
  query,
  getPoolMetrics,
  runWithDbRequestContext,
  acquireConfiguredConnection,
} = require('./config/db');
const {
    globalLimiter,
    createSecurityHeaders,
    validateContentType,
    cobrosLimiter,
    pedidosLimiter,
    emailLimiter,
    detectSuspiciousAgents,
    validateContentLength,
    addRequestId,
    detectScannerProbes,
    bruteForceIpTracker
} = require('./middleware/security');
const { MIN_YEAR } = require('./utils/common');

// ==================== OPTIMIZATION IMPORTS ====================
const { getCacheStats } = require('./services/redis-cache');
const { networkOptimizer, responseCoalescing } = require('./middleware/network-optimizer');
const { cacheMiddleware, invalidationMiddleware, getCacheStats: getHttpCacheStats } = require('./middleware/http-cache');
const { createOptimizedQuery } = require('./services/query-optimizer');
const { auditMiddleware, getRecentAuditEntries, getActiveSessions } = require('./middleware/audit');
const { createCompressionMiddleware } = require('./middleware/compression');
const { prometheusMetrics, metricsHandler, requireInternalMetricsAccess, canSeeInternalDetails } = require('./middleware/prometheus-metrics');
const { checkAuthPinHashReadiness } = require('./services/auth-pin-readiness');

// =============================================================================
// FEATURE TOGGLE: USE_TS_ROUTES
// Set USE_TS_ROUTES=true to use compiled TypeScript routes (from dist/)
// Set USE_TS_ROUTES=false (default) to use legacy JavaScript routes
// =============================================================================
const repartoDiagnostic = sanitizedRepartoDiagnostic(repartoRuntime, repartoRouteMode);
logger.info(`[REPARTO_RUNTIME] ${JSON.stringify(repartoDiagnostic)}`);
if (!repartoRuntime.valid && process['env'].NODE_ENV !== 'test') {
  logger.warn(`[REPARTO_RUNTIME] Writes blocked: ${repartoRuntime.errors.join('; ')}`);
}

const canonicalRepartidorFinanzasRoutes = require('./routes/repartidor-finanzas');
const canonicalConfirmationBootstrap = createCanonicalConfirmationBootstrap({
  runtime: repartoRuntime,
  db: { acquireConfiguredConnection },
  logger,
});
canonicalRepartidorFinanzasRoutes.setCanonicalConfirmationRuntime(
  canonicalConfirmationBootstrap.runtime,
);
logger.info(`[REPARTO_CONFIRMATION_RUNTIME] ${JSON.stringify(canonicalConfirmationBootstrap.diagnostic)}`);

const canonicalLiquidacionBootstrap = createRepartidorLiquidacionBootstrap({
  runtime: repartoRuntime,
  db: { acquireConfiguredConnection },
  logger,
});
canonicalRepartidorFinanzasRoutes.setCanonicalLiquidacionService(
  canonicalLiquidacionBootstrap.service,
);
logger.info(`[REPARTIDOR_LIQUIDACION_RUNTIME] ${JSON.stringify(canonicalLiquidacionBootstrap.diagnostic)}`);

// =============================================================================
// FEATURE TOGGLE: USE_DDD_ROUTES — DEFAULT TRUE for v4.0.0
// Set USE_DDD_ROUTES=true to use DDD module routes (from src/modules/)
// Set USE_DDD_ROUTES=false to use legacy JavaScript routes
// HEAVY endpoints (clients, commissions, dashboard) use DDD modules with Redis ALL cache
// =============================================================================

function requireOperationalAdmin(req, res, next) {
  const user = req.user || {};
  if (user.role === 'ADMIN' || user.role === 'JEFE_VENTAS' || user.isJefeVentas) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: 'Admin privileges required',
  });
}

let authRoutes, dashboardRoutes, analyticsRoutes, masterRoutes, clientsRoutes,
  plannerRoutes, objectivesRoutes, exportRoutes, chatbotRoutes,
  commissionsRoutes, filtersRoutes, entregasRoutes, repartidorRoutes,
  userActionsRoutes, facturasRoutes, warehouseRoutes,
  productsRoutes, bolsaRoutes, evolutionRoutes,
  pedidosRoutes, cobrosRoutes, kpiModule;

if (USE_TS_ROUTES) {
  // ==================== COMPILED TYPESCRIPT ROUTES ====================
  logger.info('🚀 Loading COMPILED TypeScript routes from dist/');
  try {
    const tsApp = require('./dist/index').default;
    // We don't mount individual routes - the TS app is self-contained
    // Instead we'll mount the entire TS app as middleware
    // (Individual route vars set to empty routers for legacy mount compatibility)
    const { Router } = require('express');
    const emptyRouter = Router();
    authRoutes = emptyRouter;
    dashboardRoutes = emptyRouter;
    analyticsRoutes = emptyRouter;
    masterRoutes = emptyRouter;
    clientsRoutes = emptyRouter;
    plannerRoutes = emptyRouter;
    objectivesRoutes = emptyRouter;
    exportRoutes = emptyRouter;
    chatbotRoutes = emptyRouter;
    commissionsRoutes = emptyRouter;
    filtersRoutes = emptyRouter;
    entregasRoutes = emptyRouter;
    repartidorRoutes = emptyRouter;
    userActionsRoutes = emptyRouter;
    facturasRoutes = emptyRouter;

    // Mount TS app - it handles its own /api prefix, auth, etc.
    // We use a flag so startServer can mount it after middleware
    global.__TS_APP__ = tsApp;
  } catch (err) {
    logger.error(`❌ Failed to load TS routes: ${err.message}`);
    throw err;
  }
}

if (!USE_TS_ROUTES) {
  // ==================== LEGACY JAVASCRIPT ROUTES ====================
  authRoutes = require('./routes/auth');
  dashboardRoutes = require('./routes/dashboard');
  analyticsRoutes = require('./routes/analytics');
  masterRoutes = require('./routes/master');
  clientsRoutes = require('./routes/clients');
  plannerRoutes = require('./routes/planner');
  objectivesRoutes = require('./routes/objectives');
  exportRoutes = require('./routes/export');
  try {
    chatbotRoutes = require('./routes/chatbot');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND' || !err.message.includes('./routes/chatbot')) throw err;
    logger.warn('⚠️ Chatbot route unavailable; /api/chatbot is disabled until backend/routes/chatbot.js is restored');
    chatbotRoutes = express.Router();
    chatbotRoutes.use((req, res) => res.status(503).json({
      success: false,
      error: 'Chatbot API temporarily unavailable',
    }));
  }
  const commissionsModule = require('./routes/commissions');
  commissionsRoutes = commissionsModule.router;
  filtersRoutes = require('./routes/filters');
  entregasRoutes = require('./routes/entregas');
  repartidorRoutes = require('./routes/repartidor');
  userActionsRoutes = require('./routes/user-actions');
  facturasRoutes = require('./routes/facturas');
  warehouseRoutes = require('./routes/warehouse');
  productsRoutes = require('./routes/products');
  bolsaRoutes = require('./routes/bolsa');
  evolutionRoutes = require('./routes/evolution');
  pedidosRoutes = require('./routes/pedidos');
  cobrosRoutes = require('./routes/cobros');
  // Módulo KPI Glacius (DB2/ODBC + Redis)
  try {
    kpiModule = require('./kpi');
  } catch (err) {
    logger.warn(`⚠️ KPI module not available: ${err.message}`);
  }
}

// ==================== DDD MODULE ROUTES ====================
let dddAuthRoutes, dddPedidosRoutes, dddCobrosRoutes;

if (USE_DDD_ROUTES) {
  try {
    const dddAdapters = require('./src/shared/routes/ddd-adapters');
    dddAuthRoutes = dddAdapters.createAuthRoutes();
    dddPedidosRoutes = dddAdapters.createPedidosRoutes();
    dddCobrosRoutes = dddAdapters.createCobrosRoutes();
    logger.info('✅ DDD module routes loaded (src/modules/)');
  } catch (err) {
    logger.error(`❌ Failed to load DDD routes: ${err.message}`);
    throw err;
  }
}

const app = express();
// This process receives client traffic directly. Never trust arbitrary
// X-Forwarded-For values; proxy support needs an explicit reviewed allowlist.
app.set('trust proxy', false);
const HTTP_COMPRESSION_THRESHOLD = parseInt(process.env.HTTP_COMPRESSION_THRESHOLD, 10) || 1024;
const HTTP_COMPRESSION_LEVEL = parseInt(process.env.HTTP_COMPRESSION_LEVEL, 10) || 6;
const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS, 10) || 30000;
const HTTP_LIST_TIMEOUT_MS = parseInt(process.env.HTTP_LIST_TIMEOUT_MS, 10) || HTTP_REQUEST_TIMEOUT_MS;
const HTTP_ACTION_TIMEOUT_MS = parseInt(process.env.HTTP_ACTION_TIMEOUT_MS, 10) || 20000;
const HTTP_REPORT_TIMEOUT_MS = parseInt(process.env.HTTP_REPORT_TIMEOUT_MS, 10) || 60000;
const HTTP_PDF_TIMEOUT_MS = parseInt(process.env.HTTP_PDF_TIMEOUT_MS, 10) || 180000;
const HEALTH_DB_TIMEOUT_MS = parseInt(process.env.HEALTH_DB_TIMEOUT_MS, 10) || 1500;
const HEALTH_DB_CACHE_MS = parseInt(process.env.HEALTH_DB_CACHE_MS, 10) || 5000;

let eventLoopDelay = null;
let dbHealthCache = null;

function resolveRequestTimeoutMs(req) {
  const path = req.path || '';
  const originalUrl = req.originalUrl || path;
  if (path.includes('/pdf')) {
    return HTTP_PDF_TIMEOUT_MS;
  }
  if (
    path.includes('/report') ||
    path.includes('/export') ||
    path.includes('/metrics') ||
    originalUrl.includes('/objectives/evolution') ||
    originalUrl.includes('/objectives/matrix') ||
    originalUrl.includes('/objectives/by-client') ||
    originalUrl.includes('/commissions/summary') ||
    originalUrl.includes('/cobros/pending-summary') ||
    originalUrl.includes('/planner/rutero/day')
  ) {
    return HTTP_REPORT_TIMEOUT_MS;
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return HTTP_ACTION_TIMEOUT_MS;
  }
  if (req.method === 'GET') {
    return HTTP_LIST_TIMEOUT_MS;
  }
  return HTTP_REQUEST_TIMEOUT_MS;
}

function requestTimeoutMiddleware(req, res, next) {
  const timeoutMs = resolveRequestTimeoutMs(req);
  req.setTimeout(timeoutMs);
  res.setTimeout(timeoutMs);
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  function isLateResponse() {
    return Boolean((res.locals.requestTimedOut && !res.locals.sendingTimeoutResponse) || res.writableEnded || res.destroyed);
  }
  res.json = function guardedJson(payload) {
    if (isLateResponse()) {
      logger.warn(`[LATE_RESPONSE_SUPPRESSED] ${req.method} ${req.originalUrl || req.path}`);
      return res;
    }
    return originalJson(payload);
  };
  res.send = function guardedSend(payload) {
    if (isLateResponse()) {
      logger.warn(`[LATE_RESPONSE_SUPPRESSED] ${req.method} ${req.originalUrl || req.path}`);
      return res;
    }
    return originalSend(payload);
  };
  res.end = function guardedEnd(...args) {
    if (isLateResponse()) {
      return res;
    }
    return originalEnd(...args);
  };
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.locals.requestTimedOut = true;
      res.locals.sendingTimeoutResponse = true;
      logger.warn(`[REQUEST_TIMEOUT] ${req.method} ${req.path} timeoutMs=${timeoutMs}`);
      res.status(503).json({
        success: false,
        error: 'Request timeout',
        code: 'REQUEST_TIMEOUT',
      });
      res.locals.sendingTimeoutResponse = false;
    }
  }, timeoutMs);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
}

// Middleware — Security
function configuredCorsOrigin() {
    return process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '';
}

function parseCorsOrigin(value) {
    if (process.env.NODE_ENV === 'production') {
        if (!value || value === 'true' || value === '*') {
            throw new Error('[SECURITY] CORS_ORIGIN must list explicit origins in production');
        }
        return value.split(',').map(o => o.trim()).filter(Boolean);
    }
    if (value === 'true' || value === '*') return true;
    if (value) return value.split(',').map(o => o.trim()).filter(Boolean);
    return true;
}

app.use(cors({
    origin: parseCorsOrigin(configuredCorsOrigin()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cache-Control', 'Pragma', 'X-Force-Refresh', 'X-Request-ID', 'X-App-Version', 'X-Device-Model', 'X-Device-OS', 'X-Device-ID', 'User-Agent', 'X-Internal-Token', 'X-Metrics-Token', 'X-Healthcheck-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Cache-Status', 'ETag', 'Cache-Control'],
    credentials: true,
    maxAge: 86400
}));
app.use(addRequestId);
const telemetryLogger = require('./telemetry/logger');
app.use((req, res, next) => {
  req.log = telemetryLogger.child({ request_id: req.requestId });
  next();
});
app.use(requestTimeoutMiddleware);
app.use((req, res, next) => runWithDbRequestContext({
  requestId: req.requestId,
  method: req.method,
  path: req.path,
  dbDeadlineAt: Date.now() + Math.max(1000, resolveRequestTimeoutMs(req) - 1000),
  req,
}, next));
app.use(detectScannerProbes);
app.use(detectSuspiciousAgents);
app.use(validateContentLength);
app.use(createSecurityHeaders());
app.use(helmet());
app.use(compression({
    threshold: HTTP_COMPRESSION_THRESHOLD,
    level: HTTP_COMPRESSION_LEVEL,
    filter: (req, res) => {
        // Don't compress if client doesn't accept gzip
        const contentType = res.getHeader('Content-Type') || '';
        // Skip compression for already compressed formats
        if (contentType.includes('zip') || contentType.includes('pdf') || contentType.includes('image')) {
            return false;
        }
        // Use compression filter - default is to compress if accept-encoding is set
        return compression.filter(req, res);
    }
}));
app.use(express.json({ limit: '2mb' }));
// Handle JSON parse errors gracefully (prevents 500 on malformed bodies)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn(`[JSON Parse Error] ${req.method} ${req.path} from ${req.ip}: ${err.message}`);
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      hint: 'Ensure Content-Type is application/json and body is valid JSON'
    });
  }
  next(err);
});
app.use(validateContentType);

// ==================== OPTIMIZATION MIDDLEWARE ====================
app.use(prometheusMetrics);  // Prometheus metrics collection (must be before other middleware)
app.use(networkOptimizer);  // HTTP/2 hints, ETag, cache headers
app.use(responseCoalescing); // Combine identical concurrent requests
app.use(invalidationMiddleware); // Cache invalidation on mutations

// ==================== AUDIT MIDDLEWARE (logs IP, user, action) ====================
app.use(auditMiddleware);

// Logging (concise, only method/path/status/duration for PM2)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Only log warnings/errors here — audit middleware handles the rest
    if (res.statusCode >= 400 && req.path !== '/api/health') {
      logger.warn(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// API documentation is mounted before legacy /api path normalization.
// Dedicated limiter: Basic Auth on /docs must not bypass the global rate limit
// (brute-force protection; covers /docs and /docs.json).
let docsLimiter;
function lazyDocsLimiter(req, res, next) {
  if (!docsLimiter) {
    docsLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    });
  }
  return docsLimiter(req, res, next);
}
app.use(['/docs', '/docs.json'], lazyDocsLimiter);
app.use(docsRoutes);

// Path normalization — handle requests arriving without /api prefix.
// Safety net for cases where Cloudflare Tunnel or a reverse proxy strips the
// /api path segment before forwarding to this server.
// Examples fixed: /auth/login → /api/auth/login, /facturas → /api/facturas
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/health')) {
    // Only add /api prefix if the original URL does not already start with /api/
    // This prevents double prefixing when the Flutter client already adds /api
    if (!req.originalUrl.startsWith('/api/')) {
      req.url = '/api' + req.url;
    }
  }
  next();
});

// Rate Limiting
app.use('/api/', globalLimiter);

// NOTE: Login endpoint rate limiting is handled by loginLimiter in routes/auth.js
// Removed AdvancedRateLimiter from login to prevent duplicate rate limiting that
// was causing legitimate users to get 429 after pressing back button and re-login

// Cache stats endpoint (admin only)
app.get('/api/admin/cache-stats', verifyToken, requireOperationalAdmin, (req, res) => {
  const { performanceCache } = require('./src/core/infrastructure/cache/performance-cache');
  res.json({
    performance: performanceCache.getStats(),
    httpCache: getHttpCacheStats(),
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// PUBLIC ROUTES (No Auth Required)
// =============================================================================
if (USE_DDD_ROUTES && dddAuthRoutes) {
  app.use('/api/auth', dddAuthRoutes);
  // Fall-through to legacy for routes DDD doesn't implement yet
  // (/repartidores, /refresh, /logout, /switch-role, etc.)
  app.use('/api/auth', authRoutes);
  logger.info('✅ DDD auth routes mounted (public) + legacy fallback');
} else {
  app.use('/api/auth', authRoutes);
}

// Prometheus metrics endpoint (internal or authorized scraper only)
app.get('/api/metrics', requireInternalMetricsAccess, metricsHandler);

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

async function checkDbHealth() {
  if (dbHealthCache && Date.now() - dbHealthCache.checkedAt < HEALTH_DB_CACHE_MS) {
    return dbHealthCache;
  }

  const dbStart = Date.now();
  try {
    await withTimeout(
      query('SELECT 1 as ok FROM SYSIBM.SYSDUMMY1', false, false),
      HEALTH_DB_TIMEOUT_MS,
      'DB health'
    );
    dbHealthCache = {
      status: 'connected',
      queryTime: Date.now() - dbStart,
      poolMetrics: getPoolMetrics(),
      checkedAt: Date.now(),
    };
  } catch (e) {
    dbHealthCache = {
      status: 'error',
      queryTime: Date.now() - dbStart,
      poolMetrics: getPoolMetrics(),
      error: e.message,
      checkedAt: Date.now(),
    };
  }

  return dbHealthCache;
}

function getRedisHealth() {
  try {
    const { redisCache } = require('./services/redis-cache');
    const stats = redisCache.getStats();
    return {
      status: stats.isConnected ? 'connected' : 'L1_only',
      connected: Boolean(stats.isConnected),
      cacheHitRate: parseFloat(stats.hitRate || 0),
      stats,
    };
  } catch (e) {
    return {
      status: 'error',
      connected: false,
      cacheHitRate: 0,
      stats: {},
      error: e.message,
    };
  }
}

function authRequiresSharedSessionStore() {
  return process.env.NODE_ENV === 'production'
    && (process.env.PM2_EXEC_MODE === 'cluster' || process.env.NODE_APP_INSTANCE !== undefined);
}

// Unified probes remain part of app composition; importing app still starts no listener.
const healthProbes = require('./routes/health-probes');
app.use('/health', healthProbes);

app.get('/api/live', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
app.use('/api/health-check-e2e', require('./routes/health-check-e2e'));

// Health check (public minimal; SRE/internal gets detailed diagnostics)
app.get('/api/health', async (req, res) => {
  const start = Date.now();
  if (!canSeeInternalDetails(req)) {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - start}ms`
    });
  }

  const dbHealth = await checkDbHealth();
  const dbStatus = dbHealth.status;
  const dbQueryTime = dbHealth.queryTime;
  const poolMetrics = dbHealth.poolMetrics;
  const status = dbStatus === 'connected' ? 'ok' : 'degraded';

  const redisHealth = getRedisHealth();

  // Get query optimizer stats
  let queryStats = {};
  try {
    const { getQueryStats } = require('./services/query-optimizer');
    queryStats = getQueryStats ? getQueryStats() : {};
  } catch (e) {
    queryStats = {};
  }

  // Memory usage with detailed breakdown
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const externalMB = Math.round(mem.external / 1024 / 1024);

  // GC info (if available)
  let gcInfo = {};
  if (global.gc) {
    gcInfo = { note: 'GC available - call global.gc() manually if needed' };
  }

  const eventLoopMeanMs = Number.isFinite(eventLoopDelay?.mean)
    ? Math.round(eventLoopDelay.mean / 1e6)
    : 0;
  const eventLoopP95Ms = typeof eventLoopDelay?.percentile === 'function'
    ? Math.round(eventLoopDelay.percentile(95) / 1e6)
    : 0;

  res.json({
    status,
    database: {
      status: dbStatus,
      queryTime: `${dbQueryTime}ms`
    },
    redis: {
      status: redisHealth.status,
      ...redisHealth.stats
    },
    cache: {
      hitRate: `${redisHealth.cacheHitRate}%`,
      ...queryStats
    },
    memory: {
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      heapUsage: `${Math.round(heapUsedMB/heapTotalMB*100)}%`,
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      external: `${externalMB}MB`
    },
    gc: gcInfo,
    eventLoop: { mean: `${eventLoopMeanMs}ms`, p95: `${eventLoopP95Ms}ms` },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    responseTime: `${Date.now() - start}ms`,
    mode: 'modular',
    security: 'enabled',
    version: process['env'].APP_VERSION || '3.3.1',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    dateRange: { from: `${MIN_YEAR}-01-01`, to: 'today' }
  });
});

app.get('/api/ready', requireInternalMetricsAccess, async (req, res) => {
  const start = Date.now();
  const dbHealth = await checkDbHealth();
  const redisHealth = getRedisHealth();
  const authSessionStore = await getSessionStoreReadiness();
  const authPinHashes = dbHealth.status === 'connected'
    ? await checkAuthPinHashReadiness()
    : { status: 'skipped', reason: 'database_not_connected' };
  const liquidacionRequired = canonicalLiquidacionBootstrap.diagnostic.configured === true;
  const liquidacionWritable = !liquidacionRequired || canonicalLiquidacionBootstrap.enabled === true;
  const ready = dbHealth.status === 'connected'
    && authSessionStore.ready === true
    && authPinHashes.status === 'ready'
    && liquidacionWritable;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    database: {
      status: dbHealth.status,
      queryTime: `${dbHealth.queryTime}ms`,
      poolMetrics: dbHealth.poolMetrics,
      error: dbHealth.error,
    },
    redis: {
      status: redisHealth.status,
      required: authSessionStore.required,
      error: redisHealth.error,
      ...redisHealth.stats,
    },
    auth: {
      pinHashes: authPinHashes,
      sessions: authSessionStore,
    },
    reparto: {
      runtime: repartoDiagnostic,
      liquidacion: {
        required: liquidacionRequired,
        writable: liquidacionWritable,
        catalogChecked: canonicalLiquidacionBootstrap.diagnostic.catalogChecked === true,
        catalogVerified: canonicalLiquidacionBootstrap.diagnostic.catalogVerified === true,
        errorCode: canonicalLiquidacionBootstrap.diagnostic.errorCode || null,
      },
    },
    timestamp: new Date().toISOString(),
    responseTime: `${Date.now() - start}ms`,
  });
});

// Version check (Public for mobile app updates)
app.get('/health/version-check', (req, res) => {
  res.json({
    status: 'ok',
    currentVersion: process.env.APP_VERSION || '3.3.1',
    minVersion: process.env.MIN_APP_VERSION || '3.0.0',
    latestVersion: process.env.LATEST_APP_VERSION || '3.3.1',
    updateRequired: false,
    updateUrl: process.env.UPDATE_URL || null,
    timestamp: new Date().toISOString()
  });
});

// Also mount at /api/health/version-check since Flutter ApiClient adds /api prefix
app.get('/api/health/version-check', (req, res) => {
  res.json({
    status: 'ok',
    currentVersion: process.env.APP_VERSION || '3.3.1',
    minVersion: process.env.MIN_APP_VERSION || '3.0.0',
    latestVersion: process.env.LATEST_APP_VERSION || '3.3.1',
    updateRequired: false,
    updateUrl: process.env.UPDATE_URL || null,
    timestamp: new Date().toISOString()
  });
});

// API version endpoint for mobile app compatibility
app.get('/api/app/version', (req, res) => {
  res.json({
    status: 'ok',
    currentVersion: process.env.APP_VERSION || '3.3.1',
    minVersion: process.env.MIN_APP_VERSION || '3.0.0',
    latestVersion: process.env.LATEST_APP_VERSION || '3.3.1',
    updateRequired: false,
    updateUrl: process.env.UPDATE_URL || null,
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// PROTECTED ROUTES (Token Required)
// =============================================================================

// Reparto has exactly one canonical write contract, independent of the
// selected application route family. Keep the guard before every reparto
// family mount so an invalid runtime can never fall through to legacy writes.
app.use('/api/repartidor-finanzas', verifyToken, repartoFinanzasWriteGuard, canonicalRepartidorFinanzasRoutes);
app.use('/api/repartidor', verifyToken, repartoFamilyWriteGuard);
app.use('/api/entregas', verifyToken, repartoConfirmationWriteGuard);

if (USE_TS_ROUTES && global.__TS_APP__) {
  // TS app handles its own auth, routes, and middleware
  app.use(global.__TS_APP__);
  logger.info('✅ TypeScript routes mounted (compiled from src/)');
} else {
  // Legacy JavaScript routes
  app.use('/api', verifyToken);
  app.use('/api', cacheMiddleware); // Authenticated HTTP cache; requires req.user from verifyToken

  // Mount Protected Modules
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', masterRoutes); // mounts /products and /vendedores
  app.use('/api', plannerRoutes); // mounts /router/* and /rutero/*
  // Flutter reparto uses the legacy read contract. Keep it canonical in both
  // JavaScript modes while plannerRoutes remains the sole /rutero owner.
  app.use('/api/entregas', entregasRoutes);
  app.use('/api/objectives', objectivesRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/chatbot', chatbotRoutes);
  app.use('/api/filters', filtersRoutes);
  app.use('/api/repartidor', repartidorRoutes);
  app.use('/api/logs', userActionsRoutes);
  app.use('/api/facturas', facturasRoutes);
  app.use('/api/warehouse', warehouseRoutes);
  if (bolsaRoutes) app.use('/api/bolsa', bolsaRoutes);
  if (evolutionRoutes) app.use('/api/evolution', evolutionRoutes);

  // DDD routes for domains whose public contracts remain canonical in DDD mode.
  if (USE_DDD_ROUTES) {
    app.use('/api/pedidos', pedidosLimiter, dddPedidosRoutes);
    app.use('/api/cobros', cobrosLimiter, dddCobrosRoutes);
    // DDD clients + commissions with performance cache (overrides legacy)
    const dddAdapters = require('./src/shared/routes/ddd-adapters');
    app.use('/api/clients', dddAdapters.createClientsRoutes());
    app.use('/api/commissions', dddAdapters.createCommissionsRoutes());
    // Mount productsRoutes for image/ficha endpoints (not in masterRoutes)
    app.use('/api/products', productsRoutes);
    logger.info('✅ DDD routes mounted at /api/{pedidos,cobros}');
    logger.info('✅ DDD-enhanced: clients + commissions with Redis ALL cache + performanceCache');
    logger.info('✅ Products image/ficha routes mounted at /api/products/:code/{image,ficha}');
  } else {
    // Legacy fallback
    app.use('/api/products', productsRoutes);
    app.use('/api/pedidos', pedidosLimiter, pedidosRoutes);
    app.use('/api/cobros', cobrosLimiter, cobrosRoutes);
  }

  // Legacy fallbacks for client/commission routes not covered by DDD adapters.
  app.use('/api/clients', clientsRoutes);
  app.use('/api/commissions', commissionsRoutes);

  // KPI Glacius module (DB2/ODBC-backed alerts)
  if (kpiModule) {
    app.use('/api/kpi', kpiModule.kpiRoutes);
    logger.info('✅ KPI Glacius routes mounted at /api/kpi');
  }
}
// ==================== OPTIMIZATION MONITORING ENDPOINTS ====================
// Cache statistics endpoint (protected)
app.get('/api/optimization/cache-stats', verifyToken, requireOperationalAdmin, (req, res) => {
  try {
    const stats = getCacheStats();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      cacheStats: stats,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Query optimization stats (protected)
app.get('/api/optimization/query-stats', verifyToken, requireOperationalAdmin, (req, res) => {
  try {
    const { createOptimizedQuery } = require('./services/query-optimizer');
    const optimizedQuery = createOptimizedQuery(query);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      slowQueries: optimizedQuery.getSlowQueries(500),
      queryStats: optimizedQuery.getStats().slice(0, 20),
      indexSuggestions: optimizedQuery.suggestIndexes(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== AUDIT ENDPOINTS (protected, admin only) ====================
// Recent audit log entries (last 500)
app.get('/api/optimization/audit-log', verifyToken, requireOperationalAdmin, (req, res) => {
  try {
    const entries = getRecentAuditEntries();
    const { limit = 100, user, status } = req.query;
    let filtered = entries;
    if (user) filtered = filtered.filter(e => e.user === user);
    if (status) filtered = filtered.filter(e => String(e.status) === status);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total: filtered.length,
      entries: filtered.slice(-parseInt(limit)).reverse() // Most recent first
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Active sessions overview (who's connected, from where)
app.get('/api/optimization/active-sessions', verifyToken, requireOperationalAdmin, (req, res) => {
  try {
    const sessions = getActiveSessions();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      activeSessions: Object.keys(sessions).length,
      sessions
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stable JSON 404 contract for API clients and controller tests.
app.use((req, res) => res.status(404).json({
  success: false,
  code: 'NOT_FOUND',
  error: 'Not found',
}));

// ==================== GLOBAL ERROR HANDLERS ====================
if (Sentry && typeof Sentry.setupExpressErrorHandler === 'function') {
  Sentry.setupExpressErrorHandler(app);
}

// Enhanced error handler with proper error classification
app.use((err, req, res, next) => {
  // Log full error with stack in development
  if (process.env.NODE_ENV !== 'production') {
    logger.error(`❌ Error: ${err.stack || err.message}`);
  } else {
    logger.error(`❌ Error: ${err.message}`);
  }
  
  // Classify error type
  let statusCode = 500;
  let errorMessage = 'Internal Server Error';
  
  if (err.name === 'ValidationError' || err.name === 'ZodError') {
    statusCode = 400;
    errorMessage = 'Validation failed';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    errorMessage = 'Unauthorized';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    errorMessage = 'Forbidden';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    errorMessage = 'Not found';
  } else if (err.code === 'DB_CIRCUIT_OPEN' || err.code === 'DB_QUERY_QUEUE_TIMEOUT' || err.code === 'DB_QUERY_TIMEOUT') {
    statusCode = 503;
    errorMessage = 'Database temporarily unavailable';
  } else if (err.code === 'SQLITE_CANTOPEN' || err.message?.includes('database')) {
    statusCode = 503;
    errorMessage = 'Database unavailable';
  }
  
  // Don't leak internal error details in production
  if (!res.headersSent) {
    res.status(statusCode).json({ 
      error: errorMessage, 
      id: req.requestId,
      ...(process.env.NODE_ENV !== 'production' ? { details: err.message } : {})
    });
  }
});

app.locals.repartoRuntime = repartoRuntime;
app.locals.repartoRouteMode = repartoRouteMode;
app.locals.canonicalLiquidacionBootstrap = canonicalLiquidacionBootstrap;
app.locals.setEventLoopDelayMonitor = (monitor) => { eventLoopDelay = monitor; };

module.exports = app;
