'use strict';

// Run on the API host over SSH. Credentials remain in process memory.
// All mutations have a session marker registered BEFORE the request and cleanup
// runs in finally, including failed assertions and ambiguous HTTP responses.
const db = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const { db2AppTable } = require('../utils/db2-schemas');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const { exportGate } = require('../services/dsedac-exports.service');
require('../middleware/logger').level = 'error';
const SESSION = `demo${Date.now()}`;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const BASE = 'http://127.0.0.1:3335/api';
const results = [];
const tokens = new Set();
const orderIds = new Set();
const fixtures = {};
const baseline = { sequence: null, bolsas: new Map() };
let safe = false;
const q = (sql, params = []) => db.queryWithParams(sql, params, false, false);
const cents = (n) => Math.round(Number(n || 0) * 100);
const marker = (name) => { const value = `${SESSION}${name}`; tokens.add(value); return value; };
function check(name, ok, detail = {}) {
  const row = { name, pass: Boolean(ok), ...detail };
  results.push(row); console.log(JSON.stringify(row));
  return Boolean(ok);
}
function must(name, ok, detail = {}) {
  if (!check(name, ok, detail)) throw new Error(`ASSERT:${name}`);
}
async function api(method, path, auth, body) {
  if (method !== 'GET' && !path.startsWith('/auth/') && !safe) throw new Error('UNSAFE_RUNTIME');
  const started = Date.now();
  const headers = { 'User-Agent': 'GMP-Commercial-Strict-HIT/2.0' };
  if (auth) headers.Authorization = `Bearer ${auth.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${BASE}${path}`, { method, headers,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data; try { data = JSON.parse(bytes.toString()); } catch { data = { magic: bytes.subarray(0, 5).toString(), bytes: bytes.length }; }
    return { status: response.status, ms: Date.now() - started, body: data };
  } catch (error) { return { status: 0, ms: Date.now() - started, body: { code: error.name } }; }
}
async function login(vendor, mode) {
  const rows = await q('SELECT CODIGOPIN FROM DSEDAC.VDPL1 WHERE CODIGOVENDEDOR=CAST(? AS CHAR(2)) FETCH FIRST 1 ROW ONLY', [vendor]);
  const response = await api('POST', '/auth/login', null, { username: vendor, password: String(rows[0]?.CODIGOPIN || '').trim(), ...(mode ? { activeMode: mode } : {}) });
  must(`login_${vendor}_${mode || 'COMERCIAL'}`, response.status === 200 && !!response.body.token,
    { status: response.status, ms: response.ms, role: response.body.user?.role, mode: response.body.user?.activeMode });
  const auth = { vendor, token: response.body.token };
  if (mode) {
    const switched = await api('POST', '/auth/switch-role', auth, { userId: vendor, newRole: mode });
    must(`switch_${vendor}_${mode}`, switched.status === 200 && !!switched.body.token
      && (switched.body.activeMode || switched.body.user?.activeMode) === mode,
    { status: switched.status, ms: switched.ms, mode: switched.body.activeMode || switched.body.user?.activeMode, code: switched.body.code });
    auth.token = switched.body.token;
  }
  return auth;
}
async function catalog(table) {
  if (!/^(DSEDAC|DSED|JAVIER)\.[A-Z0-9_]+$/.test(table)) throw new Error('UNSAFE_IDENTIFIER');
  const [schema, name] = table.split('.');
  const cols = await q('SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [schema, name]);
  must(`catalog_${table}`, cols.length > 0, { columns: cols.map(c => c.COLUMN_NAME) });
  return new Set(cols.map(c => c.COLUMN_NAME));
}
async function guard() {
  const ready = await api('GET', '/ready');
  const runtime = resolveRepartoRuntime(process.env);
  const live = ready.body.reparto?.runtime || {};
  must('isolated_runtime_fail_closed', ready.status === 200 && live.tableSet === 'isolated_test'
    && live.productionErpWritesApproved === false && runtime.valid && runtime.tableSet === 'isolated_test'
    && db2AppTable('COBROS') === 'JAVIER.TEST_COBROS'
    && db2AppTable('REPARTIDOR_COBROS') === 'JAVIER.TEST_REPARTIDOR_COBROS'
    && ['PEDIDOS_SEQ', 'PEDIDO_IDEMPOTENCY', 'PEDIDOS_STOCK_RESERVE', 'BOLSA_COMERCIAL', 'MOVIMIENTOS_BOLSA']
      .every((table) => db2AppTable(table) === `JAVIER.TEST_${table}`)
    && !exportGate().enabled && comercialErpTable('LACLAE') === 'DSED.LACLAE'
    && comercialErpTable('CVC') === 'DSEDAC.CVC',
  { status: ready.status, ms: ready.ms, tableSet: live.tableSet, exportEnabled: exportGate().enabled, sales: comercialErpTable('LACLAE') });
  for (const table of ['DSEDAC.VDPL1', 'DSEDAC.CVC', 'DSEDAC.CPC', 'DSEDAC.OPP', 'DSEDAC.FPG', 'DSEDAC.CLX', 'DSEDAC.CLP',
    'JAVIER.TEST_COBROS', 'JAVIER.TEST_REPARTIDOR_COBROS', 'JAVIER.TEST_PEDIDOS_CAB', 'JAVIER.TEST_PEDIDOS_LIN',
    'JAVIER.TEST_LIQUIDACION_COMERCIAL', 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
    'JAVIER.TEST_PEDIDOS_SEQ', 'JAVIER.TEST_PEDIDO_IDEMPOTENCY', 'JAVIER.TEST_PEDIDOS_STOCK_RESERVE',
    'JAVIER.TEST_BOLSA_COMERCIAL', 'JAVIER.TEST_MOVIMIENTOS_BOLSA']) await catalog(table);
  baseline.year = Number(TODAY.slice(0, 4));
  baseline.month = Number(TODAY.slice(5, 7));
  baseline.sequence = (await q('SELECT ULTIMO_NUMERO FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO=?', [baseline.year]))[0] || null;
  baseline.bolsas = new Map((await q('SELECT ID, CODIGOVENDEDOR, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO, UPDATED_AT FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE EJERCICIO=? AND MES=?',
    [baseline.year, baseline.month])).map(row => [Number(row.ID), row]));
  safe = true;
}
async function cleanup() {
  if (!safe) return;
  // Recover orders even if the HTTP response never arrived.
  const discovered = await q('SELECT ID, NUMEROPEDIDO FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES LIKE ?', [`${SESSION}%`]);
  for (const row of discovered) orderIds.add(row.ID);
  for (const token of tokens) {
    for (const table of ['TEST_COBROS', 'TEST_REPARTIDOR_COBROS', 'TEST_DEVOLUCIONES_COMERCIAL', 'TEST_LIQUIDACION_COMERCIAL']) {
      await q(`DELETE FROM JAVIER.${table} WHERE IDEMPOTENCY_TOKEN=?`, [token]);
      const rows = await q(`SELECT COUNT(*) AS N FROM JAVIER.${table} WHERE IDEMPOTENCY_TOKEN=?`, [token]);
      if (Number(rows[0]?.N) !== 0) throw new Error(`CLEANUP_FAILED:${table}`);
    }
  }
  const conn = await db.getPool().connect();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.query('LOCK TABLE JAVIER.TEST_BOLSA_COMERCIAL IN EXCLUSIVE MODE');
    await conn.query('LOCK TABLE JAVIER.TEST_MOVIMIENTOS_BOLSA IN EXCLUSIVE MODE');
    await conn.query('LOCK TABLE JAVIER.TEST_PEDIDOS_SEQ IN EXCLUSIVE MODE');
    for (const id of orderIds) {
      const owned = await conn.query('SELECT ID FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=? AND OBSERVACIONES LIKE ?', [id, `${SESSION}%`]);
      if (owned.length !== 1) throw new Error('CLEANUP_ORDER_OWNERSHIP_MISMATCH');
      const movements = await conn.query('SELECT ID, BOLSA_ID, TIPO, IMPORTE FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE PEDIDO_ID=?', [id]);
      for (const movement of movements) {
        const amount = Number(movement.IMPORTE);
        const consumed = String(movement.TIPO).trim() === 'CONSUMO' ? amount : 0;
        const accrued = String(movement.TIPO).trim() === 'ACUMULACION' ? amount : 0;
        if (!consumed && !accrued && amount) throw new Error('UNEXPECTED_SESSION_BOLSA_MOVEMENT');
        await conn.query('UPDATE JAVIER.TEST_BOLSA_COMERCIAL SET SALDO_DISPONIBLE=SALDO_DISPONIBLE-?, CONSUMIDO=CONSUMIDO-?, ACUMULADO=ACUMULADO-? WHERE ID=?',
          [accrued - consumed, consumed, accrued, movement.BOLSA_ID]);
        await conn.query('DELETE FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE ID=? AND PEDIDO_ID=?', [movement.ID, id]);
      }
      await conn.query('DELETE FROM JAVIER.TEST_PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID=?', [id]);
      await conn.query('DELETE FROM JAVIER.TEST_PEDIDO_IDEMPOTENCY WHERE PEDIDO_ID=? AND IDEMPOTENCY_KEY LIKE ?', [id, `${SESSION}%`]);
      await conn.query('DELETE FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID=?', [id]);
      await conn.query('DELETE FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=? AND OBSERVACIONES LIKE ?', [id, `${SESSION}%`]);
    }
    // Only the session's vendor/month can have been created by this runner.
    const bolsas = await conn.query('SELECT ID FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE CODIGOVENDEDOR=? AND EJERCICIO=? AND MES=?', ['35', baseline.year, baseline.month]);
    for (const bolsa of bolsas) {
      if (!baseline.bolsas.has(Number(bolsa.ID))) {
        const other = await conn.query('SELECT COUNT(*) AS N FROM JAVIER.TEST_MOVIMIENTOS_BOLSA WHERE BOLSA_ID=?', [bolsa.ID]);
        if (Number(other[0]?.N)) throw new Error('CONCURRENT_BOLSA_USE_REQUIRES_REVIEW');
        await conn.query('DELETE FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE ID=?', [bolsa.ID]);
      } else {
        const before = baseline.bolsas.get(Number(bolsa.ID));
        const current = (await conn.query('SELECT SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO FROM JAVIER.TEST_BOLSA_COMERCIAL WHERE ID=?', [bolsa.ID]))[0];
        for (const column of ['SALDO_DISPONIBLE', 'CONSUMIDO', 'ACUMULADO']) {
          if (cents(current[column]) !== cents(before[column])) throw new Error('CONCURRENT_BOLSA_USE_REQUIRES_REVIEW');
        }
        await conn.query('UPDATE JAVIER.TEST_BOLSA_COMERCIAL SET UPDATED_AT=? WHERE ID=?', [before.UPDATED_AT, bolsa.ID]);
      }
    }
    const allocated = discovered.map(row => Number(row.NUMEROPEDIDO)).sort((a, b) => a - b);
    if (allocated.length) {
      const initial = Number(baseline.sequence?.ULTIMO_NUMERO || 0);
      const expected = initial + allocated.length;
      if (allocated.some((number, index) => number !== initial + index + 1)) throw new Error('CONCURRENT_SEQUENCE_ALLOCATION');
      const current = await conn.query('SELECT ULTIMO_NUMERO FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO=?', [baseline.year]);
      if (Number(current[0]?.ULTIMO_NUMERO) !== expected) throw new Error('CONCURRENT_SEQUENCE_ALLOCATION');
      if (baseline.sequence) await conn.query('UPDATE JAVIER.TEST_PEDIDOS_SEQ SET ULTIMO_NUMERO=? WHERE EJERCICIO=? AND ULTIMO_NUMERO=?', [initial, baseline.year, expected]);
      else await conn.query('DELETE FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO=? AND ULTIMO_NUMERO=?', [baseline.year, expected]);
    }
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally { await conn.close(); }
  for (const id of orderIds) {
    for (const table of ['TEST_PEDIDOS_LIN', 'TEST_PEDIDOS_STOCK_RESERVE', 'TEST_PEDIDO_IDEMPOTENCY', 'TEST_MOVIMIENTOS_BOLSA']) {
      const count = await q(`SELECT COUNT(*) AS N FROM JAVIER.${table} WHERE PEDIDO_ID=?`, [id]);
      must(`cleanup_${table}_${id}`, Number(count[0]?.N) === 0, { remaining: Number(count[0]?.N) });
    }
  }
  const sequenceAfter = (await q('SELECT ULTIMO_NUMERO FROM JAVIER.TEST_PEDIDOS_SEQ WHERE EJERCICIO=?', [baseline.year]))[0] || null;
  must('cleanup_sequence_restored', JSON.stringify(sequenceAfter) === JSON.stringify(baseline.sequence));
  const left = await q('SELECT COUNT(*) AS N FROM JAVIER.TEST_PEDIDOS_CAB WHERE OBSERVACIONES LIKE ?', [`${SESSION}%`]);
  must('cleanup_zero_rows', Number(left[0]?.N) === 0, { session: SESSION, orders: orderIds.size, tokens: tokens.size, remaining: Number(left[0]?.N) });
}
function detail(response) { return { status: response.status, ms: response.ms, body: response.body }; }
async function stage(name, action) {
  try { await action(); } catch (error) { check(`${name}_complete`, false, { error: String(error.message).slice(0, 180) }); }
}
async function orderFlow(auth, repAuth) {
  const client = '4300009324';
  const promotions = await api('GET', `/pedidos/promotions?clientCode=${client}&vendedorCodes=35`, auth);
  const promo = promotions.body.promotions?.find(p => p.productCode && Number(p.stockEnvases) > 0 && Number(p.minQty) > 0 && Number(p.giftQty) > 0 && p.promoType === 'GIFT');
  must('A_live_promo', promotions.status === 200 && !!promo, { status: promotions.status, ms: promotions.ms, promo });
  const products = await api('GET', `/pedidos/products/${promo.productCode}?clientCode=${client}&vendedorCodes=35`, auth);
  const product = products.body.product;
  must('A_product_exists', products.status === 200 && !!product, { status: products.status, ms: products.ms, code: promo.productCode });
  const line = { codigoArticulo: product.code, descripcion: product.name, cantidadEnvases: Number(promo.minQty), cantidadUnidades: 0,
    unidadesCaja: product.unitsPerBox || 1, precio: Number(product.precioCliente || product.precioTarifa1), promotionCode: promo.promoCode };
  fixtures.line = line;
  const delivery = await api('GET', `/pedidos/delivery-options?clientCode=${client}&vendedorCode=35`, auth);
  const options = delivery.body.options || delivery.body;
  check('A_delivery_options', delivery.status === 200, detail(delivery));
  const deliveryDate = options.suggestedDeliveryDate || options.selectedDeliveryDate;
  const driver = options.driverCode || options.codigoRepartidor;
  const createOne = async (suffix, cash) => {
    const response = await api('POST', '/pedidos/create', auth, { clientCode: client, clientName: 'Auditoria demo', vendedorCode: '35',
      observaciones: `${SESSION}-${suffix}`, clientRequestId: marker(suffix), lines: [line] });
    const id = response.body.id || response.body.order?.header?.id || response.body.order?.id;
    if (id) orderIds.add(id);
    must(`A_create_${suffix}`, [200, 201].includes(response.status) && !!id, detail(response));
    const stored = await q('SELECT * FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID=?', [id]);
    const headers = await q('SELECT IMPORTETOTAL,IMPORTEBASE,IMPORTEIVA FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?', [id]);
    const gifts = stored.filter(r => String(r.TIPOLINEA).trim() === 'G');
    const giftQuantity = gifts.reduce((sum, r) => sum + Number(r.CANTIDADENVASES || 0), 0);
    const base = stored.reduce((sum, r) => sum + Number(r.IMPORTEVENTA || 0), 0);
    check(`A_promo_engine_${suffix}`, giftQuantity === Number(promo.giftQty)
      && gifts.every(r => Number(r.PRECIOVENTA) === 0 && Number(r.IMPORTEVENTA) === 0)
      && cents(headers[0].IMPORTEBASE) === cents(base)
      && cents(headers[0].IMPORTETOTAL) === cents(base + Number(headers[0].IMPORTEIVA))
      && gifts.some(r => Number(r.PRECIOTARIFA) > 0),
      { requestPaidLines: 1, storedLines: stored.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k === k.toUpperCase()))), totals: headers });
    const confirmed = await api('PUT', `/pedidos/${id}/confirm`, auth, { saleType: 'CC', deliveryDate,
      vehicleCode: options.vehicleCode, driverCode: driver, routeCode: options.routeCode, cobroEnMano: cash });
    must(`A_confirm_${suffix}`, confirmed.status === 200, detail(confirmed));
    const cab = (await q('SELECT ESTADO,SYNC_STATUS,CODIGOREPARTIDOR,FECHAREPARTO,IMPORTETOTAL,SERIEPEDIDO,NUMEROPEDIDO FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID=?', [id]))[0];
    must(`A_pending_erp_${suffix}`, String(cab.ESTADO).trim() === 'CONFIRMADO' && ['LOCAL', ''].includes(String(cab.SYNC_STATUS || '').trim()), { id, cab });
    return { id, cab };
  };
  const assigned = await createOne('assigned', false);
  const cash = await createOne('cash', true);
  fixtures.draftCandidate = cash.id;
  const assignedDriver = String(assigned.cab.CODIGOREPARTIDOR || '').trim();
  must('A_driver_assignment', !!assignedDriver && !String(cash.cab.CODIGOREPARTIDOR || '').trim(), { assignedDriver });
  const overlay = await api('GET', `/entregas/pendientes/${assignedDriver}?date=${deliveryDate}&limit=500`, repAuth);
  const rows = overlay.body.albaranes || overlay.body.entregas || overlay.body.data || [];
  const contains = (id) => rows.some(r => r.documentoTipo === 'PEDIDO' && (String(r.pedidoId || r.id).includes(String(id))));
  check('A_assigned_overlay_only', overlay.status === 200 && contains(assigned.id) && !contains(cash.id),
    { status: overlay.status, ms: overlay.ms, date: deliveryDate, assigned: assigned.id, cash: cash.id, pedidos: rows.filter(r => r.documentoTipo === 'PEDIDO') });
  const listed = await api('GET', '/pedidos?vendedorCodes=35&limit=100', auth);
  check('A_mis_pedidos', listed.status === 200 && JSON.stringify(listed.body).includes(String(assigned.id)), { status: listed.status, ms: listed.ms, id: assigned.id });
  const reference = `PEDIDO:${assigned.id}:${String(assigned.cab.SERIEPEDIDO).trim()}-${assigned.cab.NUMEROPEDIDO}`;
  const payment = await api('POST', `/cobros/${client}/registrar`, auth, { referencia: reference, importe: Number(assigned.cab.IMPORTETOTAL),
    formaPago: 'CONTADO', observaciones: `${SESSION} entrega futura`, idempotencyToken: marker('futurepay') });
  check('F_pay_today_deliver_future', deliveryDate > TODAY && payment.status === 200 && payment.body.payment?.pendingAfter === 0,
    { date: deliveryDate, today: TODAY, ...detail(payment) });
  const overlayPaid = await api('GET', `/entregas/pendientes/${assignedDriver}?date=${deliveryDate}&limit=500`, repAuth);
  const paidRows = overlayPaid.body.albaranes || [];
  check('F_paid_order_still_pending_delivery', overlayPaid.status === 200 && paidRows.some(row => row.documentoTipo === 'PEDIDO' && Number(row.pedidoId) === Number(assigned.id)), { status: overlayPaid.status, ms: overlayPaid.ms, id: assigned.id });
}
async function paymentFlow(auth, repAuth) {
  const client = '4300032729';
  const pending = await api('GET', `/cobros/${client}/pendientes`, auth);
  must('B_pending', pending.status === 200, detail(pending));
  const documents = [];
  for (const document of pending.body.cobros || []) {
    if (document.docKey?.tipoDocumento !== 'CAC' || Number(document.importePendiente) <= 10) continue;
    const key = document.docKey;
    const assigned = await q(`SELECT MAX(O.CODIGOREPARTIDOR) AS DRIVER FROM DSEDAC.CPC P JOIN DSEDAC.OPP O
      ON O.NUMEROORDENPREPARACION=P.NUMEROORDENPREPARACION AND O.EJERCICIOORDENPREPARACION=P.EJERCICIOORDENPREPARACION
      AND O.SUBEMPRESA=P.SUBEMPRESAPEDIDO WHERE P.SUBEMPRESAALBARAN=? AND P.EJERCICIOALBARAN=? AND P.SERIEALBARAN=?
      AND P.TERMINALALBARAN=? AND P.NUMEROALBARAN=? AND P.CODIGOCLIENTEALBARAN=?`,
    [key.subempresa, Number(key.ejercicioDocumento), key.serie, Number(key.terminalDocumento), Number(key.numero), client]);
    const driver = String(assigned[0]?.DRIVER || '').trim();
    if (driver) documents.push({ ...document, driver });
  }
  must('C_assigned_documents', documents.length >= 3, { available: documents.length });
  const repPayload = (doc, token) => ({ codigoCliente: client, codigoRepartidor: doc.driver, tipoDocumento: doc.docKey.tipoDocumento,
    origenDocumento: doc.docKey.origenDocumento, subempresaDocumento: doc.docKey.subempresa, ejercicioDocumento: Number(doc.docKey.ejercicioDocumento),
    serieDocumento: doc.docKey.serie, terminalDocumento: Number(doc.docKey.terminalDocumento), numeroDocumento: Number(doc.docKey.numero),
    xdeDocumento: Number(doc.docKey.xde), dexDocumento: Number(doc.docKey.dex), importeCobrado: 1, importePendiente: Number(doc.importePendiente) - 1,
    formaPago: 'EFECTIVO', pantallaOrigen: 'VENCIMIENTOS', idempotencyToken: token, notas: SESSION });
  const commercial = (doc, token, amount) => ({ referencia: doc.docKey.reference, importe: amount,
    formaPago: 'CONTADO', observaciones: SESSION, idempotencyToken: token });
  const [first, second, third] = documents;
  const amount = Math.round(Number(first.importePendiente) * 50) / 100;
  const payload = commercial(first, marker('partial'), amount);
  const paid = await api('POST', `/cobros/${client}/registrar`, auth, payload);
  must('B_partial', paid.status === 200 && paid.body.payment?.pendingAfter > 0, detail(paid));
  const history = await api('GET', `/cobros/${client}/historico?limit=100&offset=0`, auth);
  const historyPayment = history.body.historico?.find(row => row.id === paid.body.payment.id);
  check('B_history_after_payment', history.status === 200 && !!historyPayment
    && historyPayment.codigoCliente === client && cents(historyPayment.importe) === cents(amount)
    && historyPayment.referencia === first.docKey.reference && historyPayment.observaciones === SESSION,
  { status: history.status, ms: history.ms, payment: historyPayment });
  const replay = await api('POST', `/cobros/${client}/registrar`, auth, payload);
  check('B_idempotency_replay', replay.status === 200 && replay.body.payment?.idempotent === true, detail(replay));
  const conflict = await api('POST', `/cobros/${client}/registrar`, auth, { ...payload, importe: amount + 0.01 });
  check('B_idempotency_conflict', conflict.status === 409 && conflict.body.code === 'IDEMPOTENCY_CONFLICT', detail(conflict));
  const exceeds = await api('POST', `/cobros/${client}/registrar`, auth, commercial(first, marker('exceeds'), Number(first.importePendiente) + 10));
  check('B_exceeds', exceeds.status === 409 && exceeds.body.code === 'PAYMENT_EXCEEDS', detail(exceeds));
  const after = await api('GET', `/cobros/${client}/pendientes`, auth);
  const rest = after.body.cobros?.find(d => d.docKey?.reference === first.docKey.reference);
  check('B_visible_rest', after.status === 200 && !!rest && cents(rest.importePendiente) === cents(first.importePendiente) - cents(amount),
    { status: after.status, ms: after.ms, before: first.importePendiente, amount, after: rest?.importePendiente });
  const cross = await api('POST', '/repartidor-finanzas/cobros', repAuth, repPayload(first, marker('cross1')));
  check('C_commercial_then_driver_409', cross.status === 409 && /COMMERCIAL_CONFLICT|COLLECTED_BY_COMERCIAL/.test(cross.body.code || ''), detail(cross));
  // Driver success automatically sends SMTP in this runtime. Require an explicit opt-in.
  if (process.env.GMP_HIT_ALLOW_NOTIFICATIONS === 'true') {
  const driverPayment = await api('POST', '/repartidor-finanzas/cobros', repAuth, repPayload(second, marker('driverfirst')));
  must('C_driver_payment', [200, 201].includes(driverPayment.status) && driverPayment.body.success !== false, detail(driverPayment));
  const reverse = await api('POST', `/cobros/${client}/registrar`, auth, commercial(second, marker('cross2'), 1));
  check('C_driver_then_commercial_409', reverse.status === 409 && reverse.body.code === 'COBRO_ALREADY_COLLECTED_BY_REPARTIDOR', detail(reverse));
  const concurrent = await Promise.all([
    api('POST', `/cobros/${client}/registrar`, auth, commercial(third, marker('racec'), Math.round(Number(third.importePendiente) * 50) / 100)),
    api('POST', '/repartidor-finanzas/cobros', repAuth, repPayload(third, marker('racer'))),
  ]);
  check('C_concurrent_one_winner', concurrent.filter(r => [200, 201].includes(r.status)).length === 1 && concurrent.filter(r => r.status === 409).length === 1, { responses: concurrent });
  } else {
    console.log(JSON.stringify({ skipped: ['C_driver_then_commercial_409', 'C_concurrent_one_winner'], reason: 'Driver success triggers SMTP; prior session evidence is strict-payments-fourth.jsonl' }));
  }
  await liquidationFlow(auth, amount);
}
async function liquidationFlow(auth, amount) {
  const existing = await q('SELECT ID FROM JAVIER.TEST_LIQUIDACION_COMERCIAL WHERE CODIGO_VENDEDOR=CAST(? AS CHAR(2)) AND FECHA=?', ['35', TODAY]);
  must('D_day_not_preexisting', existing.length === 0, { date: TODAY });
  const before = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=35&fecha=${TODAY}`, auth);
  const expectedAmount = Number(before.body.summary?.totalAIngresar);
  must('D_total_after_all_payments', before.status === 200 && Number.isFinite(expectedAmount) && expectedAmount >= amount, { expectedAmount, partial: amount });
  const saved = await api('POST', '/comercial-liquidacion/guardar', auth, { vendedor: '35', fecha: TODAY, ingresoBanco: expectedAmount, entregado: 0,
    expectedTotal: expectedAmount, idempotencyToken: marker('liquidation') });
  must('D_save_after_payment', saved.status === 201 && saved.body.saved?.source === 'JAVIER.TEST_LIQUIDACION_COMERCIAL', detail(saved));
  const pg = await api('GET', '/comercial-liquidacion/ya-cobrados-pg?vendedor=35', auth);
  const document = pg.body.documents?.find(d => d.yaCobrada === true && Number(d.formaPagoDias) > 0);
  must('D_real_pg_document', pg.status === 200 && !!document, { status: pg.status, ms: pg.ms, document });
  const returned = await api('POST', '/comercial-liquidacion/devoluciones', auth, { vendedor: '35', fecha: TODAY, cliente: document.cliente,
    importe: 1, yaCobrada: true, formaPago: document.formaPago, impactoLqd: 'YA_COBRADOS', documentoOrigen: document.documento,
    albaranOrigen: document.albaran, vencimiento: document.vencimiento, idempotencyToken: marker('return') });
  must('D_return_pg', returned.status === 201 && returned.body.return?.impactoLqd === 'YA_COBRADOS', detail(returned));
  const ret = returned.body.return;
  const pdf = await api('GET', `/comercial-liquidacion/devoluciones/pdf?vendedor=35&fecha=${TODAY}&serie=${encodeURIComponent(ret.serie)}&numero=${ret.numero}`, auth);
  check('D_pdf_magic', pdf.status === 200 && pdf.body.magic === '%PDF-' && pdf.body.bytes > 500, detail(pdf));
  const after = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=35&fecha=${TODAY}`, auth);
  check('D_no_double_LQD_subtract', after.status === 200 && JSON.stringify(before.body.lqd) === JSON.stringify(after.body.lqd)
    && cents(after.body.summary?.devolucionesYaCobradas) === cents(before.body.summary?.devolucionesYaCobradas) + 100,
  { status: after.status, ms: after.ms, before: before.body, after: after.body });
}
async function minimumFlow(auth) {
  const client = '4300001041';
  const { lookupClientAssignedVendorCodes } = require('../utils/common');
  const { evaluateMinCobroOrderGate } = require('../services/pedidos-comercial-gates');
  const owners = await lookupClientAssignedVendorCodes(client);
  const vendor = owners[0];
  const gate = await evaluateMinCobroOrderGate({ clientCode: client, vendorCode: vendor });
  must('E_live_below_minimum', !!vendor && gate.blocked === true && gate.snapshot === false, { client, vendor, gate });
  must('E_product_fixture', !!fixtures.line, {});
  const created = await api('POST', '/pedidos/create', auth, { clientCode: client, vendedorCode: vendor,
    observaciones: `${SESSION}-minimum`, clientRequestId: marker('minimum'), lines: [fixtures.line] });
  const unexpectedId = created.body.id || created.body.order?.header?.id || created.body.order?.id;
  if (unexpectedId) orderIds.add(unexpectedId);
  check('E_create_403', created.status === 403 && created.body.code === 'MIN_COBRO_ORDER_BLOCKED', detail(created));
  must('E_draft_fixture_available', !!fixtures.draftCandidate, {});
  // Model a saved draft whose client's collection ratio has fallen below the
  // threshold. Only this session's TEST order changes; live CLX/CVC stay intact.
  await q('UPDATE JAVIER.TEST_PEDIDOS_CAB SET CODIGOCLIENTE=?,CODIGOVENDEDOR=?,ESTADO=? WHERE ID=? AND OBSERVACIONES LIKE ?',
    [client, vendor, 'BORRADOR', fixtures.draftCandidate, `${SESSION}%`]);
  const confirmed = await api('PUT', `/pedidos/${fixtures.draftCandidate}/confirm`, auth, { saleType: 'CC', cobroEnMano: true });
  check('E_confirm_403', confirmed.status === 403 && confirmed.body.code === 'MIN_COBRO_ORDER_BLOCKED',
    { fixture: 'session TEST draft; live CLX/CVC rule', ...detail(confirmed) });
}
async function main() {
  await db.initDb();
  try {
    await guard();
    const auth = await login('35'); await login('80'); const jefe = await login('98');
    const rep = await login('98', 'REPARTIDOR');
    await stage('A_F', () => orderFlow(auth, rep));
    await stage('B_C_D', () => paymentFlow(auth, rep));
    await stage('E', () => minimumFlow(jefe));
  } finally {
    try { await cleanup(); } catch (error) { check('cleanup', false, { error: error.message }); }
    await db.closePool();
    const failed = results.filter(r => !r.pass).length;
    console.log(JSON.stringify({ summary: true, session: SESSION, passed: results.length - failed, failed }));
    if (failed) process.exitCode = 1;
  }
}
main().catch(error => { console.error(JSON.stringify({ fatal: error.message })); process.exitCode = 1; });
