// ARCHIVE one-off [2026/anio-gitlog]: header-no-leido;hit-objectives | hit puntual evolucion objetivos 98 | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * HIT JEFE 98 Objetivos septiembre forceRefresh. SELECT/login only. Never prints PIN.
 *
 *   node backend/scripts/hit-objectives-evolution-98.js
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const localDb = path.resolve(__dirname, '../config/db.js');
const remoteDb = '/opt/gmp-api/backend/config/db.js';
const dbModule = fs.existsSync(localDb) ? localDb : remoteDb;
const { initDb, closePool, queryWithParams } = require(dbModule);

const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const YEAR = 2026;
const MONTH = 9;
const UA = 'GMP-Objectives-HIT/1.0';

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 180) };
  }
}

function api(method, pathName, { token, body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const reqHeaders = { 'User-Agent': UA };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    if (String(pathName).includes('forceRefresh')) {
      reqHeaders['X-Force-Refresh'] = 'true';
      reqHeaders['Cache-Control'] = 'no-cache';
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${pathName}`,
      method,
      headers: reqHeaders,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: parseBody(raw),
        ms: Date.now() - started,
      }));
    });
    req.setTimeout(timeoutMs || 60000, () => {
      req.destroy(new Error(`timeout ${pathName}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function septFromEvolution(body) {
  const months = body?.yearlyData?.[String(YEAR)] || body?.yearlyData?.[YEAR] || [];
  const row = Array.isArray(months)
    ? months.find((item) => Number(item.month || item.MONTH) === MONTH)
    : null;
  return {
    sales: num(row?.sales || row?.SALES),
    objective: num(row?.objective),
    workingDays: num(row?.workingDays),
    daysPassed: num(row?.daysPassed),
    annualObjective: num(body?.yearTotals?.[String(YEAR)]?.annualObjective
      || body?.yearTotals?.[YEAR]?.annualObjective),
  };
}

async function main() {
  await initDb();
  try {
    const pinRows = await queryWithParams(
      `SELECT TRIM(CODIGOPIN) AS PIN
         FROM DSEDAC.VDPL1
        WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
        FETCH FIRST 1 ROW ONLY`,
      ['98'],
    );
    const pin = String(pinRows?.[0]?.PIN || pinRows?.[0]?.pin || '').trim();
    if (!pin) {
      console.log(JSON.stringify({ ok: false, reason: 'sin PIN VDPL1 para 98' }));
      return;
    }
    const login = await api('POST', '/auth/login', {
      body: { username: '98', password: pin },
    });
    const token = login.body?.token || login.body?.accessToken;
    const role = String(login.body?.user?.role || login.body?.role || '');
    const evo = await api(
      'GET',
      `/objectives/evolution?vendedorCodes=ALL&years=${YEAR}&forceRefresh=1`,
      { token, timeoutMs: 90000 },
    );
    const sept = septFromEvolution(evo.body);
    const dailyTarget = sept.workingDays > 0 ? sept.objective / sept.workingDays : 0;
    const dailyActual = sept.daysPassed > 0 ? sept.sales / sept.daysPassed : 0;
    const pacePct = dailyTarget > 0 ? ((dailyActual - dailyTarget) / dailyTarget) * 100 : 0;
    const monthPct = sept.objective > 0 ? (sept.sales / sept.objective) * 100 : 0;
    console.log(JSON.stringify({
      dsedacWrite: false,
      loginStatus: login.status,
      role,
      isJefe: role.toUpperCase() === 'JEFE_VENTAS' || login.body?.user?.isJefeVentas === true,
      evolutionStatus: evo.status,
      evolutionMs: evo.ms,
      sept,
      derived: {
        dailyTarget: Math.round(dailyTarget * 100) / 100,
        dailyActual: Math.round(dailyActual * 100) / 100,
        pacePct: Math.round(pacePct * 100) / 100,
        monthPct: Math.round(monthPct * 10) / 10,
      },
    }));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error).slice(0, 300));
  process.exit(1);
});
