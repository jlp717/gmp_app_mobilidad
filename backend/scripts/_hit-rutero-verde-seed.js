'use strict';

/**
 * Seed TEST overlay (ANO/MES/DIA documento = orderDate) for a client on today's
 * rutero day, bust app:v2 cache, assert PEDIDO/VENTA label.
 */

require('../config/load-env').loadEnv(require('path').join(__dirname, '..'));
process.env.REPARTO_TABLE_SET = process.env.REPARTO_TABLE_SET || 'isolated_test';

const http = require('http');
const { initDb, queryWithParams, closePool } = require('../config/db');
const { initCache, deleteCachePattern, redisCache } = require('../services/redis-cache');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const VENDOR = String(process.env.VENDOR || '35').trim();
const UA = 'GMP-SRE-HealthCheck/1.0';

function request(method, path, { token, body, forceRefresh = false } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        ...(forceRefresh ? { 'x-force-refresh': '1' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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
    req.setTimeout(90000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function weekdayName(d = new Date()) {
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][d.getDay()];
}

(async () => {
  await initDb();
  try { await initCache(); } catch (_) { /* L1-only fallback */ }
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
  if (!token) throw new Error(`login failed ${login.status}`);

  const day = weekdayName();
  const before = await request('GET', `/api/rutero/day/${day}`, { token });
  const clients = Array.isArray(before.json?.clients) ? before.json.clients : [];
  const orderDate = String(before.json?.orderDate || before.json?.date || '').slice(0, 10);
  if (!clients.length || !orderDate) throw new Error('no clients/orderDate');

  const [y, m, d] = orderDate.split('-').map(Number);
  const target = clients.find((c) => String(c?.orderStatus?.state || '').toUpperCase() === 'SIN_PEDIDO')
    || clients[0];
  const clientCode = String(target.codigoCliente || target.code || '').trim();
  const marker = `RUTEROGREEN${Date.now()}`;
  const num = Math.floor(Date.now() % 900000) + 100000;

  // Overlay matches ANODOCUMENTO/MESDOCUMENTO/DIADOCUMENTO (= orderDate), not FECHAREPARTO.
  await queryWithParams(
    `INSERT INTO JAVIER.TEST_PEDIDOS_CAB (
       EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, TERMINAL,
       DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
       CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
       CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, ESTADO,
       IMPORTETOTAL, IMPORTEBASE, IMPORTEIVA, IMPORTECOSTO, IMPORTEMARGEN,
       OBSERVACIONES, DESCUENTO_GLOBAL, ORIGEN, TARGET_SCHEMA, SYNC_STATUS,
       FECHAREPARTO, DIAREPARTO, MESREPARTO, ANOREPARTO,
       CREATED_AT, UPDATED_AT
     ) VALUES (
       2026, ?, 'T', 99,
       ?, ?, ?, 120000,
       ?, ?, ?, '01',
       1, 1, 'CC', 'CONFIRMADO',
       10, 10, 0, 5, 5,
       ?, 0, 'A', 'JAVIER', 'LOCAL',
       ?, ?, ?, ?,
       CURRENT TIMESTAMP, CURRENT TIMESTAMP
     )`,
    [num, d, m, y, clientCode, marker, VENDOR, marker, orderDate, d, m, y],
    false,
  );

  const seeded = await queryWithParams(
    `SELECT ID, TRIM(ESTADO) E, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
       FROM JAVIER.TEST_PEDIDOS_CAB WHERE TRIM(OBSERVACIONES) = ?
       FETCH FIRST 1 ROW ONLY`,
    [marker],
    false,
  );

  try {
    await deleteCachePattern('query:rutero:orders:app:v2:*');
    await deleteCachePattern('query:rutero:day:payload:v4:*');
    await deleteCachePattern('rutero:orders:app:v2:*');
    await deleteCachePattern('query:query:rutero:orders:app:v2:*');
  } catch (_) { /* best-effort */ }

  const after = await request('GET', `/api/rutero/day/${day}?_=${Date.now()}`, {
    token,
    forceRefresh: true,
  });
  const afterClients = Array.isArray(after.json?.clients) ? after.json.clients : [];
  const hit = afterClients.find((c) => {
    const code = String(c.codigoCliente || c.code || '').trim();
    return code === clientCode;
  });
  const state = String(hit?.orderStatus?.state || '').toUpperCase();
  const label = String(hit?.orderStatus?.label || '').toUpperCase();
  const green = Boolean(hit)
    && state !== 'SIN_PEDIDO'
    && label !== 'SIN VENTA'
    && (state.includes('PEDIDO') || label.includes('PEDIDO') || state === 'CON_VENTA' || state === 'CONFIRMADO');

  // Second attempt after L1 TTL if still not green
  let finalHit = hit;
  let finalState = state;
  let finalLabel = label;
  let finalGreen = green;
  if (!green) {
    await new Promise((r) => setTimeout(r, 65_000));
    const retry = await request('GET', `/api/rutero/day/${day}?_=${Date.now()}`, {
      token,
      forceRefresh: true,
    });
    const retryClients = Array.isArray(retry.json?.clients) ? retry.json.clients : [];
    finalHit = retryClients.find((c) => String(c.codigoCliente || c.code || '').trim() === clientCode);
    finalState = String(finalHit?.orderStatus?.state || '').toUpperCase();
    finalLabel = String(finalHit?.orderStatus?.label || '').toUpperCase();
    finalGreen = Boolean(finalHit)
      && finalState !== 'SIN_PEDIDO'
      && finalLabel !== 'SIN VENTA'
      && (finalState.includes('PEDIDO') || finalLabel.includes('PEDIDO') || finalState === 'CON_VENTA' || finalState === 'CONFIRMADO');
  }

  await queryWithParams(
    `DELETE FROM JAVIER.TEST_PEDIDOS_CAB WHERE TRIM(OBSERVACIONES) = ?`,
    [marker],
    false,
  );

  const out = {
    ok: before.status === 200 && finalGreen && Boolean(seeded?.[0]?.ID),
    vendor: VENDOR,
    day,
    orderDate,
    clientCode,
    seeded: seeded?.[0] || null,
    beforeState: target.orderStatus?.state || null,
    afterState: finalState || null,
    afterLabel: finalLabel || null,
    afterOrderStatus: finalHit?.orderStatus || null,
    green: finalGreen,
    immediateGreen: green,
    clients: afterClients.length,
    redisConnected: Boolean(redisCache?.isConnected),
  };
  console.log(JSON.stringify(out, null, 2));
  await closePool().catch(() => {});
  if (!out.ok) process.exit(2);
})().catch(async (e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  try { await closePool(); } catch (_) {}
  process.exit(1);
});
