'use strict';

const http = require('http');
const logger = require('../middleware/logger');

const DELAY_MS = parseInt(process.env.JEFE_HOT_WARMUP_DELAY_MS, 10) || 0;
const PORT = parseInt(process.env.PORT, 10) || 3335;

// Must match Flutter ProductsHistoryTab / ProductsHistoryPage first paint:
// last 3 years (Jan 1 of year-2 .. Dec 31 of current) and limit=300.
const PURCHASE_HISTORY_UI_LIMIT = 300;
const PURCHASE_HISTORY_UI_YEAR_SPAN = 2;

function buildPurchaseHistoryUiPath(now = new Date(), vendedorCode = 'ALL') {
  const year = now.getFullYear();
  const from = `${year - PURCHASE_HISTORY_UI_YEAR_SPAN}-01-01`;
  const to = `${year}-12-31`;
  const code = encodeURIComponent(String(vendedorCode || 'ALL').trim() || 'ALL');
  return `/api/pedidos/purchase-history-global?vendedorCode=${code}&from=${from}&to=${to}&limit=${PURCHASE_HISTORY_UI_LIMIT}`;
}

function isJefeUser({ isJefeVentas, role } = {}) {
  if (isJefeVentas === true) return true;
  const normalized = String(role || '').trim().toUpperCase();
  return normalized === 'JEFE_VENTAS' || normalized === 'ADMIN';
}

function shouldWarmHotRoutes({ isJefeVentas, role, code } = {}) {
  if (isJefeUser({ isJefeVentas, role })) return true;
  return String(code || '').trim() === '80';
}

function buildVendorHotPaths(now, vendorCode) {
  const year = now.getFullYear();
  const code = encodeURIComponent(String(vendorCode || '').trim());
  return [
    `/api/objectives/evolution?vendedorCodes=${code}&years=${year}`,
    `/api/commissions/summary?vendedorCode=${code}&year=${year}`,
    buildPurchaseHistoryUiPath(now, vendorCode),
  ];
}

function buildPurchaseHistoryYoyPath(now = new Date(), vendedorCode = 'ALL') {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const code = encodeURIComponent(String(vendedorCode || 'ALL').trim() || 'ALL');
  return `/api/pedidos/purchase-history-global?vendedorCode=${code}&from=${year}-01-01&to=${year}-${month}-${day}&limit=1`;
}

function buildJefeHotPaths(now = new Date(), { vendorCode, includeAll = true } = {}) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const ytdMonths = Array.from({ length: month }, (_, i) => i + 1).join(',');
  const allMonths = '1,2,3,4,5,6,7,8,9,10,11,12';
  const allPaths = includeAll
    ? [
      `/api/dashboard/metrics?vendedorCodes=ALL&year=${year}`,
      buildPurchaseHistoryUiPath(now, 'ALL'),
      `/api/objectives/evolution?vendedorCodes=ALL&years=${year}`,
      `/api/objectives/by-client?vendedorCodes=ALL&years=${year}&months=${allMonths}&limit=100`,
      `/api/commissions/summary?vendedorCode=ALL&year=${year}`,
      `/api/dashboard/matrix-data?vendedorCodes=ALL&year=${year}&years=${year}&groupBy=vendor&limit=240&months=${ytdMonths}`,
      `/api/clients/list?vendedorCodes=ALL&limit=50`,
      buildPurchaseHistoryYoyPath(now, 'ALL'),
    ]
    : [];
  const code = String(vendorCode || '').trim();
  if (code && code.toUpperCase() !== 'ALL') {
    const scoped = buildVendorHotPaths(now, code);
    if (!includeAll) return scoped;
    // Keep Flutter history ALL at index 1 so warmup can fill it before LACLAE evo.
    allPaths.splice(2, 0, scoped[0], scoped[1]);
  }
  return allPaths;
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

async function runJefeHotRouteWarmup({ token, now, vendorCode, includeAll = true } = {}) {
  if (!token) return [];
  const paths = buildJefeHotPaths(now, { vendorCode, includeAll });
  if (paths.length === 0) return [];
  const historyIdx = paths.findIndex((path) => path.includes('/purchase-history-global') && path.includes('limit=300'));
  const results = [];
  if (paths[0]) results.push(await getOnce(paths[0], token));
  if (historyIdx > 0) results.push(await getOnce(paths[historyIdx], token));
  const rest = paths.filter((_, index) => index !== 0 && index !== historyIdx);
  if (rest.length > 0) {
    results.push(...await Promise.all(rest.slice(0, 2).map((path) => getOnce(path, token))));
    for (const path of rest.slice(2)) {
      results.push(await getOnce(path, token));
    }
  }
  for (const result of results) {
    logger.info(`[JefeHotWarmup] ${result.status} ${result.ms}ms ${result.path}`);
  }
  return results;
}

function scheduleJefeHotRouteWarmup({
  token,
  isJefeVentas,
  role,
  code,
  delayMs = DELAY_MS,
} = {}) {
  if (!token || !shouldWarmHotRoutes({ isJefeVentas, role, code })) return false;
  const includeAll = isJefeUser({ isJefeVentas, role });
  const timer = setTimeout(() => {
    runJefeHotRouteWarmup({ token, vendorCode: code, includeAll }).catch((error) => {
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
  buildVendorHotPaths,
  buildPurchaseHistoryUiPath,
  buildPurchaseHistoryYoyPath,
  isJefeUser,
  shouldWarmHotRoutes,
  PURCHASE_HISTORY_UI_LIMIT,
};
