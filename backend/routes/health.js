/**
 * HEALTH CHECK ROUTE
 * ===================
 * Comprehensive health check with circuit breaker status, cache stats, and DB connectivity
 */

const express = require('express');
const router = express.Router();
const { query, getPoolMetrics } = require('../config/db');
const logger = require('../middleware/logger');
const { handleRouteError } = require('../utils/common');

/**
 * GET /api/health
 * Full system health check
 */
router.get('/', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {},
        circuitBreakers: {},
        cache: {},
        database: {}
    };
    
    // Check database connectivity
    try {
        const start = Date.now();
        await query('SELECT 1 FROM SYSIBM.SYSDUMMY1 FETCH FIRST 1 ROW ONLY');
        const metrics = getPoolMetrics();
        health.database.db2 = {
            status: 'connected',
            latencyMs: Date.now() - start,
            pool: {
                active: metrics.active,
                idle: metrics.idle,
                total: metrics.total,
                min: metrics.min,
                max: metrics.max
            }
        };
    } catch (error) {
        // F2b-04: detalle interno solo en log; respuesta publica generica.
        logger.error(`[HEALTH] DB2 check failed: ${error?.message || error}`);
        health.database.db2 = {
            status: 'error',
            error: 'Base de datos no disponible'
        };
        health.status = 'degraded';
    }
    
    // Check Redis cache (if available)
    try {
        const redisCache = require('../services/redis-cache');
        if (redisCache.redisCache) {
            const stats = redisCache.redisCache.stats;
            health.cache = {
                redis: 'connected',
                l1Hits: stats?.hits?.l1 || 0,
                l2Hits: stats?.hits?.l2 || 0,
                misses: stats?.misses || 0
            };
        } else {
            health.cache.redis = 'not_configured';
        }
    } catch (error) {
        health.cache.redis = 'error';
    }
    
    // Circuit breaker status
    try {
        const monitor = require('../services/circuit-breaker-monitor');
        try {
            monitor.initializeMonitoring();
        } catch (e) { /* Breakers not loaded yet */ }
        health.circuitBreakers = monitor.getHealthSummary();
    } catch (error) {
        // F2b-04: detalle interno solo en log; respuesta publica generica.
        logger.error(`[HEALTH] Circuit breaker check failed: ${error?.message || error}`);
        health.circuitBreakers = { error: 'Monitor no disponible' };
    }
    
    // Memory usage
    const memUsage = process.memoryUsage();
    health.memory = {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
    };
    
    // Set status code based on health
    if (health.status === 'healthy' && health.database.db2?.status !== 'connected') {
        health.status = 'degraded';
    }
    
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

/**
 * GET /api/health/liveness
 * Simple liveness probe (is process running?)
 */
router.get('/liveness', (req, res) => {
    res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

/**
 * GET /api/health/readiness
 * Readiness probe (is DB connected?)
 */
router.get('/readiness', async (req, res) => {
    try {
        await query('SELECT 1 FROM SYSIBM.SYSDUMMY1 FETCH FIRST 1 ROW ONLY');
        res.json({ status: 'ready', database: 'connected' });
    } catch (error) {
        // F2b-04: detalle interno solo en log; respuesta publica generica.
        logger.error(`[HEALTH] Readiness check failed: ${error?.message || error}`);
        res.status(503).json({ status: 'not_ready', database: 'error', error: 'Base de datos no disponible' });
    }
});

/**
 * GET /api/health/circuit-breakers
 * Detailed circuit breaker status
 */
router.get('/circuit-breakers', (req, res) => {
    try {
        const monitor = require('../services/circuit-breaker-monitor');
        const statuses = monitor.getAllStatuses();
        res.json({ circuitBreakers: statuses, summary: monitor.getHealthSummary() });
    } catch (error) {
        // F2b-04: error generico via handler central; detalle solo en log.
        handleRouteError(error, res, 'Error interno del servidor', 500, { code: 'HEALTH_CIRCUIT_ERROR' });
    }
});

/**
 * GET /api/health/cache
 * Cache statistics
 */
router.get('/cache', (req, res) => {
    try {
        const redisCache = require('../services/redis-cache');
        const stats = redisCache.redisCache?.stats || {};
        
        res.json({
            cache: {
                l1: stats.hits?.l1 || 0,
                l2: stats.hits?.l2 || 0,
                misses: stats.misses || 0,
                cacheSize: redisCache.redisCache?.L1_CACHE?.size || 0
            }
        });
    } catch (error) {
        // F2b-04: error generico via handler central; detalle solo en log.
        handleRouteError(error, res, 'Error interno del servidor', 500, { code: 'HEALTH_CACHE_ERROR' });
    }
});

module.exports = router;