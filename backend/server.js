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
const verifyToken = require('./middleware/auth');
const { initDb, query } = require('./config/db');
const { globalLimiter } = require('./middleware/security');
const { loadMetadataCache } = require('./services/metadataCache');
const { preloadCache } = require('./services/cache-preloader');
const { MIN_YEAR, getCurrentDate } = require('./utils/common');

// ==================== OPTIMIZATION IMPORTS ====================
const { initCache, getCacheStats } = require('./services/redis-cache');
const { networkOptimizer, responseCoalescing } = require('./middleware/network-optimizer');
const { createOptimizedQuery } = require('./services/query-optimizer');

// Import Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const masterRoutes = require('./routes/master');
const clientsRoutes = require('./routes/clients');
const plannerRoutes = require('./routes/planner');
const objectivesRoutes = require('./routes/objectives');
const exportRoutes = require('./routes/export');
const chatbotRoutes = require('./routes/chatbot');
const commissionsRoutes = require('./routes/commissions');
const filtersRoutes = require('./routes/filters');
const entregasRoutes = require('./routes/entregas');
const repartidorRoutes = require('./routes/repartidor');
const userActionsRoutes = require('./routes/user-actions');
const facturasRoutes = require('./routes/facturas');

const app = express();
app.set('trust proxy', 1); // Required for rate limiting behind proxies (ngrok)
const PORT = process.env.PORT || 3334;

// Middleware — Security
app.use(cors({
  origin: process.env.CORS_ORIGIN || true, // Restrict in production via CORS_ORIGIN env var
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // Cache preflight for 24h
}));
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '10kb' }));

// ==================== OPTIMIZATION MIDDLEWARE ====================
app.use(networkOptimizer);  // HTTP/2 hints, ETag, cache headers
app.use(responseCoalescing); // Combine identical concurrent requests

// Logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    // Don't log health checks to reduce noise
    if (req.path !== '/api/health') {
      logger[logLevel](`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Rate Limiting
app.use('/api/', globalLimiter);

// =============================================================================
// PUBLIC ROUTES (No Auth Required)
// =============================================================================
app.use('/api/auth', authRoutes);

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
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// =============================================================================
// PROTECTED ROUTES (Token Required)
// =============================================================================
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
app.use('/api/entregas', entregasRoutes);
app.use('/api/repartidor', repartidorRoutes);
app.use('/api/logs', userActionsRoutes);
app.use('/api/facturas', facturasRoutes);

// Start server
async function startServer() {
  await initDb();

  // Ensure Delivery Status Table Exists (Safe Strategy)
  try {
    const checkSql = `SELECT COUNT(*) as CNT FROM SYSIBM.SYSTABLES WHERE TRIM(CREATOR) = 'JAVIER' AND TRIM(NAME) = 'DELIVERY_STATUS'`;
    const result = await query(checkSql, false);
    if (result[0].CNT === 0) {
      logger.info('Creating JAVIER.DELIVERY_STATUS table...');
      await query(`
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
        `, false);
      logger.info('JAVIER.DELIVERY_STATUS created.');
    }
  } catch (e) {
    logger.error(`Error ensuring delivery table: ${e.message}`);
  }

  // Initialize Redis cache (non-blocking - works without Redis too)
  initCache()
    .then(() => logger.info('✅ Redis cache initialized'))
    .catch(err => logger.warn(`⚠️ Redis unavailable (using L1 only): ${err.message}`));

  // Start server first so it's responsive
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('═'.repeat(60));
    logger.info(`  GMP Sales Analytics Server - Port ${PORT}`);
    logger.info(`  Listening on ALL interfaces (0.0.0.0:${PORT})`);
    logger.info(`  Connected to DB2 via ODBC - Real Data`);
    logger.info(`  Security: HMAC TOKEN AUTH 🔒`);
    logger.info(`  Optimizations: Redis L1/L2 Cache, Network Optimizer`);
    logger.info('═'.repeat(60));

    // Start System Preload (Cache Warmup)
    preloadCache(PORT).catch(err => logger.warn(`Preload error: ${err.message}`));
    loadMetadataCache().catch(err => logger.warn(`Metadata cache error: ${err.message}`));
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

startServer();

// ==================== GLOBAL ERROR HANDLERS ====================
// Prevent crashes from unhandled exceptions (like header errors)
process.on('uncaughtException', (err) => {
  logger.error(`🔥 UNCAUGHT EXCEPTION: ${err.message}`, { stack: err.stack });
  // Keep alive if possible, but PM2 will restart if we exit. 
  // For header errors, we can usually continue.
  if (err.code !== 'ERR_HTTP_HEADERS_SENT') {
    // process.exit(1); // Let PM2 restart for critical state corruption
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`🔥 UNHANDLED REJECTION: ${reason}`);
});

// Global Error Middleware (Last resort)
app.use((err, req, res, next) => {
  logger.error(`❌ Global Middleware Error: ${err.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', id: Date.now() });
  }
});

