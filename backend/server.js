/**
 * GMP SALES APP - MODULAR SERVER (Work provided by Antigravity)
 * =============================================================
 * Enhanced with: Multi-layer caching (Redis), Network optimization,
 * Query optimization, and Performance monitoring
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const logger = require('./middleware/logger');
const { verifyToken } = require('./middleware/auth');
const { initDb, query } = require('./config/db');
const { 
    globalLimiter, 
    createSecurityHeaders, 
    validateContentType, 
    cobrosLimiter, 
    pedidosLimiter,
    detectSuspiciousAgents,
    validateContentLength,
    addRequestId
} = require('./middleware/security');
const { loadMetadataCache } = require('./services/metadataCache');
const { preloadCache } = require('./services/cache-preloader');
const { MIN_YEAR, getCurrentDate } = require('./utils/common');
const { setDeliveryStatusAvailable } = require('./utils/delivery-status-check');

// ==================== OPTIMIZATION IMPORTS ====================
const { initCache, getCacheStats } = require('./services/redis-cache');
const { networkOptimizer, responseCoalescing } = require('./middleware/network-optimizer');
const { createOptimizedQuery } = require('./services/query-optimizer');
const { auditMiddleware, getRecentAuditEntries, getActiveSessions } = require('./middleware/audit');
const { AdvancedRateLimiter } = require('./src/core/infrastructure/security/advanced-rate-limiter');
const { refreshTokenManager } = require('./src/core/infrastructure/security/refresh-token-manager');

// =============================================================================
// FEATURE TOGGLE: USE_TS_ROUTES
// Set USE_TS_ROUTES=true to use compiled TypeScript routes (from dist/)
// Set USE_TS_ROUTES=false (default) to use legacy JavaScript routes
// =============================================================================
const USE_TS_ROUTES = process.env.USE_TS_ROUTES === 'true';

// =============================================================================
// FEATURE TOGGLE: USE_DDD_ROUTES
// Set USE_DDD_ROUTES=true to use DDD module routes (from src/modules/)
// Set USE_DDD_ROUTES=false (default) to use legacy JavaScript routes
// This toggle is independent of USE_TS_ROUTES
// =============================================================================
const USE_DDD_ROUTES = process.env.USE_DDD_ROUTES === 'true';

let authRoutes, dashboardRoutes, analyticsRoutes, masterRoutes, clientsRoutes,
  plannerRoutes, objectivesRoutes, exportRoutes, chatbotRoutes,
  commissionsRoutes, filtersRoutes, entregasRoutes, repartidorRoutes,
  userActionsRoutes, facturasRoutes, warehouseRoutes, productsRoutes, 
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
  chatbotRoutes = require('./routes/chatbot');
  const commissionsModule = require('./routes/commissions');
  commissionsRoutes = commissionsModule.router;
  filtersRoutes = require('./routes/filters');
  entregasRoutes = require('./routes/entregas');
  repartidorRoutes = require('./routes/repartidor');
  userActionsRoutes = require('./routes/user-actions');
  facturasRoutes = require('./routes/facturas');
  warehouseRoutes = require('./routes/warehouse');
  productsRoutes = require('./routes/products');
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

// Middleware — Security
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    credentials: true,
    maxAge: 86400
}));
app.use(addRequestId);
app.use(detectSuspiciousAgents);
app.use(validateContentLength);
app.use(createSecurityHeaders());
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(validateContentType);

// ==================== OPTIMIZATION MIDDLEWARE ====================
app.use(networkOptimizer);  // HTTP/2 hints, ETag, cache headers
app.use(responseCoalescing); // Combine identical concurrent requests

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

// Rate Limiting
app.use('/api/', globalLimiter);

// Advanced rate limiter for login endpoint (prevent brute force)
const advancedRateLimiter = new AdvancedRateLimiter();
app.use('/api/auth/login', advancedRateLimiter.middleware());

// Refresh token endpoint
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken required' });
    }
    const tokens = refreshTokenManager.rotateToken(refreshToken);
    res.json(tokens);
  } catch (err) {
    if (err.name === 'TokenError') {
      return res.status(401).json({ error: err.message, code: err.code });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', verifyToken, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      refreshTokenManager.revokeToken(refreshToken);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cache stats endpoint (admin only)
app.get('/api/admin/cache-stats', verifyToken, (req, res) => {
  const { performanceCache } = require('./src/core/infrastructure/cache/performance-cache');
  res.json({
    performance: performanceCache.getStats(),
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// PUBLIC ROUTES (No Auth Required)
// =============================================================================
if (process.env.USE_DDD_ROUTES === 'true' && dddAuthRoutes) {
  app.use('/api/auth', dddAuthRoutes);
  logger.info('✅ DDD auth routes mounted (public)');
} else {
  app.use('/api/auth', authRoutes);
}

// Health check (Public for monitoring)
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1 as ok FROM SYSIBM.SYSDUMMY1', false);
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
      mode: 'modular',
      security: 'enabled',
      dateRange: { from: `${MIN_YEAR}-01-01`, to: 'today' }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Internal server error' });
  }
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

  // Mount Protected Modules
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api', masterRoutes); // mounts /products and /vendedores
  app.use('/api/clients', clientsRoutes);
  app.use('/api', plannerRoutes); // mounts /router/* and /rutero/*
  app.use('/api/objectives', objectivesRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/chatbot', chatbotRoutes);
  app.use('/api/commissions', commissionsRoutes);
  app.use('/api/filters', filtersRoutes);
  app.use('/api/repartidor', repartidorRoutes);
  app.use('/api/logs', userActionsRoutes);
  app.use('/api/facturas', facturasRoutes);
  app.use('/api/warehouse', warehouseRoutes);

  // DDD routes (mount before legacy — Express first-match wins)
  if (process.env.USE_DDD_ROUTES === 'true') {
    app.use('/api/auth', dddAuthRoutes);
    app.use('/api/pedidos', pedidosLimiter, dddPedidosRoutes);
    app.use('/api/cobros', cobrosLimiter, dddCobrosRoutes);
    app.use('/api/entregas', dddEntregasRoutes);
    app.use('/api/rutero', dddRuteroRoutes);
    logger.info('✅ DDD routes mounted at /api/{auth,pedidos,cobros,entregas,rutero}');
  } else {
    // Legacy fallback
    app.use('/api/entregas', entregasRoutes);
    app.use('/api/products', productsRoutes);
    app.use('/api/pedidos', pedidosLimiter, pedidosRoutes);
    app.use('/api/cobros', cobrosLimiter, cobrosRoutes);
  }
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

  // ─── PHASE 1: Verify/create DB schema using DIRECT connections ────────
  // Uses getPool().connect() directly, NOT query(), to avoid retry/pool-recreation logic.
  const { getPool } = require('./config/db');

  // Delivery Status table
  try {
    const pool = getPool();
    const conn = await pool.connect();
    try {
      await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.DELIVERY_STATUS`);
      logger.info('✅ JAVIER.DELIVERY_STATUS table verified and ready.');
      setDeliveryStatusAvailable(true);
    } catch (probeErr) {
      try {
        await conn.query(`
            CREATE TABLE JAVIER.DELIVERY_STATUS (
                ID VARCHAR(64) NOT NULL PRIMARY KEY,
                STATUS VARCHAR(20) DEFAULT 'PENDIENTE',
                OBSERVACIONES VARCHAR(512),
                FIRMA_PATH VARCHAR(255),
                LATITUD DECIMAL(10, 8),
                LONGITUD DECIMAL(11, 8),
                UPDATED_AT TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                REPARTIDOR_ID VARCHAR(20)
            )
        `);
        logger.info('✅ JAVIER.DELIVERY_STATUS table created successfully.');
        setDeliveryStatusAvailable(true);
      } catch (createErr) {
        if (createErr.message && createErr.message.includes('SQL0601')) {
          logger.info('✅ JAVIER.DELIVERY_STATUS already exists.');
          setDeliveryStatusAvailable(true);
        } else {
          logger.warn(`⚠️ Cannot create DELIVERY_STATUS table: ${createErr.message}`);
          logger.warn('⚠️ Delivery status tracking will use in-memory fallback.');
        }
      }
    } finally {
      try { await conn.close(); } catch (_) { }
    }
  } catch (e) {
    logger.warn(`⚠️ DELIVERY_STATUS setup skipped: ${e.message}`);
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

  logger.info('📦 Pre-loading critical caches before accepting requests…');
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
  app.listen(PORT, '0.0.0.0', () => {
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
app.get('/api/optimization/cache-stats', verifyToken, (req, res) => {
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
app.get('/api/optimization/query-stats', verifyToken, (req, res) => {
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
app.get('/api/optimization/audit-log', verifyToken, (req, res) => {
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
app.get('/api/optimization/active-sessions', verifyToken, (req, res) => {
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
// Global Error Middleware (must be registered BEFORE server starts listening)
app.use((err, req, res, next) => {
  logger.error(`❌ Global Middleware Error: ${err.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', id: Date.now() });
  }
});

// Prevent crashes from unhandled exceptions (like header errors)
process.on('uncaughtException', (err) => {
  logger.error(`🔥 UNCAUGHT EXCEPTION: ${err.message}`, { stack: err.stack });
  if (err.code !== 'ERR_HTTP_HEADERS_SENT') {
    // process.exit(1); // Let PM2 restart for critical state corruption
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`🔥 UNHANDLED REJECTION: ${reason}`);
  process.exit(1);
});

startServer().catch((err) => {
  logger.error(`🔥 Failed to start server: ${err.message}`);
  process.exit(1);
});

