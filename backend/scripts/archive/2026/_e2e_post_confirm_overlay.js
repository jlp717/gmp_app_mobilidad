// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual overlay post-confirm | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';
const http = require('http');
const PORT = Number(process.env.E2E_PORT || 3355);
const DRIVER = '08';
const TODAY = new Date().toISOString().slice(0, 10);
const IDS = ['2026-I-5-179-4300009180', '2026-I-5-180-4300009036'];

function pickToken(j) {
  return j?.token || j?.data?.token || j?.accessToken || null;
}

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GMP-App/1.0 Dart/3.0 (e2e-overlay)',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const login = await request('POST', '/api/auth/login', { body: { username: 'diego', password: '9322' } });
  const token = pickToken(login.json);
  const user = login.json?.user || {};
  const pend = await request(
    'GET',
    `/api/entregas/pendientes/${DRIVER}?date=${TODAY}&limit=50&offset=0`,
    { token },
  );
  const list = pend.json?.data || pend.json?.albaranes || [];
  const found = list.filter((a) => IDS.includes(a.id)).map((a) => ({
    id: a.id, estado: a.estado,
  }));
  console.log(JSON.stringify({
    loginRole: user.role, activeMode: user.activeMode,
    pendStatus: pend.status, total: list.length, confirmed: found,
    error: pend.json?.error || pend.json?.code || null,
  }));
})().catch((e) => { console.error(e); process.exit(1); });
