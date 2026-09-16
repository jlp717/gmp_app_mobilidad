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
  const months = '1,2,3,4,5,6,7,8,9,10,11,12';
  return [
    `/api/dashboard/metrics?vendedorCodes=ALL&year=${year}`,
    `/api/objectives/evolution?vendedorCodes=ALL&years=${year}`,
    `/api/objectives/by-client?vendedorCodes=ALL&years=${year}&months=${months}&limit=100`,
    `/api/commissions/summary?vendedorCode=ALL&year=${year}`,
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
  const [metrics, evolution, byClient, commissions] = buildJefeHotPaths(now);
  // Metrics first and alone: dashboard first paint must not queue behind
  // LACLAE GROUP BY (gate max=4). Then at most two heavy queries.
  const first = await getOnce(metrics, token);
  const heavy = await Promise.all([
    getOnce(evolution, token),
    getOnce(byClient, token),
  ]);
  const last = await getOnce(commissions, token);
  const results = [first, ...heavy, last];
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
