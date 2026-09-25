// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-probe | _-scratch gitignored; probe puntual rutero comercial (lectura) | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Live commercial Ruta probe. Reads PIN from VDPL1, never prints it.
 * Run on the API host against localhost:3335.
 */
const http = require('http');
const { initDb, queryWithParams, closePool } = require('../config/db');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const UA = 'GMP-SRE-HealthCheck/1.0';

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
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
        resolve({
          status: res.statusCode,
          json,
          raw: data.slice(0, 400),
          keys: json && typeof json === 'object' ? Object.keys(json) : [],
        });
      });
    });
    req.setTimeout(45000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function summarize(label, res) {
  const week = res.json?.week;
  return {
    label,
    status: res.status,
    keys: res.keys,
    error: res.json?.error || null,
    code: res.json?.code || null,
    hasWeek: Boolean(week && typeof week === 'object' && !Array.isArray(week)),
    week,
    cacheStatus: res.json?.cacheStatus || null,
    totalUniqueClients: res.json?.totalUniqueClients,
    clients: Array.isArray(res.json?.clients) ? res.json.clients.length : undefined,
    role: res.json?.role || null,
    raw: res.json ? undefined : res.raw,
  };
}

async function pinFor(code) {
  const rows = await queryWithParams(
    `SELECT TRIM(CODIGOPIN) AS PIN
     FROM DSEDAC.VDPL1
     WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
     FETCH FIRST 1 ROW ONLY`,
    [String(code)],
    false,
    false,
  );
  const pin = String(rows?.[0]?.PIN || rows?.[0]?.pin || '').trim();
  if (!pin) throw new Error(`no PIN for ${code}`);
  return pin;
}

async function login(code) {
  const password = await pinFor(code);
  const res = await request('POST', '/api/auth/login', {
    body: { username: String(code), password },
  });
  const token = res.json?.token || res.json?.accessToken || res.json?.data?.token;
  return {
    status: res.status,
    token: token || null,
    role: res.json?.user?.role || res.json?.role || null,
    code: res.json?.user?.code || res.json?.code || null,
    vendorCodes: res.json?.vendedorCodes || res.json?.vendorCodes || res.json?.user?.vendedorCodes || [],
    claimsVersion: res.json?.claimsVersion || res.json?.user?.claimsVersion || null,
    error: res.json?.error || null,
    codeName: res.json?.code || null,
  };
}

async function main() {
  await initDb();
  const out = { host: HOST, port: PORT, at: new Date().toISOString(), cases: [] };
  try {
    const commercial = await login('10');
    out.login10 = {
      status: commercial.status,
      role: commercial.role,
      code: commercial.code,
      vendorCodes: commercial.vendorCodes,
      claimsVersion: commercial.claimsVersion,
      error: commercial.error,
      codeName: commercial.codeName,
      hasToken: Boolean(commercial.token),
    };
    if (!commercial.token) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    const token = commercial.token;
    const paths = [
      '/api/rutero/week?vendedorCodes=10&role=comercial',
      '/api/rutero/week?vendedorCodes=ALL&role=comercial',
      '/api/rutero/week?vendedorCodes=15&role=comercial',
      '/api/rutero/counts?vendedorCodes=10&role=comercial',
      '/api/rutero/day/lunes?vendedorCodes=10&role=comercial',
      '/api/rutero/day-direct/lunes?vendedorCodes=10&role=comercial',
      '/api/rutero/positions/lunes?vendedorCodes=10&role=comercial',
    ];
    for (const path of paths) {
      const started = Date.now();
      try {
        const res = await request('GET', path, { token });
        out.cases.push({ ...summarize(path, res), ms: Date.now() - started });
      } catch (error) {
        out.cases.push({ label: path, status: 0, error: error.message, ms: Date.now() - started });
      }
    }

    const jefe = await login('98');
    out.login98 = {
      status: jefe.status,
      role: jefe.role,
      code: jefe.code,
      vendorCount: Array.isArray(jefe.vendorCodes) ? jefe.vendorCodes.length : 0,
      hasToken: Boolean(jefe.token),
      error: jefe.error,
    };
    if (jefe.token) {
      for (const path of [
        '/api/rutero/week?vendedorCodes=ALL&role=comercial',
        '/api/rutero/week?vendedorCodes=10&role=comercial',
      ]) {
        const started = Date.now();
        try {
          const res = await request('GET', path, { token: jefe.token });
          out.cases.push({ ...summarize(`jefe ${path}`, res), ms: Date.now() - started });
        } catch (error) {
          out.cases.push({ label: `jefe ${path}`, status: 0, error: error.message, ms: Date.now() - started });
        }
      }
    }
  } finally {
    try { await closePool(); } catch (_) { /* ignore */ }
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exit(1);
});
