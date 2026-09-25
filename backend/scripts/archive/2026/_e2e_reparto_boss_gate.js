// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e | _-scratch gitignored; e2e puntual boss gate | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Boss-gate E2E for Perfil Reparto against isolated_test.
 * Writes only JAVIER.TEST_*. Never DSEDAC / production JAVIER tables.
 *
 *   E2E_HOST=127.0.0.1 E2E_PORT=3335 node backend/scripts/_e2e_reparto_boss_gate.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const { initDb, closePool, query, queryWithParams } = require('../config/db');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 3335);
const DRIVER = process.env.E2E_DRIVER || '08';
const USER = process.env.E2E_USER || 'diego';
const PIN = process.env.E2E_PIN || '9322';
const UA = 'GMP-App/1.0 Dart/3.0 (e2e-reparto-boss-gate)';
const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const YESTERDAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() - 24 * 60 * 60 * 1000));
const YEAR = Number(TODAY.slice(0, 4));
const MONTH = Number(TODAY.slice(5, 7));
const STAMP = `boss${Date.now()}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const failures = [];
const findings = [];

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* raw */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 900) });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickToken(json) {
  return json?.token || json?.data?.token || json?.accessToken || null;
}

function record(label, pass, extra = {}) {
  const row = { label, pass, ...extra };
  console.log(JSON.stringify(row));
  findings.push(row);
  if (!pass) failures.push(label);
  return pass;
}

async function one(sql, params) {
  const rows = params ? await queryWithParams(sql, params) : await query(sql);
  const value = rows[0]?.C ?? rows[0]?.c ?? rows[0]?.S ?? rows[0]?.s ?? rows[0]?.SALDO ?? rows[0]?.saldo ?? 0;
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

async function snapshot() {
  const [lqd, cpc, cpcS, testCobros, testConf, testBal] = await Promise.all([
    one('SELECT COUNT(*) AS C FROM DSEDAC.LQD'),
    one('SELECT COUNT(*) AS C FROM DSEDAC.CPC'),
    one("SELECT SUM(CASE WHEN TRIM(CONFORMADOSN)='S' THEN 1 ELSE 0 END) AS C FROM DSEDAC.CPC"),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTIDOR_COBROS'),
    one('SELECT COUNT(*) AS C FROM JAVIER.TEST_REPARTO_CONFIRMACIONES'),
    one(
      'SELECT COALESCE(SALDO_PENDIENTE,0) AS S FROM JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES WHERE TRIM(CODIGO_REPARTIDOR)=?',
      [DRIVER],
    ),
  ]);
  return { dsedac: { lqd, cpc, cpcS }, test: { cobros: testCobros, conf: testConf, saldo: testBal } };
}

async function ledgerFromDb(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  const dateYmd = year * 10000 + month * 100 + day;
  const codes = [DRIVER, String(Number(DRIVER)), String(Number(DRIVER)).padStart(2, '0')]
    .filter((value, index, all) => all.indexOf(value) === index);
  const inList = codes.map(() => '?').join(', ');
  const saldo = await one(
    `SELECT COALESCE(SALDO_PENDIENTE,0) AS S
       FROM JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES
      WHERE TRIM(CODIGO_REPARTIDOR) IN (${inList})`,
    codes,
  );
  const efectivo = await one(
    `SELECT COALESCE(SUM(CASE
        WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('EFECTIVO','EF','F0','E','CONTADO','CT')
        THEN IMPORTEVENCIMIENTO ELSE 0 END),0) AS S
       FROM JAVIER.TEST_REPARTIDOR_COBROS
      WHERE TRIM(CODIGOVENDEDOR) IN (${inList})
        AND (ANOCOBRO * 10000 + MESCOBRO * 100 + DIACOBRO) = ?
        AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'`,
    [...codes, dateYmd],
  );
  const cobros = await one(
    `SELECT COALESCE(SUM(IMPORTEVENCIMIENTO),0) AS S
       FROM JAVIER.TEST_REPARTIDOR_COBROS
      WHERE TRIM(CODIGOVENDEDOR) IN (${inList})
        AND (ANOCOBRO * 10000 + MESCOBRO * 100 + DIACOBRO) = ?
        AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'`,
    [...codes, dateYmd],
  );
  const structured = async (table) => one(
    `SELECT COALESCE(SUM(IMPORTE),0) AS S
       FROM ${table}
      WHERE TRIM(CODIGO_REPARTIDOR) IN (${inList})
        AND DIA = ? AND MES = ? AND ANO = ?`,
    [...codes, day, month, year],
  );
  const [gastos, ajustes, ingresos] = await Promise.all([
    structured('JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS'),
    structured('JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES'),
    structured('JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS'),
  ]);
  const totalAIngresar = roundMoney(saldo + efectivo - gastos + ajustes);
  return {
    saldo: roundMoney(saldo),
    cobros: roundMoney(cobros),
    efectivo: roundMoney(efectivo),
    gastos: roundMoney(gastos),
    ajustes: roundMoney(ajustes),
    ingresos: roundMoney(ingresos),
    totalAIngresar,
    expectedSaldoAfterClose: roundMoney(totalAIngresar - ingresos),
  };
}

