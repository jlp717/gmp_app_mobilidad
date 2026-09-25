// scheduler.js: Planificador diario del ETL Glacius con node-schedule
// Ejecuta a las 7:00 AM Europe/Madrid (lunes a viernes)
// Catch-up documentado: vive en memoria del proceso Node; cada restart PM2 lo
// mata hasta rearranque. Al arrancar, checkMissedRun() ejecuta UNA vez el
// LOAD_ID=YYYY-WNN de la semana en curso si esta pendiente y el scheduler esta
// habilitado. Idempotente por KPI_LOADS (COMPLETED -> skip). No mata PM2 ni
// duplica LOAD_ID: guard IN_PROGRESS reciente + flag en memoria por worker.
'use strict';

const schedule = require('node-schedule');
const { runETL, generateLoadId } = require('./etl_orchestrator');
const { kpiQuery } = require('../config/db');
const logger = require('../../middleware/logger');
const SCHEMA = process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER';

let scheduledJob = null;
let catchUpRunning = false;
// Ventana en la que un IN_PROGRESS se considera "otro worker en marcha".
const IN_PROGRESS_GUARD_MINUTES = 120;

// Timezone para España peninsular (CET/CEST con cambio automático)
const TZ = process.env.KPI_ETL_TZ || 'Europe/Madrid';
// Cron: 7:00 AM, lunes a viernes (los CSVs se suben la noche anterior)
const DEFAULT_CRON = '0 7 * * 1-5';

/**
 * Verifica en el arranque si la ejecución ETL de la semana actual fue omitida
 * (p.ej. por reinicio de PM2 después de la hora programada).
 * Si no se completó y es día laborable, ejecuta el ETL inmediatamente.
 */
async function checkMissedRun() {
  // Guard en memoria: evita doble catch-up dentro del mismo worker.
  if (catchUpRunning) {
    logger.debug('[kpi:scheduler] Catch-up ya en marcha en este worker, skip');
    return;
  }
  try {
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
    const dow = tzNow.getDay(); // 0=Sun

    // Solo lunes a viernes
    if (dow === 0 || dow === 6) {
      logger.debug('[kpi:scheduler] Catch-up: fin de semana, skip');
      return;
    }

    const currentLoadId = generateLoadId();
    const existing = await kpiQuery(
      `SELECT ID, STATUS, STARTED_AT FROM ${SCHEMA}.KPI_LOADS WHERE LOAD_ID = ?`,
      [currentLoadId]
    );

    if (existing.rows.length > 0 && existing.rows[0].STATUS === 'COMPLETED') {
      logger.info(`[kpi:scheduler] Catch-up: ${currentLoadId} ya completado`);
      return;
    }

    // No duplica LOAD_ID: si otro worker PM2 lo dejo IN_PROGRESS reciente, skip.
    if (existing.rows.length > 0 && existing.rows[0].STATUS === 'IN_PROGRESS') {
      const started = existing.rows[0].STARTED_AT ? new Date(existing.rows[0].STARTED_AT) : null;
      const ageMin = started && !Number.isNaN(started.getTime())
        ? (Date.now() - started.getTime()) / 60000
        : Number.POSITIVE_INFINITY;
      if (ageMin < IN_PROGRESS_GUARD_MINUTES) {
        logger.info(`[kpi:scheduler] Catch-up: ${currentLoadId} IN_PROGRESS reciente (otro worker), skip sin duplicar`);
        return;
      }
      logger.warn(`[kpi:scheduler] Catch-up: ${currentLoadId} IN_PROGRESS rancio (> ${IN_PROGRESS_GUARD_MINUTES}min), reprocesa via runETL`);
    }

    catchUpRunning = true;
    try {
      logger.info(`[kpi:scheduler] Catch-up: ejecutando ETL para ${currentLoadId} (semana pendiente)...`);
      const result = await runETL();
      if (result.skipped) {
        logger.info(`[kpi:scheduler] Catch-up: ETL omitido (${result.loadId})`);
      } else {
        const gaps = (result.missingAlertTypes || []).join(', ') || 'ninguno';
        logger.info(`[kpi:scheduler] Catch-up completado: ${result.totalAlerts} alertas de ${result.fileResults.length} archivos (gaps: ${gaps})`);
      }
    } finally {
      catchUpRunning = false;
    }
  } catch (err) {
    catchUpRunning = false;
    logger.error(`[kpi:scheduler] Error en catch-up ETL: ${err.message}`);
  }
}

/**
 * Inicia el job programado para ejecutar el ETL diariamente.
 * Por defecto: 7:00 AM Europe/Madrid, lunes a viernes.
 * Además ejecuta checkMissedRun() para recuperar ejecuciones
 * perdidas por reinicios antes de la hora programada.
 */
function startScheduler() {
  const cronExpr = process.env.KPI_ETL_CRON || DEFAULT_CRON;

  // node-schedule con timezone: usa RecurrenceRule
  const rule = new schedule.RecurrenceRule();
  rule.tz = TZ;

  // Parse cron para extraer valores
  const parts = cronExpr.split(' ');
  rule.minute = parseInt(parts[0], 10);
  rule.hour = parseInt(parts[1], 10);
  // Day of week: '1-5' → [1,2,3,4,5] (lun-vie)
  if (parts[4] && parts[4] !== '*') {
    if (parts[4].includes('-')) {
      const [start, end] = parts[4].split('-').map(Number);
      rule.dayOfWeek = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    } else if (parts[4].includes(',')) {
      rule.dayOfWeek = parts[4].split(',').map(Number);
    } else {
      rule.dayOfWeek = parseInt(parts[4], 10);
    }
  }

  scheduledJob = schedule.scheduleJob(rule, async () => {
    const startTime = new Date().toLocaleString('es-ES', { timeZone: TZ });
    logger.info(`[kpi:scheduler] Ejecutando ETL programado (${startTime})...`);
    try {
      const result = await runETL();
      if (result.skipped) {
        logger.info(`[kpi:scheduler] ETL omitido (ya procesado): ${result.loadId}`);
      } else {
        logger.info(`[kpi:scheduler] ETL completado: ${result.totalAlerts} alertas de ${result.fileResults.length} archivos`);
      }
    } catch (err) {
      logger.error(`[kpi:scheduler] Error en ETL programado: ${err.message}`);
    }
  });

  const nextRun = scheduledJob ? scheduledJob.nextInvocation() : null;
  const nextRunStr = nextRun
    ? new Date(nextRun).toLocaleString('es-ES', { timeZone: TZ })
    : 'desconocido';
  logger.info(`[kpi:scheduler] Job programado: ${cronExpr} (${TZ}). Próxima ejecución: ${nextRunStr}`);

  // Catch-up: recuperar ejecución perdida por reinicio (no bloquea el startup)
  checkMissedRun();

  return scheduledJob;
}

function stopScheduler() {
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
    logger.info('[kpi:scheduler] Job cancelado');
  }
}

function getSchedulerStatus() {
  const nextRun = scheduledJob ? scheduledJob.nextInvocation() : null;
  return {
    active: scheduledJob !== null,
    nextRun,
    nextRunFormatted: nextRun
      ? new Date(nextRun).toLocaleString('es-ES', { timeZone: TZ })
      : null,
    cron: process.env.KPI_ETL_CRON || DEFAULT_CRON,
    timezone: TZ,
  };
}

module.exports = { startScheduler, stopScheduler, getSchedulerStatus };
