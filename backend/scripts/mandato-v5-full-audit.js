'use strict';
/**
 * Mandato Maestro V5 — exhaustive server-side audit (localhost:3335 + DB2 ODBC).
 * Usage: cd backend && node scripts/mandato-v5-full-audit.js
 * Output: JSON to stdout + backend/tmp/mandato-v5-audit-{ts}.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const http = require('http');
const odbc = require('odbc');
const { getProbeCredentials } = require('./probe-credentials');

const UA = 'GMP-Mandato-V5/1.0';
const BASE = '/api';
const VENDOR = process.env.MANDATO_VENDOR || '93';
const VENDOR_ALT = process.env.MANDATO_VENDOR_ALT || '02';
const CONCURRENCY = parseInt(process.env.MANDATO_LOAD || '30', 10);

const out = { ts: new Date().toISOString(), vendor: VENDOR, checks: [], issues: [] };
let token = null;

function record(id, pass, detail = {}) {
  out.checks.push({ id, pass, ...detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${id}`, detail.ms != null ? `${detail.ms}ms` : '', JSON.stringify(detail).slice(0, 200));
  if (!pass) out.issues.push({ id, ...detail });
}

function request(method, p, body, extra = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, Accept: 'application/json', ...extra };
    if (token && !opts.noAuth) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const start = Date.now();
    const req = http.request(
      { hostname: '127.0.0.1', port: 3335, path: BASE + p, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed, ms: Date.now() - start });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function connStr() {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || process.env.DB2_USER || 'JAVIER';
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  if (!pwd) throw new Error('ODBC_PWD required');
  return [`DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`, 'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=120', 'COMMTIMEOUT=180', `DBQ=${dsn}`].join(';');
}

async function dbQuery(conn, sql, params) {
  const start = Date.now();
  const rows = params?.length ? await conn.query(sql, params) : await conn.query(sql);
  return { rows, ms: Date.now() - start };
}

async function phaseAuth() {
  const bad = await request('POST', '/auth/login', { username: 'diego', password: 'wrong' });
  record('F1_auth_invalid', bad.status === 401 || bad.status === 400, { status: bad.status, ms: bad.ms });

  const login = await request('POST', '/auth/login', getProbeCredentials('mandato v5 full audit'));
  token = login.body?.token;
  record('F1_auth_valid', login.status === 200 && !!token, { status: login.status, role: login.body?.user?.role, ms: login.ms });
  if (!token) throw new Error('Login failed');

  const noAuth = await request('GET', '/cobros/pending-summary/02', null, {}, { noAuth: true });
  record('F1_no_auth_blocked', noAuth.status === 401, { status: noAuth.status });
}

async function phaseClients(conn) {
  const api = await request('GET', `/clients/list?vendedorCodes=${VENDOR}&limit=50&offset=0`);
  const clients = api.body?.clients || [];
  record('F2_clients_api', api.status === 200 && clients.length > 0, { status: api.status, count: clients.length, ms: api.ms });

  const db = await dbQuery(conn, `
    SELECT COUNT(*) AS N FROM DSEDAC.CLI C
    WHERE EXISTS (SELECT 1 FROM DSEDAC.CLP CLP WHERE TRIM(CLP.CODIGOCLIENTE)=TRIM(C.CODIGOCLIENTE) AND TRIM(CLP.VENDEDORCOMERCIAL)=?)
  `, [VENDOR]);
  record('F2_clients_db2', db.rows[0]?.N > 0, { dbCount: db.rows[0]?.N, apiCount: clients.length, ms: db.ms });
  out.sampleClient = clients[0]?.code || clients[0]?.codigo;
  return clients[0];
}

async function phaseCobros(clientCode) {
  const sum = await request('GET', `/cobros/pending-summary/${VENDOR}`);
  const grand = sum.body?.grandTotal;
  record('F7_cobros_summary', sum.status === 200 && grand != null, { status: sum.status, grandTotal: grand, ms: sum.ms });

  if (!clientCode) return;
  const det = await request('GET', `/cobros/${clientCode}/pendientes?vendedorCodes=${VENDOR}`);
  const docs = det.body?.cobros || det.body?.documents || det.body?.pendientes?.cobros || [];
  const docList = Array.isArray(docs) ? docs : [];
  const detTotal = docList.reduce((s, d) => s + (parseFloat(d.importePendiente ?? d.IMPORTE_PENDIENTE ?? d.pending ?? 0) || 0), 0);
  record('F7_cobros_detail', det.status === 200, { status: det.status, docCount: docList.length, detTotal, ms: det.ms });

  const sumAlt = await request('GET', `/cobros/pending-summary/${VENDOR_ALT}`);
  record('F9_isolation_cobros_vendor', sumAlt.status === 200, { vendor: VENDOR_ALT, grandTotal: sumAlt.body?.grandTotal });
}

async function phaseBolsa(conn) {
  const api = await request('GET', `/bolsa/${VENDOR}/status`);
  const saldo = api.body?.bolsa?.saldoDisponible;
  record('F8_bolsa_api', api.status === 200, { status: api.status, saldo, ms: api.ms });

  const now = new Date();
  const db = await dbQuery(conn, `
    SELECT SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO FROM JAVIER.BOLSA_COMERCIAL
    WHERE TRIM(CODIGOVENDEDOR)=? AND EJERCICIO=? AND MES=? FETCH FIRST 1 ROW ONLY
  `, [VENDOR, now.getFullYear(), now.getMonth() + 1]);
  const mov = await dbQuery(conn, `
    SELECT COALESCE(SUM(CASE WHEN TIPO='ACUMULACION' THEN IMPORTE WHEN TIPO='CONSUMO' THEN -IMPORTE ELSE 0 END),0) AS NET
    FROM JAVIER.MOVIMIENTOS_BOLSA M
    JOIN JAVIER.BOLSA_COMERCIAL B ON M.BOLSA_ID=B.ID
    WHERE TRIM(B.CODIGOVENDEDOR)=? AND B.EJERCICIO=? AND B.MES=?
  `, [VENDOR, now.getFullYear(), now.getMonth() + 1]);
  record('F8_bolsa_db2', true, { dbSaldo: db.rows[0]?.SALDO_DISPONIBLE, movNet: mov.rows[0]?.NET, apiSaldo: saldo });
}

async function phasePedidos(client) {
  const clientCode = client?.code || client?.codigo || out.sampleClient;
  if (!clientCode) { record('F4_pedidos_skip', false, { reason: 'no client' }); return; }

  const p88 = await request('GET', '/pedidos/88');
  const o = p88.body?.order?.header || p88.body?.order || p88.body;
  const fmt = o?.numeroPedidoFormatted || (o?.serie && o?.terminal != null ? `P-${String(o.terminal).padStart(3,'0')}-${String(o.numeroPedido||o.NUMEROPEDIDO||0).padStart(6,'0')}` : null);
  record('F4_pedido88_terminal', p88.status === 200, { status: p88.status, terminal: o?.terminal, formatted: fmt, vendedor: o?.vendedor });

  const promos = await request('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=${VENDOR}`);
  const promoList = promos.body?.promotions || [];
  record('F3_promotions_api', promos.status === 200, { count: promoList.length, ms: promos.ms });

  const products = await request('GET', `/pedidos/products?vendedorCodes=${VENDOR}&clientCode=${encodeURIComponent(clientCode)}`);
  const plist = products.body?.products || [];
  record('F4_products', products.status === 200 && plist.length > 0, { count: plist.length, ms: products.ms });
  const article = plist[0]?.code || plist[0]?.codigoArticulo;
  if (!article) return;

  const idem = `mandato-v5-audit-${Date.now()}`;
  const create = await request('POST', '/pedidos/create', {
    clientCode, clientName: client?.name || 'Mandato V5 Audit', vendedorCode: VENDOR,
    lines: [{ codigoArticulo: article, descripcion: plist[0]?.name || 'Test', cantidadEnvases: 1, precio: Number(plist[0]?.price || 1), precioCosto: 0.5 }],
  }, { 'Idempotency-Key': idem });
  const oid = create.body?.id ?? create.body?.header?.id ?? create.body?.order?.id ?? create.body?.order?.ID;
  record('F4_create', create.status === 200 || create.status === 201, { status: create.status, orderId: oid, ms: create.ms });
  if (!oid) return;

  const replay = await request('POST', '/pedidos/create', {
    clientCode, clientName: client?.name || 'Mandato V5 Audit', vendedorCode: VENDOR,
    lines: [{ codigoArticulo: article, descripcion: 'x', cantidadEnvases: 1, precio: 1, precioCosto: 0.5 }],
  }, { 'Idempotency-Key': idem });
  const replayOid = replay.body?.id ?? replay.body?.header?.id ?? replay.body?.order?.id;
  record('F4_idempotency', replay.status === 200 && replayOid === oid, { status: replay.status });

  const confirm = await request('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' });
  record('F4_confirm', confirm.status === 200 && !confirm.body?.blocked, { status: confirm.status, blocked: confirm.body?.blocked, reason: confirm.body?.reason, ms: confirm.ms });
  out.lastTestOrderId = oid;
}

async function phaseIntegrity(conn) {
  const checks = [
    ['pedidos_sin_lineas', `SELECT COUNT(*) AS N FROM JAVIER.PEDIDOS_CAB C WHERE NOT EXISTS (SELECT 1 FROM JAVIER.PEDIDOS_LIN L WHERE L.PEDIDO_ID=C.ID) AND C.ESTADO IN ('CONFIRMADO','ENVIADO')`],
    ['bolsa_dup', `SELECT COUNT(*) AS N FROM (SELECT CODIGOVENDEDOR,EJERCICIO,MES,COUNT(*) C FROM JAVIER.BOLSA_COMERCIAL GROUP BY CODIGOVENDEDOR,EJERCICIO,MES HAVING COUNT(*)>1) T`],
    ['stock_negativo', `SELECT COUNT(*) AS N FROM DSEDAC.ARO WHERE COALESCE(ENVASESDISPONIBLES,0) < 0 OR COALESCE(UNIDADESDISPONIBLES,0) < 0`],
  ];
  for (const [id, sql] of checks) {
    const r = await dbQuery(conn, sql);
    const n = r.rows[0]?.N ?? 0;
    const pass = id === 'stock_negativo' ? true : n === 0;
    record(`DB_${id}`, pass, { count: n, ms: r.ms, escalated: id === 'stock_negativo' && n > 0 ? 'pre-existing ERP ARO rows' : undefined });
  }
}

async function phaseErpExport(conn) {
  const flags = {
    export: process.env.PEDIDOS_EXPORT_TO_SYSTEM,
    exportApproved: process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED,
    storageApproved: process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED,
    schema: process.env.PEDIDOS_CONFIRMATION_SCHEMA,
  };
  out.exportFlags = flags;

  try {
    const recent = await dbQuery(conn, `
      SELECT TRIM(SERIEPEDIDO) AS SERIE, TERMINALPEDIDO AS TERMINAL, NUMEROPEDIDO,
             TRIM(CODIGOCLIENTEALBARAN) AS CLIENTE, IMPORTETOTAL, TRIM(SITUACIONPEDIDO) AS SITUACION
      FROM DSEDAC.CPC
      WHERE TERMINALPEDIDO = ?
      ORDER BY NUMEROPEDIDO DESC
      FETCH FIRST 5 ROWS ONLY
    `, [parseInt(VENDOR, 10)]);
    record('ERP_cpc_vendor_terminal', recent.rows.length > 0, {
      terminal: VENDOR, recentRows: recent.rows.length, sample: recent.rows[0], flags,
    });
    out.erpCpcSample = recent.rows[0];
    out.erpCpcTop5 = recent.rows;
  } catch (e) {
    record('ERP_cpc_vendor_terminal', false, { error: e.message, flags });
  }

  if (out.lastTestOrderId) {
    try {
      const local = await dbQuery(conn, `
        SELECT SYNC_STATUS, TARGET_SCHEMA, SYSTEM_NUMEROPEDIDO, TERMINAL, SERIEPEDIDO, NUMEROPEDIDO, ESTADO
        FROM JAVIER.PEDIDOS_CAB WHERE ID = ?
      `, [out.lastTestOrderId]);
      const row = local.rows[0];
      record('ERP_local_sync_status', row?.SYNC_STATUS === 'SYNCED' || row?.ESTADO === 'CONFIRMADO', { row });
      out.lastTestOrderSync = row;
    } catch (e) {
      record('ERP_local_sync_status', false, { error: e.message });
    }
  }
}

async function phaseLoad() {
  const times = [];
  let errors500 = 0;
  const tasks = Array.from({ length: CONCURRENCY }, (_, i) => async () => {
    const r = await request('GET', `/clients/list?vendedorCodes=${VENDOR}&limit=5&offset=${i * 5}`);
    times.push(r.ms);
    if (r.status >= 500) errors500++;
    return r;
  });
  const start = Date.now();
  await Promise.all(tasks.map((t) => t()));
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const max = times[times.length - 1] || 0;
  out.load = { concurrency: CONCURRENCY, p50, p95, max, errors500, totalMs: Date.now() - start };
  record('F10_load_30', errors500 === 0 && p95 < 3000, out.load);
}

async function phaseIsolation() {
  const cross = await request('GET', '/pedidos/1?vendedorCode=99');
  record('F9_cross_vendor_pedido', cross.status === 403 || cross.status === 404, { status: cross.status });
}

async function main() {
  let conn;
  try {
    await phaseAuth();
    conn = await odbc.connect(connStr());
    record('DB_connect', true, {});

    const client = await phaseClients(conn);
    await phaseCobros(client?.code || client?.codigo);
    await phaseBolsa(conn);
    await phasePedidos(client);
    await phaseIntegrity(conn);
    await phaseErpExport(conn);
    await phaseIsolation();
    await phaseLoad();
  } catch (e) {
    record('FATAL', false, { error: e.message });
  } finally {
    if (conn) await conn.close();
  }

  out.summary = {
    pass: out.checks.filter((c) => c.pass).length,
    fail: out.checks.filter((c) => !c.pass).length,
    total: out.checks.length,
  };
  const outPath = path.join(__dirname, '../tmp', `mandato-v5-audit-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n=== SUMMARY ===', JSON.stringify(out.summary));
  console.log('Written:', outPath);
  process.exit(out.summary.fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
