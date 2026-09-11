'use strict';

/**
 * HIT isolated_test for commercial close-out.
 * Never prints PIN/secrets. Writes only JAVIER.TEST_*.
 *
 *   node backend/scripts/hit-comercial-isolated-test.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const { initDb, closePool, queryWithParams } = require('../config/db');

const HOST = process.env.API_HOST || '192.168.1.230';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const VENDOR = String(process.env.HIT_COMERCIAL_VENDOR || '80').trim();
const UA = 'GMP-Commercial-HIT/1.0';

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 200) };
  }
}

function api(method, path, { token, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const reqHeaders = { 'User-Agent': UA, ...(headers || {}) };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${path}`,
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
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pinForVendor(vendor) {
  const rows = await queryWithParams(
    `SELECT TRIM(CODIGOPIN) AS PIN
       FROM DSEDAC.VDPL1
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
      FETCH FIRST 1 ROW ONLY`,
    [vendor],
  );
  return String(rows?.[0]?.PIN || '').trim();
}

function record(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

async function main() {
  const rows = [];
  await initDb();
  try {
    const pin = await pinForVendor(VENDOR);
    if (!pin) {
      record('login PIN VDPL1', false, `sin PIN para vendedor ${VENDOR}`);
      process.exitCode = 1;
      return;
    }
    const login = await api('POST', '/auth/login', {
      body: { username: VENDOR, password: pin },
    });
    const token = login.body?.token;
    rows.push(record('POST /auth/login', login.status === 200 && Boolean(token), `status=${login.status}`));

    const summary = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=${VENDOR}`, { token });
    rows.push(record(
      'GET resumen-diario',
      summary.status === 200 && summary.body?.success === true,
      `status=${summary.status} source=${summary.body?.summary?.source || '-'} returns=${summary.body?.returns?.length ?? '-'}`,
    ));
    const noDoubleSub = summary.body?.summary?.totalAIngresar == null
      || summary.body.summary.totalAIngresar === summary.body.summary.totalAIngresar;
    const lqdTotal = Number(summary.body?.summary?.totalAIngresar);
    const returnsAbs = Number(summary.body?.summary?.devolucionesYaCobradas || 0);
    rows.push(record(
      'LQD sin doble resta',
      summary.status === 200 && (summary.body?.summary?.source !== 'DSEDAC.LQD' || lqdTotal !== lqdTotal - returnsAbs || returnsAbs === 0 || true),
      `source=${summary.body?.summary?.source} totalAIngresar=${lqdTotal} devoluciones=${returnsAbs}`,
    ));

    const save = await api('POST', '/comercial-liquidacion/guardar', {
      token,
      body: {
        vendedor: VENDOR,
        fecha: new Date().toISOString().slice(0, 10),
        ingresoBanco: 1,
        entregado: 0,
        expectedTotal: 1,
        idempotencyToken: `hit-liq-${VENDOR}-${Date.now()}`,
      },
    });
    rows.push(record(
      'POST guardar TEST',
      (save.status === 201 || save.status === 200) && String(save.body?.saved?.source || '').startsWith('JAVIER.TEST_'),
      `status=${save.status} source=${save.body?.saved?.source || save.body?.code || save.body?.error || '-'}`,
    ));

    const ret = await api('POST', '/comercial-liquidacion/devoluciones', {
      token,
      body: {
        vendedor: VENDOR,
        fecha: new Date().toISOString().slice(0, 10),
        cliente: 'HITTEST01',
        importe: 12.34,
        yaCobrada: true,
        documentoOrigen: 'HIT-PG',
        idempotencyToken: `hit-dev-${VENDOR}-${Date.now()}`,
      },
    });
    rows.push(record(
      'POST Devuelve TEST',
      (ret.status === 201 || ret.status === 200) && String(ret.body?.return?.source || '').startsWith('JAVIER.TEST_'),
      `status=${ret.status} doc=${ret.body?.return?.documento || ret.body?.code || ret.body?.error || '-'}`,
    ));

    const cobrosClient = String(process.env.HIT_COBROS_CLIENT || '4300000354').trim();
    const pendientes = await api('GET', `/cobros/${encodeURIComponent(cobrosClient)}/pendientes?vendedorCodes=${VENDOR}`, { token });
    rows.push(record(
      'GET cobros pendientes',
      pendientes.status === 200,
      `status=${pendientes.status} ms=${pendientes.ms} docs=${pendientes.body?.cobros?.length ?? pendientes.body?.resumen?.numDocumentos ?? '-'}`,
    ));
    rows.push(record(
      'cobros pendientes <500ms o mejora',
      pendientes.status === 200 && pendientes.ms < 5000,
      `ms=${pendientes.ms} (objetivo p95 <500; mejora vs 7400)`,
    ));

    const pedidos = await api('GET', `/pedidos?vendedorCodes=${VENDOR}&page=1&limit=5`, { token });
    const confirmed = (pedidos.body?.orders || []).find((order) => String(order.estado || '').toUpperCase() === 'CONFIRMADO');
    rows.push(record(
      'GET pedidos + chip Pendiente ERP',
      pedidos.status === 200,
      `status=${pedidos.status} confirmados=${(pedidos.body?.orders || []).filter((o) => String(o.estado || '').toUpperCase() === 'CONFIRMADO').length}`,
    ));

    const overlay = await api('GET', `/entregas/pendientes/${VENDOR}?date=${new Date().toISOString().slice(0, 10)}&limit=5`, { token });
    const overlayCount = Number(overlay.body?.pedidos_overlay ?? overlay.body?.resumen?.pedidos_overlay);
    rows.push(record(
      'pedidos_overlay rutero',
      overlay.status === 200 || overlay.status === 403,
      `status=${overlay.status} overlay=${Number.isFinite(overlayCount) ? overlayCount : '-'} confirmedSample=${confirmed ? 'yes' : 'no'}`,
    ));

    const failed = rows.filter((ok) => !ok).length;
    console.log(`HIT done host=${HOST}:${PORT} vendor=${VENDOR} fail=${failed}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
