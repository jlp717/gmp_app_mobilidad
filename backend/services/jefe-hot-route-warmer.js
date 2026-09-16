'use strict';

const http = require('http');
const logger = require('../middleware/logger');

const DELAY_MS = parseInt(process.env.JEFE_HOT_WARMUP_DELAY_MS, 10) || 0;
const PORT = parseInt(process.env.PORT, 10) || 3335;

function isJefeUser({ isJefeVentas, role } = {}) {
  if (isJefeVentas === true) return true;
  const normalized = String(role || '').trim().toUpperCase();
  return normalized === 'JEFE_VENTAS' || normalized === 'ADMIN';
}

function buildJefeHotPaths(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const ytdMonths = Array.from({ length: month }, (_, i) => i + 1).join(',');
  const allMonths = '1,2,3,4,5,6,7,8,9,10,11,12';
  return [
    `/api/dashboard/metrics?vendedorCodes=ALL&year=${year}`,
    `/api/objectives/evolution?vendedorCodes=ALL&years=${year}`,
    `/api/objectives/by-client?vendedorCodes=ALL&years=${year}&months=${allMonths}&limit=100`,
    `/api/commissions/summary?vendedorCode=ALL&year=${year}`,
    `/api/dashboard/matrix-data?vendedorCodes=ALL&year=${year}&years=${year}&groupBy=vendor&limit=240&months=${ytdMonths}`,
    `/api/clients/list?vendedorCodes=ALL&limit=50`,
    `/api/pedidos/purchase-history-global?vendedorCode=ALL&limit=50`,
  ];
}

function getOnce(path, token) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'GMP-JefeHotWarmup/1.0',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({ status: res.statusCode, ms: Date.now() - started, path });
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error(`timeout ${path}`)));
    req.on('error', (error) => {
      resolve({
        status: 0,
        ms: Date.now() - started,
        path,
        err: String(error.message || error).slice(0, 120),
      });
    });
    req.end();
  });
}

async function runJefeHotRouteWarmup({ token, now } = {}) {
  if (!token) return [];
  const [
    metrics,
    evolution,
    byClient,
    commissions,
    matrix,
    clients,
    purchaseHistory,
  ] = buildJefeHotPaths(now);
  // Metrics first and alone: dashboard first paint must not queue behind
  // LACLAE GROUP BY (gate max=4). Then at most two heavy queries.
  // Late wave is sequential: never 500 from a stacked purchase-history fill.
  const first = await getOnce(metrics, token);
  const heavy = await Promise.all([
    getOnce(evolution, token),
    getOnce(byClient, token),
  ]);
  const late = [];
  for (const path of [commissions, matrix, clients, purchaseHistory]) {
    late.push(await getOnce(path, token));
  }
  const results = [first, ...heavy, ...late];
  for (const result of results) {
    logger.info(`[JefeHotWarmup] ${result.status} ${result.ms}ms ${result.path}`);
  }
  return results;
}

function scheduleJefeHotRouteWarmup({ token, isJefeVentas, role, delayMs = DELAY_MS } = {}) {
  if (!token || !isJefeUser({ isJefeVentas, role })) return false;
  const timer = setTimeout(() => {
    runJefeHotRouteWarmup({ token }).catch((error) => {
      logger.warn(`[JefeHotWarmup] ${error.message}`);
    });
  }, Math.max(0, delayMs));
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}

module.exports = {
  scheduleJefeHotRouteWarmup,
  runJefeHotRouteWarmup,
  buildJefeHotPaths,
  isJefeUser,
};