async function seedBalanceIfMissing() {
  const existing = await queryWithParams(
    `SELECT TRIM(CODIGO_REPARTIDOR) AS C, SALDO_PENDIENTE AS S
       FROM JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES
      WHERE TRIM(CODIGO_REPARTIDOR) = ?`,
    [DRIVER],
  );
  if (existing.length) {
    return Number(existing[0].S ?? existing[0].s ?? 0);
  }
  const lqd = await queryWithParams(
    `SELECT IMPORTESALDOACTUAL AS S
       FROM DSEDAC.LQD
      WHERE TRIM(CODIGOVENDEDOR) = ?
      ORDER BY ANOLIQUIDACION DESC, MESLIQUIDACION DESC, DIALIQUIDACION DESC, NUMEROLIQUIDACION DESC
      FETCH FIRST 1 ROW ONLY`,
    [DRIVER],
  );
  const saldo = Number(lqd[0]?.S ?? lqd[0]?.s ?? 0) || 0;
  await queryWithParams(
    `INSERT INTO JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES (CODIGO_REPARTIDOR, SALDO_PENDIENTE)
     VALUES (?, ?)`,
    [DRIVER, saldo],
  );
  record('seed.balance', true, { saldo, source: lqd.length ? 'LQD' : 'zero' });
  return saldo;
}

async function login() {
  const loginRes = await request('POST', '/api/auth/login', {
    body: { username: USER, password: PIN },
  });
  let token = pickToken(loginRes.json);
  if (!token) throw new Error(`login failed ${loginRes.status}`);
  const sw = await request('POST', '/api/auth/switch-role', {
    token,
    body: { userId: '98', newRole: 'REPARTIDOR' },
  });
  token = pickToken(sw.json) || token;
  const user = sw.json?.user || {};
  const mode = user.activeMode || sw.json?.activeMode;
  record('auth.switch', mode === 'REPARTIDOR' && user.isJefeVentas === true, {
    role: user.role, activeMode: mode, isJefeVentas: user.isJefeVentas, isRepartidor: user.isRepartidor,
  });
  return token;
}

