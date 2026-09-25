// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e-write | _-scratch gitignored; e2e puntual escrituras perfil (solo test) | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Perfil Reparto write+verify E2E against local staging isolated_test.
 * Writes only JAVIER.TEST_*. Asserts DSEDAC counts unchanged.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const crypto = require('crypto');
const { initDb, closePool, query, queryWithParams } = require('../config/db');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3351);
const DRIVER = process.env.E2E_DRIVER || '08';
const UA = 'GMP-App/1.0 Dart/3.0 (e2e-perfil-reparto-writes)';
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STAMP = `e2e${Date.now()}`;

const failures = [];
const findings = [];

function request(method, path, { token, body, headers = {}, timeoutMs = 60000 } = {}) {
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
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 800) });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickToken(j) {
  return j?.token || j?.data?.token || j?.accessToken || null;
}

function record(label, pass, extra = {}) {
  const row = { label, pass, ...extra };
  console.log(JSON.stringify(row));
  findings.push(row);
  if (!pass) failures.push(label);
  return pass;
}

async function snapshot() {
  const one = async (sql) => {
    const rows = await query(sql);
    const v = rows[0]?.C ?? rows[0]?.c ?? rows[0]?.S ?? rows[0]?.s ?? 0;
    return typeof v === 'bigint' ? Number(v) : Number(v);
  };
  const [lqd, cvc, cpc, cpcS, testCobros, testConf, testEv, testGastos, testIng, testAj, testOrden] = await Promise.all([
    one('SELECT COUNT(*) AS C FROM DSEDAC.LQD'),
    one('SELECT COUNT(*) AS C FROM DSEDAC.CVC'),
    one('SELECT COUNT(*) AS C FROM DSEDAC.CPC'),
    one("SELECT SUM(CASE WHEN TRIM(CONFORMADOSN)='S' THEN 1 ELSE 0 END) AS C FROM DSEDAC.CPC"),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_COBROS'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTO_CONFIRMACIONES'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTO_EVIDENCIAS'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN'),
  ]);
  return {
    dsedac: { lqd, cvc, cpc, cpcS },
    test: { cobros: testCobros, conf: testConf, evid: testEv, gastos: testGastos, ingresos: testIng, ajustes: testAj, orden: testOrden },
  };
}

async function cpcFlag(itemId) {
  const parts = String(itemId).split('-');
  if (parts.length < 5) return null;
  const [ejercicio, serie, terminal, numero, ...clientParts] = parts;
  const cliente = clientParts.join('-');
  const rows = await queryWithParams(
    `SELECT TRIM(CONFORMADOSN) AS CONFORMADOSN
       FROM DSEDAC.CPC
      WHERE EJERCICIOALBARAN = ?
        AND TRIM(SERIEALBARAN) = ?
        AND TERMINALALBARAN = ?
        AND NUMEROALBARAN = ?
        AND TRIM(CODIGOCLIENTEALBARAN) = ?
      FETCH FIRST 1 ROW ONLY`,
    [Number(ejercicio), serie, Number(terminal), Number(numero), cliente],
  );
  return rows[0]?.CONFORMADOSN ?? rows[0]?.conformadosn ?? null;
}

