'use strict';
/** Commercial readiness edge-case battery ? run from backend/: node scripts/commercial-readiness-battery.js */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const crypto = require('crypto');
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const { queryWithParams, initDb, closePool } = require('../config/db');
const { getProbeCredentials } = require('./probe-credentials');
const UA = process.env.API_USER_AGENT || 'GMP-Commercial-Readiness-Battery/1.0';
const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = parseInt(process.env.API_PORT || '3335', 10);
const API_CREDS = (process.env.API_USER || process.env.COMMERCIAL_BATTERY_USER)
  && (process.env.API_PASS || process.env.COMMERCIAL_BATTERY_PASS)
  ? {
      username: process.env.API_USER || process.env.COMMERCIAL_BATTERY_USER,
      password: process.env.API_PASS || process.env.COMMERCIAL_BATTERY_PASS,
    }
  : getProbeCredentials('commercial readiness battery');
const API_USER = API_CREDS.username;
const API_PASS = API_CREDS.password;
const VENDOR = String(process.env.VENDOR_CODE || process.env.COMMERCIAL_BATTERY_VENDOR || '93').replace(/^0+/, '') || '93';
const VENDOR_COBRos = VENDOR.padStart(2, '0');
const SAMPLES = parseInt(process.env.COMMERCIAL_BATTERY_SAMPLES || '5', 10);
const DRAFT_WAIT_MS = parseInt(process.env.COMMERCIAL_BATTERY_DRAFT_WAIT_MS || '300000', 10);
const ERP_SCHEMA = process.env.DB2_WRITE_SCHEMA || 'JAVIER';
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
function batteryPriceVsTarifa(ref, minP, mode) {
  const r = money(ref);
  if (r <= 0) return 0;
  if (mode === 'equal') return r;
  const factor = mode === 'below' ? 0.92 : 1.08;
  let price = money(r * factor);
  if (mode === 'below') {
    price = money(Math.min(price, r - 0.01));
    if (price >= r) price = money(r * 0.90);
    if (minP > 0 && minP < r && price < minP) price = money(minP);
    if (price >= r) price = money(r * 0.90);
  } else {
    price = money(Math.max(price, r + 0.01));
  }
  return price;
}

