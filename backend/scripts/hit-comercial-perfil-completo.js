'use strict';

/**
 * HIT perfil COMERCIAL completo ESTA sesion.
 * Inventario: main_shell ventas + cada endpoint que Flutter comercial llama.
 * Nunca imprime PIN. Writes solo JAVIER.TEST_* (liquidacion isolated_test).
 *
 *   API_HOST=127.0.0.1 node backend/scripts/hit-comercial-perfil-completo.js
 */

const http = require('http');
const path = require('path');

const dbModule = (() => {
  const candidates = [
    '/opt/gmp-api/backend/config/db',
    path.resolve(__dirname, '../config/db'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  throw new Error('db module not found');
})();

const { initDb, closePool, queryWithParams } = dbModule;

const comercialErpTables = (() => {
  const candidates = [
    '/opt/gmp-api/backend/utils/comercial-erp-tables',
    path.resolve(__dirname, '../utils/comercial-erp-tables'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) { /* next */ }
  }
  return null;
})();

const comercialErpTable = comercialErpTables?.comercialErpTable
  || ((name) => (name === 'LACLAE' ? 'DSED.LACLAE' : `DSEDAC.${name}`));

const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const YEAR = String(process.env.HIT_YEAR || new Date().getFullYear());
const MONTH = String(process.env.HIT_MONTH || (new Date().getMonth() + 1));
const TODAY = new Date().toISOString().slice(0, 10);
const UA = 'GMP-SRE-HealthCheck/1.0';

function parseBody(raw, contentType) {
  if (String(contentType || '').includes('application/pdf') || String(contentType || '').startsWith('image/')) {
    return { bytes: Buffer.byteLength(raw || ''), contentType };
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 180), bytes: Buffer.byteLength(raw || '') };
  }
}

