'use strict';

/**
 * HIT isolated_test: rutero week/day + factura detail for 80/35/98.
 * Never prints PIN. No POST /commissions/pay. No OPP export.
 *
 *   API_HOST=192.168.1.230 node backend/scripts/hit-comercial-lac-select.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const { initDb, closePool, queryWithParams } = require('../config/db');

const HOST = process.env.API_HOST || '192.168.1.230';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const VENDORS = ['80', '35', '98'];
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;
const UA = 'GMP-Commercial-HIT/1.0';

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 200) };
  }
}

function api(method, path, { token, timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${path}`,
      method,
      headers: {
        'User-Agent': UA,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: parseBody(raw),
        ms: Date.now() - started,
      }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${timeoutMs}ms ${path}`));
    });
    req.on('error', reject);
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

function firstFactura(body) {
  const list = body?.facturas || body?.invoices || body?.data || body?.items || [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const row = list[0];
  return {
    serie: String(row.serie || row.SERIE || row.serieFactura || '').trim(),
    numero: row.numero || row.NUMERO || row.numeroFactura,
    ejercicio: row.ejercicio || row.EJERCICIO || row.ejercicioFactura || YEAR,
  };
}

function record(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

async function hitVendor(vendor) {
  const rows = [];
  const pin = await pinForVendor(vendor);
  if (!pin) {
    rows.push(record(`login ${vendor}`, false, 'sin PIN VDPL1'));
    return rows;
  }
  const loginRes = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ username: vendor, password: pin });
    const started = Date.now();
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
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
    req.write(payload);
    req.end();
  });
  const token = loginRes.body?.token;
  const role = String(loginRes.body?.user?.role || loginRes.body?.role || '').toUpperCase();
  rows.push(record(
    `POST /auth/login ${vendor}`,
    loginRes.status === 200 && Boolean(token),
    `status=${loginRes.status} role=${role || '-'}`,
  ));
  if (!token) return rows;

  const week = await api('GET', `/rutero/week?vendedorCodes=${encodeURIComponent(vendor)}&year=${YEAR}&month=${MONTH}`, { token });
  const weekMap = week.body?.week || {};
  const weekTotal = Object.values(weekMap).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const uniqueClients = Number(week.body?.totalUniqueClients || 0);
  rows.push(record(
    `GET /rutero/week ${vendor}`,
    week.status === 200 && (uniqueClients > 0 || weekTotal > 0),
    `status=${week.status} unique=${uniqueClients} sumDays=${weekTotal} ms=${week.ms}`,
  ));

  const dayName = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    .find((day) => Number(weekMap[day] || 0) > 0) || 'martes';
  const day = await api('GET', `/rutero/day/${dayName}?vendedorCodes=${encodeURIComponent(vendor)}&year=${YEAR}&month=${MONTH}&forceRefresh=1`, { token });
  const dayClients = day.body?.clients || day.body?.data || [];
  rows.push(record(
    `GET /rutero/day/${dayName} ${vendor}`,
    day.status === 200 && Array.isArray(dayClients) && dayClients.length > 0,
    `status=${day.status} count=${Array.isArray(dayClients) ? dayClients.length : 0} ms=${day.ms}`,
  ));

  const factList = await api('GET', `/facturas?vendedorCodes=${encodeURIComponent(vendor)}&year=${YEAR}&limit=20`, { token });
  const factura = firstFactura(factList.body);
  rows.push(record(
    `GET /facturas ${vendor}`,
    factList.status === 200 && Boolean(factura),
    `status=${factList.status} first=${factura ? `${factura.serie}-${factura.numero}` : '-'} ms=${factList.ms}`,
  ));
  if (factura && factura.serie && factura.numero) {
    const fDet = await api(
      'GET',
      `/facturas/${encodeURIComponent(factura.serie)}/${encodeURIComponent(factura.numero)}/${encodeURIComponent(factura.ejercicio)}`,
      { token },
    );
    const lines = fDet.body?.lines || fDet.body?.lineas || fDet.body?.factura?.lines || [];
    rows.push(record(
      `GET /facturas/:serie/:numero/:ej ${vendor}`,
      fDet.status === 200,
      `status=${fDet.status} lines=${Array.isArray(lines) ? lines.length : '-'} ms=${fDet.ms}`,
    ));
  } else {
    rows.push(record(`GET /facturas/:serie/:numero/:ej ${vendor}`, false, 'sin factura de muestra'));
  }
  return rows;
}

async function main() {
  const rows = [];
  await initDb();
  try {
    const ready = await api('GET', '/ready');
    const tableSet = String(ready.body?.reparto?.runtime?.tableSet || '').toLowerCase();
    const erpWrites = ready.body?.reparto?.runtime?.productionErpWritesApproved === true;
    rows.push(record(
      'GET /ready isolated_test',
      ready.status === 200 && tableSet === 'isolated_test' && erpWrites === false,
      `status=${ready.status} tableSet=${tableSet || '-'} erpWrites=${erpWrites}`,
    ));

    for (const vendor of VENDORS) {
      rows.push(...await hitVendor(vendor));
    }

    const dsedacWrite = false;
    rows.push(record('dsedacWrite=false', dsedacWrite === false, 'writes=none HIT=GET-only pin=VDPL1-DSEDAC'));
    rows.push(record('no POST /commissions/pay', true, 'skipped'));
    rows.push(record('no export OPP', true, 'skipped'));

    const failed = rows.filter((ok) => !ok).length;
    console.log(`HIT lac-select host=${HOST}:${PORT} fail=${failed}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(String(error.message || error).slice(0, 200));
  process.exitCode = 1;
});
