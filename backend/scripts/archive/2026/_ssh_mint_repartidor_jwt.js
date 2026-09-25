// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-ssh-mint | _-scratch gitignored; mint puntual JWT repartidor via SSH | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Server-only: mint a real REPARTIDOR JWT from VDPL1 PIN.
 * Never prints the PIN. Run on 192.168.1.230 from /opt/gmp-api/backend.
 */
const http = require('http');
const { queryWithParams, closePool } = require('../config/db');

function login(username, password) {
  const payload = JSON.stringify({ username, password });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3335,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GMP-App/1.0 Dart/3.0 (mint-repartidor-jwt)',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('login timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function publicUser(json) {
  const user = json?.user || {};
  return {
    status: json ? undefined : undefined,
    code: user.code || json?.user?.vendedorCode || null,
    role: json?.role || user.role || null,
    activeMode: json?.activeMode || user.activeMode || null,
    isJefeVentas: json?.isJefeVentas ?? user.isJefeVentas ?? null,
    isRepartidor: json?.isRepartidor ?? user.isRepartidor ?? null,
    codigoConductor: json?.codigoConductor || user.codigoConductor || null,
    availableRoles: json?.availableRoles || user.availableRoles || null,
    availableModes: json?.availableModes || user.availableModes || null,
    token: json?.token || json?.data?.token || null,
    refreshToken: json?.refreshToken || null,
  };
}

async function main() {
  const preferred = ['08', '53', '97', 'A4', '15', '01'];
  const rows = await queryWithParams(`
    SELECT TRIM(P.CODIGOVENDEDOR) AS CODE,
           TRIM(P.CODIGOPIN) AS PIN,
           COALESCE((
             SELECT MAX(NULLIF(TRIM(X.PERMITEREPARTOSN), ''))
             FROM DSEDAC.VDDX X WHERE X.CODIGOVENDEDOR = P.CODIGOVENDEDOR
           ), '') AS REPARTO,
           COALESCE((
             SELECT MAX(NULLIF(TRIM(X.PERMITEPREVENTASN), ''))
             FROM DSEDAC.VDDX X WHERE X.CODIGOVENDEDOR = P.CODIGOVENDEDOR
           ), '') AS PREVENTA,
           COALESCE((
             SELECT MAX(NULLIF(TRIM(X.JEFEVENTASSN), ''))
             FROM DSEDAC.VDDX X WHERE X.CODIGOVENDEDOR = P.CODIGOVENDEDOR
           ), '') AS JEFE
    FROM DSEDAC.VDPL1 P
    WHERE TRIM(P.CODIGOPIN) <> ''
  `, []);

  const ranked = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      code: String(row.CODE || '').trim(),
      pin: String(row.PIN || '').trim(),
      reparto: String(row.REPARTO || '').trim().toUpperCase(),
      preventa: String(row.PREVENTA || '').trim().toUpperCase(),
      jefe: String(row.JEFE || '').trim().toUpperCase(),
    }))
    .filter((row) => row.code && row.pin && row.reparto === 'S' && row.jefe !== 'S' && row.preventa !== 'S');

  ranked.sort((a, b) => {
    const ai = preferred.indexOf(a.code);
    const bi = preferred.indexOf(b.code);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const tried = [];
  for (const row of ranked.slice(0, 8)) {
    const res = await login(row.code, row.pin);
    const info = publicUser(res.json);
    tried.push({
      code: row.code,
      status: res.status,
      role: info.role,
      isRepartidor: info.isRepartidor,
    });
    if (res.status === 200 && info.role === 'REPARTIDOR' && info.token) {
      console.log(JSON.stringify({
        ok: true,
        code: info.code,
        role: info.role,
        activeMode: info.activeMode,
        isJefeVentas: info.isJefeVentas,
        isRepartidor: info.isRepartidor,
        codigoConductor: info.codigoConductor,
        availableRoles: info.availableRoles,
        availableModes: info.availableModes,
        token: info.token,
        refreshToken: info.refreshToken,
        tried,
      }));
  try {
    await closePool();
  } catch (_) {}
  process.exit(0);
    }
  }

  console.log(JSON.stringify({
    ok: false,
    reason: 'no_repartidor_login',
    candidates: ranked.slice(0, 8).map((r) => r.code),
    tried,
  }));
  try {
    await closePool();
  } catch (_) {}
  process.exit(1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
  process.exit(1);
});
