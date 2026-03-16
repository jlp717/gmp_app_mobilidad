// routes.js: API REST para alertas KPI — consulta, ETL manual, health y métricas (DB2/ODBC)
'use strict';

const { Router } = require('express');
const { kpiQuery, kpiHealthCheck } = require('./config/db');
const { getCachedClientAlerts, getRedisStatus, getLastLoadInfo } = require('./services/redis_cache');
const { runETL } = require('./services/etl_orchestrator');
const { getSchedulerStatus } = require('./services/scheduler');
const { getPrometheusMetrics, metricsMiddleware } = require('./services/metrics');
const { transformAlert } = require('./services/alert_transformer');
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
      SELECT DISTINCT CLIENT_CODE
      FROM JAVIER.KPI_ALERTS
      WHERE IS_ACTIVE = 1
    `;
    const params = [];

    if (type && type !== 'ALL') {
      queryStr += ` AND ALERT_TYPE = ?`;
      params.push(type);
    }

    if (severity && severity !== 'ALL') {
      queryStr += ` AND SEVERITY = ?`;
      params.push(severity);
    }

    const result = await kpiQuery(queryStr, params);
    let clientCodes = result.rows.map(r => (r.CLIENT_CODE || '').trim());

    if (vendorCodesStr && vendorCodesStr !== 'ALL') {
      const codes = vendorCodesStr.split(',').map(c => c.trim()).filter(Boolean);
      if (codes.length > 0) {
        const placeholders = codes.map(() => '?').join(',');
        const vendorQuery = `
          SELECT DISTINCT TRIM(LCCDCL) AS CLIENT_CODE
          FROM DSED.LACLAE
          WHERE TRIM(LCCDVD) IN (${placeholders})
            AND LCAADC >= YEAR(CURRENT_DATE) - 1
            AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT')
        `;
        const vendorClientsResult = await kpiQuery(vendorQuery, codes);
        const validCodes = new Set(vendorClientsResult.rows.map(r => r.CLIENT_CODE.trim()));

        clientCodes = clientCodes.filter(c => validCodes.has(c));
      }
    }

    res.json({
      success: true,
      clientCodes,
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
  const rawData = parseRawData(row.RAW_DATA || row.raw_data);
  const severity = row.SEVERITY || row.severity;

  // Campos originales (retrocompatibilidad)
  const base = {
    id: row.ID || row.id,
    clientCode: row.CLIENT_CODE || row.client_code,
    type,
    severity,
    message: row.MESSAGE || row.message,
    rawData,
    sourceFile: row.SOURCE_FILE || row.source_file,
    createdAt: row.CREATED_AT || row.created_at,
    typeExplanation: getTypeExplanation(type),
  };

  // Campos compactos (nuevos — para UI colapsable)
  try {
    const compact = transformAlert({ alertType: type, severity, message: base.message, rawData });
    base.title = compact.title;
    base.summary = compact.summary;
    base.detail = compact.detail;
    base.actions = compact.actions;
    base.meta = compact.meta;
    base.ui_hint = compact.ui_hint;
  } catch (_) {
    // Fallback: si la transformacion falla, el frontend usa 'message'
  }

  return base;
}

/**
 * Devuelve una explicación breve de cada tipo de alerta para la UI.
 */
function getTypeExplanation(type) {
  const explanations = {
    DESVIACION_VENTAS: 'Ventas vs objetivo anual asignado',
    CUOTA_SIN_COMPRA: 'Cuota asignada sin pedidos realizados',
    DESVIACION_REFERENCIACION: 'Productos que deberia estar comprando',
    PROMOCION: 'Promocion disponible para ofrecer',
    ALTA_CLIENTE: 'Seguimiento de cliente nuevo',
    AVISO: 'Aviso operativo',
    MEDIOS_CLIENTE: 'Equipamiento en el punto de venta',
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
      `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN IS_ACTIVE = 1 THEN 1 ELSE 0 END) AS ACTIVE
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

    // 1. Fetch ALL active alerts with type (single query, filter in Node)
    const allAlertsResult = await kpiQuery(`
      SELECT CLIENT_CODE, ALERT_TYPE, SEVERITY
      FROM JAVIER.KPI_ALERTS WHERE IS_ACTIVE = 1
    `);

    let filteredAlerts = allAlertsResult.rows;

    // 2. Vendor filter: restrict to this vendor's clients
    if (vendorCode && vendorCode !== 'ALL') {
      const vendorClientsQuery = `
        SELECT DISTINCT TRIM(LCCDCL) AS CLIENT_CODE
        FROM DSED.LACLAE
        WHERE TRIM(LCCDVD) = ? AND LCAADC = YEAR(CURRENT_DATE)
          AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT')`;
      const vendorClientsResult = await kpiQuery(vendorClientsQuery, [vendorCode.trim()]);
      const validCodes = new Set(vendorClientsResult.rows.map(r => r.CLIENT_CODE.trim()));

      filteredAlerts = filteredAlerts.filter(a => validCodes.has((a.CLIENT_CODE || '').trim()));
    }

    // 3. Compute totals, byType, and clientsMap — all from the SAME filtered data
    const calcTotals = { TOTAL_ALERTS: 0, TOTAL_CLIENTS: new Set(), CRITICAL: 0, WARNING: 0, INFO: 0 };
    const byTypeMap = {}; // { DESVIACION_VENTAS: { critical: 3, warning: 5, info: 2 } }
    const clientsMap = {};

    for (const row of filteredAlerts) {
      const code = (row.CLIENT_CODE || '').trim();
      const sev = (row.SEVERITY || '').toLowerCase();
      const type = (row.ALERT_TYPE || '').trim();

      calcTotals.TOTAL_ALERTS++;
      calcTotals.TOTAL_CLIENTS.add(code);
      if (sev === 'critical') calcTotals.CRITICAL++;
      if (sev === 'warning') calcTotals.WARNING++;
      if (sev === 'info') calcTotals.INFO++;

      // byType aggregation
      if (!byTypeMap[type]) byTypeMap[type] = { critical: 0, warning: 0, info: 0 };
      if (sev === 'critical') byTypeMap[type].critical++;
      else if (sev === 'warning') byTypeMap[type].warning++;
      else byTypeMap[type].info++;

      // clients aggregation
      if (!clientsMap[code]) clientsMap[code] = { code, total: 0, critical: 0, warning: 0, info: 0, types: new Set() };
      clientsMap[code].total++;
      if (sev === 'critical') clientsMap[code].critical++;
      else if (sev === 'warning') clientsMap[code].warning++;
      else clientsMap[code].info++;
      clientsMap[code].types.add(type);
    }

    // Sort clients: critical first, then warning, then total
    const sortedClients = Object.values(clientsMap)
      .sort((a, b) => b.critical - a.critical || b.warning - a.warning || b.total - a.total)
      .slice(0, 50);

    // 4. Fetch client info from DSEDAC.CLI (name, address, city)
    const clientCodes = sortedClients.map(c => c.code);
    const clientInfo = {}; // code → { name, address, city }
    if (clientCodes.length > 0) {
      try {
        const placeholders = clientCodes.map(() => '?').join(',');
        const cliResult = await kpiQuery(
          `SELECT TRIM(C.CODIGOCLIENTE) AS CODE,
                  COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) AS NAME,
                  TRIM(C.DIRECCION) AS ADDRESS, TRIM(C.POBLACION) AS CITY
           FROM DSEDAC.CLI C
           WHERE C.CODIGOCLIENTE IN (${placeholders})`,
          clientCodes
        );
        for (const r of cliResult.rows) {
          clientInfo[(r.CODE || '').trim()] = {
            name: r.NAME || '',
            address: r.ADDRESS || '',
            city: r.CITY || '',
          };
        }
      } catch (e) {
        logger.warn(`[kpi:api] Error fetching client info: ${e.message}`);
        // Fallback: try to get names from RAW_DATA in alerts
        try {
          const placeholders = clientCodes.map(() => '?').join(',');
          const namesResult = await kpiQuery(
            `SELECT CLIENT_CODE, RAW_DATA FROM JAVIER.KPI_ALERTS
             WHERE CLIENT_CODE IN (${placeholders}) AND IS_ACTIVE = 1
             FETCH FIRST ${clientCodes.length} ROWS ONLY`, clientCodes);
          for (const row of namesResult.rows) {
            const raw = parseRawData(row.RAW_DATA);
            const code = (row.CLIENT_CODE || '').trim();
            if (raw.nombreComercial && !clientInfo[code]) {
              clientInfo[code] = { name: raw.nombreComercial, address: '', city: '' };
            }
          }
        } catch (_) { /* non-critical */ }
      }
    }

    // 5. Fetch detailed alerts per client (with transformation for compact UI)
    const clientAlerts = {}; // code → [{ type, severity, title, summary, detail, actions, ui_hint }]
    if (clientCodes.length > 0) {
      try {
        const placeholders = clientCodes.map(() => '?').join(',');
        const alertsResult = await kpiQuery(
          `SELECT CLIENT_CODE, ALERT_TYPE, SEVERITY, MESSAGE, RAW_DATA
           FROM JAVIER.KPI_ALERTS
           WHERE CLIENT_CODE IN (${placeholders}) AND IS_ACTIVE = 1
           ORDER BY CASE SEVERITY WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`,
          clientCodes
        );
        for (const row of alertsResult.rows) {
          const code = (row.CLIENT_CODE || '').trim();
          if (!clientAlerts[code]) clientAlerts[code] = [];
          const rawData = parseRawData(row.RAW_DATA);
          const compact = transformAlert({
            alertType: row.ALERT_TYPE, severity: row.SEVERITY,
            message: row.MESSAGE, rawData,
          });
          clientAlerts[code].push({
            type: row.ALERT_TYPE,
            severity: (row.SEVERITY || '').toLowerCase(),
            title: compact.title || row.ALERT_TYPE,
            summary: compact.summary || (row.MESSAGE || '').substring(0, 120),
            detail: compact.detail || '',
            actions: compact.actions || [],
            ui_hint: compact.ui_hint || {},
          });
        }
      } catch (e) {
        logger.warn(`[kpi:api] Error fetching client alerts detail: ${e.message}`);
      }
    }

    // 6. Last load info
    const lastLoadResult = await kpiQuery(
      `SELECT LOAD_ID, STATUS, TOTAL_ALERTS, COMPLETED_AT
       FROM JAVIER.KPI_LOADS ORDER BY STARTED_AT DESC FETCH FIRST 1 ROWS ONLY`
    );
    const lastLoad = lastLoadResult.rows[0] || null;

    // Format byType as array with labels
    const typeLabels = {
      DESVIACION_VENTAS: 'Desviacion Ventas',
      CUOTA_SIN_COMPRA: 'Sin Compras',
      DESVIACION_REFERENCIACION: 'Referenciacion',
      PROMOCION: 'Promociones',
      ALTA_CLIENTE: 'Clientes Nuevos',
      AVISO: 'Avisos',
      MEDIOS_CLIENTE: 'Equipamiento',
    };

    // Ordered consistently
    const typeOrder = ['DESVIACION_VENTAS', 'CUOTA_SIN_COMPRA', 'DESVIACION_REFERENCIACION',
      'ALTA_CLIENTE', 'PROMOCION', 'AVISO', 'MEDIOS_CLIENTE'];

    const byType = typeOrder
      .filter(t => byTypeMap[t])
      .map(t => ({
        type: t,
        label: typeLabels[t] || t,
        critical: byTypeMap[t].critical,
        warning: byTypeMap[t].warning,
        info: byTypeMap[t].info,
        total: byTypeMap[t].critical + byTypeMap[t].warning + byTypeMap[t].info,
      }));

    res.json({
      success: true,
      totals: {
        alerts: calcTotals.TOTAL_ALERTS,
        clients: calcTotals.TOTAL_CLIENTS.size,
        critical: calcTotals.CRITICAL,
        warning: calcTotals.WARNING,
        info: calcTotals.INFO,
      },
      byType,
      clients: sortedClients.map(c => {
        const info = clientInfo[c.code] || {};
        return {
          code: c.code,
          name: info.name || '',
          address: info.address || '',
          city: info.city || '',
          total: c.total,
          critical: c.critical,
          warning: c.warning,
          info: c.info,
          types: Array.from(c.types),
          alerts: clientAlerts[c.code] || [],
        };
      }),
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
