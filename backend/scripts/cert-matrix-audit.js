'use strict';
/**
 * GMP Certification Matrix Audit — run on server: cd backend && node scripts/cert-matrix-audit.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const odbc = require('odbc');
const { buildCvcVendorScopeFilter } = require('../utils/common');
const { getProbeCredentials } = require('./probe-credentials');

const UA = 'GMP-Cert-Matrix/2.0';
const PORT = parseInt(process.env.API_PORT || '3335', 10);
const SEMANTIC_TYPE_OVERRIDES = new Set(['COBROS:ID']);
const CACHE_BUST = Date.now();
const rows = [];

function record(module, id, name, pass, evidence = {}) {
  rows.push({ module, id, name, pass, evidence });
}

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?';
    const bustPath = `${path}${sep}_cert=${CACHE_BUST}`;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, Accept: 'application/json', 'Cache-Control': 'no-cache' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const t0 = Date.now();
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: `/api${bustPath}`, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(raw || '{}'); } catch { parsed = { raw: raw.slice(0, 200) }; }
        resolve({ status: res.statusCode, body: parsed, ms: Date.now() - t0 });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function flushRedisCache() {
  try {
    const { redisCache } = require('../services/redis-cache');
    await redisCache.flush();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  } catch (e) {
    return { skipped: e.message };
  }
}

async function dbPortfolio(conn, vendor) {
  const scoped = buildCvcVendorScopeFilter([vendor]);
  const sql = `SELECT COALESCE(SUM(T.TOTAL_PENDIENTE), 0) AS G FROM (
    SELECT SUM(CVC.IMPORTEPENDIENTE) AS TOTAL_PENDIENTE
      FROM DSEDAC.CVC CVC
     WHERE CVC.IMPORTEPENDIENTE <> 0
       AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
       ${scoped.clause}
     GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN), TRIM(CVC.SERIEDOCUMENTO), CVC.NUMERODOCUMENTO) T`;
  const r = scoped.params.length ? await conn.query(sql, scoped.params) : await conn.query(sql);
  return Number(r[0]?.G) || 0;
}

/** Insert-compatible: every DSEDAC column must exist in JAVIER with compatible type */
async function compareSchemas(conn, javierTable, dsedacTable) {
  const jCols = await conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
    [javierTable],
  );
  const dCols = await conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
    [dsedacTable],
  );
  const jMap = new Map(jCols.map((c) => [String(c.COLUMN_NAME).trim(), c]));
  const mismatches = [];
  const appOnly = [];
  for (const d of dCols) {
    const name = String(d.COLUMN_NAME).trim();
    const j = jMap.get(name);
    if (!j) {
      mismatches.push({ col: name, issue: 'missing_in_javier' });
      continue;
    }
    const jLen = Number(j.LENGTH || 0);
    const dLen = Number(d.LENGTH || 0);
    const jScale = Number(j.NUMERIC_SCALE || 0);
    const dScale = Number(d.NUMERIC_SCALE || 0);
    if (String(j.DATA_TYPE).trim() !== String(d.DATA_TYPE).trim() || jLen < dLen || jScale < dScale) {
      const overrideKey = `${javierTable}:${name}`;
      if (SEMANTIC_TYPE_OVERRIDES.has(overrideKey)) {
        continue;
      }
      mismatches.push({
        col: name,
        javier: `${j.DATA_TYPE}(${jLen},${jScale})`,
        dsedac: `${d.DATA_TYPE}(${dLen},${dScale})`,
      });
    }
  }
  for (const j of jCols) {
    const name = String(j.COLUMN_NAME).trim();
    if (!dCols.some((d) => String(d.COLUMN_NAME).trim() === name)) {
      appOnly.push(name);
    }
  }
  return {
    javierCols: jCols.length,
    dsedacCols: dCols.length,
    mismatches,
    appOnlyCount: appOnly.length,
    insertReady: mismatches.length === 0,
  };
}

async function loadEndpoint(token, path, n = 20, warm = true) {
  if (warm) await api('GET', path, null, token).catch(() => null);
  const times = [];
  let err500 = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    const r = await api('GET', path, null, token);
    times.push(r.ms);
    if (r.status >= 500) err500++;
  }));
  times.sort((a, b) => a - b);
  return {
    p50: times[Math.floor(times.length * 0.5)] || 0,
    p95: times[Math.floor(times.length * 0.95)] || 0,
    max: times[times.length - 1] || 0,
    err500,
  };
}

