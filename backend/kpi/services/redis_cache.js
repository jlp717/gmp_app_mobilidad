// redis_cache.js: Capa de cache Redis para alertas KPI con TTL y invalidación en tiempo real
'use strict';

const logger = require('../../middleware/logger');

const KPI_CACHE_PREFIX = 'kpi:alerts:';
// F5-02 TTL por dominio con constantes nombradas. Alertas 7 dias intactas;
// dinero/cobros en REALTIME 60.
const KPI_TTL_BY_DOMAIN = {
  ALERTS: parseInt(process.env.KPI_CACHE_TTL || '604800', 10), // 7 dias por defecto
  MONEY: 60, // == TTL.REALTIME del bus central
  COBROS: 60, // == TTL.REALTIME del bus central
};
const KPI_CACHE_TTL = KPI_TTL_BY_DOMAIN.ALERTS; // alias compatibilidad
const KPI_GLOBAL_KEY = 'kpi:last_load';

let redisClient = null;

/**
 * Inicializa el cliente Redis reutilizando el existente del proyecto o creando uno nuevo.
 */
async function initRedis() {
  try {
    // Intentar reutilizar el cliente Redis del proyecto principal
    const { getRedisClient } = require('../../services/redis-cache');
    redisClient = getRedisClient();
    if (redisClient && redisClient.isOpen) {
      logger.info('[kpi:redis] Reutilizando conexión Redis existente');
      return;
    }
  } catch (_) {
    // No hay cliente Redis del proyecto principal
  }

  try {
    const { createClient } = require('redis');
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redisClient.on('error', (err) => {
      logger.warn(`[kpi:redis] Error de conexión: ${err.message}`);
    });

    await redisClient.connect();
    logger.info('[kpi:redis] Conexión Redis establecida');
  } catch (err) {
    logger.warn(`[kpi:redis] No se pudo conectar a Redis: ${err.message}. Cache deshabilitada.`);
    redisClient = null;
  }
}

/**
 * Cachea las alertas de un cliente específico.
 * @param {string} clientCode
 * @param {Array} alerts
 */
async function cacheClientAlerts(clientCode, alerts) {
  if (!redisClient) return;
  try {
    const key = `${KPI_CACHE_PREFIX}${clientCode}`;
    await redisClient.set(key, JSON.stringify(alerts), { EX: KPI_TTL_BY_DOMAIN.ALERTS });
  } catch (err) {
    logger.warn(`[kpi:redis] Error cacheando alertas para ${clientCode}: ${err.message}`);
  }
}

/**
 * Obtiene las alertas cacheadas para un cliente.
 * @param {string} clientCode
 * @returns {Promise<Array|null>} null = cache miss
 */
async function getCachedClientAlerts(clientCode) {
  if (!redisClient) return null;
  try {
    const key = `${KPI_CACHE_PREFIX}${clientCode}`;
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    logger.warn(`[kpi:redis] Error leyendo cache para ${clientCode}: ${err.message}`);
    return null;
  }
}

/**
 * Invalida toda la cache KPI (tras nueva carga ETL).
 */
async function invalidateKpiCache() {
  if (!redisClient) return;
  try {
    // Buscar y eliminar todas las keys KPI
    let cursor = '0';
    do {
      const result = await redisClient.scan(cursor, { MATCH: `${KPI_CACHE_PREFIX}*`, COUNT: 100 });
      cursor = result.cursor.toString();
      if (result.keys.length > 0) {
        await redisClient.del(result.keys);
      }
    } while (cursor !== '0');

    // Actualizar timestamp de última carga
    await redisClient.set(KPI_GLOBAL_KEY, JSON.stringify({
      timestamp: new Date().toISOString(),
      action: 'cache_invalidated',
    }));

    logger.info('[kpi:redis] Cache KPI invalidada completamente');
  } catch (err) {
    logger.warn(`[kpi:redis] Error invalidando cache: ${err.message}`);
  }
}

/**
 * Obtiene info de la última carga desde Redis.
 */
async function getLastLoadInfo() {
  if (!redisClient) return null;
  try {
    const data = await redisClient.get(KPI_GLOBAL_KEY);
    return data ? JSON.parse(data) : null;
  } catch (_) {
    return null;
  }
}

function getRedisStatus() {
  return {
    connected: redisClient !== null && redisClient.isOpen,
    prefix: KPI_CACHE_PREFIX,
    ttl: KPI_CACHE_TTL,
  };
}

// F5-01 invalidacion cruzada KPI: reacciona al bus central onInvalidationPattern.
// Cualquier patron que mencione kpi (p.ej. "kpi*", "gmp:kpi*") dispara el
// borrado local via scan+del para converger en cluster PM2.
function handleKpiInvalidationPattern(pattern) {
  if (/kpi/i.test(String(pattern || ''))) {
    return invalidateKpiCache();
  }
  return Promise.resolve();
}

let kpiInvalidationHooked = false;
function ensureKpiClusterInvalidation() {
  if (kpiInvalidationHooked) return;
  kpiInvalidationHooked = true;
  try {
    const { onInvalidationPattern } = require('../../services/redis-cache');
    onInvalidationPattern((pattern) => {
      handleKpiInvalidationPattern(pattern).catch(() => {});
    });
  } catch (_) {
    // Redis opcional — workers siguen invalidando en local
  }
}

ensureKpiClusterInvalidation();

function __setRedisClientForTests(client) {
  redisClient = client;
}

function __resetKpiClusterHookForTests() {
  kpiInvalidationHooked = false;
}

module.exports = {
  initRedis,
  cacheClientAlerts,
  getCachedClientAlerts,
  invalidateKpiCache,
  getLastLoadInfo,
  getRedisStatus,
  KPI_CACHE_PREFIX,
  KPI_CACHE_TTL,
  KPI_TTL_BY_DOMAIN,
  KPI_GLOBAL_KEY,
  handleKpiInvalidationPattern,
  ensureKpiClusterInvalidation,
  __setRedisClientForTests,
  __resetKpiClusterHookForTests,
};
