// index.js: Punto de entrada del módulo KPI Glacius — inicialización y exports (DB2/ODBC)
'use strict';

const kpiRoutes = require('./routes');
const { initRedis } = require('./services/redis_cache');
const { startScheduler, stopScheduler, getSchedulerStatus } = require('./services/scheduler');
const { kpiHealthCheck, kpiEndPool, initKpiTables } = require('./config/db');
const logger = require('../middleware/logger');

/**
 * Inicializa el módulo KPI: tablas DB2 + Redis + scheduler.
 * Llamar desde server.js en startServer().
 */
async function initKpiModule() {
  try {
    // 1. Crear/verificar tablas KPI en DB2 (JAVIER.KPI_LOADS, KPI_ALERTS, KPI_FILE_AUDIT)
    await initKpiTables();

    // 2. Conectar Redis para cache
    await initRedis();
    logger.info('[kpi] Redis inicializado');

    // 3. Verificar conexión DB2
    const dbHealth = await kpiHealthCheck();
    if (dbHealth.status === 'ok') {
      logger.info('[kpi] DB2 KPI conectado');
    } else {
      logger.warn(`[kpi] DB2 KPI no disponible: ${dbHealth.error}. Módulo en modo degradado.`);
    }

    // 4. Iniciar scheduler ETL semanal (solo si KPI_SCHEDULER_ENABLED=true)
    if (process.env.KPI_SCHEDULER_ENABLED === 'true') {
      startScheduler();
      logger.info('[kpi] Scheduler ETL iniciado');
    } else {
      logger.info('[kpi] Scheduler ETL deshabilitado (KPI_SCHEDULER_ENABLED != true)');
    }

    logger.info('[kpi] Módulo KPI Glacius inicializado correctamente');
  } catch (err) {
    logger.error(`[kpi] Error inicializando módulo KPI: ${err.message}`);
    // No lanzar error — el módulo opera en modo degradado
  }
}

/**
 * Detiene el módulo KPI limpiamente.
 */
async function shutdownKpiModule() {
  stopScheduler();
  await kpiEndPool();
  logger.info('[kpi] Módulo KPI detenido');
}

module.exports = {
  kpiRoutes,
  initKpiModule,
  shutdownKpiModule,
  getSchedulerStatus,
};
