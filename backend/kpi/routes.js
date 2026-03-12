// routes.js: API REST para alertas KPI — consulta, ETL manual, health y métricas (DB2/ODBC)
'use strict';

const { Router } = require('express');
const { kpiQuery, kpiHealthCheck } = require('./config/db');
const { getCachedClientAlerts, getRedisStatus, getLastLoadInfo } = require('./services/redis_cache');
const { runETL } = require('./services/etl_orchestrator');
const { getSchedulerStatus } = require('./services/scheduler');
const { getPrometheusMetrics, metricsMiddleware } = require('./services/metrics');
const logger = require('../middleware/logger');

const router = Router();

// Métricas middleware en todas las rutas KPI
router.use(metricsMiddleware);

// ============================================================
// GET /api/kpi/alerts?clientId=871&type=DESVIACION_VENTAS&severity=critical&since=2026-01-01&page=1&limit=20
// Endpoint principal: alertas KPI para la app Flutter
// ============================================================
router.get('/alerts', async (req, res) => {
  try {
    const { clientId, type, severity, since, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const maxLimit = Math.min(parseInt(limit) || 50, 200);

    // Cache hit para consultas por clientId
    if (clientId && !type && !severity && !since) {
      const cached = await getCachedClientAlerts(clientId);
      if (cached) {
        return res.json({
          success: true,
          source: 'cache',
          alerts: cached,
          total: cached.length,
        });
      }
    }

    // Construir query dinámica con placeholders ? (DB2)
    const conditions = ['a.IS_ACTIVE = 1'];
    const params = [];

    if (clientId) {
      conditions.push('a.CLIENT_CODE = ?');
      params.push(clientId);
    }
    if (type) {
      conditions.push('a.ALERT_TYPE = ?');
      params.push(type);
    }
    if (severity) {
      conditions.push('a.SEVERITY = ?');
      params.push(severity);
    }
    if (since) {
      conditions.push('a.CREATED_AT >= ?');
      params.push(since);
    }

    const whereClause = conditions.join(' AND ');

    // Count total
    const countResult = await kpiQuery(
      `SELECT COUNT(*) AS TOTAL FROM JAVIER.KPI_ALERTS a WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.TOTAL || 0);

    // Fetch page (DB2: OFFSET/FETCH FIRST)
    const dataResult = await kpiQuery(
      `SELECT a.ID, a.CLIENT_CODE, a.ALERT_TYPE, a.SEVERITY, a.MESSAGE,
              a.RAW_DATA, a.SOURCE_FILE, a.CREATED_AT
       FROM JAVIER.KPI_ALERTS a
       WHERE ${whereClause}
       ORDER BY
         CASE a.SEVERITY WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
         a.CREATED_AT DESC
       OFFSET ? ROWS FETCH FIRST ? ROWS ONLY`,
      [...params, offset, maxLimit]
    );

    res.json({
      success: true,
      source: 'db',
      alerts: dataResult.rows.map(formatAlert),
      total,
      page: parseInt(page),
      limit: maxLimit,
      totalPages: Math.ceil(total / maxLimit),
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /alerts: ${err.message}`);
    res.status(500).json({ success: false, error: 'Error consultando alertas' });
  }
});

// ============================================================
// GET /api/kpi/alerts/client/:clientId
// Endpoint optimizado para la ficha de cliente en la app
// ============================================================
router.get('/alerts/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    // Intentar cache primero
    const cached = await getCachedClientAlerts(clientId);
    if (cached) {
      return res.json({ success: true, source: 'cache', clientId, alerts: cached });
    }

    // Fallback a DB
    const result = await kpiQuery(
      `SELECT ID, ALERT_TYPE, SEVERITY, MESSAGE, RAW_DATA, SOURCE_FILE, CREATED_AT
       FROM JAVIER.KPI_ALERTS
       WHERE CLIENT_CODE = ? AND IS_ACTIVE = 1
       ORDER BY
         CASE SEVERITY WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
         CREATED_AT DESC`,
      [clientId]
    );

    const alerts = result.rows.map(formatAlert);

    res.json({ success: true, source: 'db', clientId, alerts });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /alerts/client/${req.params.clientId}: ${err.message}`);
    res.status(500).json({ success: false, error: 'Error consultando alertas del cliente' });
  }
});

// ============================================================
// GET /api/kpi/alerts/summary
// Resumen de alertas activas agrupadas por tipo y severidad
// ============================================================
router.get('/alerts/summary', async (req, res) => {
  try {
    const result = await kpiQuery(`
      SELECT ALERT_TYPE, SEVERITY, COUNT(*) AS COUNT
      FROM JAVIER.KPI_ALERTS
      WHERE IS_ACTIVE = 1
      GROUP BY ALERT_TYPE, SEVERITY
      ORDER BY ALERT_TYPE, SEVERITY
    `);

    const totalResult = await kpiQuery(`
      SELECT COUNT(DISTINCT CLIENT_CODE) AS TOTAL_CLIENTS,
             COUNT(*) AS TOTAL_ALERTS
      FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1
    `);

    res.json({
      success: true,
      summary: result.rows,
      totalClients: parseInt(totalResult.rows[0]?.TOTAL_CLIENTS || 0),
      totalAlerts: parseInt(totalResult.rows[0]?.TOTAL_ALERTS || 0),
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /alerts/summary: ${err.message}`);
    res.status(500).json({ success: false, error: 'Error obteniendo resumen' });
  }
});

