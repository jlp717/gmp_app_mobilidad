// scheduler.js: Planificador semanal del ETL con node-schedule
'use strict';

const schedule = require('node-schedule');
const { runETL } = require('./etl_orchestrator');
const logger = require('../../middleware/logger');

let scheduledJob = null;

/**
 * Inicia el job programado para ejecutar el ETL semanalmente.
 * Por defecto: lunes a las 06:00 (tras la subida del domingo)
 */
function startScheduler() {
  const cronExpr = process.env.KPI_ETL_CRON || '0 6 * * 1'; // Lunes a las 6:00

  scheduledJob = schedule.scheduleJob(cronExpr, async () => {
    logger.info('[kpi:scheduler] Ejecutando ETL programado...');
    try {
      const result = await runETL();
      if (result.skipped) {
        logger.info(`[kpi:scheduler] ETL omitido (ya procesado): ${result.loadId}`);
      } else {
        logger.info(`[kpi:scheduler] ETL completado: ${result.totalAlerts} alertas`);
      }
    } catch (err) {
      logger.error(`[kpi:scheduler] Error en ETL programado: ${err.message}`);
    }
  });

  logger.info(`[kpi:scheduler] Job programado con cron: ${cronExpr}`);
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
  return {
    active: scheduledJob !== null,
    nextRun: scheduledJob ? scheduledJob.nextInvocation() : null,
    cron: process.env.KPI_ETL_CRON || '0 6 * * 1',
  };
}

module.exports = { startScheduler, stopScheduler, getSchedulerStatus };