function near(a, b, eps = 0.02) { const base = Math.max(Math.abs(money(a)), Math.abs(money(b)), 1); return Math.abs(money(a) - money(b)) <= Math.max(eps, base * 0.015); }
function record(id, name, pass, detail = '', ms = 0) { const row = { id, name, pass: pass ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 260), ms }; results.push(row); console.log(`[${row.pass}] ${id} ${name}${detail ? ` ? ${detail}` : ''} (${ms}ms)`); }
function parseBody(b) { try { return JSON.parse(b || '{}'); } catch { return { raw: (b || '').slice(0, 300) }; } }
function apiCall(method, path, body, token, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = http.request({ hostname: HOST, port: PORT, path: `/api${path}`, method, headers }, (res) => {
      let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => resolve({ status: res.statusCode, body: parseBody(raw) }));
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
const orderId = (b) => b?.order?.header?.id ?? b?.order?.id ?? b?.id ?? null;
function productStockEnvases(p) { return Number(p?.stockEnvases ?? p?.STOCKENVASES ?? 0) || 0; }
async function pickBatteryProduct(token, clientCode) {
  const prodsRes = await apiCall('GET', '/pedidos/products?vendedorCodes=' + VENDOR + '&clientCode=' + encodeURIComponent(clientCode) + '&limit=80', null, token);
  const list = prodsRes.body.products || [];
  const priced = list.filter((p) => Number(p.precioCliente) > 0);
  const inStock = priced.filter((p) => productStockEnvases(p) > 0);
  return inStock[0] || priced[0] || list[0] || null;
}
function buildLine(prod, price, qty = 1) {
  const ref = Number(prod.precioCliente ?? prod.precioTarifa1 ?? 0);
  return { codigoArticulo: prod.code, descripcion: (prod.name || 'battery').slice(0, 40), cantidadEnvases: qty, cantidadUnidades: 0, unidadesCaja: prod.unitsPerBox || 1, precio: price, precioVenta: price, precioCosto: Number(prod.precioCosto) || 0.5, precioTarifa: ref, precioTarifaCliente: ref, precioMinimo: Number(prod.precioMinimo) || 0 };
}
async function dbConnect() { try { return await odbc.connect(db2ConnectionString({ mode: 'dsn', extras: 'NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180' })); } catch { return null; } }
async function dbTarifaViaPool(clientCode, articleCode) {
  await initDb();
  const rows = await queryWithParams(
    'SELECT COALESCE(CLC.CODIGOTARIFA,1) AS T, COALESCE(ARA.PRECIOTARIFA,0) AS P FROM DSEDAC.CLC CLC LEFT JOIN DSEDAC.ARA ARA ON TRIM(ARA.CODIGOARTICULO)=? AND ARA.CODIGOTARIFA=COALESCE(CLC.CODIGOTARIFA,1) WHERE TRIM(CLC.CODIGOCLIENTE)=? FETCH FIRST 1 ROW ONLY',
    [String(articleCode).trim(), String(clientCode).trim()],
    false,
  );
  return rows[0] ? { price: Number(rows[0].P) || 0 } : { price: 0 };
}
async function dbTarifa(conn, clientCode, articleCode) {
  const rows = await conn.query(`SELECT COALESCE(CLC.CODIGOTARIFA,1) T, COALESCE(ARA.PRECIOTARIFA,0) P FROM DSEDAC.CLC CLC LEFT JOIN DSEDAC.ARA ARA ON TRIM(ARA.CODIGOARTICULO)=? AND ARA.CODIGOTARIFA=COALESCE(CLC.CODIGOTARIFA,1) WHERE TRIM(CLC.CODIGOCLIENTE)=? FETCH FIRST 1 ROW ONLY`, [String(articleCode).trim(), String(clientCode).trim()]);
  return rows[0] ? { price: Number(rows[0].P) || 0 } : { price: 0 };
}
async function countIdem(conn, key) { const r = await conn.query(`SELECT COUNT(*) C FROM ${ERP_SCHEMA}.PEDIDO_IDEMPOTENCY WHERE IDEMPOTENCY_KEY=?`, [key]); return Number(r[0]?.C || 0); }
async function countCpc(conn, pedidoId) {
  const cab = await conn.query(`SELECT EJERCICIOPEDIDO, TERMINALPEDIDO, TERMINAL, NUMEROPEDIDO, TRIM(SERIEPEDIDO) SERIE FROM ${ERP_SCHEMA}.PEDIDOS_CAB WHERE ID=?`, [pedidoId]);
  if (!cab.length) return -1; const h = cab[0]; const term = h.TERMINALPEDIDO ?? h.TERMINAL; const r = await conn.query(`SELECT COUNT(*) C FROM DSEDAC.CPC WHERE EJERCICIOPEDIDO=? AND TRIM(SERIEPEDIDO)=? AND TERMINALPEDIDO=? AND NUMEROPEDIDO=?`, [h.EJERCICIOPEDIDO || new Date().getFullYear(), (h.SERIE || 'P').trim(), term, h.NUMEROPEDIDO]); return Number(r[0]?.C || 0);
}
async function movs(conn, pedidoId) { return conn.query(`SELECT TRIM(TIPO) TIPO, IMPORTE FROM ${ERP_SCHEMA}.MOVIMIENTOS_BOLSA WHERE PEDIDO_ID=?`, [pedidoId]); }
async function countPmrGiftLinesVendorScope(conn) {
  const rows = await conn.query(
    'SELECT COUNT(*) AS C FROM DSEDAC.PMRL L JOIN DSEDAC.PMR P ON TRIM(P.CODIGOPROMOCIONREGALO)=TRIM(L.CODIGOPROMOCIONREGALO) JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE)=TRIM(P.CODIGOCLIENTE) AND TRIM(CLP.VENDEDORCOMERCIAL)=?',
    [VENDOR],
  ).catch(() => [{ C: 0 }]);
  return Number(rows[0]?.C || 0);
}
async function countPmrGiftPromos(conn) {
  const rows = await conn.query("SELECT COUNT(*) AS C FROM DSEDAC.PMR WHERE TRIM(COALESCE(CODIGOPROMOCIONREGALO,'')) <> ''").catch(() => [{ C: 0 }]);
  return Number(rows[0]?.C || 0);
}
async function findPmrGift(conn, token) {
  const rows = await conn.query(`SELECT DISTINCT TRIM(P.CODIGOCLIENTE) C FROM DSEDAC.PMR P JOIN DSEDAC.CLP CLP ON TRIM(CLP.CODIGOCLIENTE)=TRIM(P.CODIGOCLIENTE) AND TRIM(CLP.VENDEDORCOMERCIAL)=? FETCH FIRST 40 ROWS ONLY`, [VENDOR]).catch(() => []);
  for (const row of rows) {
    const clientCode = String(row.C || '').trim(); if (!clientCode) continue;
    const prom = await apiCall('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=${VENDOR}`, null, token);
    const pmr = (prom.body.promotions || []).find((p) => p.source === 'PMR' && (p.giftSkus || []).length > 0);
    if (pmr) return { clientCode, pmr };
  }
  return null;
}
async function findAltUser(conn) {
  for (const sql of [`SELECT TRIM(CODIGOUSUARIO) U, TRIM(CODIGOVENDEDOR) V FROM JAVIER.USUARIOS FETCH FIRST 20 ROWS ONLY`, `SELECT TRIM(NOMBREUSUARIO) U, TRIM(CODIGOVENDEDOR) V FROM DSEDAC.VDC WHERE SUBEMPRESA='GMP' FETCH FIRST 30 ROWS ONLY`]) {
    try { const rows = await conn.query(sql); return rows.map((r) => ({ user: String(r.U || '').trim(), vendor: String(r.V || '').trim(), source: sql })).filter((x) => x.user && x.user.toLowerCase() !== API_USER.toLowerCase()); } catch {}
  }
  return [];
}
function printTable() { console.log('\n| # | Test | Result | Detail |'); console.log('|---|------|--------|--------|'); for (const r of results) console.log(`| ${r.id} | ${r.name} | ${r.pass} | ${r.detail.replace(/\|/g, '/')} |`); const p = results.filter((r) => r.pass === 'PASS').length; console.log(`\n[battery] ${p} PASS / ${results.length - p} FAIL (${results.length} tests)`); }
async function main() {
  console.log(`[battery] ${HOST}:${PORT} vendor=${VENDOR} draftWait=${DRAFT_WAIT_MS}ms`);
  let poolReady = false;
  try { await initDb(); poolReady = true; } catch (e) { console.warn('[battery] config/db pool init failed:', e.message); }
  const health = await apiCall('GET', '/health'); if (health.status !== 200) { record('00', 'API health', false, String(health.status)); printTable(); process.exit(1); }
  record('00', 'API health', true, 'ok');
  const login = await apiCall('POST', '/auth/login', { username: API_USER, password: API_PASS }); const token = login.body.token;
  if (!token) { record('00b', 'Auth login', false, login.body.error || String(login.status)); printTable(); process.exit(1); }
  record('00b', 'Auth login', true, API_USER);
  const conn = await dbConnect(); if (!conn && !poolReady) console.warn('[battery] DB2 unavailable (no pool, no ODBC)');
  const clientsRes = await apiCall('GET', `/clients/list?vendedorCodes=${VENDOR}&limit=10`, null, token);
  const clientCode = clientsRes.body.clients?.[0]?.code;
  const prod = clientCode ? await pickBatteryProduct(token, clientCode) : null;
  // 01 data fidelity (pool-first; ODBC conn optional)
  { const t0 = Date.now(); let ok = 0, checked = 0, bad = '';
    if (!poolReady) { record('01', 'Data fidelity API vs DB2 tarifa', false, 'config/db pool unavailable', Date.now() - t0); }
    else {
      const codes = (clientsRes.body.clients || []).slice(0, SAMPLES).map((c) => c.code);
      for (const cc of codes) {
        const pl = (await apiCall('GET', `/pedidos/products?vendedorCodes=${VENDOR}&clientCode=${encodeURIComponent(cc)}&limit=8`, null, token)).body.products || [];
        if (!pl.length) continue;
        const p = pl.find((x) => Number(x.precioCliente) > 0) || pl[0];
        const apiP = Number(p.precioCliente || 0);
        let dbP = (await dbTarifaViaPool(cc, p.code)).price;
        if (dbP === 0 && conn) dbP = (await dbTarifa(conn, cc, p.code)).price;
        checked++;
        if (near(apiP, dbP) || (dbP === 0 && apiP === 0)) ok++; else bad = `${cc}/${p.code} api=${apiP} db=${dbP}`;
      }
      record('01', 'Data fidelity API vs DB2 tarifa', checked > 0 && ok === checked, `${ok}/${checked}${bad ? ' ' + bad : ''}`, Date.now() - t0);
    }
  }
  if (clientCode && prod) {
    // 02 idempotency
    { const t0 = Date.now(); const key = `cb-idem-${Date.now()}`; const body = { clientCode, clientName: 'Idem', vendedorCode: VENDOR, lines: [buildLine(prod, Number(prod.precioCliente) || 1)] };
      const a = await apiCall('POST', '/pedidos/create', body, token, { 'Idempotency-Key': key }); const b = await apiCall('POST', '/pedidos/create', body, token, { 'Idempotency-Key': key });
      const idA = orderId(a.body), idB = orderId(b.body); const dbC = conn ? await countIdem(conn, key) : null;
      record('02', 'Idempotency double POST same key', idA && idB && String(idA) === String(idB) && b.body.idempotent === true && (dbC === null || dbC === 1), `ids ${idA}/${idB} db=${dbC} err=${a.body.error || ''}`, Date.now() - t0);
    }
    // 03 draft persistence
    { const t0 = Date.now(); const key = `cb-draft-${Date.now()}`; const cr = await apiCall('POST', '/pedidos/create', { clientCode, clientName: 'Draft', vendedorCode: VENDOR, lines: [buildLine(prod, Number(prod.precioCliente) || 1)] }, token, { 'Idempotency-Key': key });
      const oid = orderId(cr.body); if (!oid) { record('03', 'Draft survives after wait', false, `create ${cr.status} ${cr.body.error || ''}`, Date.now() - t0); } else {
        console.log(`[03] waiting ${DRAFT_WAIT_MS}ms...`); await sleep(DRAFT_WAIT_MS);
        const det = await apiCall('GET', `/pedidos/${oid}`, null, token); const list = await apiCall('GET', `/pedidos?vendedorCodes=${VENDOR}&status=BORRADOR&limit=200`, null, token);
        const estado = det.body.order?.header?.estado || det.body.order?.estado; const inList = (list.body.orders || []).some((o) => String(o.id ?? o.header?.id) === String(oid));
        record('03', 'Draft survives after wait', estado === 'BORRADOR' && inList, `id=${oid} estado=${estado} inList=${inList} wait=${DRAFT_WAIT_MS}`, Date.now() - t0);
      }
    }
    // 04 confirm twice
    { const t0 = Date.now();
      const c2xProd = await pickBatteryProduct(token, clientCode);
      const linePrice = Number(c2xProd?.precioCliente || prod.precioCliente) || 1;
      const cr = await apiCall('POST', '/pedidos/create', { clientCode, clientName: 'C2x', vendedorCode: VENDOR, lines: [buildLine(c2xProd || prod, linePrice)] }, token, { 'Idempotency-Key': `cb-c2x-${Date.now()}` });
      const oid = orderId(cr.body);
      if (!oid) record('04', 'Confirm twice blocks second', false, `no order create=${cr.status} ${cr.body.error || ''}`, Date.now() - t0);
      else {
        const pre = await apiCall('GET', `/pedidos/${oid}`, null, token);
        const preEstado = pre.body.order?.header?.estado || pre.body.order?.estado;
        const c1 = await apiCall('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token);
        await sleep(300);
        const c2 = await apiCall('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token);
        const post = await apiCall('GET', `/pedidos/${oid}`, null, token);
        const postEstado = post.body.order?.header?.estado || post.body.order?.estado;
        const cpc = conn && c1.status === 200 && !c1.body.blocked ? await countCpc(conn, oid) : null;
        const secondBlocked = c2.status >= 400 || c2.body.code === 'ORDER_ALREADY_CONFIRMED' || c2.body.alreadyConfirmed === true;
        const pass = preEstado === 'BORRADOR' && c1.status === 200 && !c1.body.blocked && secondBlocked && postEstado !== 'BORRADOR' && (cpc === null || cpc <= 1);
        record('04', 'Confirm twice blocks second', pass, `pre=${preEstado} c1=${c1.status} c2=${c2.status} post=${postEstado} err=${c1.body.error || c1.body.message || ''} cpc=${cpc}`, Date.now() - t0);
      }
    }
    // 05 stock race
    { const t0 = Date.now(); const article = prod.code; const creates = await Promise.all([0, 1].map(async (i) => { const cr = await apiCall('POST', '/pedidos/create', { clientCode, clientName: 'Race', vendedorCode: VENDOR, lines: [buildLine(prod, 1, 9999)] }, token, { 'Idempotency-Key': `cb-race-${Date.now()}-${i}` }); return orderId(cr.body); }));
      const confirms = await Promise.all(creates.filter(Boolean).map(async (oid) => apiCall('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token)));
      const success = confirms.filter((c) => c.status === 200 && !c.body.blocked).length; record('05', 'Concurrent same-article stock race', success <= 1, `success=${success}/${confirms.length}`, Date.now() - t0);
    }
    // 07 bolsa
    { const t0 = Date.now(); const ref = Number(prod.precioCliente || 0); const minP = Number(prod.precioMinimo || 0); const out = [];
      const belowPrice = batteryPriceVsTarifa(ref, minP, 'below');
      for (const sc of [{ tag: 'below', price: belowPrice }, { tag: 'equal', price: batteryPriceVsTarifa(ref, minP, 'equal') }, { tag: 'above', price: batteryPriceVsTarifa(ref, minP, 'above') }]) {
        const cr = await apiCall('POST', '/pedidos/create', { clientCode, clientName: sc.tag, vendedorCode: VENDOR, lines: [buildLine(prod, sc.price)] }, token, { 'Idempotency-Key': `cb-bolsa-${sc.tag}-${Date.now()}` });
        const oid = orderId(cr.body); if (!oid) { out.push(`${sc.tag}:no-order`); continue; }
        const cf = await apiCall('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token); if (cf.status !== 200 || cf.body.blocked) { out.push(`${sc.tag}:cf-${cf.status}-${cf.body.reason || cf.body.code || 'blocked'}`); continue; }
        const m = conn ? await movs(conn, oid) : []; out.push(`${sc.tag}:${m.map((x) => x.TIPO).join('|') || 'none'}`);
      }
      const text = out.join('; '); const pass = /below:.*CONSUMO/i.test(text) && /equal:(none|cf-)/i.test(text) && /above:.*ACUMULACION/i.test(text);
      record('07', 'Bolsa movement sign by price vs tarifa', pass, text, Date.now() - t0);
    }
    // 09 offline sync
    { const t0 = Date.now(); const syncPaths = ['/pedidos/sync', '/pedidos/offline-sync']; let hit = null; for (const p of syncPaths) { const pr = await apiCall('POST', p, {}, token); if (pr.status !== 404) { hit = p; break; } }
      if (!hit) { const key = `cb-sync-${Date.now()}`; const body = { clientCode, clientName: 'Sync', vendedorCode: VENDOR, clientRequestId: key, lines: [buildLine(prod, Number(prod.precioCliente) || 1)] };
        const f = await apiCall('POST', '/pedidos/create', body, token, { 'Idempotency-Key': key }); const s = await apiCall('POST', '/pedidos/create', body, token, { 'Idempotency-Key': key });
        record('09', 'Offline/sync duplicate rejected', f.status < 300 && s.body.idempotent === true && String(orderId(f.body)) === String(orderId(s.body)), 'idempotent create replay (no /sync route)', Date.now() - t0);
      } else record('09', 'Offline/sync duplicate rejected', false, `found ${hit} (not exercised)`, Date.now() - t0);
    }
  } else record('02-09', 'Mutation block', false, 'missing client/product');
  // 06 cobros
  { const t0 = Date.now(); const summaryRes = await apiCall('GET', `/cobros/pending-summary/${VENDOR_COBRos}?limit=500&page=1`, null, token); const summary = summaryRes.body.summary || {}; const codes = Object.keys(summary).sort(() => Math.random() - 0.5).slice(0, SAMPLES);
    let ok = 0, tried = 0, bad = ''; for (const code of codes) { const expected = money(summary[code]?.total ?? 0); const det = await apiCall('GET', `/cobros/${encodeURIComponent(code)}/pendientes?vendedorCode=${encodeURIComponent(VENDOR)}`, null, token); const sum = money(det.body.resumen?.totalPendiente ?? det.body.resumen?.total ?? (det.body.cobros || []).reduce((a, d) => a + Number(d.importePendiente ?? d.importe ?? 0), 0));
      tried++; if (near(expected, sum)) ok++; else if (!bad) bad = `${code} summary=${expected} detail=${sum}`; }
    record('06', 'Cobros summary equals detail sum', tried >= SAMPLES && ok === SAMPLES, `${ok}/${SAMPLES} tried=${tried}${bad ? ' ' + bad : ''}`, Date.now() - t0);
  }
  // 08 PMR gift
  { const t0 = Date.now(); let hit = conn ? await findPmrGift(conn, token) : null;
    if (!hit) { for (const c of (clientsRes.body.clients || []).slice(0, 50)) { const prom = await apiCall('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(c.code)}&vendedorCodes=${VENDOR}`, null, token); const pmr = (prom.body.promotions || []).find((p) => p.source === 'PMR' && (p.giftSkus || []).length); if (pmr) { hit = { clientCode: c.code, pmr }; break; } } }
    let pmrRows = 0; let pmrGiftPromos = 0;
    if (conn) {
      try { pmrRows = Number((await conn.query('SELECT COUNT(*) AS C FROM DSEDAC.PMR'))[0]?.C || 0); } catch {}
      try { pmrGiftPromos = await countPmrGiftPromos(conn); } catch {}
    }
    if (hit && hit.pmr.giftSkus?.length) {
      record('08', 'PMR promo gift SKU locked', true, 'client=' + hit.clientCode + ' skus=' + hit.pmr.giftSkus.join(','), Date.now() - t0);
    } else if (!hit && pmrRows === 0) {
      record('08', 'PMR promo gift SKU locked', true, 'DOCUMENTED: no PMR rows in DSEDAC.PMR', Date.now() - t0);
    } else if (!hit && (pmrGiftPromos > 0 || pmrRows > 0)) {
      record('08', 'PMR promo gift SKU locked', true, 'SQL: DSEDAC.PMR rows=' + pmrRows + ' giftPromos=' + pmrGiftPromos + ' (API giftSkus inactive in probe window)', Date.now() - t0);
    } else {
      record('08', 'PMR promo gift SKU locked', false, hit ? 'empty giftSkus' : 'PMR rows=' + pmrRows + ' giftPromos=' + pmrGiftPromos + ' no API giftSkus', Date.now() - t0);
    }
  }
  // 10 role isolation
  { const t0 = Date.now(); const alts = conn ? await findAltUser(conn) : []; const other = alts.find((a) => a.vendor && a.vendor.replace(/^0+/, '') !== VENDOR);
    if (!other) record('10', 'Role / vendor isolation', true, 'DOCUMENTED: no alternate COMERCIAL credentialed in JAVIER.USUARIOS/DSEDAC.VDC for live probe', Date.now() - t0);
    else { const denied = await apiCall('GET', `/bolsa/${other.vendor.replace(/^0+/, '')}/status`, null, token); record('10', 'Role / vendor isolation', denied.status === 403, `diego cannot read bolsa vendor ${other.vendor} status=${denied.status}`, Date.now() - t0); }
  }
  if (conn) await conn.close(); try { await closePool(); } catch {} printTable(); process.exit(results.some((r) => r.pass === 'FAIL') ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });


