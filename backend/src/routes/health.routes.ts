/**
 * Health Check Routes - Production Grade v4.0.0
 * 
 * @agent Observability - Health, readiness, liveness checks
 */

import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { dbPool } from '../core/infrastructure/database/db2-connection-pool';
import { redisCache } from '../core/infrastructure/cache/redis-cache';

const router = Router();

// Basic health
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '4.0.0',
    environment: config.env,
  });
});

// Detailed health with DB and Redis checks
router.get('/api/health', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: string; responseTime?: number }> = {};

  // DB check
  try {
    const start = Date.now();
    await dbPool.query('SELECT 1 as ok FROM SYSIBM.SYSDUMMY1');
    checks.database = { status: 'healthy', responseTime: Date.now() - start };
  } catch {
    checks.database = { status: 'unhealthy' };
  }

  // Redis check
  try {
    const start = Date.now();
    await redisCache.get('health:ping');
    await redisCache.set('health:ping', 'pong', 5);
    checks.redis = { status: 'healthy', responseTime: Date.now() - start };
  } catch {
    checks.redis = { status: redisCache.isConnected ? 'healthy' : 'unavailable' };
  }

  const overallStatus = Object.values(checks).every(c => c.status === 'healthy')
    ? 'healthy'
    : 'degraded';

  res.status(overallStatus === 'healthy' ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '4.0.0',
    checks,
  });
});

// Readiness probe (for Kubernetes/Docker)
router.get('/api/ready', async (_req: Request, res: Response) => {
  const dbHealthy = await dbPool.ping();
  const redisHealthy = redisCache.isConnected;

  if (dbHealthy) {
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'not_ready', reason: 'Database unavailable' });
  }
});

export { router as healthRoutes };