// ============================================================
// POST /api/kpi/etl/run
// Dispara el ETL manualmente (admin only)
// ============================================================
router.post('/etl/run', async (req, res) => {
  try {
    const { localDir, force } = req.body || {};

    logger.info(`[kpi:api] ETL manual solicitado por ${req.user?.code || 'unknown'}`);

    const result = await runETL({ localDir, force: force === true });

    res.json({
      success: true,
      loadId: result.loadId,
      totalAlerts: result.totalAlerts,
      skipped: result.skipped || false,
      fileResults: result.fileResults,
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en POST /etl/run: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/kpi/etl/status
// Estado de la última carga ETL
// ============================================================
router.get('/etl/status', async (req, res) => {
  try {
    const loadResult = await kpiQuery(
      `SELECT LOAD_ID, STATUS, FILES_PROCESSED, TOTAL_ALERTS, ERRORS, STARTED_AT, COMPLETED_AT
       FROM JAVIER.KPI_LOADS ORDER BY STARTED_AT DESC FETCH FIRST 5 ROWS ONLY`
    );

    const scheduler = getSchedulerStatus();
    const redis = getRedisStatus();
    const lastLoad = await getLastLoadInfo();

    res.json({
      success: true,
      loads: loadResult.rows,
      scheduler,
      redis,
      lastCacheUpdate: lastLoad,
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /etl/status: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/kpi/health
// Health check del módulo KPI
// ============================================================
router.get('/health', async (req, res) => {
  const dbHealth = await kpiHealthCheck();
  const redis = getRedisStatus();
  const scheduler = getSchedulerStatus();

  // Count active alerts
  let alertStats = { activeAlerts: 0, activeClients: 0 };
  try {
    const statsResult = await kpiQuery(
      `SELECT COUNT(*) AS TOTAL_ALERTS, COUNT(DISTINCT CLIENT_CODE) AS TOTAL_CLIENTS
       FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1`
    );
    if (statsResult.rows[0]) {
      alertStats.activeAlerts = parseInt(statsResult.rows[0].TOTAL_ALERTS || 0);
      alertStats.activeClients = parseInt(statsResult.rows[0].TOTAL_CLIENTS || 0);
    }
  } catch (_) { /* non-critical */ }

  const status = dbHealth.status === 'ok' ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    service: 'kpi-glacius',
    status,
    database: dbHealth,
    redis,
    scheduler,
    alerts: alertStats,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// GET /api/kpi/metrics
// Métricas en formato Prometheus
// ============================================================
router.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(getPrometheusMetrics());
});

// ============================================================
// GET /api/kpi/loads/:loadId/audit
// Auditoría detallada de una carga específica
// ============================================================
router.get('/loads/:loadId/audit', async (req, res) => {
  try {
    const { loadId } = req.params;

    const loadResult = await kpiQuery(
      'SELECT * FROM JAVIER.KPI_LOADS WHERE LOAD_ID = ?', [loadId]
    );
    if (loadResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Carga no encontrada' });
    }

    const filesResult = await kpiQuery(
      'SELECT * FROM JAVIER.KPI_FILE_AUDIT WHERE LOAD_ID = ? ORDER BY PROCESSED_AT', [loadId]
    );

    res.json({
      success: true,
      load: loadResult.rows[0],
      files: filesResult.rows,
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /loads/${req.params.loadId}/audit: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Formatea una alerta DB2 (columnas UPPER) para la respuesta API (camelCase).
 */
function formatAlert(row) {
  // DB2 devuelve columnas en UPPERCASE
  return {
    id: row.ID || row.id,
    clientCode: row.CLIENT_CODE || row.client_code,
    type: row.ALERT_TYPE || row.alert_type,
    severity: row.SEVERITY || row.severity,
    message: row.MESSAGE || row.message,
    rawData: parseRawData(row.RAW_DATA || row.raw_data),
    sourceFile: row.SOURCE_FILE || row.source_file,
    createdAt: row.CREATED_AT || row.created_at,
  };
}

/**
 * Parsea RAW_DATA que en DB2 viene como string CLOB.
 */
function parseRawData(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (_) {
    return {};
  }
}

module.exports = router;
