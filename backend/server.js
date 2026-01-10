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
const { loadLaclaeCache } = require('./services/laclae');
const { loadMetadataCache } = require('./services/metadataCache');
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

const app = express();
app.set('trust proxy', 1); // Required for rate limiting behind proxies (ngrok)
const PORT = process.env.PORT || 3334;

// Middleware
app.use(cors());
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
      dateRange: { from: `${MIN_YEAR}-01-01`, to: 'today' },
      endpoints: [
        '/api/auth/login',
        '/api/dashboard/metrics',
        '/api/dashboard/sales-evolution',
        '/api/dashboard/matrix-data',
        '/api/dashboard/recent-sales',
        '/api/clients',
        '/api/clients/:code',
        '/api/clients/:code/sales-history',
        '/api/clients/compare',
        '/api/router/calendar',
        '/api/rutero/week',
        '/api/rutero/day/:day',
        '/api/rutero/client/:code/status',
        '/api/rutero/client/:code/detail',
        '/api/analytics/yoy-comparison',
        '/api/analytics/top-clients',
        '/api/analytics/top-products',
        '/api/analytics/margins',
        '/api/analytics/trends',
        '/api/analytics/sales-history',
        '/api/objectives',
        '/api/objectives/matrix',
        '/api/objectives/evolution',
        '/api/objectives/by-client',
        '/api/export/client-report',
        '/api/chatbot/message',
        '/api/products',
        '/api/vendedores',
        '/api/commissions/summary'
      ]
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

// Start server
async function startServer() {
  await initDb();

  // Initialize Redis cache (non-blocking - works without Redis too)
  initCache()
    .then(() => logger.info('✅ Redis cache initialized'))
    .catch(err => logger.warn(`⚠️ Redis unavailable (using L1 only): ${err.message}`));

  // Start server first so it's responsive
  app.listen(PORT, '0.0.0.0', () => {
    logger.info('═'.repeat(60));
    logger.info(`  GMP Sales Analytics Server - http://192.168.1.238:${PORT}`);
    logger.info(`  Listening on ALL interfaces (0.0.0.0:${PORT})`);
    logger.info(`  Connected to DB2 via ODBC - Real Data`);
    logger.info(`  Security: TOKEN AUTH ENFORCED 🔒`);
    logger.info(`  Optimizations: Redis L1/L2 Cache, Network Optimizer`);
    logger.info('═'.repeat(60));

    // Load caches in background
    loadLaclaeCache().catch(err => logger.warn(`LACLAE cache error: ${err.message}`));
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

