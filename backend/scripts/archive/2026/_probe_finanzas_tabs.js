// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual tabs finanzas | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const http = require('http');

const UA = 'GMP-Probe-FinanzasTabs/1.0';
const TODAY = new Date().toISOString().slice(0, 10);

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3335,
      path,
      method,
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
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 1500) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickToken(j) {
  return j?.token || j?.accessToken || j?.data?.token || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function login() {
  for (let i = 0; i < 5; i += 1) {
    const login = await request('POST', '/api/auth/login', {
      body: { username: 'diego', password: '9322' },
    });
    if (login.status === 429) {
      await sleep(12000);
      continue;
    }
    return login;
  }
  return { status: 429, json: null };
}

async function hit(token, label, path) {
  const res = await request('GET', path, { token });
  const j = res.json || {};
  const summary = j.summary || j.data?.summary || null;
  console.log(JSON.stringify({
    label,
    status: res.status,
    success: j.success,
    code: j.code || null,
    error: j.error || null,
    keys: j && typeof j === 'object' ? Object.keys(j).slice(0, 20) : [],
    summary: summary ? {
      TOTAL_REPARTIDO: summary.TOTAL_REPARTIDO ?? summary.entregado ?? summary.totalRepartido,
      TOTAL_COBROS_DIA: summary.TOTAL_COBROS_DIA ?? summary.totalCobrosDia,
      TOTAL_EFECTIVO: summary.TOTAL_EFECTIVO ?? summary.totalEfectivo,
      DEUDA_PENDIENTE: summary.DEUDA_PENDIENTE ?? summary.deudaPendiente,
      SALDO_PENDIENTE: summary.SALDO_PENDIENTE ?? summary.saldoActual,
      gastos: summary.gastos ?? summary.TOTAL_GASTOS,
    } : null,
    vencCount: Array.isArray(j.vencimientos) ? j.vencimientos.length : null,
    months: Array.isArray(j.months) ? j.months.length : (Array.isArray(j.summary?.months) ? j.summary.months.length : null),
    raw: res.status >= 400 ? res.raw : undefined,
  }));
  return res;
}

async function main() {
  const loginRes = await login();
  let token = pickToken(loginRes.json);
  console.log(JSON.stringify({ auth: loginRes.status, hasToken: Boolean(token) }));
  if (!token) process.exit(2);

  const sw = await request('POST', '/api/auth/switch-role', {
    token,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = pickToken(sw.json) || token;
  console.log(JSON.stringify({ switch: sw.status }));

  // Runtime sanity via ready + env echo endpoint if any; else just probe data
  const ids = ['08', '05', '21'];
  for (const id of ids) {
    await hit(token, `daily.${id}`, `/api/repartidor-finanzas/daily-summary/${id}?date=${TODAY}`);
    await hit(token, `desglose.${id}`, `/api/repartidor-finanzas/liquidaciones/${id}/desglose?date=${TODAY}`);
    await hit(token, `venc.${id}`, `/api/repartidor-finanzas/vencimientos/${id}?from=2026-01-01&to=${TODAY}&limit=50`);
    await hit(token, `comm.${id}`, `/api/repartidor-finanzas/commissions/summary/${id}?from=2026-01-01&to=${TODAY}`);
  }

  // ALL aggregate daily
  await hit(token, 'daily.ALL', `/api/repartidor-finanzas/daily-summary/05,08,10,18,19,21?date=${TODAY}`);
}

main().catch((e) => {
  console.error(String(e && e.stack || e));
  process.exit(3);
});
