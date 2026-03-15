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
      // Buscar con ambos formatos: completo GMP y corto Glacius
      const codesToTry = [clientId];
      if (/^4300\d{6}$/.test(clientId)) {
        codesToTry.push(clientId.slice(4).replace(/^0+/, '') || '0');
      }
      if (/^\d{1,6}$/.test(clientId) && !clientId.startsWith('4300')) {
        codesToTry.push('4300' + clientId.padStart(6, '0'));
      }
      conditions.push(`(${codesToTry.map(() => 'a.CLIENT_CODE = ?').join(' OR ')})`);
      params.push(...codesToTry);
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
// Busca tanto con código GMP completo (4300XXXXXX) como con código corto Glacius
// ============================================================
router.get('/alerts/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;

    // Construir variantes de código: completo GMP + corto numérico
    const codesToTry = [clientId];
    // Si es código GMP 4300XXXXXX, añadir variante corta (quitar 4300 y ceros iniciales)
    if (/^4300\d{6}$/.test(clientId)) {
      const shortCode = clientId.slice(4).replace(/^0+/, '') || '0';
      codesToTry.push(shortCode);
    }
    // Si es código corto, añadir variante GMP
    if (/^\d{1,6}$/.test(clientId) && !clientId.startsWith('4300')) {
      codesToTry.push('4300' + clientId.padStart(6, '0'));
    }

    // Intentar cache primero (con todas las variantes)
    for (const code of codesToTry) {
      const cached = await getCachedClientAlerts(code);
      if (cached && cached.length > 0) {
        return res.json({ success: true, source: 'cache', clientId, alerts: cached });
      }
    }

    // Fallback a DB con OR para ambos formatos
    const placeholders = codesToTry.map(() => 'CLIENT_CODE = ?').join(' OR ');
    const result = await kpiQuery(
      `SELECT ID, ALERT_TYPE, SEVERITY, MESSAGE, RAW_DATA, SOURCE_FILE, CREATED_AT
       FROM JAVIER.KPI_ALERTS
       WHERE (${placeholders}) AND IS_ACTIVE = 1
       ORDER BY
         CASE SEVERITY WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
         CREATED_AT DESC`,
      codesToTry
    );

    const alerts = result.rows.map(formatAlert);

    // Log para diagnóstico
    if (alerts.length === 0) {
      logger.info(`[kpi:api] 0 alertas para ${clientId} (variantes: ${codesToTry.join(', ')})`);
    }

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
// GET /api/kpi/alerts/clients
// Retorna códigos de clientes con alertas activas,
// filtrable por vendedor(es), tipo y severidad.
// Usado por Flutter para filtros en Rutero/Clientes.
// ============================================================
router.get('/alerts/clients', async (req, res) => {
  try {
    const vendorCodesStr = req.query.vendedorCodes || req.query.vendorCodes || req.query.vendorCode;
    const { type, severity } = req.query;

    let queryStr = `
      SELECT DISTINCT a.CLIENT_CODE
      FROM JAVIER.KPI_ALERTS a
      WHERE a.IS_ACTIVE = 1
    `;
    const params = [];

    if (vendorCodesStr && vendorCodesStr !== 'ALL') {
      const codes = vendorCodesStr.split(',').map(c => c.trim()).filter(Boolean);
      if (codes.length > 0) {
        const placeholders = codes.map(() => '?').join(',');
        queryStr += ` AND a.CLIENT_CODE IN (
          SELECT TRIM(CDCL) FROM JAVIER.LACLAE WHERE TRIM(CDVI) IN (${placeholders})
        )`;
        params.push(...codes);
      }
    }

    if (type) {
      queryStr += ` AND a.ALERT_TYPE = ?`;
      params.push(type);
    }

    if (severity) {
      queryStr += ` AND a.SEVERITY = ?`;
      params.push(severity);
    }

    const result = await kpiQuery(queryStr, params);

    res.json({
      success: true,
      clientCodes: result.rows.map(r => (r.CLIENT_CODE || '').trim()),
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /alerts/clients: ${err.message}`);
    res.status(500).json({ success: false, error: 'Error obteniendo clientes con alertas' });
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
  const type = row.ALERT_TYPE || row.alert_type || '';
  return {
    id: row.ID || row.id,
    clientCode: row.CLIENT_CODE || row.client_code,
    type,
    severity: row.SEVERITY || row.severity,
    message: row.MESSAGE || row.message,
    rawData: parseRawData(row.RAW_DATA || row.raw_data),
    sourceFile: row.SOURCE_FILE || row.source_file,
    createdAt: row.CREATED_AT || row.created_at,
    typeExplanation: getTypeExplanation(type),
  };
}

/**
 * Devuelve una explicación breve de cada tipo de alerta para la UI.
 */
function getTypeExplanation(type) {
  const explanations = {
    DESVIACION_VENTAS: 'Ventas Nestle vs objetivo anual asignado',
    CUOTA_SIN_COMPRA: 'Cuota Nestle asignada sin pedidos realizados',
    DESVIACION_REFERENCIACION: 'Productos Nestle que deberia estar comprando',
    PROMOCION: 'Promocion Nestle disponible para ofrecer',
    ALTA_CLIENTE: 'Seguimiento de cliente nuevo en Nestle',
    AVISO: 'Aviso operativo de Nestle/Froneri',
    MEDIOS_CLIENTE: 'Equipamiento Nestle en el punto de venta',
  };
  return explanations[type] || '';
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

// ============================================================
// GET /api/kpi/debug/db-status
// Diagnóstico: muestra contenido real de la tabla KPI_ALERTS
// ============================================================
router.get('/debug/db-status', async (req, res) => {
  try {
    const countResult = await kpiQuery(
      `SELECT COUNT(*) AS TOTAL, COUNT(CASE WHEN IS_ACTIVE = 1 THEN 1 END) AS ACTIVE
       FROM JAVIER.KPI_ALERTS`
    );

    const sampleCodes = await kpiQuery(
      `SELECT DISTINCT CLIENT_CODE FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1 FETCH FIRST 20 ROWS ONLY`
    );

    const lastLoad = await kpiQuery(
      `SELECT LOAD_ID, STATUS, TOTAL_ALERTS, STARTED_AT, COMPLETED_AT FROM JAVIER.KPI_LOADS ORDER BY STARTED_AT DESC FETCH FIRST 3 ROWS ONLY`
    );

    const byType = await kpiQuery(
      `SELECT ALERT_TYPE, COUNT(*) AS CNT FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1 GROUP BY ALERT_TYPE`
    );

    res.json({
      success: true,
      total: parseInt(countResult.rows[0]?.TOTAL || 0),
      active: parseInt(countResult.rows[0]?.ACTIVE || 0),
      sampleClientCodes: sampleCodes.rows.map(r => r.CLIENT_CODE),
      alertsByType: byType.rows,
      recentLoads: lastLoad.rows,
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en debug/db-status: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/kpi/dashboard?vendorCode=V01
// Panel resumen Glacius para la app Flutter
// JEFE_VENTAS: todos los clientes | COMERCIAL: solo los suyos
// ============================================================
router.get('/dashboard', async (req, res) => {
  try {
    const { vendorCode } = req.query;

    // 1. Resumen por tipo y severidad
    const summaryResult = await kpiQuery(`
      SELECT ALERT_TYPE, SEVERITY, COUNT(*) AS CNT
      FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1
      GROUP BY ALERT_TYPE, SEVERITY ORDER BY ALERT_TYPE, SEVERITY
    `);

    // 2. Totales globales
    const totalsResult = await kpiQuery(`
      SELECT COUNT(*) AS TOTAL_ALERTS,
             COUNT(DISTINCT CLIENT_CODE) AS TOTAL_CLIENTS,
             COUNT(CASE WHEN SEVERITY = 'critical' THEN 1 END) AS CRITICAL,
             COUNT(CASE WHEN SEVERITY = 'warning' THEN 1 END) AS WARNING,
             COUNT(CASE WHEN SEVERITY = 'info' THEN 1 END) AS INFO
      FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1
    `);

    // 3. Top clientes por severidad (los que mas alertas criticas/warning tienen)
    let topClientsQuery = `
      SELECT a.CLIENT_CODE,
             COUNT(*) AS TOTAL_ALERTS,
             COUNT(CASE WHEN a.SEVERITY = 'critical' THEN 1 END) AS CRITICAL,
             COUNT(CASE WHEN a.SEVERITY = 'warning' THEN 1 END) AS WARNING
      FROM JAVIER.KPI_ALERTS a
      WHERE a.IS_ACTIVE = 1`;
    const topParams = [];

    // Si hay vendorCode, filtrar por clientes de ese vendedor
    if (vendorCode && vendorCode !== 'ALL') {
      topClientsQuery += ` AND a.CLIENT_CODE IN (
        SELECT TRIM(CDCL) FROM JAVIER.LACLAE WHERE TRIM(CDVI) = ?
      )`;
      topParams.push(vendorCode.trim());
    }

    topClientsQuery += `
      GROUP BY a.CLIENT_CODE
      ORDER BY CRITICAL DESC, WARNING DESC, TOTAL_ALERTS DESC
      FETCH FIRST 30 ROWS ONLY`;

    const topClientsResult = await kpiQuery(topClientsQuery, topParams);

    // 4. Ultima carga
    const lastLoadResult = await kpiQuery(
      `SELECT LOAD_ID, STATUS, TOTAL_ALERTS, COMPLETED_AT
       FROM JAVIER.KPI_LOADS ORDER BY STARTED_AT DESC FETCH FIRST 1 ROWS ONLY`
    );

    // 5. Nombres comerciales de los top clientes (si existen en LACLAE)
    const clientCodes = topClientsResult.rows.map(r => r.CLIENT_CODE);
    let clientNames = {};
    if (clientCodes.length > 0) {
      try {
        const placeholders = clientCodes.map(() => '?').join(',');
        const namesResult = await kpiQuery(
          `SELECT TRIM(CDCL) AS CDCL, TRIM(NMCL) AS NMCL
           FROM JAVIER.LACLAE
           WHERE TRIM(CDCL) IN (${placeholders})
           FETCH FIRST ${clientCodes.length} ROWS ONLY`,
          clientCodes
        );
        for (const row of namesResult.rows) {
          clientNames[row.CDCL] = row.NMCL;
        }
      } catch (_) {
        // LACLAE puede no tener todos los codigos
      }
    }

    const totals = totalsResult.rows[0] || {};
    const lastLoad = lastLoadResult.rows[0] || null;

    res.json({
      success: true,
      totals: {
        alerts: parseInt(totals.TOTAL_ALERTS || 0),
        clients: parseInt(totals.TOTAL_CLIENTS || 0),
        critical: parseInt(totals.CRITICAL || 0),
        warning: parseInt(totals.WARNING || 0),
        info: parseInt(totals.INFO || 0),
      },
      byType: summaryResult.rows.map(r => ({
        type: r.ALERT_TYPE,
        severity: r.SEVERITY,
        count: parseInt(r.CNT),
      })),
      topClients: topClientsResult.rows.map(r => ({
        clientCode: r.CLIENT_CODE,
        clientName: clientNames[r.CLIENT_CODE] || null,
        totalAlerts: parseInt(r.TOTAL_ALERTS),
        critical: parseInt(r.CRITICAL),
        warning: parseInt(r.WARNING),
      })),
      lastLoad: lastLoad ? {
        loadId: lastLoad.LOAD_ID,
        status: lastLoad.STATUS,
        totalAlerts: parseInt(lastLoad.TOTAL_ALERTS || 0),
        completedAt: lastLoad.COMPLETED_AT,
      } : null,
    });
  } catch (err) {
    logger.error(`[kpi:api] Error en GET /dashboard: ${err.message}`);
    res.status(500).json({ success: false, error: 'Error obteniendo dashboard KPI' });
  }
});

module.exports = router;
