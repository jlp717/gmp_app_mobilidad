/**
 * GMP SALES APP - MODULAR SERVER (Work provided by Antigravity)
 * =============================================================
 * Enhanced with: Multi-layer caching (Redis), Network optimization,
 * Query optimization, and Performance monitoring
 */

// Load environment variables FIRST, before any other module
// Use explicit path to ensure .env is found regardless of CWD
const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '.env')
});

const Sentry = require('./instrument');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const logger = require('./middleware/logger');
const { verifyToken, handleRefreshToken, handleLogout } = require('./middleware/auth');
  const { initDb, query, queryWithParams, getPoolMetrics } = require('./config/db');
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
const { loadMetadataCache } = require('./services/metadataCache');
const { preloadCache } = require('./services/cache-preloader');
const { MIN_YEAR, getCurrentDate } = require('./utils/common');
const { setDeliveryStatusAvailable, initSchemaCheck } = require('./utils/delivery-status-check');

// ==================== OPTIMIZATION IMPORTS ====================
const { initCache, getCacheStats } = require('./services/redis-cache');
const { networkOptimizer, responseCoalescing } = require('./middleware/network-optimizer');
const { cacheMiddleware, invalidationMiddleware, getCacheStats: getHttpCacheStats } = require('./middleware/http-cache');
const { createOptimizedQuery } = require('./services/query-optimizer');
const { auditMiddleware, getRecentAuditEntries, getActiveSessions } = require('./middleware/audit');
const { createCompressionMiddleware } = require('./middleware/compression');
const { prometheusMetrics, metricsHandler, requireInternalMetricsAccess, canSeeInternalDetails } = require('./middleware/prometheus-metrics');

// =============================================================================
// FEATURE TOGGLE: USE_TS_ROUTES
// Set USE_TS_ROUTES=true to use compiled TypeScript routes (from dist/)
// Set USE_TS_ROUTES=false (default) to use legacy JavaScript routes
// =============================================================================
const USE_TS_ROUTES = process.env.USE_TS_ROUTES === 'true';

// =============================================================================
// FEATURE TOGGLE: USE_DDD_ROUTES â€” DEFAULT TRUE for v4.0.0
// Set USE_DDD_ROUTES=true to use DDD module routes (from src/modules/)
// Set USE_DDD_ROUTES=false to use legacy JavaScript routes
// HEAVY endpoints (clients, commissions, dashboard) use DDD modules with Redis ALL cache
// =============================================================================
const USE_DDD_ROUTES = process.env.USE_DDD_ROUTES !== 'false';

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
  repartidorFinanzasRoutes, userActionsRoutes, facturasRoutes, warehouseRoutes,
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
    logger.warn('⚠️ Falling back to legacy JavaScript routes');
    process.env.USE_TS_ROUTES = 'false';
    // Fall through to legacy imports below
  }
}

