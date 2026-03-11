// etl_orchestrator.js: Orquestador ETL — SFTP → parse CSV → reglas → DB2 → Redis cache
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fetchCSVsFromSFTP, loadLocalCSVs } = require('./sftp_client');
const { parseCSV } = require('./csv_parser');
const { PROCESSORS } = require('./alert_rules');
const { kpiQuery } = require('../config/db');
const { invalidateKpiCache, cacheClientAlerts } = require('./redis_cache');
const { recordETLRun, incrementMetric, setMetric } = require('./metrics');
const logger = require('../../middleware/logger');

/**
 * Genera un load_id basado en la semana ISO actual.
 * Formato: YYYY-WNN (ej: 2026-W10)
 */
function generateLoadId(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Ejecuta el pipeline ETL completo.
 * @param {Object} options
 * @param {string} [options.localDir] - Directorio local con CSVs (omitir para SFTP)
 * @param {string} [options.loadId] - Override del load_id (default: semana actual)
 * @param {boolean} [options.force=false] - Forzar re-procesamiento aunque ya exista la carga
 * @returns {Promise<{loadId: string, totalAlerts: number, fileResults: Array}>}
 */
async function runETL({ localDir, loadId, force = false } = {}) {
  const currentLoadId = loadId || generateLoadId();
  const etlStart = Date.now();

  logger.info(`[kpi:etl] Iniciando ETL para load_id=${currentLoadId}`);

  // 1. Idempotencia: comprobar si ya se procesó esta semana
  if (!force) {
    const existing = await kpiQuery(
      'SELECT ID, STATUS, TOTAL_ALERTS FROM JAVIER.KPI_LOADS WHERE LOAD_ID = ?',
      [currentLoadId]
    );
    if (existing.rows.length > 0 && existing.rows[0].STATUS === 'COMPLETED') {
      logger.info(`[kpi:etl] load_id=${currentLoadId} ya completado (${existing.rows[0].TOTAL_ALERTS} alertas). Usa force=true para reprocesar.`);
      return {
        loadId: currentLoadId,
        totalAlerts: existing.rows[0].TOTAL_ALERTS,
        fileResults: [],
        skipped: true,
      };
    }
    // Si está IN_PROGRESS o FAILED, lo reprocesamos — borrar alertas y auditoría hijas
    if (existing.rows.length > 0) {
      await kpiQuery('DELETE FROM JAVIER.KPI_FILE_AUDIT WHERE LOAD_ID = ?', [currentLoadId]);
      await kpiQuery('DELETE FROM JAVIER.KPI_ALERTS WHERE LOAD_ID = ?', [currentLoadId]);
      await kpiQuery('DELETE FROM JAVIER.KPI_LOADS WHERE LOAD_ID = ?', [currentLoadId]);
    }
  } else {
    // Force: limpiar todo de esta carga
    await kpiQuery('DELETE FROM JAVIER.KPI_FILE_AUDIT WHERE LOAD_ID = ?', [currentLoadId]);
    await kpiQuery('DELETE FROM JAVIER.KPI_ALERTS WHERE LOAD_ID = ?', [currentLoadId]);
    await kpiQuery('DELETE FROM JAVIER.KPI_LOADS WHERE LOAD_ID = ?', [currentLoadId]);
  }

  // 2. Obtener archivos CSV (SFTP o local)
  let csvResult;
  let sftpDownloadDir = null;
  if (localDir) {
    csvResult = loadLocalCSVs(localDir);
  } else {
    csvResult = await fetchCSVsFromSFTP();
    sftpDownloadDir = csvResult.dir; // Track for cleanup
  }

  if (csvResult.files.length === 0) {
    recordETLRun({ success: false, duration: Date.now() - etlStart, alertsGenerated: 0, filesProcessed: 0 });
    throw new Error('No hay archivos CSV para procesar');
  }

  // 3. Calcular checksum global
  const globalHash = crypto.createHash('sha256')
    .update(csvResult.files.map((f) => f.hash).join('|'))
    .digest('hex');

  // 4. Crear registro de carga
  const filesList = csvResult.files.map((f) => f.name).join(',');
  await kpiQuery(
    `INSERT INTO JAVIER.KPI_LOADS (LOAD_ID, STATUS, FILES_PROCESSED, CHECKSUM)
     VALUES (?, 'IN_PROGRESS', ?, ?)`,
    [currentLoadId, filesList, globalHash]
  );

  // 5. Desactivar alertas anteriores y limpiar alertas expiradas
  await kpiQuery('UPDATE JAVIER.KPI_ALERTS SET IS_ACTIVE = 0 WHERE IS_ACTIVE = 1');
  await kpiQuery('DELETE FROM JAVIER.KPI_ALERTS WHERE EXPIRES_AT IS NOT NULL AND EXPIRES_AT < CURRENT TIMESTAMP');

  // 6. Procesar cada CSV
  const fileResults = [];
  let totalAlerts = 0;
  const allAlerts = [];
  const errors = [];

  for (const file of csvResult.files) {
    const processor = PROCESSORS[file.name];
    if (!processor) {
      logger.warn(`[kpi:etl] No hay procesador para ${file.name}, omitiendo`);
      continue;
    }

    logger.info(`[kpi:etl] Procesando ${file.name} (${file.size} bytes)...`);

    const { headers, rows, skippedLines, parseErrors } = parseCSV(file.localPath, file.name);

    if (parseErrors.length > 0) {
      incrementMetric('csv_parse_errors', parseErrors.length);
    }

    if (rows.length === 0) {
      logger.warn(`[kpi:etl] ${file.name}: sin datos parseables`);
      fileResults.push({
        name: file.name, rowsTotal: 0, rowsParsed: 0,
        rowsSkipped: skippedLines, alertsGenerated: 0,
        parseErrors,
      });
      continue;
    }

    // Aplicar reglas
    const alerts = processor(rows, headers);

    // Insertar alertas una por una (DB2 ODBC no soporta multi-row VALUES con params)
    if (alerts.length > 0) {
      await insertAlertsBatch(currentLoadId, alerts);
      allAlerts.push(...alerts);
    }

    totalAlerts += alerts.length;

    // Auditoría del archivo
    await kpiQuery(
      `INSERT INTO JAVIER.KPI_FILE_AUDIT
       (LOAD_ID, FILENAME, FILE_SIZE, FILE_HASH, ROWS_TOTAL, ROWS_PARSED, ROWS_SKIPPED, ALERTS_GENERATED, PARSE_ERRORS)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [currentLoadId, file.name, file.size, file.hash,
       rows.length + skippedLines, rows.length, skippedLines, alerts.length,
       JSON.stringify(parseErrors)]
    );

    fileResults.push({
      name: file.name,
      rowsTotal: rows.length + skippedLines,
      rowsParsed: rows.length,
      rowsSkipped: skippedLines,
      alertsGenerated: alerts.length,
      parseErrors,
    });

    logger.info(`[kpi:etl] ${file.name}: ${rows.length} filas → ${alerts.length} alertas`);
  }

  // 7. Marcar carga como completada
  await kpiQuery(
    `UPDATE JAVIER.KPI_LOADS SET STATUS = 'COMPLETED', TOTAL_ALERTS = ?, COMPLETED_AT = CURRENT TIMESTAMP, ERRORS = ?
     WHERE LOAD_ID = ?`,
    [totalAlerts, JSON.stringify(errors), currentLoadId]
  );

  // 8. Actualizar cache Redis por cliente
  await updateRedisCache(allAlerts);

  // 9. Actualizar métricas Prometheus
  const etlDuration = Date.now() - etlStart;
  recordETLRun({
    success: true,
    duration: etlDuration,
    alertsGenerated: totalAlerts,
    filesProcessed: fileResults.length,
  });
  setMetric('active_alerts_total', totalAlerts);
  setMetric('active_clients_total', new Set(allAlerts.map((a) => a.clientCode)).size);

  // 10. Limpiar archivos temporales SFTP
  if (sftpDownloadDir) {
    cleanupTempDir(sftpDownloadDir);
  }

  logger.info(`[kpi:etl] ETL completado: load_id=${currentLoadId}, ${totalAlerts} alertas de ${fileResults.length} archivos (${etlDuration}ms)`);

  return { loadId: currentLoadId, totalAlerts, fileResults, skipped: false };
}

/**
 * Inserta alertas una por una (DB2 ODBC no soporta multi-row INSERT con params).
 */
async function insertAlertsBatch(loadId, alerts) {
  const sql = `INSERT INTO JAVIER.KPI_ALERTS
    (LOAD_ID, CLIENT_CODE, ALERT_TYPE, SEVERITY, MESSAGE, RAW_DATA, SOURCE_FILE, EXPIRES_AT)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP + 7 DAYS)`;

  for (const alert of alerts) {
    await kpiQuery(sql, [
      loadId,
      alert.clientCode,
      alert.alertType,
      alert.severity,
      alert.message,
      JSON.stringify(alert.rawData || {}),
      alert.sourceFile,
    ]);
  }
}

/**
 * Actualiza la cache Redis agrupando alertas por cliente.
 */
async function updateRedisCache(alerts) {
  try {
    const byClient = {};
    for (const alert of alerts) {
      if (!byClient[alert.clientCode]) {
        byClient[alert.clientCode] = [];
      }
      byClient[alert.clientCode].push({
        type: alert.alertType,
        severity: alert.severity,
        message: alert.message,
        source: alert.sourceFile,
      });
    }

    await invalidateKpiCache();

    for (const [clientCode, clientAlerts] of Object.entries(byClient)) {
      await cacheClientAlerts(clientCode, clientAlerts);
    }

    logger.info(`[kpi:etl] Cache Redis actualizada para ${Object.keys(byClient).length} clientes`);
  } catch (err) {
    logger.warn(`[kpi:etl] Error actualizando Redis (no crítico): ${err.message}`);
  }
}

/**
 * Limpia el directorio temporal de SFTP tras el procesamiento.
 */
function cleanupTempDir(dirPath) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      fs.unlinkSync(path.join(dirPath, file));
    }
    fs.rmdirSync(dirPath);
    logger.info(`[kpi:etl] Directorio temporal limpiado: ${dirPath}`);
  } catch (err) {
    logger.warn(`[kpi:etl] Error limpiando temp (no crítico): ${err.message}`);
  }
}

module.exports = { runETL, generateLoadId };
