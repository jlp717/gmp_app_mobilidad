'use strict';

/**
 * Live smoke of repartidor tab GET endpoints against a running API.
 *
 * Env:
 *   SMOKE_BASE_URL   default http://127.0.0.1:3335/api
 *   SMOKE_TOKEN      Bearer JWT (required)
 *   SMOKE_REPARTIDOR default 08
 *
 * Usage:
 *   set SMOKE_TOKEN=... && node backend/scripts/smoke-repartidor-tabs.js
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3335/api').replace(/\/$/, '');
const TOKEN = process.env.SMOKE_TOKEN || '';
const REP = process.env.SMOKE_REPARTIDOR || '08';
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;
const TODAY = new Date().toISOString().slice(0, 10);

if (!TOKEN) {
  console.error('FATAL: set SMOKE_TOKEN');
  process.exit(2);
}

const paths = [
  ['Panel delivery-summary', `GET /repartidor/history/delivery-summary/${REP}?year=${YEAR}&month=${MONTH}`],
  ['Panel monthly summary', `GET /repartidor-finanzas/summary/${REP}?year=${YEAR}&month=${MONTH}`],
  ['Clientes', `GET /repartidor/history/clients/${REP}?limit=20&offset=0`],
  ['Rutero pendientes', `GET /entregas/pendientes/${REP}?date=${TODAY}&limit=50&offset=0`],
  ['Rutero week', `GET /repartidor/rutero/week/${REP}?date=${TODAY}`],
  ['Liquidacion daily', `GET /repartidor-finanzas/daily-summary/${REP}?date=${TODAY}`],
  ['Liquidacion desglose', `GET /repartidor-finanzas/liquidaciones/${REP}/desglose?date=${TODAY}`],
  ['Vencimientos', `GET /repartidor-finanzas/vencimientos/${REP}?limit=50`],
  ['Evolucion', `GET /repartidor-finanzas/evolution/${REP}`],
  ['Comisiones tiers', 'GET /repartidor-finanzas/commissions/tiers'],
  ['Comisiones summary', `GET /repartidor-finanzas/commissions/summary/${REP}?from=${YEAR}-01-01&to=${YEAR}-12-31`],
  ['Auth repartidores', 'GET /auth/repartidores'],
  ['Chatbot health', 'GET /chatbot/health'],
];

async function hit(label, spec) {
  const [method, path] = spec.split(' ');
  const url = `${BASE}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
        'User-Agent': 'GMP-Repartidor-Tab-Smoke/1.0',
      },
    });
    const ms = Date.now() - started;
    const ok = res.status >= 200 && res.status < 300;
    console.log(`${ok ? 'OK' : 'FAIL'}`.padEnd(4), String(res.status).padStart(3), `${ms}ms`.padStart(7), label, path);
    return ok;
  } catch (err) {
    console.log('FAIL ERR', label, err.message);
    return false;
  }
}

(async () => {
  console.log('BASE', BASE, 'REP', REP);
  let pass = 0;
  for (const [label, spec] of paths) {
    // eslint-disable-next-line no-await-in-loop
    if (await hit(label, spec)) pass += 1;
  }
  console.log(`RESULT ${pass}/${paths.length}`);
  process.exit(pass === paths.length ? 0 : 1);
})();
