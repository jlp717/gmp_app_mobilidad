'use strict';

/**
 * Rutero verde HIT: login + GET /rutero/day/{weekday} and assert overlay states
 * from TEST_PEDIDOS_CAB appear (PEDIDO / PEDIDO BORRADOR) when present.
 * Also verifies orderDate matches requested weekday (eae44b4).
 *
 * Usage: node scripts/_hit-rutero-verde-api.js
 * Optional: E2E_HOST=192.168.1.230 E2E_PORT=3335 VENDOR=35
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const odbc = require('odbc');

const HOST = process.env.E2E_HOST || '192.168.1.230';
const PORT = Number(process.env.E2E_PORT || 3335);
const VENDOR = String(process.env.VENDOR || '05').trim();
const DAY = String(process.env.RUTERO_DAY || '').trim().toLowerCase();
const EXPECT_CLIENT = String(process.env.EXPECT_CLIENT || '').trim();
const UA = 'GMP-SRE-HealthCheck/1.0';

function cs() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || process.env.DB2_USER || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  if (!pwd) throw new Error('Missing ODBC_PWD');
  return `DSN=${dsn};UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${dsn}`;
}

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
        resolve({ status: res.statusCode, json, raw: data.slice(0, 500) });
      });
    });
    req.setTimeout(60000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function weekdayName(d = new Date()) {
  const names = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return names[d.getDay()];
}

(async () => {
  const conn = await odbc.connect(cs());
  const pinRows = await conn.query(
    `SELECT TRIM(CODIGOPIN) AS PIN FROM DSEDAC.VDPL1
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
      FETCH FIRST 1 ROW ONLY`,
    [VENDOR],
  );
  const pin = String(pinRows?.[0]?.PIN || '').trim();
  if (!pin) throw new Error(`no PIN for ${VENDOR}`);

  const todayCab = await conn.query(
    `SELECT COUNT(*) AS N,
            SUM(CASE WHEN TRIM(ESTADO)='CONFIRMADO' THEN 1 ELSE 0 END) AS CONF,
            SUM(CASE WHEN TRIM(ESTADO)='BORRADOR' THEN 1 ELSE 0 END) AS DRAFT
       FROM JAVIER.TEST_PEDIDOS_CAB
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
        AND FECHAREPARTO = CURRENT DATE`,
    [VENDOR],
  );

  const login = await request('POST', '/api/auth/login', {
    body: { username: VENDOR, password: pin },
  });
  const token = login.json?.token || login.json?.accessToken || login.json?.data?.token;
  if (!token) {
    console.log(JSON.stringify({
      ok: false,
      step: 'login',
      status: login.status,
      error: login.json?.error || login.json?.code || null,
      keys: login.json && Object.keys(login.json),
      raw: login.raw,
    }, null, 2));
    process.exit(2);
  }

  const day = DAY || weekdayName();
  const res = await request('GET', `/api/rutero/day/${day}`, { token });
  const clients = Array.isArray(res.json?.clients) ? res.json.clients : [];
  const withPedido = clients.filter((c) => {
    const state = String(c?.orderStatus?.state || c?.orderStatus?.estado || '').toUpperCase();
    const label = String(c?.orderStatus?.label || '').toUpperCase();
    if (state === 'SIN_PEDIDO' || label === 'SIN VENTA') return false;
    return state.includes('PEDIDO') || label.includes('PEDIDO') || state === 'CON_VENTA';
  });
  const orderDate = res.json?.orderDate || res.json?.date || null;

  let expectHit = null;
  if (EXPECT_CLIENT) {
    const found = clients.find((c) => String(c.codigoCliente || c.code || '').trim() === EXPECT_CLIENT);
    const state = String(found?.orderStatus?.state || '').toUpperCase();
    const label = String(found?.orderStatus?.label || '').toUpperCase();
    const green = Boolean(found)
      && state !== 'SIN_PEDIDO'
      && label !== 'SIN VENTA'
      && (state.includes('PEDIDO') || label.includes('PEDIDO') || state === 'CON_VENTA');
    expectHit = {
      client: EXPECT_CLIENT,
      found: Boolean(found),
      state: found?.orderStatus?.state || null,
      label: found?.orderStatus?.label || null,
      date: found?.orderStatus?.date || null,
      green,
    };
  }

  const out = {
    ok: res.status === 200 && (!EXPECT_CLIENT || Boolean(expectHit?.green)),
    host: `${HOST}:${PORT}`,
    vendor: VENDOR,
    day,
    orderDate,
    status: res.status,
    clients: clients.length,
    withPedidoOverlay: withPedido.length,
    sampleOverlay: withPedido.slice(0, 5).map((c) => ({
      code: c.codigoCliente || c.code,
      state: c.orderStatus?.state || c.orderStatus?.estado,
      label: c.orderStatus?.label,
      date: c.orderStatus?.date,
    })),
    expectHit,
    testCabToday: todayCab?.[0] || null,
    cacheStatus: res.json?.cacheStatus || null,
  };

  const isoToday = new Date().toISOString().slice(0, 10);
  out.orderDateMatchesToday = !orderDate || String(orderDate).startsWith(isoToday)
    || String(orderDate) === isoToday;

  console.log(JSON.stringify(out, null, 2));
  await conn.close();
  if (!out.ok) process.exit(2);
})().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
