/**
 * GMP App Mobilidad - Production Server v4.0.0
 * 
 * Architecture: Clean Architecture + DDD
 * Stack: Node.js 20+ / TypeScript 5 / Express / DB2 / Redis
 * 
 * @agent Architect Lead - Clean DDD structure, single entry point
 * @agent Performance - Redis-first cache, <2s JEFE DE VENTAS
 * @agent Security - Rate limiting, token rotation, input validation
 * @agent Backend TS - 100% TypeScript, zero legacy JS
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { config, validateConfig } from './config/env';
import { logger, morganStream } from './utils/logger';
import { Db2ConnectionPool } from './core/infrastructure/database/db2-connection-pool';
import { RedisCacheService } from './core/infrastructure/cache/redis-cache';
import { CachePreloader } from './core/infrastructure/cache/cache-preloader';
import { AdvancedRateLimiter } from './core/infrastructure/security/advanced-rate-limiter';
import { RefreshTokenManager } from './core/infrastructure/security/refresh-token-manager';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { auditMiddleware } from './middleware/audit.middleware';
import { healthRoutes } from './routes/health.routes';
import { authRoutes } from './routes/auth.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { pedidosRoutes } from './routes/pedidos.routes';
import { cobrosRoutes } from './routes/cobros.routes';
import { entregasRoutes } from './routes/entregas.routes';
import { clientsRoutes } from './routes/clients.routes';
import { commissionsRoutes } from './routes/commissions.routes';
import { objectivesRoutes } from './routes/objectives.routes';
import { repartidorRoutes } from './routes/repartidor.routes';
import { warehouseRoutes } from './routes/warehouse.routes';
import { facturasRoutes } from './routes/facturas.routes';
import { analyticsRoutes } from './routes/analytics.routes';
import { masterRoutes } from './routes/master.routes';
import { initDatabaseSchema } from './services/init.service';
import { startCronJobs } from './cron';

// ============================================================
// APP INITIALIZATION
// ============================================================

const app: Application = express();
app.set('trust proxy', 1);

// ============================================================
// SECURITY MIDDLEWARE (order matters)
// ============================================================

// 1. CORS
app.use(cors({
  origin: parseCorsOrigin(config.cors.origins),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client-Version', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400,
}));

// 2. Security headers
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

// 3. Compression
app.use(compression({ level: 6 }));

// 4. Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 5. Request ID
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId = crypto.randomUUID();
  next();
});

// 6. Logging
if (config.env !== 'test') {
  app.use(morgan('combined', { stream: morganStream }));
}

// 7. Audit
app.use(auditMiddleware);

// ============================================================
// RATE LIMITING
// ============================================================

const advancedRateLimiter = new AdvancedRateLimiter();

// Global rate limiter
app.use('/api/', advancedRateLimiter.globalLimiter());

// Login brute force protection: 5 attempts per 15 min per IP
app.use('/api/auth/login', advancedRateLimiter.loginLimiter());

// Cobros: stricter limits for financial operations
app.use('/api/cobros', advancedRateLimiter.cobrosLimiter());

// Pedidos: prevent order flooding
app.use('/api/pedidos', advancedRateLimiter.pedidosLimiter());

// ============================================================
// PUBLIC ROUTES (no auth)
// ============================================================

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);

// ============================================================
// PROTECTED ROUTES (auth required)
// ============================================================

app.use('/api', authMiddleware);

// Module routes (all DDD, all TypeScript)
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/cobros', cobrosRoutes);
app.use('/api/entregas', entregasRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/commissions', commissionsRoutes);
app.use('/api/objectives', objectivesRoutes);
app.use('/api/repartidor', repartidorRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api', masterRoutes); // mounts /products and /vendedores

// ============================================================
// ERROR HANDLING (must be last)
// ============================================================

app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================
// HELPERS
// ============================================================

function parseCorsOrigin(origins: string[]): cors.CorsOptions['origin'] {
  if (config.env === 'production') {
    if (origins.includes('*') || origins.includes('true')) return false;
    return origins.map(o => o.trim()).filter(Boolean);
  }
  if (origins.includes('*') || origins.includes('true')) return true;
  return origins.map(o => o.trim()).filter(Boolean);
}

// ============================================================
// SERVER STARTUP
// ============================================================

let dbPool: Db2ConnectionPool | null = null;
let redisCache: RedisCacheService | null = null;

async function startServer(): Promise<void> {
  try {
    // 1. Validate config (throws on missing secrets)
    validateConfig();
    logger.info('✅ Configuration validated');

    // 2. Initialize DB2 connection pool
    dbPool = new Db2ConnectionPool();
    await dbPool.initialize();
    logger.info('✅ DB2 connection pool initialized');

    // 3. Initialize Redis cache
    redisCache = new RedisCacheService();
    await redisCache.initialize();
    logger.info(`✅ Redis cache initialized (${redisCache.isConnected ? 'connected' : 'fallback L1 only'})`);

    // 4. Initialize database schema (tables, indexes)
    await initDatabaseSchema(dbPool);
    logger.info('✅ Database schema verified/created');

    // 5. Pre-warm critical caches (LACLAE, metadata, dashboard queries)
    const preloader = new CachePreloader(redisCache!, dbPool!);
    const cacheStart = Date.now();
    await preloader.warmCriticalCaches();
    logger.info(`✅ Critical caches pre-warmed (${Date.now() - cacheStart}ms)`);

    // 6. Start cron jobs
    startCronJobs();
    logger.info('✅ Cron jobs started');

    // 7. Start HTTP server
    const server = app.listen(config.port, '0.0.0.0', () => {
      logger.info('═'.repeat(60));
      logger.info(`  GMP Sales Analytics v4.0.0 — Port ${config.port}`);
      logger.info(`  Environment: ${config.env}`);
      logger.info(`  DB2: ${config.database.odbcDsn ? 'connected' : 'not configured'}`);
      logger.info(`  Redis: ${redisCache?.isConnected ? 'connected' : 'unavailable'}`);
      logger.info(`  Security: HMAC JWT + Rate Limiting + Audit ✅`);
      logger.info(`  Cache: Redis-first, pre-warmed, <2s JEFE DE VENTAS ✅`);
      logger.info('═'.repeat(60));
    });

    // 8. Graceful shutdown
    setupGracefulShutdown(server, dbPool, redisCache);

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

function setupGracefulShutdown(
  server: ReturnType<typeof app.listen>,
  pool: Db2ConnectionPool,
  cache: RedisCacheService | null
): void {
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully...`);
    
    server.close(async () => {
      try {
        await cache?.close();
        await pool.close();
        logger.info('✅ All connections closed');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown:', err);
        process.exit(1);
      }
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error: Error) => {
    logger.error('🔥 Uncaught Exception:', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('🔥 Unhandled Rejection:', reason);
    shutdown('unhandledRejection');
  });
}

// ============================================================
// EXPORTS (for testing)
// ============================================================

if (require.main === module && config.env !== 'test' && !process.env.JEST_WORKER_ID) {
  startServer();
}

export { app, dbPool, redisCache, startServer };