if (process.env.USE_TS_ROUTES !== 'true') {
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
  repartidorFinanzasRoutes = require('./routes/repartidor-finanzas');
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
let dddAuthRoutes, dddPedidosRoutes, dddCobrosRoutes, dddEntregasRoutes, dddRuteroRoutes;

if (USE_DDD_ROUTES) {
  try {
    const dddAdapters = require('./src/shared/routes/ddd-adapters');
    dddAuthRoutes = dddAdapters.createAuthRoutes();
    dddPedidosRoutes = dddAdapters.createPedidosRoutes();
    dddCobrosRoutes = dddAdapters.createCobrosRoutes();
    dddEntregasRoutes = dddAdapters.createEntregasRoutes();
    dddRuteroRoutes = dddAdapters.createRuteroRoutes();
    logger.info('✅ DDD module routes loaded (src/modules/)');
  } catch (err) {
    logger.error(`❌ Failed to load DDD routes: ${err.message}`);
    logger.warn('⚠️ Falling back to legacy JavaScript routes');
    process.env.USE_DDD_ROUTES = 'false';
  }
}

const app = express();
app.set('trust proxy', 1); // Required for rate limiting behind proxies (ngrok)
const PORT = process.env.PORT || 3334;

// Middleware â€” Security
function parseCorsOrigin(value) {
    if (process.env.NODE_ENV === 'production') {
        if (!value || value === 'true' || value === '*') return false;
        return value.split(',').map(o => o.trim()).filter(Boolean);
    }
    if (value === 'true' || value === '*') return true;
    if (value) return value.split(',').map(o => o.trim()).filter(Boolean);
    return true;
}

app.use(cors({
    origin: parseCorsOrigin(process.env.CORS_ORIGIN),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cache-Control', 'Pragma', 'X-Force-Refresh', 'X-Request-ID', 'X-App-Version', 'X-Device-Model', 'X-Device-OS', 'X-Device-ID', 'User-Agent', 'X-Internal-Token', 'X-Metrics-Token', 'X-Healthcheck-Token'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Cache-Status', 'ETag', 'Cache-Control'],
    credentials: true,
    maxAge: 86400
}));
app.use(addRequestId);
app.use(detectScannerProbes);
app.use(detectSuspiciousAgents);
app.use(validateContentLength);
app.use(createSecurityHeaders());
app.use(helmet());
app.use(compression({
    threshold: 256, // Compress responses > 256 bytes (lower threshold = more compression)
    level: 9, // Maximum compression (balance for CPU vs bandwidth)
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
    // Only log warnings/errors here â€” audit middleware handles the rest
    if (res.statusCode >= 400 && req.path !== '/api/health') {
      logger.warn(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

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

// Refresh token endpoint
app.post('/api/auth/refresh', async (req, res) => {
  await handleRefreshToken(req, res);
});

// Logout endpoint
app.post('/api/auth/logout', verifyToken, async (req, res) => {
  await handleLogout(req, res);
});

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
if (process.env.USE_DDD_ROUTES === 'true' && dddAuthRoutes) {
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

// Health check (public minimal; SRE/internal gets detailed diagnostics)
app.get('/api/health', async (req, res) => {
  const start = Date.now();
  let dbStatus = 'disconnected';
  let dbQueryTime = 0;
  let poolMetrics = {};

  try {
    const dbStart = Date.now();
    await query('SELECT 1 as ok FROM SYSIBM.SYSDUMMY1', false);
    dbQueryTime = Date.now() - dbStart;
    dbStatus = 'connected';
    poolMetrics = getPoolMetrics();
  } catch (e) {
    dbStatus = 'error';
  }

  const status = dbStatus === 'connected' ? 'ok' : 'degraded';

  if (!canSeeInternalDetails(req)) {
    return res.json({
      status,
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - start}ms`
    });
  }

  // Get Redis status with detailed stats
  let redisStatus = 'disconnected';
  let cacheHitRate = 0;
  let redisStats = {};
  try {
    const { redisCache } = require('./services/redis-cache');
    const stats = redisCache.getStats();
    redisStats = stats;
    redisStatus = stats.isConnected ? 'connected' : 'L1_only';
    cacheHitRate = parseFloat(stats.hitRate || 0);
  } catch (e) {
    redisStatus = 'error';
  }

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

  // Event loop lag (if available)
  let eventLoopLag = 0;
  try {
    const drift = Date.now() - start;
    eventLoopLag = drift > 5 ? drift - 5 : 0;
  } catch (e) {
    eventLoopLag = 0;
  }

  res.json({
    status,
    database: {
      status: dbStatus,
      queryTime: `${dbQueryTime}ms`
    },
    redis: {
      status: redisStatus,
      ...redisStats
    },
    cache: {
      hitRate: `${cacheHitRate}%`,
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
    eventLoop: { lag: `${eventLoopLag}ms` },
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

if (process.env.USE_TS_ROUTES === 'true' && global.__TS_APP__) {
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
  app.use('/api/objectives', objectivesRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/chatbot', chatbotRoutes);
  app.use('/api/filters', filtersRoutes);
  app.use('/api/repartidor', repartidorRoutes);
  app.use('/api/repartidor-finanzas', repartidorFinanzasRoutes);
  app.use('/api/logs', userActionsRoutes);
  app.use('/api/facturas', facturasRoutes);
  app.use('/api/warehouse', warehouseRoutes);
  if (bolsaRoutes) app.use('/api/bolsa', bolsaRoutes);
  if (evolutionRoutes) app.use('/api/evolution', evolutionRoutes);

  // DDD routes (mount before legacy â€” Express first-match wins)
  if (process.env.USE_DDD_ROUTES !== 'false') {
    app.use('/api/auth', dddAuthRoutes);
    app.use('/api/pedidos', pedidosLimiter, dddPedidosRoutes);
    app.use('/api/cobros', cobrosLimiter, dddCobrosRoutes);
    app.use('/api/entregas', dddEntregasRoutes);
    app.use('/api/rutero', dddRuteroRoutes);
    // DDD clients + commissions with performance cache (overrides legacy)
    const dddAdapters = require('./src/shared/routes/ddd-adapters');
    app.use('/api/clients', dddAdapters.createClientsRoutes());
    app.use('/api/commissions', dddAdapters.createCommissionsRoutes());
    // Mount productsRoutes for image/ficha endpoints (not in masterRoutes)
    app.use('/api/products', productsRoutes);
    logger.info('✅ DDD routes mounted at /api/{auth,pedidos,cobros,entregas,rutero}');
    logger.info('✅ DDD-enhanced: clients + commissions with Redis ALL cache + performanceCache');
    logger.info('✅ Products image/ficha routes mounted at /api/products/:code/{image,ficha}');
  } else {
    // Legacy fallback
    app.use('/api/entregas', entregasRoutes);
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

// Start server
async function startServer() {
  // Validate configuration before starting (throws if JWT secrets missing)
  const { validateConfig } = require('./config/env');
  validateConfig();
  logger.info('✅ Configuration validated successfully');

  await initDb();

  // ─── PHASE 1: Centralized table initialization (init-tables.js) ───────
  const { getPool } = require('./config/db');
  try {
    const { initAllTables } = require('./migrations/init-tables');
    // CRITICAL FIX: init-tables.js ensureColumn() passes (sql, params).
    // query(sql, logQuery, logError) interprets params[] as logQuery=true,
    // causing state=07002 (wrong param count) cascade errors → pool recreate → SQL5051.
    await initAllTables((sql, ...args) => {
      if (args.length > 0 && Array.isArray(args[0])) {
        return queryWithParams(sql, args[0], false, false);
      }
      return query(sql, false, false);
    });
    logger.info('✅ App-specific tables initialized via init-tables.js');
    setDeliveryStatusAvailable(true);

    // Req #18: Schema Audit
    try {
      const { runSchemaAudit } = require('./migrations/schema-audit');
      await runSchemaAudit();
    } catch (auditErr) {
      logger.warn('⚠️  Schema audit skipped: ' + auditErr.message);
    }
  } catch (initErr) {
    logger.warn(`⚠️ init-tables error (non-fatal): ${initErr.message}`);
    // Fallback: check DELIVERY_STATUS manually
    try {
      await query('SELECT 1 FROM JAVIER.DELIVERY_STATUS FETCH FIRST 1 ROW ONLY');
      setDeliveryStatusAvailable(true);
    } catch (_) {
      logger.warn('⚠️ DELIVERY_STATUS unavailable â€” using in-memory fallback.');
    }
  }

  // Detect DELIVERY_STATUS schema version (OLD vs NEW migration 024)
  try {
    await initSchemaCheck();
  } catch (e) {
    logger.warn(`⚠️ DELIVERY_STATUS schema check skipped: ${e.message}`);
  }

  // ─── PHASE 2: Create/verify DB schema (direct connections, no pool recreation) ───
  try {
    const { initWarehouseTables } = require('./routes/warehouse');
    await initWarehouseTables();
  } catch (whErr) {
    logger.warn(`⚠️ Warehouse table setup error (non-fatal): ${whErr.message}`);
  }

  try {
    const { initCommissionTables } = require('./routes/commissions');
    await initCommissionTables();
  } catch (commErr) {
    logger.warn(`⚠️ Commission table setup error (non-fatal): ${commErr.message}`);
  }

  // ─── PHASE 3: Initialize caches (pool is stable, schema is ready) ─────
  initCache()
    .then(() => logger.info('✅ Redis cache initialized'))
    .catch(err => logger.warn(`⚠️ Redis unavailable (using L1 only): ${err.message}`));

  logger.info('📦 Pre-loading critical caches before accepting requestsâ€¦');
  const cacheStart = Date.now();

  try {
    await preloadCache(PORT);
    logger.info(`✅ LACLAE cache ready (${Date.now() - cacheStart}ms)`);
  } catch (err) {
    logger.warn(`⚠️ LACLAE preload error (non-fatal): ${err.message}`);
  }

  try {
    await loadMetadataCache();
    logger.info(`✅ Metadata cache ready (${Date.now() - cacheStart}ms total)`);
  } catch (err) {
    logger.warn(`⚠️ Metadata cache error (non-fatal): ${err.message}`);
  }

  // ─── PHASE 3.5: Initialize Pedidos tables ───
  try {
    const pedidosService = require('./services/pedidos.service');
    await pedidosService.initPedidosTables();
    logger.info('✅ Pedidos tables initialized');
  } catch (err) {
    logger.warn(`⚠️ Pedidos table init error (non-fatal): ${err.message}`);
  }

  // ─── PHASE 3.6: Initialize KPI Glacius module (DB2/ODBC + Redis) ───
  if (kpiModule) {
    try {
      await kpiModule.initKpiModule();
      logger.info('✅ KPI Glacius module initialized');
    } catch (kpiErr) {
      logger.warn(`⚠️ KPI module init error (non-fatal): ${kpiErr.message}`);
    }
  }

  // ─── PHASE 3.7: Initialize DDD modules (if enabled) ───
  if (process.env.USE_DDD_ROUTES === 'true') {
    try {
      const { Db2ConnectionPool } = require('./src/core/infrastructure/database/db2-connection-pool');
      const { ResponseCache } = require('./src/core/infrastructure/cache/response-cache');
      const dddDb = new Db2ConnectionPool();
      await dddDb.initialize();
      logger.info('✅ DDD connection pool initialized');

      const dddCache = new ResponseCache();
      logger.info('✅ DDD response cache initialized');
    } catch (dddErr) {
      logger.error(`❌ DDD module init error: ${dddErr.message}`);
      logger.warn('⚠️ Falling back to legacy routes');
      process.env.USE_DDD_ROUTES = 'false';
    }
  }

  // ─── PHASE 4: Start server (schema ready + caches warm) ───────────────
  const server = app.listen(PORT, '0.0.0.0', () => {
    // Store server reference globally for graceful shutdown
    global.__httpServer = server;
    
    const dddStatus = process.env.USE_DDD_ROUTES === 'true' ? 'DDD Routes ✅' : 'Legacy Routes';
    logger.info('═'.repeat(60));
    logger.info(`  GMP Sales Analytics Server - Port ${PORT}`);
    logger.info(`  Listening on ALL interfaces (0.0.0.0:${PORT})`);
    logger.info(`  Connected to DB2 via ODBC - Real Data`);
    logger.info(`  Security: HMAC TOKEN AUTH 🔒`);
    logger.info(`  Route Mode: ${dddStatus}`);
    logger.info(`  Optimizations: Redis L1/L2 Cache, Network Optimizer`);
    logger.info(`  Caches: LACLAE + Metadata pre-loaded ✅`);
    logger.info('═'.repeat(60));

    // Signal PM2 that we are ready (caches are warm, safe to receive traffic)
    if (process.send) {
      process.send('ready');
    }
  });
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

// Prevent crashes from unhandled exceptions (like header errors)
process.on('uncaughtException', (err) => {
  // Log with logger for proper formatting (stack incluido: sin él no hay
  // forma de diagnosticar el origen de la excepción en producción)
  if (typeof logger !== 'undefined') {
    logger.error(`🔥 UNCAUGHT EXCEPTION: ${err.message}\n${err.stack || '(no stack)'}`);
  } else {
    console.error(`🔥 UNCAUGHT EXCEPTION: ${err.message}`, err.stack);
  }

  // Only exit for truly critical errors; otherwise log and continue
  const criticalCodes = ['ERR_OUT_OF_RANGE', 'ERR_MEMORY'];
  if (criticalCodes.includes(err.code)) {
    if (typeof logger !== 'undefined') {
      logger.error('💀 Critical error — exiting (PM2 will restart)');
    }
    process.exit(1);
  }
  // Non-critical: log and keep running (avoids 181 restarts from transient errors)
});

// Handle unhandled rejections gracefully — DO NOT exit on every rejected promise
// This was the #1 cause of 181 PM2 restarts (any async error = process.exit)
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason instanceof Error
    ? `${reason.message}\n${reason.stack || ''}`
    : String(reason);
  if (typeof logger !== 'undefined') {
    logger.warn(`⚠️ Unhandled promise rejection: ${msg}`);
  } else {
    console.warn(`⚠️ Unhandled promise rejection: ${msg}`);
  }
  // Do NOT process.exit(1) — let the request error handler deal with it
  // Only exit if it's a truly fatal error (out of memory, etc.)
});

// ==================== GRACEFUL SHUTDOWN ====================
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info(`📴 Received ${signal}. Starting graceful shutdown...`);
  
  // 1. Close HTTP server if available
  try {
    if (global.__httpServer && typeof global.__httpServer.close === 'function') {
      global.__httpServer.close(() => {
        logger.info('📴 HTTP server closed');
      });
    }
  } catch (e) {
    logger.warn(`📴 HTTP server close error (non-fatal): ${e.message}`);
  }
  
  // 2. Close DB pool
  try {
    const { getPool } = require('./config/db');
    const pool = getPool();
    if (pool && typeof pool.close === 'function') {
      await pool.close();
      logger.info('📴 Database pool closed');
    }
  } catch (e) {
    logger.warn(`📴 DB close error: ${e.message}`);
  }
  
  // 3. Close Redis cache
  try {
    const { redisCache } = require('./services/redis-cache');
    if (redisCache && typeof redisCache.close === 'function') {
      await redisCache.close();
      logger.info('📴 Redis cache closed');
    }
  } catch (e) {
    // "The client is closed" is expected during shutdown — don't log as warning
    if (e.message && e.message.includes('client is closed')) {
      logger.debug('📴 Redis already closed (expected during shutdown)');
    } else {
      logger.warn(`📴 Redis close error: ${e.message}`);
    }
  }
  
  // 4. Clear LACLAE memory cache
  try {
    const { clearLaclaeCache } = require('./services/laclae');
    if (typeof clearLaclaeCache === 'function') {
      clearLaclaeCache();
      logger.info('📴 LACLAE memory cache cleared');
    }
  } catch (e) {
    logger.warn(`📴 LACLAE cache clear error: ${e.message}`);
  }
  
  // 5. Stop auth session cleanup interval
  try {
    const auth = require('./middleware/auth');
    if (auth && typeof auth.stopSessionCleanup === 'function') {
      auth.stopSessionCleanup();
      logger.info('📴 Auth session cleanup stopped');
    }
  } catch (e) {
    logger.warn(`📴 Auth cleanup error: ${e.message}`);
  }
  
  // 6. Rate limiter (security.js globalLimiter is express-rate-limit, no stopCleanup needed)
  
  logger.info('📴 Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==================== MEMORY MANAGEMENT ====================
// Log memory usage periodically in development
if (process.env.NODE_ENV !== 'production') {
  setInterval(() => {
    const usage = process.memoryUsage();
    logger.debug(`[MEMORY] Heap: ${Math.round(usage.heapUsed / 1024 / 1024)}MB, RSS: ${Math.round(usage.rss / 1024 / 1024)}MB`);
  }, 60000);
}

startServer().catch((err) => {
  logger.error(`🔥 Failed to start server: ${err.message}`);
  process.exit(1);
});