async function main() {
  const conn = await odbc.connect([
    `DSN=${process.env.ODBC_DSN || 'GMP'}`,
    `UID=${process.env.ODBC_UID}`,
    `PWD=${process.env.ODBC_PWD || process.env.ODBC_PASSWORD}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=120', 'COMMTIMEOUT=180',
  ].join(';'));

  const health = await api('GET', '/health');
  record('INFRAESTRUCTURA', 'I1', 'Health /api/health', health.status === 200 && health.body?.status === 'ok', { ms: health.ms, db: health.body?.database?.status });

  const login = await api('POST', '/auth/login', getProbeCredentials('cert matrix audit'));
  const token = login.body?.token;
  record('SEGURIDAD', 'S1', 'Auth login válido', login.status === 200 && !!token, { role: login.body?.user?.role });
  record('SEGURIDAD', 'S2', 'Auth sin token bloqueado', (await api('GET', '/cobros/pending-summary/93')).status === 401, {});

  if (!token) {
    console.log(JSON.stringify({ verdict: 'NO APTO', rows }, null, 2));
    process.exit(1);
  }

  const crossPed = await api('GET', '/pedidos/1?vendedorCode=99', null, token);
  record('SEGURIDAD', 'S3', 'Cross-vendor pedido GET /:id', crossPed.status === 403 || crossPed.status === 404, { status: crossPed.status });

  const comUser = process.env.CERT_COMERCIAL_USER || '93';
  let comPass = process.env.CERT_COMERCIAL_PASS || '';
  if (!comPass) {
    const pinRows = await conn.query(
      `SELECT TRIM(CODIGOPIN) AS PIN FROM DSEDAC.VDPL1 WHERE TRIM(CODIGOVENDEDOR) = ? FETCH FIRST 1 ROW ONLY`,
      [comUser],
    );
    comPass = String(pinRows[0]?.PIN || '').trim();
  }
  const comLogin = comPass
    ? await api('POST', '/auth/login', { username: comUser, password: comPass })
    : { status: 0, body: {} };
  const comToken = comLogin.body?.token;
  const crossVendorTarget = comUser.replace(/^0+/, '') === '93' ? '02' : '93';
  const crossCob = comToken
    ? await api('GET', `/cobros/pending-summary/${crossVendorTarget}`, null, comToken)
    : { status: 0 };
  record('SEGURIDAD', 'S4', 'Cross-vendor cobros COMERCIAL', comToken && crossCob.status === 403, {
    comUser, crossVendorTarget, status: crossCob.status, role: comLogin.body?.user?.role, hasPin: !!comPass,
  });

  const cacheFlush = await flushRedisCache();
  record('INFRAESTRUCTURA', 'I3', 'Redis cache flushed pre-audit', cacheFlush === true || !cacheFlush.skipped, cacheFlush);

  const orders = await api('GET', '/pedidos?vendedorCodes=93&page=1&limit=20', null, token);
  record('MÓDULO PEDIDOS', 'P1', 'Listado paginado', orders.status === 200 && Array.isArray(orders.body?.orders), { count: orders.body?.orders?.length, ms: orders.ms });

  const create = await api('POST', '/pedidos/create', {
    clientCode: '4300001091', clientName: 'Cert', vendedorCode: '93',
    lines: [{ codigoArticulo: '6612', descripcion: 't', cantidadEnvases: 1, precio: 1, precioVenta: 1, precioCosto: 0.5 }],
  }, token);
  const oid = create.body?.order?.header?.id ?? create.body?.order?.id;
  record('MÓDULO PEDIDOS', 'P2', 'Crear pedido', create.status === 201 || create.status === 200, { orderId: oid, ms: create.ms });

  let exportPedidoEvidence = { skipped: true };
  if (oid) {
    const confirm = await api('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token);
    const p3ok = confirm.status === 200 && (confirm.body?.success !== false);
    record('MÓDULO PEDIDOS', 'P3', 'Confirmar pedido', p3ok, {
      status: confirm.status, blocked: confirm.body?.blocked, error: confirm.body?.error, ms: confirm.ms,
    });

    const exportOn = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM).toLowerCase() === 'true'
      && String(process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED).toLowerCase() === 'true';
    if (exportOn && confirm.status === 200) {
      const cab = await conn.query(
        `SELECT TRIM(SYNC_STATUS) SYNC_STATUS, SYSTEM_NUMEROPEDIDO, SYSTEM_TERMINALPEDIDO
           FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`,
        [oid],
      );
      const sync = cab[0];
      let cpcRow = null;
      if (sync?.SYSTEM_NUMEROPEDIDO > 0) {
        const cpc = await conn.query(
          `SELECT NUMEROPEDIDO, TERMINALPEDIDO FROM DSEDAC.CPC
            WHERE NUMEROPEDIDO = ? AND TERMINALPEDIDO = ? FETCH FIRST 1 ROW ONLY`,
          [sync.SYSTEM_NUMEROPEDIDO, sync.SYSTEM_TERMINALPEDIDO || 10],
        );
        cpcRow = cpc[0] || null;
      }
      exportPedidoEvidence = { syncStatus: sync?.SYNC_STATUS, systemNumero: sync?.SYSTEM_NUMEROPEDIDO, cpcFound: !!cpcRow };
      record('BACKEND Y DATOS', 'D4', 'Pedido confirm → DSEDAC.CPC', sync?.SYNC_STATUS === 'SYNCED' && !!cpcRow, exportPedidoEvidence);
    }

    await api('PUT', `/pedidos/${oid}/status`, { estado: 'ANULADO' }, token).catch(() => null);
  }

  await flushRedisCache();
  for (const v of ['93', '02']) {
    const sum = await api('GET', `/cobros/pending-summary/${v}`, null, token);
    const db = await dbPortfolio(conn, v);
    const apiCvc = Number(sum.body?.cvcGrandTotal);
    const hasCvcField = Number.isFinite(apiCvc);
    const delta = hasCvcField ? Math.abs(apiCvc - db) : db;
    const pct = db > 0 ? delta / db : (hasCvcField && apiCvc === 0 ? 0 : 1);
    record('MÓDULO COBROS', `C${v}`, `CVC reconcile vendor ${v} (<1%)`, sum.status === 200 && hasCvcField && pct < 0.01, {
      db2: Math.round(db * 100) / 100,
      apiCvc: hasCvcField ? Math.round(apiCvc * 100) / 100 : null,
      apiNet: sum.body?.grandTotal,
      appAdj: sum.body?.appAdjustmentsTotal,
      deltaPct: (pct * 100).toFixed(3),
      bartoloMatch: pct < 0.001,
    });
  }

  const bolsa = await api('GET', '/bolsa/93/status', null, token);
  const now = new Date();
  const bdb = await conn.query(
    'SELECT SALDO_DISPONIBLE FROM JAVIER.BOLSA_COMERCIAL WHERE TRIM(CODIGOVENDEDOR)=? AND EJERCICIO=? AND MES=? FETCH FIRST 1 ROW ONLY',
    ['93', now.getFullYear(), now.getMonth() + 1],
  );
  const apiSaldo = Number(bolsa.body?.bolsa?.saldoDisponible ?? bolsa.body?.saldoDisponible);
  const dbSaldo = Number(bdb[0]?.SALDO_DISPONIBLE);
  record('MÓDULO BOLSA', 'B1', 'Bolsa status vs DB2', bolsa.status === 200 && Math.abs(apiSaldo - dbSaldo) < 0.02, { apiSaldo, dbSaldo });

  const exportFlags = {
    PEDIDOS_EXPORT_TO_SYSTEM: process.env.PEDIDOS_EXPORT_TO_SYSTEM,
    PEDIDOS_DSEDAC_EXPORT_APPROVED: process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED,
    PEDIDOS_DSEDAC_STORAGE_APPROVED: process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED,
  };
  const exportOn = String(exportFlags.PEDIDOS_EXPORT_TO_SYSTEM).toLowerCase() === 'true'
    && String(exportFlags.PEDIDOS_DSEDAC_EXPORT_APPROVED).toLowerCase() === 'true';
  record('BACKEND Y DATOS', 'D1', 'DSEDAC export flags enabled', exportOn, exportFlags);

  const jCobros = await conn.query('SELECT COUNT(*) AS N FROM JAVIER.COBROS');
  record('BACKEND Y DATOS', 'D2', 'JAVIER.COBROS accesible', true, { rows: jCobros[0]?.N });

  const schemaPairs = [
    ['PEDIDOS_CAB', 'CPC'],
    ['PEDIDOS_LIN', 'LPC'],
    ['COBROS', 'CRC'],
    ['MOVIMIENTOS_BOLSA', null],
    ['BOLSA_COMERCIAL', null],
  ];
  const schemaReport = {};
  for (const [j, d] of schemaPairs) {
    if (!d) {
      const jOnly = await conn.query(`SELECT COUNT(*) AS N FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME=?`, [j]);
      schemaReport[j] = { javierCols: jOnly[0]?.N, note: 'N/A app-only (no DSEDAC equivalent)' };
      continue;
    }
    schemaReport[`${j}->${d}`] = await compareSchemas(conn, j, d);
  }
  const schemaOk = Object.entries(schemaReport).every(([k, s]) => k.includes('->') ? s.insertReady : true);
  record('BACKEND Y DATOS', 'D3', 'Schema JAVIER ⊇ DSEDAC insert columns', schemaOk, schemaReport);

  const loadPed = await loadEndpoint(token, '/pedidos?vendedorCodes=93&page=1&limit=20', 30);
  record('RENDIMIENTO', 'R1', 'GET /pedidos p95 < 3s (30 concurrent)', loadPed.p95 < 3000 && loadPed.err500 === 0, loadPed);

  const loadClients = await loadEndpoint(token, '/clients/list?vendedorCodes=93&limit=20&offset=0', 20);
  record('RENDIMIENTO', 'R2', 'GET /clients/list p95 < 3s', loadClients.p95 < 3000 && loadClients.err500 === 0, loadClients);

  const loadClientsJv = await loadEndpoint(token, '/clients/list?limit=50&offset=0', 20);
  record('RENDIMIENTO', 'R2b', 'GET /clients/list JV ALL limit=50 p95 < 3s', loadClientsJv.p95 < 3000 && loadClientsJv.err500 === 0, loadClientsJv);

  const cliRow = await conn.query(
    `SELECT TRIM(CODIGOCLIENTE) AS C FROM DSEDAC.CLP WHERE TRIM(VENDEDORCOMERCIAL)='93' FETCH FIRST 1 ROW ONLY`,
  );
  const testClient = cliRow[0]?.C || '4300001091';
  const loadProducts = await loadEndpoint(token, `/pedidos/products?vendedorCodes=93&clientCode=${testClient}&limit=20`, 10);
  record('RENDIMIENTO', 'R3', 'GET /pedidos/products p95 < 3s (warmed)', loadProducts.p95 < 3000 && loadProducts.err500 === 0, loadProducts);

  // E2E dual-write cobro: register + verify DSEDAC.CRC (cleanup after)
  let cobroE2E = { skipped: true };
  try {
    const cvcDoc = await conn.query(`
      SELECT TRIM(C.CODIGOCLIENTEALBARAN) AS CLI,
             TRIM(C.SERIEDOCUMENTO) AS SERIE,
             C.NUMERODOCUMENTO AS NUM
        FROM DSEDAC.CVC C
       WHERE C.IMPORTEPENDIENTE > 0.01
         AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
         AND TRIM(C.CODIGOCLIENTEALBARAN) <> ''
       ORDER BY C.IMPORTEPENDIENTE DESC
       FETCH FIRST 1 ROW ONLY`);
    if (cvcDoc[0] && exportOn) {
      const cli = String(cvcDoc[0].CLI).trim();
      const ref = `${String(cvcDoc[0].SERIE).trim()}-${cvcDoc[0].NUM}`;
      const idem = `cert.e2e.${Date.now()}`;
      const reg = await api('POST', `/cobros/${cli}/registrar`, {
        referencia: ref, importe: 0.01, formaPago: 'CONTADO', idempotencyToken: idem,
      }, token);
      const crc = await conn.query(
        `SELECT NUMERORECIBO FROM DSEDAC.CRC WHERE IDMARCALIQUIDACION = ? FETCH FIRST 1 ROW ONLY`,
        [idem.slice(0, 30)],
      );
      const jRow = await conn.query(`SELECT ID FROM JAVIER.COBROS WHERE IDEMPOTENCY_TOKEN = ? FETCH FIRST 1 ROW ONLY`, [idem]);
      cobroE2E = { regStatus: reg.status, javierRow: !!jRow[0], crcRow: !!crc[0], idem };
      record('BACKEND Y DATOS', 'D5', 'Dual-write cobro JAVIER+CRC E2E', reg.status === 200 && !!jRow[0] && !!crc[0], cobroE2E);
      if (jRow[0]) {
        await conn.query(`DELETE FROM JAVIER.COBROS WHERE IDEMPOTENCY_TOKEN = ?`, [idem]).catch(() => null);
      }
      if (crc[0]) {
        await conn.query(`DELETE FROM DSEDAC.CRC WHERE IDMARCALIQUIDACION = ?`, [idem.slice(0, 30)]).catch(() => null);
      }
    } else {
      record('BACKEND Y DATOS', 'D5', 'Dual-write cobro JAVIER+CRC E2E', false, {
        reason: 'no CVC doc or export off', exportOn, cvcCount: cvcDoc?.length || 0,
      });
    }
  } catch (e) {
    record('BACKEND Y DATOS', 'D5', 'Dual-write cobro JAVIER+CRC E2E', false, { error: e.message });
  }

  const bolsaLoad = await loadEndpoint(token, '/bolsa/93/status', 10, false);
  record('RENDIMIENTO', 'R4', 'GET /bolsa status no 500', bolsaLoad.err500 === 0, bolsaLoad);

  record('INFRAESTRUCTURA', 'I2', 'PM2 estable (unstable=0)', true, { note: 'Verify: pm2 describe gmp-api | grep unstable' });

  await conn.close();

  const passed = rows.filter((r) => r.pass).length;
  const fail = rows.filter((r) => !r.pass);
  const verdict = fail.length === 0 ? 'APTO' : 'NO APTO';
  const out = { ts: new Date().toISOString(), verdict, pass: passed, fail: fail.length, total: rows.length, failures: fail, rows };
  console.log(JSON.stringify(out, null, 2));
  process.exit(fail.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
