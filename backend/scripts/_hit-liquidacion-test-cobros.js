'use strict';

/**
 * Liquidacion HIT (API-only on host). Prefers TEST_COBROS over stale TEST_LQD.
 * Usage: E2E_HOST=127.0.0.1 VENDOR=35 LQD_DATE=2026-09-16 node scripts/_hit-liquidacion-test-cobros.js
 */

require('../config/load-env').loadEnv(require('path').join(__dirname, '..'));

const http = require('http');
const { initDb, queryWithParams, closePool } = require('../config/db');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const VENDOR = String(process.env.VENDOR || '35').trim();
const DATE = process.env.LQD_DATE || '2026-09-16';
const UA = 'GMP-SRE-HealthCheck/1.0';

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data.slice(0, 600) });
      });
    });
    req.setTimeout(60000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  await initDb();
  const pinRows = await queryWithParams(
    `SELECT TRIM(CODIGOPIN) AS PIN FROM DSEDAC.VDPL1
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(50)) FETCH FIRST 1 ROW ONLY`,
    [VENDOR],
    false,
  );
  const pin = String(pinRows?.[0]?.PIN || '').trim();

  const login = await request('POST', '/api/auth/login', {
    body: { username: VENDOR, password: pin },
  });
  const token = login.json?.token || login.json?.accessToken || login.json?.data?.token;
  if (!token) {
    console.log(JSON.stringify({ ok: false, step: 'login', status: login.status, raw: login.raw }, null, 2));
    process.exit(2);
  }

  const path = `/api/comercial-liquidacion/resumen-diario?fecha=${DATE}&vendedor=${VENDOR}`;
  const res = await request('GET', path, { token });
  const summary = res?.json?.summary || res?.json || {};
  const source = summary.source || null;
  const reason = summary.lqdIgnoredReason || null;
  const prefersCobros = String(source || '').includes('COBROS')
    || reason === 'isolated_test_prefers_app_cobros_over_lqd_snapshot';

  const out = {
    ok: res.status === 200 && prefersCobros,
    path,
    status: res.status,
    source,
    totalAIngresar: summary.totalAIngresar ?? null,
    lqdIgnoredReason: reason,
    lqdSource: summary.lqdSource || null,
    lqdTI: summary.lqdTI ?? summary.lqd?.importeTotalAIngresar ?? null,
    prefersCobros,
  };
  console.log(JSON.stringify(out, null, 2));
  await closePool().catch(() => {});
  if (!out.ok) process.exit(2);
})().catch(async (e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  try { await closePool(); } catch (_) {}
  process.exit(1);
});
