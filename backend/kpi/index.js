const SCHEMA = process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER';
// index.js: Punto de entrada del módulo KPI Glacius â€” inicialización y exports (DB2/ODBC)
'use strict';

const kpiRoutes = require('./routes');
const { initRedis } = require('./services/redis_cache');
const { startScheduler, stopScheduler, getSchedulerStatus } = require('./services/scheduler');
const { kpiHealthCheck, kpiEndPool, initKpiTables } = require('./config/db');
const logger = require('../middleware/logger');

function isKpiRuntimeOwner() {
  if (process.env.KPI_SCHEDULER_ENABLED === 'false') return false;
  const instanceRaw = process.env.NODE_APP_INSTANCE ?? process.env.INSTANCE_ID;
  if (instanceRaw !== undefined && instanceRaw !== '' && String(instanceRaw) !== '0') return false;
  return true;
}

/**
 * Arranca Redis y el refresco semanal sin crear tablas.
 * initKpiTables hace DDL y no puede correr en el boot de producción.
 */
async function startKpiRuntime() {
  if (!isKpiRuntimeOwner()) {
    logger.info(`[kpi] runtime omitido en worker instance=${process.env.NODE_APP_INSTANCE ?? process.env.INSTANCE_ID ?? 'n/a'}`);
    return { started: false };
  }
  try {
    await initRedis();
    logger.info('[kpi] Redis inicializado');
    const dbHealth = await kpiHealthCheck();
    if (dbHealth.status === 'ok') {
      logger.info('[kpi] DB2 KPI conectado');
    } else {
      logger.warn(`[kpi] DB2 KPI no disponible: ${dbHealth.error}. Scheduler en espera.`);
      return { started: false };
    }
    startScheduler();
    logger.info('[kpi] Scheduler ETL iniciado (L-V 7:00 Europe/Madrid, un solo worker)');
    return { started: true };
  } catch (err) {
    logger.error(`[kpi] Error arrancando runtime KPI: ${err.message}`);
    return { started: false };
  }
}

/**
 * Inicializa el módulo KPI: tablas DB2 + Redis + scheduler.
 * El boot de server.js usa startKpiRuntime y no esta función: crear tablas es DDL.
 */
async function initKpiModule() {
  try {
    // 1. Crear/verificar tablas KPI en DB2 (${SCHEMA}.KPI_LOADS, KPI_ALERTS, KPI_FILE_AUDIT)
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

    // 4. Iniciar scheduler ETL diario (activo por defecto, desactivar con KPI_SCHEDULER_ENABLED=false)
    if (process.env.KPI_SCHEDULER_ENABLED !== 'false') {
      startScheduler();
      logger.info('[kpi] Scheduler ETL iniciado (L-V 7:00 AM Europe/Madrid)');
    } else {
      logger.info('[kpi] Scheduler ETL deshabilitado (KPI_SCHEDULER_ENABLED=false)');
    }

    logger.info('[kpi] Módulo KPI Glacius inicializado correctamente');
  } catch (err) {
    logger.error(`[kpi] Error inicializando módulo KPI: ${err.message}`);
    // No lanzar error â€” el módulo opera en modo degradado
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
  startKpiRuntime,
  shutdownKpiModule,
  getSchedulerStatus,
};
