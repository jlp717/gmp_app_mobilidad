// scheduler.js: Planificador diario del ETL Glacius con node-schedule
// Ejecuta a las 7:00 AM Europe/Madrid (lunes a viernes)
'use strict';

const schedule = require('node-schedule');
const { runETL, generateLoadId } = require('./etl_orchestrator');
const { kpiQuery } = require('../config/db');
const logger = require('../../middleware/logger');
const SCHEMA = process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER';

let scheduledJob = null;

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
      `SELECT ID, STATUS FROM ${SCHEMA}.KPI_LOADS WHERE LOAD_ID = ?`,
      [currentLoadId]
    );

    if (existing.rows.length > 0 && existing.rows[0].STATUS === 'COMPLETED') {
      logger.info(`[kpi:scheduler] Catch-up: ${currentLoadId} ya completado`);
      return;
    }

    logger.info(`[kpi:scheduler] Catch-up: ejecutando ETL para ${currentLoadId} (semana pendiente)...`);
    const result = await runETL();
    if (result.skipped) {
      logger.info(`[kpi:scheduler] Catch-up: ETL omitido (${result.loadId})`);
    } else {
      logger.info(`[kpi:scheduler] Catch-up completado: ${result.totalAlerts} alertas de ${result.fileResults.length} archivos`);
    }
  } catch (err) {
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
