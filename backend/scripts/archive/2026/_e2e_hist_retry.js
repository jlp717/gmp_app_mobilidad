// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual reintento historico | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

const http = require('http');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const DRIVER = '08';
const CLIENT = process.env.E2E_CLIENT || '4300010180';
const DATE = process.env.E2E_DATE || '2026-08-14';
const USER = process.env.E2E_USER || 'diego';
const PIN = process.env.E2E_PIN || '9322';

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GMP-App/1.0 Dart/3.0 (e2e-hist-retry)',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 400) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const login = await request('POST', '/api/auth/login', { body: { username: USER, password: PIN } });
  let token = login.json?.token || login.json?.data?.token;
  const sw = await request('POST', '/api/auth/switch-role', {
    token, body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = sw.json?.token || sw.json?.data?.token || token;
  const docs = await request(
    'GET',
    `/api/repartidor/history/documents/${CLIENT}?repartidorId=${DRIVER}&dateFrom=${DATE}&dateTo=${DATE}&limit=50`,
    { token },
  );
  const list = docs.json?.documents || docs.json?.data || [];
  const delivered = list.filter((doc) => String(doc.status || '').toLowerCase() === 'delivered');
  console.log(JSON.stringify({
    label: 'hist.documentsByDate',
    status: docs.status,
    code: docs.json?.code || null,
    docs: list.length,
    delivered: delivered.length,
    sample: delivered[0] ? { status: delivered[0].status, number: delivered[0].number || delivered[0].albaranNumber } : null,
  }));
  const hist = await request(
    'GET',
    `/api/repartidor/history/${DRIVER}?startDate=${DATE}&endDate=${DATE}&limit=50&offset=0`,
    { token },
  );
  const rows = hist.json?.data || [];
  const overlayed = rows.filter((row) => String(row.ESTADO_ENTREGA || '').toUpperCase() === 'ENTREGADO');
  console.log(JSON.stringify({
    label: 'hist.listByRouteDate',
    status: hist.status,
    code: hist.json?.code || null,
    rows: rows.length,
    entregados: overlayed.length,
  }));
  if (docs.status !== 200 || hist.status !== 200 || delivered.length < 1) process.exit(2);
})().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