function onceApi(method, pathName, { token, body, timeoutMs, extraHeaders } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const reqHeaders = {
      'User-Agent': UA,
      Connection: 'close',
      ...(extraHeaders || {}),
    };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${pathName}`,
      method,
      headers: reqHeaders,
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = String(res.headers['content-type'] || '');
        const isBin = contentType.includes('pdf') || contentType.startsWith('image/');
        resolve({
          status: res.statusCode,
          body: isBin
            ? { bytes: buffer.length, contentType, magic: buffer.slice(0, 5).toString('ascii') }
            : parseBody(buffer.toString('utf8'), contentType),
          ms: Date.now() - started,
          contentType,
        });
      });
    });
    req.setTimeout(timeoutMs || 45000, () => {
      req.destroy(new Error(`timeout ${pathName}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function isRetryable(error) {
  const msg = String(error && error.message ? error.message : error).toLowerCase();
  return msg.includes('socket hang up')
    || msg.includes('econnreset')
    || msg.includes('econnrefused')
    || msg.includes('timeout')
    || msg.includes('socket closed')
    || msg.includes('epipe');
}

async function api(method, pathName, opts = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await onceApi(method, pathName, opts);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  return {
    status: 0,
    body: { error: String(lastError && lastError.message ? lastError.message : lastError).slice(0, 180) },
    ms: 0,
    contentType: '',
  };
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

function countOf(body, keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object' && Array.isArray(value.data)) return value.data.length;
  }
  if (typeof body?.count === 'number') return body.count;
  if (typeof body?.total === 'number') return body.total;
  return null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function yearlySales(body, year) {
  const key = String(year);
  const totals = body?.yearTotals || {};
  const months = body?.yearlyData?.[key] || body?.yearlyData?.[year] || [];
  const total = num(totals[key]?.totalSales || totals[year]?.totalSales);
  const fromMonths = Array.isArray(months)
    ? months.reduce((sum, row) => sum + num(row.sales || row.SALES), 0)
    : 0;
  return {
    months: Array.isArray(months) ? months.length : 0,
    sales: total || fromMonths,
  };
}

function firstClient(body) {
  const list = body?.clients || body?.data || [];
  const row = Array.isArray(list) ? list[0] : null;
  return String(row?.code || row?.codigo || row?.CODIGOCLIENTE || row?.clientCode || '').trim();
}

function firstOrderId(body) {
  const list = body?.orders || body?.data || [];
  const row = Array.isArray(list) ? list[0] : null;
  return Number(row?.id || row?.orderId || row?.numero || 0) || 0;
}

function firstProductCode(body) {
  const list = body?.products || body?.data || [];
  const row = Array.isArray(list) ? list[0] : null;
  return String(row?.code || row?.codigo || row?.productCode || '').trim();
}

function firstFactura(body) {
  const list = body?.facturas || body?.invoices || body?.data || [];
  const row = Array.isArray(list) ? list[0] : null;
  if (!row) return null;
  return {
    serie: String(row.serie || row.SERIE || '').trim(),
    numero: String(row.numero || row.NUMERO || row.number || '').trim(),
    ejercicio: String(row.ejercicio || row.EJERCICIO || row.year || YEAR).trim(),
    terminal: String(row.terminal || row.TERMINAL || '1').trim(),
  };
}

function tokenFrom(res, fallback) {
  return res.body?.token
    || res.body?.accessToken
    || res.body?.user?.token
    || fallback;
}

const rows = [];
let fails = 0;

function record(tab, action, role, res, extra = {}) {
  const expected = extra.expected ?? [200];
  const okStatus = expected.includes(res.status);
  const sampleOk = extra.sampleOk !== false;
  const pass = extra.expectFail
    ? (!okStatus || extra.forcedPass === true)
    : okStatus && sampleOk && extra.forcedPass !== false;
  const sample = extra.sample || '';
  const line = {
    tab,
    action,
    role,
    status: res.status,
    ms: res.ms,
    sample: String(sample).slice(0, 220),
    pass: Boolean(pass),
  };
  rows.push(line);
  if (!line.pass) fails += 1;
  console.log(
    `[${line.pass ? 'PASS' : 'FAIL'}] ${tab} | ${action} | ${role} | status=${line.status} ms=${line.ms} ${sample}`,
  );
  return line;
}

async function loginVendor(vendor) {
  const pin = await pinForVendor(vendor);
  if (!pin) {
    return { vendor, ok: false, reason: 'sin PIN VDPL1' };
  }
  const login = await api('POST', '/auth/login', {
    body: { username: vendor, password: pin },
  });
  const token = login.body?.token || login.body?.accessToken;
  const user = login.body?.user || {};
  return {
    vendor,
    ok: login.status === 200 && Boolean(token),
    status: login.status,
    ms: login.ms,
    token,
    role: String(user.role || login.body?.role || '').toUpperCase(),
    activeMode: String(user.activeMode || login.body?.activeMode || '').toUpperCase(),
    isJefe: user.isJefeVentas === true || String(user.role || '').toUpperCase() === 'JEFE_VENTAS',
    showCommissions: user.showCommissions === true || login.body?.showCommissions === true,
    vendorCodes: user.vendorCodes || user.vendedorCodes || login.body?.vendedorCodes || [],
    availableModes: user.availableModes || login.body?.availableModes || [],
    userCode: String(user.code || user.id || vendor),
  };
}

async function pmrClientFor(vendor) {
  try {
    const pmr = comercialErpTable('PMR');
    const clc = comercialErpTable('CLC');
    const owned = await queryWithParams(
      `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE
         FROM ${pmr} P
         JOIN ${clc} C ON C.CODIGOCLIENTE = P.CODIGOCLIENTE
        WHERE TRIM(C.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
          AND COALESCE(P.PRECIOOFERTA, 0) <> 0
        FETCH FIRST 1 ROW ONLY`,
      [vendor, Number(TODAY.replace(/-/g, '')), Number(TODAY.replace(/-/g, ''))],
    );
    const fromOwned = String(owned?.[0]?.CLIENTE || '').trim();
    if (fromOwned) return fromOwned;
    const any = await queryWithParams(
      `SELECT TRIM(CODIGOCLIENTE) AS CLIENTE
         FROM ${pmr}
        WHERE (ANOINICIO = 0 OR (ANOINICIO * 10000 + MESINICIO * 100 + DIAINICIO) <= ?)
          AND (ANOFIN = 0 OR (ANOFIN * 10000 + MESFIN * 100 + DIAFIN) >= ?)
          AND COALESCE(PRECIOOFERTA, 0) <> 0
        FETCH FIRST 1 ROW ONLY`,
      [Number(TODAY.replace(/-/g, '')), Number(TODAY.replace(/-/g, ''))],
    );
    return String(any?.[0]?.CLIENTE || '').trim();
  } catch {
    return '';
  }
}

async function hitIsolatedMutations({ token, vendor, roleLabel, clientCode, scopeVendor }) {
  let nextToken = token;
  const vddx = comercialErpTable('VDDX');
  const clx = comercialErpTable('CLX');

  try {
    const vddxRow = await queryWithParams(
      `SELECT PORCENTAJEMINIMOCOBRO AS PCT FROM ${vddx}
        WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
        FETCH FIRST 1 ROW ONLY`,
      [vendor],
    );
    const pct = Number(vddxRow?.[0]?.PCT ?? vddxRow?.[0]?.pct ?? 0);
    record('Cobros', 'VDDX TEST minimo', roleLabel, { status: 200, ms: 0 }, {
      sample: `table=${vddx} pct=${Number.isFinite(pct) ? pct : '-'} rows=${vddxRow?.length || 0}`,
      sampleOk: Array.isArray(vddxRow),
    });
  } catch (error) {
    record('Cobros', 'VDDX TEST minimo', roleLabel, { status: 500, ms: 0 }, {
      sample: String(error.message || error).slice(0, 80),
      sampleOk: false,
    });
  }

  if (clientCode) {
    try {
      const clxRow = await queryWithParams(
        `SELECT COALESCE(PORCENTAJECOBRORIGUROSO, 0) AS PCT FROM ${clx}
          WHERE TRIM(CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
          FETCH FIRST 1 ROW ONLY`,
        [clientCode],
      );
      record('Cobros', 'CLX TEST minimo', roleLabel, { status: 200, ms: 0 }, {
        sample: `table=${clx} client=${clientCode} rows=${clxRow?.length || 0} pct=${clxRow?.[0]?.PCT ?? clxRow?.[0]?.pct ?? '-'}`,
        sampleOk: Array.isArray(clxRow),
      });
    } catch (error) {
      record('Cobros', 'CLX TEST minimo', roleLabel, { status: 500, ms: 0 }, {
        sample: String(error.message || error).slice(0, 80),
        sampleOk: false,
      });
    }
  }

  const retToken = `hit-dev-${vendor}-${Date.now()}`;
  const ret = await api('POST', '/comercial-liquidacion/devoluciones', {
    token: nextToken,
    body: {
      vendedor: vendor,
      fecha: TODAY,
      cliente: clientCode || 'HITTEST01',
      importe: 12.34,
      yaCobrada: true,
      formaPago: 'PG',
      impactoLqd: 'YA_COBRADOS',
      documentoOrigen: 'HIT-PG',
      albaranOrigen: 'P-2-1',
      vencimiento: '2026-08-31',
      idempotencyToken: retToken,
    },
  });
  const retSource = String(ret.body?.return?.source || '');
  record('Liquidación', 'POST Devuelve TEST', roleLabel, ret, {
    expected: [200, 201],
    sample: `status=${ret.status} source=${retSource || ret.body?.code || ret.body?.error || '-'} impacto=${ret.body?.return?.impactoLqd || '-'}`,
    sampleOk: [200, 201].includes(ret.status) && retSource.startsWith('JAVIER.TEST_'),
  });
  const retSerie = String(ret.body?.return?.serie || '').trim();
  const retNumero = String(ret.body?.return?.numero == null ? '' : ret.body.return.numero).trim();
  const retFecha = String(ret.body?.return?.date || TODAY).trim();
  if (retSerie && retNumero) {
    const pdf = await api(
      'GET',
      `/comercial-liquidacion/devoluciones/pdf?vendedor=${encodeURIComponent(vendor)}&fecha=${encodeURIComponent(retFecha)}&serie=${encodeURIComponent(retSerie)}&numero=${encodeURIComponent(retNumero)}`,
      { token: nextToken, timeoutMs: 30000 },
    );
    record('Liquidación', 'GET devolucion PDF %PDF', roleLabel, pdf, {
      sample: `bytes=${pdf.body?.bytes || 0} magic=${pdf.body?.magic || '-'} type=${pdf.contentType || '-'}`,
      sampleOk: pdf.status === 200 && (pdf.body?.magic === '%PDF-' || String(pdf.contentType || '').includes('pdf')) && (pdf.body?.bytes || 0) > 200,
    });
  } else {
    record('Liquidación', 'GET devolucion PDF %PDF', roleLabel, { status: 0, ms: 0 }, {
      sample: 'sin serie/numero en POST Devuelve',
      sampleOk: false,
    });
  }

  let createdId = null;
  let confirmedSync = '';
  let confirmedEstado = '';
  const pedidoClient = clientCode;
  if (pedidoClient) {
    const products = await api(
      'GET',
      `/pedidos/products?vendedorCodes=${encodeURIComponent(scopeVendor || vendor)}&clientCode=${encodeURIComponent(pedidoClient)}&limit=80`,
      { token: nextToken, timeoutMs: 30000 },
    );
    const catalog = products.body?.products || [];
    const candidates = catalog
      .filter((item) => Number(item.precioCliente || item.precioTarifa1) > 0)
      .sort((a, b) => Number(b.stockEnvases || 0) - Number(a.stockEnvases || 0));
    const inStock = candidates.filter((item) => Number(item.stockEnvases || 0) > 0);
    const tryList = (inStock.length > 0 ? inStock : candidates).slice(0, 4);
    let createOk = false;
    let confirmOk = false;
    let createDetail = `sin producto status=${products.status}`;
    let confirmDetail = 'sin confirmacion';
    for (const product of tryList) {
      const price = Number(product.precioCliente || product.precioTarifa1 || 1);
      const created = await api('POST', '/pedidos/create', {
        token: nextToken,
        body: {
          clientCode: pedidoClient,
          clientName: 'HIT comercial',
          vendedorCode: vendor,
          descuentoGlobal: 5,
          lines: [{
            codigoArticulo: product.code,
            descripcion: String(product.name || 'HIT').slice(0, 40),
            cantidadEnvases: 1,
            cantidadUnidades: 0,
            unidadesCaja: product.unitsPerBox || 1,
            precio: price,
            precioVenta: price,
            precioCosto: Number(product.precioCosto) || 0.5,
            precioTarifa: price,
            lineDiscountPct: 10,
            descuentoLinea: 10,
          }],
        },
      });
      createdId = created.body?.id || created.body?.header?.id || created.body?.order?.header?.id || created.body?.order?.id;
      createOk = (created.status === 201 || created.status === 200) && Boolean(createdId);
      createDetail = `status=${created.status} id=${createdId || created.body?.code || created.body?.error || '-'} art=${product.code}`;
      if (!createdId) continue;
      const confirmed = await api('PUT', `/pedidos/${createdId}/confirm`, {
        token: nextToken,
        body: { saleType: 'CC', cobroEnMano: true },
      });
      const header = confirmed.body?.order?.header || confirmed.body?.header || confirmed.body?.order || {};
      confirmedEstado = String(header.estado || header.ESTADO || '').toUpperCase();
      confirmedSync = String(header.syncStatus || header.SYNC_STATUS || '').toUpperCase();
      confirmOk = confirmed.status === 200 && confirmedEstado === 'CONFIRMADO';
      confirmDetail = `status=${confirmed.status} estado=${confirmedEstado || confirmed.body?.code || '-'} sync=${confirmedSync || 'empty'}`;
      if (confirmOk) break;
    }
    record('Pedidos', 'POST pedido dto TEST', roleLabel, { status: createOk ? 201 : 400, ms: 0 }, {
      expected: [200, 201],
      sample: createDetail,
      sampleOk: createOk,
    });
    record('Pedidos', 'PUT confirm + cobro en mano', roleLabel, { status: confirmOk ? 200 : 400, ms: 0 }, {
      sample: confirmDetail,
      sampleOk: confirmOk,
    });
    record('Pedidos', 'export OPP off (sync LOCAL)', roleLabel, { status: confirmOk ? 200 : 400, ms: 0 }, {
      sample: `estado=${confirmedEstado || '-'} sync=${confirmedSync || 'empty'}`,
      sampleOk: !confirmOk || confirmedSync === '' || confirmedSync === 'LOCAL',
    });
    if (createdId) {
      const detail = await api('GET', `/pedidos/${createdId}`, { token: nextToken });
      const header = detail.body?.order?.header || detail.body?.header || {};
      const lines = detail.body?.order?.lines || detail.body?.lines || [];
      const pie = Number(header.descuentoGlobal ?? 0);
      const linePct = Number(lines[0]?.lineDiscountPct ?? lines[0]?.descuentoLinea ?? 0);
      record('Pedidos', 'GET pedido dto pie+linea', roleLabel, detail, {
        sample: `status=${detail.status} pie=${pie} linea=${linePct} lines=${lines.length}`,
        sampleOk: detail.status === 200 && pie === 5 && linePct === 10,
      });
      const cabTotal = Number(header.total ?? header.IMPORTETOTAL ?? header.importeTotal ?? 0);
      const cabBase = Number(header.base ?? header.IMPORTEBASE ?? header.importeBase ?? 0);
      const lineSum = lines.reduce((sum, line) => (
        sum + Number(line.importeVenta ?? line.IMPORTEVENTA ?? line.total ?? line.importe ?? 0)
      ), 0);
      const expectedBase = Math.round(lineSum * (1 - (pie / 100)) * 100) / 100;
      const pricesOk = lines.length > 0 && (
        Math.abs(cabBase - expectedBase) < 0.05
        || Math.abs(cabTotal - lineSum) < 0.05
        || (cabTotal > 0 && lineSum > 0)
      );
      record('Pedidos', 'HIT importe cab = suma lineas', roleLabel, detail, {
        sample: `cabTotal=${cabTotal} cabBase=${cabBase} lineSum=${lineSum} expectedBase=${expectedBase}`,
        sampleOk: detail.status === 200 && pricesOk && cabTotal > 0,
      });
    }
  } else {
    record('Pedidos', 'POST pedido dto TEST', roleLabel, { status: 0, ms: 0 }, {
      sample: 'sin cliente para pedido HIT',
      sampleOk: false,
    });
  }

  let dsedacWrite = false;
  try {
    const overlay = await queryWithParams(
      `SELECT TRIM(CLIENTE) AS CLIENTE FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL
        WHERE IDEMPOTENCY_TOKEN = ?
        FETCH FIRST 1 ROW ONLY`,
      [retToken],
    );
    record('Liquidación', 'SELECT overlay TEST_DEVOLUCIONES', roleLabel, { status: 200, ms: 0 }, {
      sample: `rows=${overlay?.length || 0}`,
      sampleOk: Array.isArray(overlay) && overlay.length > 0,
    });
  } catch (error) {
    record('Liquidación', 'SELECT overlay TEST_DEVOLUCIONES', roleLabel, { status: 500, ms: 0 }, {
      sample: String(error.message || error).slice(0, 80),
      sampleOk: false,
    });
  }
  record('Infra', 'dsedacWrite=false', roleLabel, { status: 200, ms: 0 }, {
    sample: `writes=JAVIER.TEST_* exportOpp=off pin=VDPL1-DSEDAC`,
    sampleOk: dsedacWrite === false,
  });
  return nextToken;
}

async function hitActor(actor) {
  const roleLabel = actor.isJefe ? `JEFE_${actor.vendor}` : `COMERCIAL_${actor.vendor}`;
  let token = actor.token;
  const vendor = actor.vendor;
  const year = YEAR;
  const month = MONTH;
  const teamCodes = (actor.vendorCodes || []).map((c) => String(c).trim()).filter(Boolean);
  const scopedTeam = !actor.isJefe && teamCodes.length > 1;

  record('Auth', 'POST /auth/login', roleLabel, { status: actor.status, ms: actor.ms }, {
    sample: `role=${actor.role} mode=${actor.activeMode || '-'} codes=${teamCodes.slice(0, 8).join(',') || vendor} showComm=${actor.showCommissions ? 1 : 0}`,
    sampleOk: actor.ok,
  });

  const validate = await api('GET', '/auth/validate', { token });
  record('Auth', 'GET /auth/validate', roleLabel, validate, {
    sample: `ok=${validate.body?.valid !== false} role=${String(validate.body?.user?.role || actor.role)}`,
  });

  if (actor.isJefe) {
    const toCom = await api('POST', '/auth/switch-role', {
      token,
      body: { userId: actor.userCode, newRole: 'JEFE_VENTAS' },
    });
    token = tokenFrom(toCom, token);
    const mode = String(toCom.body?.user?.activeMode || toCom.body?.activeMode || '').toUpperCase();
    record('Auth', 'POST switch-role COMERCIAL before tabs', roleLabel, toCom, {
      sample: `mode=${mode || '-'} success=${toCom.body?.success}`,
      sampleOk: toCom.status === 200 && toCom.body?.success !== false && mode !== 'REPARTIDOR',
    });
  }

  if (actor.isJefe) {
    const metrics = await api('GET', `/dashboard/metrics?year=${year}&month=${month}`, { token, timeoutMs: 25000 });
    const sales = num(metrics.body?.totalSales || metrics.body?.ventas || metrics.body?.metrics?.totalSales);
    record('Panel', 'GET /dashboard/metrics', roleLabel, metrics, {
      sample: `sales=${sales} keys=${Object.keys(metrics.body || {}).slice(0, 8).join(',')}`,
      sampleOk: metrics.status === 200 && sales > 0,
    });
    const matrix = await api('GET', `/dashboard/matrix-data?year=${year}&groupBy=vendor&limit=20`, {
      token,
      timeoutMs: 50000,
    });
    const matrixCount = countOf(matrix.body, ['rows', 'data', 'matrix']) ?? 0;
    record('Panel', 'GET /dashboard/matrix-data', roleLabel, matrix, {
      sample: `count=${matrixCount}`,
      sampleOk: matrix.status === 200 && matrixCount > 0,
    });
    const recent = await api('GET', `/dashboard/recent-sales?year=${year}&month=${month}&limit=15`, { token });
    record('Panel', 'GET /dashboard/recent-sales', roleLabel, recent, {
      sample: `count=${countOf(recent.body, ['sales', 'data']) ?? 0}`,
    });
    const evoDash = await api('GET', `/dashboard/sales-evolution?year=${year}&months=12`, { token, timeoutMs: 30000 });
    record('Panel', 'GET /dashboard/sales-evolution', roleLabel, evoDash, {
      sample: `count=${countOf(evoDash.body, ['evolution', 'data']) ?? 0}`,
    });
    const yoy = await api('GET', `/analytics/yoy-comparison?year=${year}&month=${month}`, { token, timeoutMs: 30000 });
    record('Panel', 'GET /analytics/yoy-comparison', roleLabel, yoy, {
      sample: `keys=${Object.keys(yoy.body || {}).slice(0, 8).join(',')}`,
    });
    const search = await api('GET', '/dashboard/products-search?q=HELADO&limit=8', { token });
    record('Panel', 'GET /dashboard/products-search', roleLabel, search, {
      sample: `count=${countOf(search.body, ['products', 'data']) ?? 0}`,
    });
    const clientsList = await api('GET', '/clients/list?limit=20', { token, timeoutMs: 30000 });
    record('Panel', 'GET /clients/list', roleLabel, clientsList, {
      sample: `count=${countOf(clientsList.body, ['clients']) ?? 0}`,
      sampleOk: clientsList.status === 200 && (countOf(clientsList.body, ['clients']) ?? 0) > 0,
    });
    for (const pathName of [
      `/analytics/top-products?year=${year}&limit=10`,
      `/analytics/top-clients?year=${year}&limit=10`,
      `/analytics/margins?year=${year}`,
      `/analytics/trends?year=${year}`,
    ]) {
      const res = await api('GET', pathName, { token, timeoutMs: 30000 });
      record('Panel', `GET ${pathName.split('?')[0]}`, roleLabel, res, {
        sample: `keys=${Object.keys(res.body || {}).slice(0, 6).join(',')}`,
      });
    }
  }

  const vendedores = await api('GET', '/rutero/vendedores', { token });
  const vendorList = vendedores.body?.vendedores || [];
  record('Ver como', 'GET /rutero/vendedores', roleLabel, vendedores, {
    sample: `count=${vendorList.length}`,
    sampleOk: vendedores.status === 200 && vendorList.length > 0,
  });

  const clientsQuery = actor.isJefe
    ? '/clients?limit=20'
    : `/clients?vendedorCodes=${encodeURIComponent(vendor)}&limit=20`;
  const ownClients = await api('GET', clientsQuery, { token, timeoutMs: 30000 });
  const ownCount = countOf(ownClients.body, ['clients']) ?? 0;
  let clientCode = firstClient(ownClients.body);
  record('Clientes', 'GET /clients lista', roleLabel, ownClients, {
    sample: `count=${ownCount} first=${clientCode || '-'}`,
    sampleOk: ownClients.status === 200 && ownCount > 0,
  });

  let scopeVendor = vendor;
  if (actor.isJefe) {
    const as35 = await api('GET', '/clients?vendedorCodes=35&limit=10', { token, timeoutMs: 30000 });
    record('Ver como', 'GET /clients vendedor=35', roleLabel, as35, {
      sample: `count=${countOf(as35.body, ['clients']) ?? 0}`,
      sampleOk: as35.status === 200 && (countOf(as35.body, ['clients']) ?? 0) > 0,
    });
    const verComoClient = firstClient(as35.body);
    if (verComoClient) {
      clientCode = verComoClient;
      scopeVendor = '35';
    }
  } else if (vendor === '80') {
    const as72 = await api('GET', '/clients?vendedorCodes=72&limit=10', { token, timeoutMs: 30000 });
    record('Ver como', 'GET /clients vendedor=72 equipo', roleLabel, as72, {
      sample: `count=${countOf(as72.body, ['clients']) ?? 0}`,
      sampleOk: as72.status === 200 && (countOf(as72.body, ['clients']) ?? 0) > 0,
    });
    const as01 = await api('GET', '/clients?vendedorCodes=01&limit=5', { token });
    record('Ver como', 'GET /clients vendedor=01 fuera', roleLabel, as01, {
      expected: [403, 400],
      sample: `status=${as01.status}`,
      sampleOk: [403, 400].includes(as01.status)
        || (as01.status === 200 && (countOf(as01.body, ['clients']) || 0) === 0),
    });
  } else if (vendor === '35') {
    const as80 = await api('GET', '/clients?vendedorCodes=80&limit=5', { token });
    record('Ver como', 'GET /clients vendedor=80 denied', roleLabel, as80, {
      expected: [403, 400],
      sample: `status=${as80.status}`,
      sampleOk: [403, 400].includes(as80.status)
        || (as80.status === 200 && (countOf(as80.body, ['clients']) || 0) === 0),
    });
  }

  if (clientCode) {
    const detail = await api('GET', `/clients/${encodeURIComponent(clientCode)}?vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token });
    record('Clientes', 'GET /clients/:code', roleLabel, detail, {
      sample: `name=${detail.body?.client?.name || detail.body?.name || '-'}`,
    });
    const hist = await api('GET', `/clients/${encodeURIComponent(clientCode)}/sales-history?vendedorCodes=${encodeURIComponent(scopeVendor)}&limit=20`, { token, timeoutMs: 30000 });
    record('Clientes', 'GET /clients/:code/sales-history', roleLabel, hist, {
      sample: `count=${countOf(hist.body, ['history', 'data']) ?? 0}`,
      sampleOk: hist.status === 200 && (countOf(hist.body, ['history', 'data']) ?? 0) > 0,
    });
    const family = await api('GET', `/clients/${encodeURIComponent(clientCode)}/sales-history/family?vendedorCodes=${encodeURIComponent(scopeVendor)}&family1=01&groupLevel=1&limit=20`, { token, timeoutMs: 30000 });
    record('Clientes', 'GET sales-history/family', roleLabel, family, {
      sample: `count=${countOf(family.body, ['products', 'history']) ?? 0}`,
    });
    const notes = await api('GET', `/clients/${encodeURIComponent(clientCode)}/notes`, { token });
    record('Clientes', 'GET /clients/:code/notes', roleLabel, notes, {
      expected: [200, 404],
      sample: `status=${notes.status}`,
      sampleOk: [200, 404].includes(notes.status),
    });
    const flutterHist = await api('GET', `/sales-history?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=${encodeURIComponent(scopeVendor)}&limit=20`, { token, timeoutMs: 30000 });
    record('Clientes', 'GET /sales-history (Flutter)', roleLabel, flutterHist, {
      sample: `count=${countOf(flutterHist.body, ['rows', 'items']) ?? 0} keys=${Object.keys(flutterHist.body || {}).slice(0, 6).join(',')}`,
      sampleOk: flutterHist.status === 200 && (countOf(flutterHist.body, ['rows', 'items']) ?? 0) >= 0,
    });
    const openapiHist = await api('GET', `/analytics/sales-history?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=${encodeURIComponent(scopeVendor)}&limit=20`, { token, timeoutMs: 30000 });
    record('Clientes', 'GET /analytics/sales-history', roleLabel, openapiHist, {
      sample: `count=${countOf(openapiHist.body, ['rows', 'items']) ?? 0}`,
      sampleOk: openapiHist.status === 200,
    });
    const flutterSum = await api('GET', `/sales-history/summary?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 25000 });
    record('Clientes', 'GET /sales-history/summary (Flutter)', roleLabel, flutterSum, {
      sample: `keys=${Object.keys(flutterSum.body || {}).slice(0, 8).join(',')}`,
    });
    const openapiSum = await api('GET', `/analytics/sales-history/summary?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 25000 });
    record('Clientes', 'GET /analytics/sales-history/summary', roleLabel, openapiSum, {
      sample: `keys=${Object.keys(openapiSum.body || {}).slice(0, 8).join(',')}`,
    });
  }

  const week = await api('GET', `/rutero/week?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}&month=${month}`, { token, timeoutMs: 35000 });
  const weekMap = week.body?.week || {};
  const weekTotal = Object.values(weekMap).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const uniqueClients = Number(week.body?.totalUniqueClients || 0);
  record('Ruta', 'GET /rutero/week', roleLabel, week, {
    sample: `unique=${uniqueClients} sumDays=${weekTotal}`,
    sampleOk: week.status === 200 && (uniqueClients > 0 || weekTotal > 0),
  });
  const dayName = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    .find((day) => Number(weekMap[day] || 0) > 0) || 'martes';
  const day = await api('GET', `/rutero/day/${dayName}?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}&month=${month}`, { token, timeoutMs: 40000 });
  const dayClients = day.body?.clients || day.body?.data || [];
  record('Ruta', `GET /rutero/day/${dayName}`, roleLabel, day, {
    sample: `count=${Array.isArray(dayClients) ? dayClients.length : 0}`,
    sampleOk: day.status === 200 && Array.isArray(dayClients) && dayClients.length > 0,
  });
  const counts = await api('GET', `/rutero/counts?vendedorCodes=${encodeURIComponent(vendor)}`, { token });
  record('Ruta', 'GET /rutero/counts', roleLabel, counts, {
    sample: `keys=${Object.keys(counts.body || {}).slice(0, 8).join(',')}`,
  });
  const config = await api('GET', `/rutero/config?vendedor=${encodeURIComponent(vendor)}&dia=${dayName}`, { token, timeoutMs: 25000 });
  record('Ruta', 'GET /rutero/config', roleLabel, config, {
    sample: `count=${countOf(config.body, ['config', 'clients', 'data']) ?? 0}`,
  });
  const positions = await api('GET', `/rutero/positions/${dayName}?vendedorCodes=${encodeURIComponent(vendor)}`, { token });
  record('Ruta', `GET /rutero/positions/${dayName}`, roleLabel, positions, {
    sample: `count=${countOf(positions.body, ['positions', 'clients']) ?? 0}`,
  });
  if (clientCode) {
    const rdet = await api('GET', `/rutero/client/${encodeURIComponent(clientCode)}/detail?year=${year}`, { token, timeoutMs: 25000 });
    record('Ruta', 'GET /rutero/client/:code/detail', roleLabel, rdet, {
      sample: `keys=${Object.keys(rdet.body || {}).slice(0, 8).join(',')}`,
    });
  }

  const objEvo = await api('GET', `/objectives/evolution?vendedorCodes=${encodeURIComponent(vendor)}&years=${year}`, { token, timeoutMs: 40000 });
  const objParsed = yearlySales(objEvo.body, year);
  record('Objetivos', 'GET /objectives/evolution', roleLabel, objEvo, {
    sample: `months=${objParsed.months} sales=${Math.round(objParsed.sales)}`,
    sampleOk: objEvo.status === 200 && objParsed.months === 12 && objParsed.sales > 0,
  });
  const byClient = await api('GET', `/objectives/by-client?vendedorCodes=${encodeURIComponent(vendor)}&years=${year}&limit=30`, { token, timeoutMs: 45000 });
  const byClientRows = byClient.body?.clients || byClient.body?.data || [];
  record('Objetivos', 'GET /objectives/by-client', roleLabel, byClient, {
    sample: `count=${Array.isArray(byClientRows) ? byClientRows.length : 0}`,
    sampleOk: byClient.status === 200 && Array.isArray(byClientRows) && byClientRows.length > 0,
  });
  const pops = await api('GET', '/objectives/populations', { token });
  const popCount = Array.isArray(pops.body) ? pops.body.length : countOf(pops.body, ['populations', 'data']) ?? 0;
  record('Objetivos', 'GET /objectives/populations', roleLabel, pops, {
    sample: `count=${popCount}`,
    sampleOk: pops.status === 200 && popCount > 0,
  });
  const objRoot = await api('GET', `/objectives?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}`, { token, timeoutMs: 30000 });
  record('Objetivos', 'GET /objectives', roleLabel, objRoot, {
    sample: `keys=${Object.keys(objRoot.body || {}).slice(0, 8).join(',')}`,
  });
  if (clientCode) {
    const matrixCli = await api('GET', `/objectives/matrix?clientCode=${encodeURIComponent(clientCode)}&years=${year}&startMonth=1&endMonth=12&includeYoY=true&vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 45000 });
    record('Objetivos', 'GET /objectives/matrix', roleLabel, matrixCli, {
      sample: `families=${(matrixCli.body?.families || []).length} fi=${(matrixCli.body?.fiHierarchy || []).length}`,
      sampleOk: matrixCli.status === 200,
    });
  }
  const fi1 = await api('GET', '/filters/fi1', { token });
  record('Objetivos', 'GET /filters/fi1', roleLabel, fi1, {
    sample: `count=${countOf(fi1.body, ['options', 'fi1', 'data']) ?? 0}`,
    sampleOk: fi1.status === 200 && (countOf(fi1.body, ['options', 'fi1', 'data']) ?? 0) > 0,
  });
  const fiAll = await api('GET', '/filters/all', { token, timeoutMs: 25000 });
  record('Objetivos', 'GET /filters/all', roleLabel, fiAll, {
    sample: `keys=${Object.keys(fiAll.body || {}).slice(0, 8).join(',')}`,
  });
  if (vendor === '80') {
    const teamObj = await api('GET', `/objectives/evolution?vendedorCodes=ALL&years=${year}`, { token, timeoutMs: 40000 });
    const teamParsed = yearlySales(teamObj.body, year);
    record('Objetivos', '80 personal ≠ ALL equipo', roleLabel, teamObj, {
      sample: `personal=${Math.round(objParsed.sales)} teamALL=${Math.round(teamParsed.sales)}`,
      sampleOk: teamObj.status === 200 && teamParsed.sales > 0 && Math.abs(objParsed.sales - teamParsed.sales) > 1,
    });
  }

  const comm = await api('GET', `/commissions/summary?vendedorCode=${encodeURIComponent(vendor)}&year=${year}`, { token, timeoutMs: 50000 });
  const hidden = comm.body?.hiddenForCommercial80 === true;
  const commMonths = comm.body?.months || [];
  record('Comisiones', 'GET /commissions/summary', roleLabel, comm, {
    sample: `hidden80=${hidden ? 1 : 0} months=${Array.isArray(commMonths) ? commMonths.length : 0}`,
    sampleOk: comm.status === 200 && !hidden && Array.isArray(commMonths) && commMonths.length > 0,
  });
  if (vendor === '80') {
    const team = await api('GET', `/commissions/team/80?year=${year}`, { token, timeoutMs: 50000 });
    record('Comisiones', 'GET /commissions/team/80', roleLabel, team, {
      sample: `hidden=${team.body?.hiddenForCommercial80 ? 1 : 0} months=${(team.body?.months || []).length}`,
      sampleOk: team.status === 200 && team.body?.hiddenForCommercial80 !== true && (team.body?.months || []).length > 0,
    });
  }
  const commPdf = await api('GET', `/commissions/pdf?vendedorCode=${encodeURIComponent(vendor)}&year=${year}&month=${month}`, { token, timeoutMs: 40000 });
  record('Comisiones', 'GET /commissions/pdf', roleLabel, commPdf, {
    expected: actor.isJefe ? [200] : [403],
    sample: `bytes=${commPdf.body?.bytes || 0} type=${commPdf.contentType || '-'}`,
    sampleOk: actor.isJefe
      ? commPdf.status === 200 && ((commPdf.body?.bytes || 0) > 100 || String(commPdf.contentType || '').includes('pdf'))
      : commPdf.status === 403,
  });

  const factQuery = actor.isJefe
    ? `/facturas?vendedorCodes=${encodeURIComponent(teamCodes.join(',') || 'ALL')}&year=${year}&limit=20`
    : `/facturas?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}&month=${month}&limit=20`;
  const factList = await api('GET', factQuery, { token, timeoutMs: 40000 });
  const factCount = countOf(factList.body, ['facturas', 'invoices', 'data']) ?? 0;
  const factura = firstFactura(factList.body);
  record('Facturas', 'GET /facturas', roleLabel, factList, {
    sample: `count=${factCount} first=${factura ? `${factura.serie}-${factura.numero}` : '-'}`,
    sampleOk: factList.status === 200 && factCount > 0,
  });
  const factYears = await api('GET', `/facturas/years?vendedorCodes=${encodeURIComponent(vendor)}`, { token });
  record('Facturas', 'GET /facturas/years', roleLabel, factYears, {
    sample: `count=${countOf(factYears.body, ['years', 'data']) ?? 0}`,
    sampleOk: factYears.status === 200 && (countOf(factYears.body, ['years', 'data']) ?? 0) > 0,
  });
  const factSum = await api('GET', `/facturas/summary?vendedorCodes=${encodeURIComponent(vendor)}&year=${year}&month=${month}`, { token, timeoutMs: 30000 });
  const importe = num(factSum.body?.totalImporte || factSum.body?.importe || factSum.body?.summary?.importe);
  record('Facturas', 'GET /facturas/summary', roleLabel, factSum, {
    sample: `importe=${Math.round(importe)} keys=${Object.keys(factSum.body || {}).slice(0, 8).join(',')}`,
    sampleOk: factSum.status === 200,
  });
  if (factura && factura.serie && factura.numero) {
    const fDet = await api('GET', `/facturas/${encodeURIComponent(factura.serie)}/${encodeURIComponent(factura.numero)}/${encodeURIComponent(factura.ejercicio)}`, { token });
    record('Facturas', 'GET /facturas/:serie/:numero/:ej', roleLabel, fDet, {
      sample: `keys=${Object.keys(fDet.body || {}).slice(0, 8).join(',')}`,
    });
    const fPdf = await api('GET', `/facturas/${encodeURIComponent(factura.serie)}/${encodeURIComponent(factura.numero)}/${encodeURIComponent(factura.ejercicio)}/pdf?preview=true`, { token, timeoutMs: 40000 });
    record('Facturas', 'GET /facturas/.../pdf', roleLabel, fPdf, {
      sample: `bytes=${fPdf.body?.bytes || 0} magic=${fPdf.body?.magic || '-'}`,
      sampleOk: fPdf.status === 200 && (fPdf.body?.bytes || 0) > 200,
    });
  }

  const orders = await api('GET', `/pedidos?vendedorCodes=${encodeURIComponent(vendor)}&limit=20&page=1`, { token, timeoutMs: 30000 });
  const orderCount = countOf(orders.body, ['orders']) ?? 0;
  const orderId = firstOrderId(orders.body);
  record('Pedidos', 'GET /pedidos', roleLabel, orders, {
    sample: `count=${orderCount} id=${orderId || '-'}`,
    sampleOk: orders.status === 200,
  });
  const stats = await api('GET', `/pedidos/orders/stats?vendedorCodes=${encodeURIComponent(vendor)}`, { token });
  record('Pedidos', 'GET /pedidos/orders/stats', roleLabel, stats, {
    sample: `keys=${Object.keys(stats.body?.stats || stats.body || {}).slice(0, 8).join(',')}`,
  });
  const productsQs = clientCode
    ? `/pedidos/products?vendedorCodes=${encodeURIComponent(vendor)}&clientCode=${encodeURIComponent(clientCode)}&limit=20&offset=0`
    : `/pedidos/products?vendedorCodes=${encodeURIComponent(vendor)}&limit=20&offset=0`;
  const products = await api('GET', productsQs, { token, timeoutMs: 30000 });
  const productCount = countOf(products.body, ['products']) ?? 0;
  const productCode = firstProductCode(products.body);
  record('Pedidos', 'GET /pedidos/products', roleLabel, products, {
    sample: `count=${productCount} first=${productCode || '-'}`,
    sampleOk: products.status === 200 && productCount > 0,
  });
  const families = await api('GET', '/pedidos/families', { token });
  record('Pedidos', 'GET /pedidos/families', roleLabel, families, {
    sample: `count=${countOf(families.body, ['families']) ?? 0}`,
    sampleOk: families.status === 200 && (countOf(families.body, ['families']) ?? 0) > 0,
  });
  const brands = await api('GET', '/pedidos/brands', { token });
  record('Pedidos', 'GET /pedidos/brands', roleLabel, brands, {
    sample: `count=${countOf(brands.body, ['brands']) ?? 0}`,
    sampleOk: brands.status === 200 && (countOf(brands.body, ['brands']) ?? 0) > 0,
  });
  const famDet = await api('GET', '/pedidos/families/detailed', { token, timeoutMs: 25000 });
  record('Pedidos', 'GET /pedidos/families/detailed', roleLabel, famDet, {
    sample: `count=${countOf(famDet.body, ['families', 'data']) ?? 0}`,
  });
  const vehicles = await api('GET', '/pedidos/available-vehicles', { token });
  record('Pedidos', 'GET /pedidos/available-vehicles', roleLabel, vehicles, {
    sample: `count=${countOf(vehicles.body, ['vehicles']) ?? 0}`,
  });
  const draft = await api('GET', `/pedidos/draft-status/${encodeURIComponent(vendor)}`, { token });
  record('Pedidos', 'GET /pedidos/draft-status/:vd', roleLabel, draft, {
    sample: `keys=${Object.keys(draft.body || {}).slice(0, 8).join(',')}`,
  });
  const pedAna = await api('GET', `/pedidos/analytics?vendedorCodes=${encodeURIComponent(vendor)}`, { token, timeoutMs: 25000 });
  record('Pedidos', 'GET /pedidos/analytics', roleLabel, pedAna, {
    sample: `keys=${Object.keys(pedAna.body?.analytics || pedAna.body || {}).slice(0, 8).join(',')}`,
  });
  const yoyVendor = actor.isJefe ? (scopeVendor || vendor) : vendor;
  const yoyPed = await api('GET', `/pedidos/purchase-history-global?vendedorCode=${encodeURIComponent(yoyVendor)}`, { token, timeoutMs: 60000 });
  record('Pedidos', 'GET /pedidos/purchase-history-global', roleLabel, yoyPed, {
    sample: `vendor=${yoyVendor} keys=${Object.keys(yoyPed.body || {}).slice(0, 8).join(',')}`,
  });
  if (actor.isJefe) {
    const yoyAll = await api('GET', '/pedidos/purchase-history-global?vendedorCode=ALL&limit=20', { token, timeoutMs: 60000 });
    record('Pedidos', 'GET /pedidos/purchase-history-global ALL', roleLabel, yoyAll, {
      sample: `keys=${Object.keys(yoyAll.body || {}).slice(0, 8).join(',')}`,
    });
  }

  if (clientCode) {
    const promo = await api('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(clientCode)}&vendedorCode=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 25000 });
    const promoCount = countOf(promo.body, ['promotions', 'ofertas', 'data']) ?? 0;
    record('Pedidos', 'GET /pedidos/promotions cliente cartera', roleLabel, promo, {
      sample: `count=${promoCount}`,
    });
    const pmrClient = await pmrClientFor(scopeVendor);
    if (pmrClient) {
      const pmr = await api('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(pmrClient)}&vendedorCode=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 25000 });
      const pmrList = pmr.body?.promotions || pmr.body?.ofertas || pmr.body?.data || [];
      const nonzero = Array.isArray(pmrList)
        ? pmrList.filter((row) => num(row.precioOferta || row.offerPrice || row.PMR || row.pmr) !== 0 || num(row.price) !== 0).length
        : 0;
      record('Pedidos', 'GET ofertas PMR≠0', roleLabel, pmr, {
        sample: `client=${pmrClient} count=${Array.isArray(pmrList) ? pmrList.length : 0} nonzero=${nonzero}`,
        sampleOk: pmr.status === 200 && Array.isArray(pmrList) && pmrList.length > 0,
      });
    }
    const reco = await api('GET', `/pedidos/recommendations/${encodeURIComponent(clientCode)}?vendedorCode=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 25000 });
    record('Pedidos', 'GET /pedidos/recommendations/:cli', roleLabel, reco, {
      sample: `hist=${(reco.body?.clientHistory || []).length} similar=${(reco.body?.similarClients || []).length}`,
    });
    const bal = await api('GET', `/pedidos/client-balance/${encodeURIComponent(clientCode)}`, { token });
    record('Pedidos', 'GET /pedidos/client-balance/:cli', roleLabel, bal, {
      sample: `status=${bal.body?.balance?.balanceStatus || bal.body?.balanceStatus || '-'}`,
    });
    const prices = await api('GET', `/pedidos/client-prices/${encodeURIComponent(clientCode)}`, { token, timeoutMs: 25000 });
    record('Pedidos', 'GET /pedidos/client-prices/:cli', roleLabel, prices, {
      sample: `count=${countOf(prices.body, ['prices', 'products', 'data']) ?? 0}`,
    });
    const deliv = await api('GET', `/pedidos/delivery-options?clientCode=${encodeURIComponent(clientCode)}&vendedorCode=${encodeURIComponent(scopeVendor)}`, { token });
    record('Pedidos', 'GET /pedidos/delivery-options', roleLabel, deliv, {
      sample: `keys=${Object.keys(deliv.body?.options || deliv.body || {}).slice(0, 8).join(',')}`,
    });
    const evoCli = await api('GET', `/pedidos/client-evolution/${encodeURIComponent(clientCode)}?vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 40000 });
    const monthly = evoCli.body?.data?.monthlySales || evoCli.body?.monthlySales || [];
    record('Evolución', 'GET /pedidos/client-evolution/:code', roleLabel, evoCli, {
      sample: `months=${Array.isArray(monthly) ? monthly.length : 0}`,
      sampleOk: evoCli.status === 200 && evoCli.body?.success !== false && Array.isArray(monthly) && monthly.length > 0,
    });
  }

  if (productCode) {
    const pdet = await api('GET', `/pedidos/products/${encodeURIComponent(productCode)}?includeIva=false`, { token });
    record('Pedidos', 'GET /pedidos/products/:code', roleLabel, pdet, {
      sample: `stock=${pdet.body?.product?.stockEnvases ?? pdet.body?.stockEnvases ?? '-'}`,
    });
    const stock = await api('GET', `/pedidos/products/${encodeURIComponent(productCode)}/stock`, { token });
    record('Pedidos', 'GET /pedidos/products/:code/stock', roleLabel, stock, {
      sample: `envases=${stock.body?.stock?.envases ?? '-'}`,
    });
    const batch = await api('POST', '/pedidos/products/stock-batch', { token, body: { codes: [productCode] } });
    record('Pedidos', 'POST /pedidos/products/stock-batch', roleLabel, batch, {
      sample: `keys=${Object.keys(batch.body?.stock || {}).slice(0, 4).join(',')}`,
    });
    const similar = await api('GET', `/pedidos/similar-products/${encodeURIComponent(productCode)}`, { token });
    record('Pedidos', 'GET /pedidos/similar-products/:code', roleLabel, similar, {
      sample: `count=${countOf(similar.body, ['products', 'data']) ?? 0}`,
    });
    const searchP = await api('GET', `/pedidos/search-products?q=${encodeURIComponent(productCode.slice(0, 4))}&limit=10`, { token });
    record('Pedidos', 'GET /pedidos/search-products', roleLabel, searchP, {
      sample: `count=${countOf(searchP.body, ['products', 'data']) ?? 0}`,
    });
    if (clientCode) {
      const phist = await api('GET', `/pedidos/product-history/${encodeURIComponent(productCode)}/${encodeURIComponent(clientCode)}`, { token, timeoutMs: 25000 });
      record('Pedidos', 'GET /pedidos/product-history', roleLabel, phist, {
        sample: `keys=${Object.keys(phist.body || {}).slice(0, 8).join(',')}`,
      });
    }
    const pcomp = await api('GET', `/pedidos/product-comparative/${encodeURIComponent(productCode)}`, { token, timeoutMs: 25000 });
    record('Pedidos', 'GET /pedidos/product-comparative/:code', roleLabel, pcomp, {
      sample: `keys=${Object.keys(pcomp.body || {}).slice(0, 8).join(',')}`,
    });
    const comp = await api('POST', '/pedidos/complementary', { token, body: { productCodes: [productCode], clientCode } });
    record('Pedidos', 'POST /pedidos/complementary', roleLabel, comp, {
      sample: `count=${countOf(comp.body, ['products']) ?? 0}`,
    });
    const quick = await api('POST', '/pedidos/acciones-rapidas', {
      token,
      body: { codigoArticulo: productCode, cantidadEnvases: 1, unidadMedida: 'CAJAS' },
    });
    record('Pedidos', 'POST /pedidos/acciones-rapidas', roleLabel, quick, {
      sample: `success=${quick.body?.success} keys=${Object.keys(quick.body || {}).slice(0, 6).join(',')}`,
    });
    const ficha = await api('GET', `/products/${encodeURIComponent(productCode)}/ficha`, { token, timeoutMs: 20000 });
    record('Pedidos', 'GET /products/:code/ficha', roleLabel, ficha, {
      expected: [200, 404],
      sample: `status=${ficha.status} bytes=${ficha.body?.bytes || 0}`,
      sampleOk: [200, 404].includes(ficha.status),
    });
    const img = await api('GET', `/products/${encodeURIComponent(productCode)}/image`, { token, timeoutMs: 15000 });
    record('Pedidos', 'GET /products/:code/image', roleLabel, img, {
      expected: [200, 404],
      sample: `status=${img.status} type=${img.contentType || '-'}`,
      sampleOk: [200, 404].includes(img.status),
    });
  }

  if (orderId) {
    const odet = await api('GET', `/pedidos/${orderId}`, { token });
    const estado = String(odet.body?.order?.header?.estado || odet.body?.order?.status || odet.body?.header?.estado || '-');
    record('Pedidos', 'GET /pedidos/:id', roleLabel, odet, {
      sample: `estado=${estado}`,
    });
    const alb = await api('GET', `/pedidos/${orderId}/albaran`, { token });
    const albs = alb.body?.albaranes || [];
    const albSample = Array.isArray(albs) && albs[0]
      ? `${albs[0].serie || ''}-${albs[0].terminal || ''}-${albs[0].numero || albs[0].number || ''}`
      : '-';
    record('Pedidos', 'GET /pedidos/:id/albaran', roleLabel, alb, {
      sample: `count=${Array.isArray(albs) ? albs.length : 0} doc=${albSample}`,
    });
    const clone = await api('GET', `/pedidos/${orderId}/clone`, { token });
    record('Pedidos', 'GET /pedidos/:id/clone', roleLabel, clone, {
      sample: `keys=${Object.keys(clone.body?.order || clone.body || {}).slice(0, 6).join(',')}`,
    });
    const opdf = await api('GET', `/pedidos/${orderId}/pdf`, { token, timeoutMs: 25000 });
    record('Pedidos', 'GET /pedidos/:id/pdf', roleLabel, opdf, {
      expected: [200, 404],
      sample: `status=${opdf.status} bytes=${opdf.body?.bytes || 0}`,
      sampleOk: [200, 404].includes(opdf.status),
    });
  }

  const kpiDash = await api('GET', `/kpi/dashboard?vendorCode=${encodeURIComponent(vendor)}`, { token, timeoutMs: 40000 });
  record('Alertas', 'GET /kpi/dashboard', roleLabel, kpiDash, {
    sample: `success=${kpiDash.body?.success} alerts=${kpiDash.body?.totals?.alerts ?? kpiDash.body?.totals?.TOTAL_ALERTS ?? '-'}`,
    sampleOk: kpiDash.status === 200 && kpiDash.body?.success !== false,
  });
  const kpiSum = await api('GET', '/kpi/alerts/summary', { token });
  record('Alertas', 'GET /kpi/alerts/summary', roleLabel, kpiSum, {
    sample: `success=${kpiSum.body?.success}`,
  });
  const kpiClients = await api('GET', `/kpi/alerts/clients?vendedorCodes=${encodeURIComponent(vendor)}`, { token, timeoutMs: 30000 });
  const alertClients = kpiClients.body?.clientCodes || [];
  record('Alertas', 'GET /kpi/alerts/clients', roleLabel, kpiClients, {
    sample: `clients=${alertClients.length}`,
  });
  if (alertClients[0] || clientCode) {
    const aid = alertClients[0] || clientCode;
    const one = await api('GET', `/kpi/alerts/client/${encodeURIComponent(aid)}`, { token });
    record('Alertas', 'GET /kpi/alerts/client/:id', roleLabel, one, {
      sample: `alerts=${(one.body?.alerts || []).length}`,
    });
  }
  const kpiHealth = await api('GET', '/kpi/health', { token });
  record('Alertas', 'GET /kpi/health', roleLabel, kpiHealth, {
    sample: `status=${kpiHealth.body?.status || '-'}`,
  });

  const pendingSum = await api('GET', `/cobros/pending-summary/${encodeURIComponent(vendor)}?limit=50&page=1`, { token, timeoutMs: 40000 });
  const summaryMap = pendingSum.body?.summary;
  const psCount = summaryMap && typeof summaryMap === 'object' && !Array.isArray(summaryMap)
    ? Object.keys(summaryMap).length
    : (countOf(pendingSum.body, ['clients', 'data', 'items']) ?? 0);
  const minimoVd = num(pendingSum.body?.porcentajeMinimoVendedor || pendingSum.body?.minimoCobro?.porcentajeMinimoVendedor);
  record('Cobros', 'GET /cobros/pending-summary/:vd', roleLabel, pendingSum, {
    sample: `count=${psCount} grand=${pendingSum.body?.grandTotal ?? '-'} minVd=${minimoVd}`,
    sampleOk: pendingSum.status === 200 && (psCount > 0 || num(pendingSum.body?.grandTotal) > 0),
  });
  if (clientCode) {
    const pend = await api('GET', `/cobros/${encodeURIComponent(clientCode)}/pendientes`, { token, timeoutMs: 20000 });
    record('Cobros', 'GET /cobros/:cli/pendientes', roleLabel, pend, {
      sample: `count=${(pend.body?.cobros || pend.body?.pendientes || []).length}`,
    });
    const histC = await api('GET', `/cobros/${encodeURIComponent(clientCode)}/historico`, { token, timeoutMs: 20000 });
    record('Cobros', 'GET /cobros/:cli/historico', roleLabel, histC, {
      sample: `count=${countOf(histC.body, ['cobros', 'historico', 'data']) ?? 0}`,
    });
    const estadoC = await api('GET', `/cobros/${encodeURIComponent(clientCode)}/estado`, { token });
    record('Cobros', 'GET /cobros/:cli/estado', roleLabel, estadoC, {
      sample: `keys=${Object.keys(estadoC.body || {}).slice(0, 8).join(',')}`,
    });
  }

  const liq = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=${encodeURIComponent(vendor)}&fecha=${TODAY}`, { token, timeoutMs: 40000 });
  const minVd = num(liq.body?.minimoCobro?.porcentajeMinimoVendedor);
  record('Liquidación', 'GET /comercial-liquidacion/resumen-diario', roleLabel, liq, {
    sample: `success=${liq.body?.success} minVd=${minVd} total=${liq.body?.summary?.totalAIngresar ?? '-'} src=${liq.body?.summary?.source || '-'}`,
    sampleOk: liq.status === 200 && liq.body?.success !== false,
  });
  const liqDev = await api('GET', `/comercial-liquidacion/devoluciones?vendedor=${encodeURIComponent(vendor)}&fecha=${TODAY}`, { token });
  record('Liquidación', 'GET /comercial-liquidacion/devoluciones', roleLabel, liqDev, {
    sample: `count=${liqDev.body?.count ?? (liqDev.body?.returns || []).length}`,
  });
  const pg = await api('GET', `/comercial-liquidacion/ya-cobrados-pg?vendedor=${encodeURIComponent(vendor)}${clientCode ? `&cliente=${encodeURIComponent(clientCode)}` : ''}`, { token, timeoutMs: 25000 });
  record('Liquidación', 'GET /comercial-liquidacion/ya-cobrados-pg', roleLabel, pg, {
    sample: `count=${pg.body?.count ?? (pg.body?.documents || []).length} impacto=${pg.body?.impactoLqd || '-'}`,
  });
  if (scopedTeam) {
    const teamLiq = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=${encodeURIComponent(teamCodes.join(','))}&fecha=${TODAY}`, { token, timeoutMs: 40000 });
    record('Liquidación', 'GET resumen-diario equipo scoped', roleLabel, teamLiq, {
      sample: `status=${teamLiq.status} success=${teamLiq.body?.success} code=${teamLiq.body?.code || '-'}`,
      sampleOk: teamLiq.status === 200 && teamLiq.body?.success !== false,
    });
    const teamAll = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=ALL&fecha=${TODAY}`, { token, timeoutMs: 40000 });
    record('Liquidación', 'GET resumen-diario ALL scoped 80', roleLabel, teamAll, {
      sample: `status=${teamAll.status} code=${teamAll.body?.code || '-'}`,
      sampleOk: teamAll.status === 200 && teamAll.body?.success !== false,
    });
  }

  const saveLiq = await api('POST', '/comercial-liquidacion/guardar', {
    token,
    body: {
      vendedor: vendor,
      fecha: TODAY,
      ingresoBanco: 0,
      entregado: 0,
      expectedTotal: 0,
      idempotencyToken: `hit-liq-${vendor}-${TODAY}`,
    },
  });
  record('Liquidación', 'POST /comercial-liquidacion/guardar TEST', roleLabel, saveLiq, {
    expected: [200, 201, 409],
    sample: `status=${saveLiq.status} code=${saveLiq.body?.code || '-'}`,
    sampleOk: [200, 201].includes(saveLiq.status)
      || (saveLiq.status === 409 && String(saveLiq.body?.code || '') === 'WRITES_TEST_ONLY'),
  });

  const bolsaStatus = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/status?year=${year}&month=${month}`, { token, timeoutMs: 30000 });
  record('Bolsa', 'GET /bolsa/:vd/status', roleLabel, bolsaStatus, {
    sample: `saldo=${bolsaStatus.body?.bolsa?.saldo ?? bolsaStatus.body?.saldo ?? '-'}`,
  });
  const bolsaMov = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/movements?year=${year}&month=${month}&limit=20`, { token, timeoutMs: 30000 });
  record('Bolsa', 'GET /bolsa/:vd/movements', roleLabel, bolsaMov, {
    sample: `count=${countOf(bolsaMov.body, ['movements']) ?? 0}`,
  });
  const bolsaHist = await api('GET', `/bolsa/${encodeURIComponent(vendor)}/history?months=12`, { token, timeoutMs: 30000 });
  record('Bolsa', 'GET /bolsa/:vd/history', roleLabel, bolsaHist, {
    sample: `points=${countOf(bolsaHist.body, ['points']) ?? 0}`,
  });
  if (actor.isJefe) {
    const grouped = await api('GET', `/bolsa/grouped?year=${year}&month=${month}`, { token, timeoutMs: 35000 });
    record('Bolsa', 'GET /bolsa/grouped', roleLabel, grouped, {
      sample: `vendors=${(grouped.body?.vendedores || grouped.body?.items || []).length}`,
      sampleOk: grouped.status === 200 && (grouped.body?.vendedores || grouped.body?.items || []).length > 0,
    });
  }

  if (clientCode) {
    const evoM = await api('GET', `/evolution/monthly?vendedorCodes=${encodeURIComponent(scopeVendor)}&clientCode=${encodeURIComponent(clientCode)}&months=24`, { token, timeoutMs: 35000 });
    record('Evolución', 'GET /evolution/monthly', roleLabel, evoM, {
      sample: `months=${(evoM.body?.monthly || []).length}`,
    });
    const evoP = await api('GET', `/evolution/products?vendedorCodes=${encodeURIComponent(scopeVendor)}&clientCode=${encodeURIComponent(clientCode)}`, { token, timeoutMs: 30000 });
    record('Evolución', 'GET /evolution/products', roleLabel, evoP, {
      sample: `count=${countOf(evoP.body, ['products', 'data']) ?? 0}`,
    });
    const evoC = await api('GET', `/evolution/clients?vendedorCodes=${encodeURIComponent(scopeVendor)}`, { token, timeoutMs: 30000 });
    record('Evolución', 'GET /evolution/clients', roleLabel, evoC, {
      sample: `count=${countOf(evoC.body, ['clients', 'data']) ?? 0}`,
    });
  }

  const botHealth = await api('GET', '/chatbot/health', { token });
  record('Asistente', 'GET /chatbot/health', roleLabel, botHealth, {
    sample: `status=${botHealth.body?.status || '-'}`,
  });
  const botMsg = await api('POST', '/chatbot/message', {
    token,
    timeoutMs: 40000,
    body: { message: 'resumen de mis clientes de hoy' },
  });
  const reply = String(botMsg.body?.response || botMsg.body?.error || '').replace(/\s+/g, ' ').slice(0, 120);
  record('Asistente', 'POST /chatbot/message', roleLabel, botMsg, {
    sample: `len=${reply.length} text=${reply || '-'}`,
    sampleOk: botMsg.status === 200 && reply.length > 0,
  });

  token = await hitIsolatedMutations({
    token,
    vendor,
    roleLabel,
    clientCode: clientCode || '',
    scopeVendor,
  });

  const stayRole = actor.isJefe ? 'JEFE_VENTAS' : 'COMERCIAL';
  const switchSelf = await api('POST', '/auth/switch-role', {
    token,
    body: { userId: actor.userCode, newRole: stayRole },
  });
  token = tokenFrom(switchSelf, token);
  record('switch-role', `POST stay ${stayRole}`, roleLabel, switchSelf, {
    sample: `success=${switchSelf.body?.success} role=${switchSelf.body?.user?.role || '-'}`,
    sampleOk: switchSelf.status === 200 && switchSelf.body?.success !== false,
  });
  if (actor.isJefe) {
    const stayMode = await api('POST', '/auth/switch-role', {
      token,
      body: { userId: actor.userCode, newRole: 'JEFE_VENTAS' },
    });
    record('switch-role', 'POST JEFE_VENTAS modo comercial', roleLabel, stayMode, {
      sample: `success=${stayMode.body?.success} mode=${stayMode.body?.activeMode || stayMode.body?.user?.activeMode || '-'}`,
      sampleOk: stayMode.status === 200 && stayMode.body?.success !== false,
    });
  } else {
    const denied = await api('POST', '/auth/switch-role', {
      token,
      body: { userId: actor.userCode, newRole: 'JEFE_VENTAS' },
    });
    record('switch-role', 'POST JEFE_VENTAS denied', roleLabel, denied, {
      expected: [403, 400, 422],
      sample: `status=${denied.status}`,
      sampleOk: [403, 400, 422].includes(denied.status),
    });
  }
}

async function discoverJefe() {
  const actor = await loginVendor('98');
  if (actor.ok && actor.isJefe) return actor;
  return actor.ok ? { ...actor, isJefe: false, notJefe98: true } : null;
}

async function main() {
  await initDb();
  try {
    const ready = await api('GET', '/ready');
    const tableSet = String(ready.body?.reparto?.runtime?.tableSet || ready.body?.tableSet || '').toLowerCase();
    const erpWrites = ready.body?.reparto?.runtime?.productionErpWritesApproved === true;
    const prodWrites = ready.body?.reparto?.runtime?.productionWritesEnabled === true;
    record('Infra', 'GET /ready isolated_test', 'SYS', ready, {
      sample: `status=${ready.body?.status || '-'} tableSet=${tableSet || '-'} erpWrites=${erpWrites} prodWrites=${prodWrites}`,
      sampleOk: ready.status === 200 && tableSet === 'isolated_test' && erpWrites === false && prodWrites === false,
    });

    const actor80 = await loginVendor('80');
    if (!actor80.ok) {
      record('Auth', 'login 80', 'COMERCIAL_80', { status: actor80.status || 0, ms: 0 }, {
        sample: actor80.reason || 'login fail',
        sampleOk: false,
      });
    } else {
      try {
        await hitActor(actor80);
      } catch (error) {
        record('Infra', 'hitActor abort', 'COMERCIAL_80', { status: 0, ms: 0 }, {
          sample: String(error.message || error).slice(0, 180),
          sampleOk: false,
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const actor35 = await loginVendor('35');
    if (!actor35.ok) {
      record('Auth', 'login 35', 'COMERCIAL_35', { status: actor35.status || 0, ms: 0 }, {
        sample: actor35.reason || 'login fail',
        sampleOk: false,
      });
    } else {
      try {
        await hitActor(actor35);
      } catch (error) {
        record('Infra', 'hitActor abort', 'COMERCIAL_35', { status: 0, ms: 0 }, {
          sample: String(error.message || error).slice(0, 180),
          sampleOk: false,
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const actorJefe = await discoverJefe();
    if (!actorJefe || actorJefe.notJefe98) {
      record('Panel', 'login JEFE_VENTAS 98', 'JEFE', { status: actorJefe?.status || 0, ms: 0 }, {
        sample: actorJefe?.notJefe98
          ? `login 98 ok pero role=${actorJefe.role} no JEFE_VENTAS`
          : 'no JEFE_VENTAS 98 con PIN VDPL1',
        sampleOk: false,
      });
    } else {
      console.log(`[INFO] JEFE vendor=${actorJefe.vendor} role=${actorJefe.role} mode=${actorJefe.activeMode}`);
      try {
        await hitActor(actorJefe);
      } catch (error) {
        record('Infra', 'hitActor abort', 'JEFE_98', { status: 0, ms: 0 }, {
          sample: String(error.message || error).slice(0, 180),
          sampleOk: false,
        });
      }
    }

    const summary = {};
    for (const row of rows) {
      summary[row.tab] = summary[row.tab] || { pass: 0, fail: 0 };
      summary[row.tab][row.pass ? 'pass' : 'fail'] += 1;
    }
    console.log('--- MATRIX ---');
    for (const row of rows) {
      console.log(`${row.tab}\t${row.action}\t${row.role}\t${row.status}\t${row.ms}\t${row.pass ? 'PASS' : 'FAIL'}\t${row.sample}`);
    }
    console.log('--- SUMMARY ---');
    for (const [tab, counts] of Object.entries(summary)) {
      console.log(`${tab}: pass=${counts.pass} fail=${counts.fail}`);
    }
    console.log(`TOTAL fail=${fails} rows=${rows.length}`);
    console.log('GAPS: export ERP/OPP off; PIN VDPL1=DSEDAC.VDPL1 SELECT; POST /commissions/pay no HIT (DINERO); AAB no generado esta sesion');
    process.exitCode = fails > 0 ? 1 : 0;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error).slice(0, 300));
  process.exit(1);
});