async function main() {
  record('runtime.target', HOST === '127.0.0.1' || HOST === 'localhost', { host: HOST, port: PORT, driver: DRIVER });

  const token = await login();
  const get = async (label, path, assertFn) => {
    const res = await request('GET', path, { token });
    const extra = typeof assertFn === 'function' ? (assertFn(res) || {}) : {};
    record(label, res.status >= 200 && res.status < 300 && res.json?.success !== false && extra.fail !== true, {
      status: res.status, code: res.json?.code || null, ...extra,
    });
    return res;
  };

  await get('tab.panel.summary', `/api/repartidor/history/delivery-summary/${DRIVER}`);
  const clientes = await get('tab.clientes', `/api/repartidor/history/clients/${DRIVER}`, (res) => {
    const list = res.json?.data || res.json?.clients || [];
    return { count: Array.isArray(list) ? list.length : 0, fail: !Array.isArray(list) };
  });
  let pendientes = await get(
    'tab.rutero.pendientes',
    `/api/entregas/pendientes/${DRIVER}?date=${TODAY}&limit=50&offset=0`,
    (res) => {
      const list = res.json?.data || res.json?.albaranes || [];
      return { count: Array.isArray(list) ? list.length : 0, fail: !Array.isArray(list) };
    },
  );
  let routeDate = TODAY;
  const todayPending = pendientes.json?.data || pendientes.json?.albaranes || [];
  if (!todayPending.length) {
    pendientes = await get(
      'tab.rutero.pendientes.yesterday',
      `/api/entregas/pendientes/${DRIVER}?date=${YESTERDAY}&limit=50&offset=0`,
      (res) => {
        const list = res.json?.data || res.json?.albaranes || [];
        return { count: Array.isArray(list) ? list.length : 0, fail: !Array.isArray(list) };
      },
    );
    routeDate = YESTERDAY;
  }
  await get('tab.rutero.week', `/api/repartidor/rutero/week/${DRIVER}?date=${TODAY}`);
  await get('tab.vencimientos', `/api/repartidor-finanzas/vencimientos/${DRIVER}?from=${YEAR}-01-01&to=${TODAY}&limit=20`);
  await get('tab.evolucion', `/api/repartidor-finanzas/evolution/${DRIVER}`);
  await get('tab.cuentas', `/api/repartidor-finanzas/cuentas/${DRIVER}`);
  await get('tab.comisiones.tiers', '/api/repartidor-finanzas/commissions/tiers');
  await get(
    'tab.comisiones.month',
    `/api/repartidor-finanzas/commissions/summary/${DRIVER}?from=${YEAR}-${String(MONTH).padStart(2, '0')}-01&to=${TODAY}`,
  );
  await get('tab.asistente.health', '/api/chatbot/health');
  const chatMsg = await request('POST', '/api/chatbot/message', {
    token,
    body: { message: 'cuantas entregas tengo hoy' },
  });
  record('tab.asistente.message', chatMsg.status >= 200 && chatMsg.status < 300 && chatMsg.json?.success !== false, {
    status: chatMsg.status,
    hasReply: Boolean(chatMsg.json?.reply || chatMsg.json?.response || chatMsg.json?.message || chatMsg.json?.data),
  });
  const collections = await request('GET', `/api/repartidor/collections/summary/${DRIVER}`, { token });
  record('tab.collections.available', collections.status === 200 && collections.json?.success === true, {
    status: collections.status, code: collections.json?.code || null,
    availability: collections.json?.collectionAvailability || null,
  });
  await get('tab.rutero.stopsGeo', `/api/repartidor/rutero/stops-geo/${DRIVER}?date=${TODAY}`);
  await get('tab.historico.byDate', `/api/repartidor/history/${DRIVER}?startDate=${TODAY}&endDate=${TODAY}&limit=20&offset=0`);
  await get('tab.liquidacion.desglose', `/api/repartidor-finanzas/liquidaciones/${DRIVER}/desglose?date=${TODAY}`);

  await initDb();
  const before = await snapshot();
  record('guard.isolatedTest', true, before);
  const opening = await seedBalanceIfMissing();
  record('liq.opening', Number.isFinite(opening), { opening });

  const gasto = await request('POST', '/api/repartidor-finanzas/liquidaciones/gastos', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: 10.00, category: 'COMBUSTIBLE',
      idempotencyToken: `gasto-${STAMP}`, observation: 'E2E menos caja',
    },
  });
  record('liq.write.gasto', gasto.status === 201 || gasto.status === 200, {
    status: gasto.status, code: gasto.json?.code || null,
  });
  const ajusteMas = await request('POST', '/api/repartidor-finanzas/liquidaciones/ajustes', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: 4.50, reason: 'E2E de mas',
      idempotencyToken: `ajmas-${STAMP}`,
    },
  });
  record('liq.write.ajusteMas', ajusteMas.status === 201 || ajusteMas.status === 200, {
    status: ajusteMas.status, code: ajusteMas.json?.code || null,
  });
  const ajusteMenos = await request('POST', '/api/repartidor-finanzas/liquidaciones/ajustes', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: -1.50, reason: 'E2E de menos',
      idempotencyToken: `ajmenos-${STAMP}`,
    },
  });
  record('liq.write.ajusteMenos', ajusteMenos.status === 201 || ajusteMenos.status === 200, {
    status: ajusteMenos.status, code: ajusteMenos.json?.code || null,
  });
  const ingreso = await request('POST', '/api/repartidor-finanzas/liquidaciones/ingresos-bancarios', {
    token,
    body: {
      repartidorId: DRIVER, date: TODAY, amount: 7.00, reference: `E2E-${STAMP}`,
      idempotencyToken: `ing-${STAMP}`,
    },
  });
  record('liq.write.ingreso', ingreso.status === 201 || ingreso.status === 200, {
    status: ingreso.status, code: ingreso.json?.code || null,
  });

  const summaryRes = await get('liq.dailySummary', `/api/repartidor-finanzas/daily-summary/${DRIVER}?date=${TODAY}`);
  const summary = summaryRes.json?.summary || summaryRes.json?.totals || {};
  const dbLedger = await ledgerFromDb(TODAY);
  record('liq.formula.apiMatchesDb', Math.abs(Number(summary.totalAIngresar) - dbLedger.totalAIngresar) < 0.011, {
    api: summary.totalAIngresar,
    db: dbLedger,
    ajustesApi: summary.ajustes,
  });
  record('liq.formula.signedAdjustments', dbLedger.ajustes !== 0, { ajustes: dbLedger.ajustes });
  const overDepositSaldo = roundMoney(dbLedger.totalAIngresar - (dbLedger.ingresos + 25));
  const underDepositSaldo = roundMoney(dbLedger.totalAIngresar - Math.max(0, dbLedger.ingresos - 1));
  record('liq.formula.overUnderDirection', overDepositSaldo < dbLedger.expectedSaldoAfterClose
    && underDepositSaldo >= dbLedger.expectedSaldoAfterClose, {
    expectedSaldoAfterClose: dbLedger.expectedSaldoAfterClose,
    overDepositSaldo,
    underDepositSaldo,
  });

  const closeRes = await request('POST', '/api/repartidor-finanzas/liquidaciones', {
    token,
    body: {
      repartidorId: DRIVER,
      date: TODAY,
      idempotencyToken: `close-${STAMP}`,
      sendEmails: false,
    },
  });
  record('liq.close', closeRes.status === 201 || closeRes.status === 200, {
    status: closeRes.status, code: closeRes.json?.code || null, error: closeRes.json?.error || null,
    created: closeRes.json?.created ?? null,
  });
  if (closeRes.status === 201 || closeRes.status === 200) {
    const saldoAfter = await one(
      'SELECT COALESCE(SALDO_PENDIENTE,0) AS S FROM JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES WHERE TRIM(CODIGO_REPARTIDOR)=?',
      [DRIVER],
    );
    record('liq.close.saldoMatchesFormula', Math.abs(saldoAfter - dbLedger.expectedSaldoAfterClose) < 0.011, {
      saldoAfter, expected: dbLedger.expectedSaldoAfterClose,
    });
  }

  const pendingList = pendientes.json?.data || pendientes.json?.albaranes || [];
  const openPending = pendingList.filter((row) => String(row.estado || '').toUpperCase() !== 'ENTREGADO');
  const first = openPending[0];
  if (first?.id) {
    const numero = first.numero ?? first.numeroAlbaran;
    const detalle = await request(
      'GET',
      `/api/entregas/albaran/${numero}/${first.ejercicio}?serie=${encodeURIComponent(first.serie)}&terminal=${encodeURIComponent(first.terminal)}&cliente=${encodeURIComponent(first.codigoCliente)}`,
      { token },
    );
    const items = detalle.json?.albaran?.items || detalle.json?.albaran?.lineas || [];
    const lineas = items.filter((line) => {
      const code = String(line.codigoArticulo || '').trim();
      const qty = Number(line.cantidadPedida ?? line.cantidad);
      return code && !/^0+$/.test(code) && qty > 0;
    }).map((line) => ({
      lineaId: String(line.itemId || line.lineaId || line.secuencia),
      codigoArticulo: String(line.codigoArticulo || '').trim(),
      cantidadPedida: Number(line.cantidadPedida ?? line.cantidad),
      cantidadEntregada: Number(line.cantidadPedida ?? line.cantidad),
      cantidadRechazada: 0,
      cantidadPendiente: 0,
    }));
    const sig = await request('POST', '/api/repartidor-finanzas/rutero/evidence/signature', {
      token,
      body: {
        documentId: first.id,
        repartidorId: DRIVER,
        signature: `data:image/png;base64,${PNG.toString('base64')}`,
      },
      timeoutMs: 90000,
    });
    const evidenceId = sig.json?.evidenceId;
    record('hist.evidence', /^ev_[a-f0-9]{64}$/.test(String(evidenceId || '')), {
      status: sig.status, evidence: evidenceId ? String(evidenceId).slice(0, 12) : null,
    });
    if (lineas.length && evidenceId) {
      const confirm = await request('POST', '/api/repartidor-finanzas/rutero/confirm-delivery-cobro', {
        token,
        headers: { 'Idempotency-Key': `hist-${STAMP}` },
        body: {
          delivery: {
            itemId: first.id,
            status: 'ENTREGADO',
            repartidorId: DRIVER,
            occurredAt: new Date().toISOString(),
            receiver: { nombre: 'E2E', apellidos: 'Boss Gate', dni: '12345678Z' },
            lineas,
            firma: evidenceId,
            observaciones: 'E2E historico',
          },
        },
        timeoutMs: 90000,
      });
      record('hist.confirm', (confirm.status === 201 || confirm.status === 200) && confirm.json?.success === true, {
        status: confirm.status, code: confirm.json?.code || null, error: confirm.json?.error || null,
      });
      const pendAfter = await request(
        'GET',
        `/api/entregas/pendientes/${DRIVER}?date=${routeDate}&limit=50&offset=0`,
        { token },
      );
      const afterList = pendAfter.json?.data || pendAfter.json?.albaranes || [];
      const estado = afterList.find((row) => row.id === first.id)?.estado || null;
      record('hist.ruteroOverlay', String(estado).toUpperCase() === 'ENTREGADO', { estado, routeDate });

      const docs = await request(
        'GET',
        `/api/repartidor/history/documents/${encodeURIComponent(first.codigoCliente)}?repartidorId=${encodeURIComponent(DRIVER)}&dateFrom=${routeDate}&dateTo=${routeDate}&limit=50`,
        { token },
      );
      const documents = docs.json?.documents || docs.json?.data || [];
      const albNumber = Number(first.numero ?? first.numeroAlbaran);
      const match = documents.find((doc) => {
        const number = Number(doc.number || doc.numero || doc.numeroAlbaran);
        const albs = Array.isArray(doc.albaranes) ? doc.albaranes : [];
        return number === albNumber
          || albs.some((alb) => Number(alb.numero || alb.number) === albNumber)
          || String(doc.id || '').includes(String(albNumber));
      });
      const status = String(match?.status || match?.estado || '').toLowerCase();
      record('hist.documentsByDate', Boolean(match) && (status === 'delivered' || status === 'entregado'), {
        status: docs.status, docs: documents.length, found: Boolean(match), docStatus: status, routeDate,
      });
      const histByDate = await request(
        'GET',
        `/api/repartidor/history/${DRIVER}?startDate=${routeDate}&endDate=${routeDate}&limit=50&offset=0`,
        { token },
      );
      const histRows = histByDate.json?.data || [];
      const histMatch = histRows.find((row) => Number(row.NUMEROALBARAN || row.numeroAlbaran) === albNumber);
      const histEstado = String(histMatch?.ESTADO_ENTREGA || histMatch?.estado || '').toUpperCase();
      record('hist.listByRouteDate', Boolean(histMatch) && histEstado === 'ENTREGADO', {
        status: histByDate.status, rows: histRows.length, found: Boolean(histMatch), histEstado, routeDate,
      });
    } else {
      record('hist.confirm', false, { error: 'no_lines_or_evidence' });
    }
  } else {
    record('hist.confirm', false, { error: 'no_open_albaran' });
  }

  const after = await snapshot();
  record('guard.dsedacUntouchedCpcS', after.dsedac.cpcS === before.dsedac.cpcS, {
    before: before.dsedac, after: after.dsedac,
  });
  await closePool();

  const failed = failures.filter((label) => label !== 'runtime.target' || HOST === '127.0.0.1');
  console.log(JSON.stringify({ ok: failed.length === 0, failed, count: findings.length }));
  if (failed.length) process.exit(2);
}

main().catch(async (error) => {
  console.error(String(error && error.stack || error));
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
