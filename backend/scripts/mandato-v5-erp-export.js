'use strict';
/** ERP export certification: create+confirm pedido vendor 93, verify DSEDAC.CPC */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
const http = require('http');
const { getProbeCredentials } = require('./probe-credentials');

const UA = 'GMP-Mandato-V5/1.0';
const VENDOR = '93';

function cs() {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  return `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${process.env.ODBC_DSN || 'GMP'}`;
}

function call(method, path, body, token, extra = {}) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const h = { 'User-Agent': UA, ...extra };
    if (token) h.Authorization = `Bearer ${token}`;
    if (d) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(d); }
    const r = http.request({ hostname: '127.0.0.1', port: 3335, path: '/api' + path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(b || '{}'); } catch (_) { parsed = { raw: b.slice(0, 300) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const out = { flags: {
    export: process.env.PEDIDOS_EXPORT_TO_SYSTEM,
    exportApproved: process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED,
    storageApproved: process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED,
    schema: process.env.PEDIDOS_CONFIRMATION_SCHEMA,
  }};

  const login = await call('POST', '/auth/login', getProbeCredentials('mandato v5 erp export'));
  const token = login.body.token;
  if (!token) { console.log(JSON.stringify({ error: 'login failed', login }, null, 2)); process.exit(1); }

  const conn = await odbc.connect(cs());
  const cobApi = await call('GET', '/cobros/pending-summary/093', null, token);
  out.cobrosMatch = { apiGrandTotal: cobApi.body.grandTotal };

  const clients = await call('GET', '/clients/list?vendedorCodes=93&limit=1', null, token);
  const clientCode = clients.body.clients?.[0]?.code;
  out.client = clientCode;

  const products = await call('GET', `/pedidos/products?vendedorCodes=${VENDOR}&clientCode=${encodeURIComponent(clientCode)}&limit=3`, null, token);
  const prod = (products.body.products || [])[0];
  out.products = { status: products.status, count: (products.body.products || []).length, article: prod?.code };

  if (!prod) {
    await conn.close();
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const idem = `mandato-erp-${Date.now()}`;
  const create = await call('POST', '/pedidos/create', {
    clientCode, clientName: clients.body.clients[0].name, vendedorCode: '93',
    lines: [{ codigoArticulo: prod.code, descripcion: prod.name || 'MV5 ERP', cantidadEnvases: 1, precio: Number(prod.price || 1), precioCosto: 0.5 }],
  }, token, { 'Idempotency-Key': idem });
  const oid = create.body.order?.id ?? create.body.order?.header?.id ?? create.body.order?.ID;
  out.create = { status: create.status, oid, error: create.body.error };

  if (!oid) { await conn.close(); console.log(JSON.stringify(out, null, 2)); process.exit(1); }

  const confirm = await call('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token);
  out.confirm = { status: confirm.status, error: confirm.body?.error, blocked: confirm.body?.blocked, reason: confirm.body?.reason };

  const dbp = await conn.query(
    `SELECT ID, TERMINAL, NUMEROPEDIDO, SERIEPEDIDO, TRIM(CODIGOVENDEDOR) AS V,
            SYNC_STATUS, TARGET_SCHEMA, SYSTEM_NUMEROPEDIDO, SYSTEM_SERIEPEDIDO
     FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`, [oid]);
  out.db2Pedido = dbp[0];
  const term = dbp[0]?.TERMINAL ?? 93;
  const num = dbp[0]?.SYSTEM_NUMEROPEDIDO ?? dbp[0]?.NUMEROPEDIDO;
  const serie = (dbp[0]?.SYSTEM_SERIEPEDIDO ?? dbp[0]?.SERIEPEDIDO ?? 'P').trim();
  out.formatted = `P-${String(term).padStart(3, '0')}-${String(num).padStart(6, '0')}`;

  const cpcRows = await conn.query(
    `SELECT TRIM(SUBEMPRESAPEDIDO) AS SUB, EJERCICIOPEDIDO, TRIM(SERIEPEDIDO) AS SERIE, TERMINALPEDIDO,
            NUMEROPEDIDO, TRIM(CODIGOCLIENTEALBARAN) AS CLIENTE, IMPORTETOTAL, TRIM(SITUACIONPEDIDO) AS SIT,
            TRIM(CODIGOVENDEDOR) AS VEND, DIASERVICIO, MESSERVICIO, ANOSERVICIO
     FROM DSEDAC.CPC
     WHERE EJERCICIOPEDIDO = ? AND TRIM(SERIEPEDIDO) = ? AND TERMINALPEDIDO = ? AND NUMEROPEDIDO = ?
     FETCH FIRST 1 ROW ONLY`,
    [2026, serie, term, num],
  );
  out.dsedacCpc = cpcRows[0] || null;
  out.erpCertified = Boolean(cpcRows[0] && out.db2Pedido?.SYNC_STATUS === 'SYNCED');

  const p88 = await conn.query(`SELECT ID,TERMINAL,NUMEROPEDIDO,SERIEPEDIDO,SYNC_STATUS,TRIM(CODIGOVENDEDOR) V FROM JAVIER.PEDIDOS_CAB WHERE ID=88`);
  out.pedido88 = p88[0];

  await conn.close();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.erpCertified ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