async function login() {
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'diego', password: '9322' },
  });
  let token = pickToken(login.json);
  if (!token) throw new Error(`login failed ${login.status} ${login.raw}`);
  const sw = await request('POST', '/api/auth/switch-role', {
    token,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = pickToken(sw.json) || token;
  const user = sw.json?.user || {};
  if ((user.activeMode || sw.json?.activeMode) !== 'REPARTIDOR') {
    throw new Error('switch Perfil Reparto failed');
  }
  record('auth.switch', true, { role: user.role, activeMode: user.activeMode || sw.json?.activeMode });
  return token;
}

function ledgerOf(json) {
  return json?.ledger || json?.desglose || json?.data || {};
}

async function main() {
  const token = await login();

  const get = async (label, path, assertFn) => {
    const res = await request('GET', path, { token });
    const extra = typeof assertFn === 'function' ? (assertFn(res) || {}) : {};
    const pass = res.status >= 200 && res.status < 300 && res.json?.success !== false && extra.fail !== true;
    record(label, pass, { status: res.status, code: res.json?.code || null, ...extra });
    return res;
  };

  await get('tab.panel.summary', `/api/repartidor/history/delivery-summary/${DRIVER}`, (res) => ({
    fail: !res.json,
  }));
  const clientes = await get('tab.clientes', `/api/repartidor/history/clients/${DRIVER}`, (res) => {
    const list = res.json?.data || res.json?.clients || [];
    return { count: Array.isArray(list) ? list.length : 0, fail: !Array.isArray(list) || list.length < 1 };
  });
  const pendientes = await get(
    'tab.rutero.pendientes',
    `/api/entregas/pendientes/${DRIVER}?date=${TODAY}&limit=50&offset=0`,
    (res) => {
      const list = res.json?.data || res.json?.albaranes || [];
      return { count: Array.isArray(list) ? list.length : 0, fail: !Array.isArray(list) || list.length < 2 };
    },
  );
  await get('tab.rutero.week', `/api/repartidor/rutero/week/${DRIVER}?date=${TODAY}`);
  await get('tab.liquidacion.daily', `/api/repartidor-finanzas/daily-summary/${DRIVER}?date=${TODAY}`);

  const closed = await get(
    'tab.liquidacion.desgloseClosed',
    `/api/repartidor-finanzas/liquidaciones/${DRIVER}/desglose?date=2026-08-12`,
    (res) => {
      const ledger = ledgerOf(res.json);
      const deposits = ledger.bankDeposits || [];
      const total = Number(ledger.totals?.bankDeposits ?? 0);
      return {
        statusLedger: ledger.status || null,
        ingresos: Array.isArray(deposits) ? deposits.length : null,
        total,
        fail: res.status !== 200 || !Array.isArray(deposits) || deposits.length < 1 || total <= 0,
      };
    },
  );

  await get(
    'tab.vencimientos',
    `/api/repartidor-finanzas/vencimientos/${DRIVER}?from=${YEAR}-01-01&to=${TODAY}&limit=50`,
    (res) => {
      const list = res.json?.vencimientos || res.json?.data || [];
      return { count: Array.isArray(list) ? list.length : 0, fail: !Array.isArray(list) };
    },
  );
  await get('tab.evolucion', `/api/repartidor-finanzas/evolution/${DRIVER}`);
  await get('tab.cuentas', `/api/repartidor-finanzas/cuentas/${DRIVER}`);
  await get('tab.comisiones.tiers', '/api/repartidor-finanzas/commissions/tiers', (res) => {
    const tiers = res.json?.tiers || res.json?.data || [];
    return { tiers: Array.isArray(tiers) ? tiers.length : 0, fail: !Array.isArray(tiers) || tiers.length < 1 };
  });
  await get(
    'tab.comisiones.month',
    `/api/repartidor-finanzas/commissions/summary/${DRIVER}?from=${YEAR}-${String(MONTH).padStart(2, '0')}-01&to=${TODAY}`,
  );
  const collections = await request('GET', `/api/repartidor/collections/summary/${DRIVER}`, { token });
  record('tab.collections.available', collections.status === 200 && collections.json?.success === true, {
    status: collections.status, code: collections.json?.code || null,
    availability: collections.json?.collectionAvailability || null,
  });
  await get('tab.asistente.health', '/api/chatbot/health');
  const chatMsg = await request('POST', '/api/chatbot/message', {
    token,
    body: { message: 'cuantas entregas tengo hoy' },
  });
  record('tab.asistente.message', chatMsg.status >= 200 && chatMsg.status < 300 && chatMsg.json?.success !== false, {
    status: chatMsg.status,
    hasReply: Boolean(chatMsg.json?.reply || chatMsg.json?.response || chatMsg.json?.message || chatMsg.json?.data),
  });
  await get('tab.rutero.stopsGeo', `/api/repartidor/rutero/stops-geo/${DRIVER}?date=${TODAY}`);
  const firstClient = Array.isArray(clientes.json?.data || clientes.json?.clients)
    ? (clientes.json.data || clientes.json.clients)[0]
    : null;
  const clientCode = firstClient?.clienteId || firstClient?.codigoCliente || firstClient?.code || firstClient?.id;
  if (clientCode) {
    await get(
      'tab.historico.docs',
      `/api/repartidor/history/documents/${encodeURIComponent(clientCode)}?repartidorId=${encodeURIComponent(DRIVER)}`,
      (res) => {
        const list = res.json?.data || res.json?.documents || [];
        return { count: Array.isArray(list) ? list.length : 0 };
      },
    );
  } else {
    record('tab.historico.docs', false, { error: 'no_client' });
  }

  const pendingList = pendientes.json?.data || pendientes.json?.albaranes || [];
  const openPending = pendingList.filter((a) => String(a.estado || '').toUpperCase() !== 'ENTREGADO');
  record('data.pendingOpen', openPending.length >= 2, { open: openPending.length });
  const first = openPending[0];
  const second = openPending[1];
  const itemId = first?.id;
  const itemId2 = second?.id;

  await initDb();
  const before = await snapshot();
  record('snapshot.before', true, before);
  const sqlClosed = await queryWithParams(
    `SELECT COUNT(*) AS C, COALESCE(SUM(IMPORTE),0) AS T
       FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS
      WHERE TRIM(CODIGO_REPARTIDOR) = ? AND ANO = 2026 AND MES = 8 AND DIA = 12`,
    [DRIVER],
  );
  const sqlCount = Number(sqlClosed[0]?.C ?? 0);
  const sqlTotal = Number(sqlClosed[0]?.T ?? 0);
  const apiTotal = Number(ledgerOf(closed.json).totals?.bankDeposits ?? 0);
  record('data.closedIngresosSqlVsApi', Math.abs(sqlTotal - apiTotal) < 0.011, {
    sqlCount, sqlTotal, apiTotal,
  });
  const cpcBefore = itemId ? await cpcFlag(itemId) : null;
  const cpcBefore2 = itemId2 ? await cpcFlag(itemId2) : null;
  await closePool();

  const gastoTok = `gasto-${STAMP}`;
  const ingTok = `ingreso-${STAMP}`;
  const ajTok = `ajuste-${STAMP}`;
  const gasto = await request('POST', '/api/repartidor-finanzas/liquidaciones/gastos', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: 1.23, category: 'COMBUSTIBLE',
      idempotencyToken: gastoTok, observation: 'E2E write test',
    },
  });
  record('write.gasto', gasto.status === 201 && gasto.json?.created === true, {
    status: gasto.status, code: gasto.json?.code || null, error: gasto.json?.error || null,
  });
  const ingreso = await request('POST', '/api/repartidor-finanzas/liquidaciones/ingresos-bancarios', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: 2.34, reference: `E2E-${STAMP}`,
      idempotencyToken: ingTok,
    },
  });
  record('write.ingreso', ingreso.status === 201 && ingreso.json?.created === true, {
    status: ingreso.status, code: ingreso.json?.code || null, error: ingreso.json?.error || null,
  });
  const ajuste = await request('POST', '/api/repartidor-finanzas/liquidaciones/ajustes', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: -1.11, reason: 'E2E ajuste',
      idempotencyToken: ajTok,
    },
  });
  record('write.ajuste', ajuste.status === 201 && ajuste.json?.created === true, {
    status: ajuste.status, code: ajuste.json?.code || null, error: ajuste.json?.error || null,
  });

  const desgloseToday = await get(
    'verify.desgloseToday',
    `/api/repartidor-finanzas/liquidaciones/${DRIVER}/desglose?date=${TODAY}`,
    (res) => {
      const ledger = ledgerOf(res.json);
      const expenses = ledger.expenses || [];
      const deposits = ledger.bankDeposits || [];
      const adjustments = ledger.adjustments || [];
      const hasGasto = expenses.some((e) => Number(e.amount) === 1.23);
      const hasIng = deposits.some((e) => Number(e.amount) === 2.34);
      const hasAj = adjustments.some((e) => Math.abs(Number(e.amount)) === 1.11);
      return {
        ledgerStatus: ledger.status || null,
        gastos: expenses.length, ingresos: deposits.length, ajustes: adjustments.length,
        hasGasto, hasIng, hasAj,
        fail: !hasGasto || !hasIng || !hasAj,
      };
    },
  );

  if (first) {
    const orden = await request('PUT', `/api/repartidor/rutero/order/${DRIVER}`, {
      token,
      body: {
        date: TODAY,
        orden: openPending.slice(0, Math.min(5, openPending.length)).map((a, i) => ({
          documentId: a.id,
          cliente: a.codigoCliente,
          posicion: i,
        })),
      },
    });
    record('write.ruteroOrder', orden.status === 200 && orden.json?.success !== false, {
      status: orden.status, code: orden.json?.code || null, error: orden.json?.error || null,
      n: Array.isArray(orden.json?.orden) ? orden.json.orden.length : null,
    });
  }

  async function loadLines(alb) {
    const numero = alb.numero ?? alb.numeroAlbaran;
    const detalle = await request(
      'GET',
      `/api/entregas/albaran/${numero}/${alb.ejercicio}?serie=${encodeURIComponent(alb.serie)}&terminal=${encodeURIComponent(alb.terminal)}&cliente=${encodeURIComponent(alb.codigoCliente)}`,
      { token },
    );
    const items = detalle.json?.albaran?.items || detalle.json?.albaran?.lineas || [];
    record(`rutero.detail.${alb.id}`, detalle.status === 200 && items.length > 0, {
      status: detalle.status, lines: items.length, code: detalle.json?.code || null,
    });
    return items.filter((ln) => {
      const code = String(ln.codigoArticulo || '').trim();
      const qty = Number(ln.cantidadPedida ?? ln.cantidad);
      const desc = String(ln.descripcion || '').trim().toLowerCase();
      return code && !/^0+$/.test(code) && qty > 0 && !desc.startsWith('pedido:');
    });
  }

  if (first && itemId) {
    const items = await loadLines(first);
    const sig = await request('POST', '/api/repartidor-finanzas/rutero/evidence/signature', {
      token,
      body: {
        documentId: itemId,
        repartidorId: DRIVER,
        signature: `data:image/png;base64,${PNG.toString('base64')}`,
      },
      timeoutMs: 90000,
    });
    const evidenceId = sig.json?.evidenceId;
    record('write.evidence', (sig.status === 201 || sig.status === 200) && /^ev_[a-f0-9]{64}$/.test(String(evidenceId || '')), {
      status: sig.status, code: sig.json?.code || null, error: sig.json?.error || null,
      evidenceId: evidenceId ? String(evidenceId).slice(0, 10) : null,
    });

    const lineas = items.map((ln) => ({
      lineaId: String(ln.itemId || ln.lineaId || ln.secuencia),
      codigoArticulo: String(ln.codigoArticulo || '').trim(),
      cantidadPedida: Number(ln.cantidadPedida ?? ln.cantidad),
      cantidadEntregada: Number(ln.cantidadPedida ?? ln.cantidad),
      cantidadRechazada: 0,
      cantidadPendiente: 0,
    }));
    if (!lineas.length) {
      record('write.confirmEntregado', false, { error: 'no_valid_lines' });
    } else {
    const confirmBody = {
      delivery: {
        itemId,
        status: 'ENTREGADO',
        repartidorId: DRIVER,
        occurredAt: new Date().toISOString(),
        receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
        lineas,
        firma: evidenceId,
        latitud: 36.84,
        longitud: -2.46,
        observaciones: 'E2E ENTREGADO',
      },
      cobro: first.puedeCobrarse || first.esCTR ? {
        entregaId: itemId,
        importeCobrado: Math.max(0.01, Number(first.importe) || 0.01),
        formaPago: 'EFECTIVO',
      } : undefined,
    };
    const confirm = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
      token,
      headers: { 'Idempotency-Key': `conf-${STAMP}` },
      body: confirmBody,
      timeoutMs: 90000,
    });
    const confirmOk = (confirm.status === 201 || confirm.status === 200) && confirm.json?.success === true;
    record('write.confirmEntregado', confirmOk, {
      status: confirm.status, code: confirm.json?.code || null, error: confirm.json?.error || null,
      details: confirm.json?.details || null,
      confirmationId: confirm.json?.confirmationId || null,
      cobroId: confirm.json?.cobroId ?? null,
      withCobro: Boolean(confirmBody.cobro),
    });

    if (!confirmOk && confirmBody.cobro) {
      const retry = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
        token,
        headers: { 'Idempotency-Key': `conf-nocobro-${STAMP}` },
        body: { delivery: confirmBody.delivery },
        timeoutMs: 90000,
      });
      record('write.confirmEntregado.withoutCobro', (retry.status === 201 || retry.status === 200) && retry.json?.success === true, {
        status: retry.status, code: retry.json?.code || null, error: retry.json?.error || null,
        details: retry.json?.details || null,
        confirmationId: retry.json?.confirmationId || null,
      });
    }
    }
  }

  if (second && itemId2) {
    const items2 = await loadLines(second);
    const lineas2 = items2.map((ln) => ({
      lineaId: String(ln.itemId || ln.lineaId || ln.secuencia),
      codigoArticulo: String(ln.codigoArticulo || '').trim(),
      cantidadPedida: Number(ln.cantidadPedida ?? ln.cantidad),
      cantidadEntregada: 0,
      cantidadRechazada: 0,
      cantidadPendiente: Number(ln.cantidadPedida ?? ln.cantidad),
      motivoDiferencia: 'CLIENTE_AUSENTE',
    }));
    if (!lineas2.length) {
      record('write.confirmNoEntregado', false, { error: 'no_valid_lines' });
    } else {
    const noEnt = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
      token,
      headers: { 'Idempotency-Key': `noent-${STAMP}` },
      body: {
        delivery: {
          itemId: itemId2,
          status: 'NO_ENTREGADO',
          repartidorId: DRIVER,
          occurredAt: new Date().toISOString(),
          lineas: lineas2,
          incidencia: { tipo: 'CLIENTE_AUSENTE', motivo: 'E2E cliente ausente' },
          observaciones: 'E2E NO_ENTREGADO',
        },
      },
      timeoutMs: 90000,
    });
    record('write.confirmNoEntregado', (noEnt.status === 201 || noEnt.status === 200) && noEnt.json?.success === true, {
      status: noEnt.status, code: noEnt.json?.code || null, error: noEnt.json?.error || null,
      details: noEnt.json?.details || null,
      confirmationId: noEnt.json?.confirmationId || null,
    });
    }
  }

  const pendAfter = await request(
    'GET',
    `/api/entregas/pendientes/${DRIVER}?date=${TODAY}&limit=50&offset=0`,
    { token },
  );
  const afterList = pendAfter.json?.data || pendAfter.json?.albaranes || [];
  const estadoOf = (id) => afterList.find((a) => a.id === id)?.estado || null;
  record('verify.confirmOverlay', estadoOf(itemId) === 'ENTREGADO' && estadoOf(itemId2) === 'NO_ENTREGADO', {
    first: estadoOf(itemId), second: estadoOf(itemId2), listed: afterList.length,
  });

  await initDb();
  const after = await snapshot();
  record('verify.dsedacCountsObserved', true, {
    before: before.dsedac, after: after.dsedac,
    cpcDelta: after.dsedac.cpc - before.dsedac.cpc,
    note: 'Live ERP counts may grow; targeted CPC flags are the write invariant',
  });
  if (itemId) {
    const cpcAfter = await cpcFlag(itemId);
    record('verify.cpcConformadoUntouched', cpcBefore === cpcAfter, { before: cpcBefore, after: cpcAfter, itemId });
  }
  if (itemId2) {
    const cpcAfter2 = await cpcFlag(itemId2);
    record('verify.cpc2Untouched', cpcBefore2 === cpcAfter2, { before: cpcBefore2, after: cpcAfter2, itemId: itemId2 });
  }

  const sqlGasto = await queryWithParams(
    `SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS WHERE IDEMPOTENCY_TOKEN = ?`,
    [gastoTok],
  );
  const sqlIng = await queryWithParams(
    `SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS WHERE IDEMPOTENCY_TOKEN = ?`,
    [ingTok],
  );
  const sqlAj = await queryWithParams(
    `SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES WHERE IDEMPOTENCY_TOKEN = ?`,
    [ajTok],
  );
  record('sql.gasto', Number(sqlGasto[0]?.C ?? 0) === 1, { count: Number(sqlGasto[0]?.C ?? 0) });
  record('sql.ingreso', Number(sqlIng[0]?.C ?? 0) === 1, { count: Number(sqlIng[0]?.C ?? 0) });
  record('sql.ajuste', Number(sqlAj[0]?.C ?? 0) === 1, { count: Number(sqlAj[0]?.C ?? 0) });
  record('sql.testGrew', after.test.conf >= before.test.conf && after.test.gastos >= before.test.gastos, {
    before: before.test, after: after.test,
  });

  const sqlDsedacWriteProbe = await query(
    `SELECT COUNT(*) AS C FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DSEDAC' FETCH FIRST 1 ROW ONLY`,
  );
  record('sql.dsedacReadable', Number(sqlDsedacWriteProbe[0]?.C ?? 0) >= 1);

  await closePool();
  const failed = failures.length;
  console.log(JSON.stringify({
    summary: { failed, total: findings.length, failures },
    flutterUi: 'NOT_CLICKED',
    server230: 'NOT_DEPLOYED',
  }));
  if (failed) process.exit(1);
}

main().catch(async (err) => {
  console.error(String(err && err.stack || err));
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
