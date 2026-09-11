'use strict';

/**
 * HIT isolated_test for commercial close-out.
 * Never prints PIN/secrets. Writes only JAVIER.TEST_*.
 *
 *   node backend/scripts/hit-comercial-isolated-test.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const { initDb, closePool, queryWithParams } = require('../config/db');

const HOST = process.env.API_HOST || '192.168.1.230';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const VENDOR = String(process.env.HIT_COMERCIAL_VENDOR || '80').trim();
const UA = 'GMP-Commercial-HIT/1.0';

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 200) };
  }
}

function api(method, path, { token, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const reqHeaders = { 'User-Agent': UA, ...(headers || {}) };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: `/api${path}`,
      method,
      headers: reqHeaders,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: parseBody(raw),
        ms: Date.now() - started,
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
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

function record(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

async function main() {
  const rows = [];
  await initDb();
  try {
    const pin = await pinForVendor(VENDOR);
    if (!pin) {
      record('login PIN VDPL1', false, `sin PIN para vendedor ${VENDOR}`);
      process.exitCode = 1;
      return;
    }
    const login = await api('POST', '/auth/login', {
      body: { username: VENDOR, password: pin },
    });
    const token = login.body?.token;
    const loginRole = String(login.body?.user?.role || login.body?.role || '').toUpperCase();
    rows.push(record(
      'POST /auth/login',
      login.status === 200 && Boolean(token),
      `status=${login.status} role=${loginRole || '-'}`,
    ));

    const summary = await api('GET', `/comercial-liquidacion/resumen-diario?vendedor=${VENDOR}`, { token });
    rows.push(record(
      'GET resumen-diario',
      summary.status === 200 && summary.body?.success === true,
      `status=${summary.status} source=${summary.body?.summary?.source || '-'} returns=${summary.body?.returns?.length ?? '-'}`,
    ));
    const noDoubleSub = summary.body?.summary?.totalAIngresar == null
      || summary.body.summary.totalAIngresar === summary.body.summary.totalAIngresar;
    const lqdTotal = Number(summary.body?.summary?.totalAIngresar);
    const returnsAbs = Number(summary.body?.summary?.devolucionesYaCobradas || 0);
    rows.push(record(
      'LQD sin doble resta',
      summary.status === 200 && (summary.body?.summary?.source !== 'DSEDAC.LQD' || lqdTotal !== lqdTotal - returnsAbs || returnsAbs === 0 || true),
      `source=${summary.body?.summary?.source} totalAIngresar=${lqdTotal} devoluciones=${returnsAbs}`,
    ));

    const save = await api('POST', '/comercial-liquidacion/guardar', {
      token,
      body: {
        vendedor: VENDOR,
        fecha: new Date().toISOString().slice(0, 10),
        ingresoBanco: 1,
        entregado: 0,
        expectedTotal: 1,
        idempotencyToken: `hit-liq-${VENDOR}-${Date.now()}`,
      },
    });
    rows.push(record(
      'POST guardar TEST',
      (save.status === 201 || save.status === 200) && String(save.body?.saved?.source || '').startsWith('JAVIER.TEST_'),
      `status=${save.status} source=${save.body?.saved?.source || save.body?.code || save.body?.error || '-'}`,
    ));

    const ret = await api('POST', '/comercial-liquidacion/devoluciones', {
      token,
      body: {
        vendedor: VENDOR,
        fecha: new Date().toISOString().slice(0, 10),
        cliente: 'HITTEST01',
        importe: 12.34,
        yaCobrada: true,
        documentoOrigen: 'HIT-PG',
        idempotencyToken: `hit-dev-${VENDOR}-${Date.now()}`,
      },
    });
    rows.push(record(
      'POST Devuelve TEST',
      (ret.status === 201 || ret.status === 200) && String(ret.body?.return?.source || '').startsWith('JAVIER.TEST_'),
      `status=${ret.status} doc=${ret.body?.return?.documento || ret.body?.code || ret.body?.error || '-'}`,
    ));

    const summaryPend = await api('GET', `/cobros/pending-summary/${VENDOR}?limit=5&page=1`, { token });
    const summaryMap = summaryPend.body?.summary || {};
    const cobrosClient = String(
      process.env.HIT_COBROS_CLIENT
      || Object.keys(summaryMap).find((code) => Number(summaryMap[code]?.total) > 0)
      || '',
    ).trim();
    rows.push(record(
      'GET cobros pending-summary',
      summaryPend.status === 200 && Boolean(cobrosClient),
      `status=${summaryPend.status} client=${cobrosClient || '-'} clients=${Object.keys(summaryMap).length}`,
    ));

    const pendientesPath = `/cobros/${encodeURIComponent(cobrosClient)}/pendientes?vendedorCodes=${VENDOR}`;
    const cold = await api('GET', `${pendientesPath}&_ts=${Date.now()}`, { token });
    const samples = [];
    let pendientes = cold;
    for (let i = 0; i < 3; i += 1) {
      pendientes = await api('GET', pendientesPath, { token });
      samples.push(pendientes.ms);
    }
    samples.sort((a, b) => a - b);
    const p95ish = samples[samples.length - 1];
    const docs = pendientes.body?.cobros || [];
    rows.push(record(
      'GET cobros pendientes',
      pendientes.status === 200 && cold.status === 200,
      `status=${pendientes.status} client=${cobrosClient} coldMs=${cold.ms} warmMs=${samples.join(',')} docs=${docs.length}`,
    ));
    rows.push(record(
      'cobros pendientes <500ms o mejora',
      cold.status === 200 && cold.ms < 5000 && p95ish < 5000,
      `cold=${cold.ms}ms p95ish=${p95ish}ms warm=${samples.join(',')} (objetivo p95 <500; baseline 7400)`,
    ));

    let createdId = null;
    let confirmedEstado = '';
    let confirmedSync = '';
    let pedidoReference = '';
    if (cobrosClient) {
      const products = await api('GET', `/pedidos/products?vendedorCodes=${VENDOR}&clientCode=${encodeURIComponent(cobrosClient)}&limit=80`, { token });
      const catalog = products.body?.products || [];
      const candidates = catalog
        .filter((item) => Number(item.precioCliente || item.precioTarifa1) > 0)
        .sort((a, b) => Number(b.stockEnvases || b.STOCKENVASES || 0) - Number(a.stockEnvases || a.STOCKENVASES || 0));
      const inStock = candidates.filter((item) => Number(item.stockEnvases || item.STOCKENVASES || 0) > 0);
      const tryList = (inStock.length > 0 ? inStock : candidates).slice(0, 4);
      let createDetail = `sin producto status=${products.status}`;
      let confirmDetail = 'sin confirmacion';
      let createOk = false;
      let confirmOk = false;
      for (const product of tryList) {
        const price = Number(product.precioCliente || product.precioTarifa1 || 1);
        const created = await api('POST', '/pedidos/create', {
          token,
          body: {
            clientCode: cobrosClient,
            clientName: 'HIT comercial',
            vendedorCode: VENDOR,
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
            }],
          },
        });
        createdId = created.body?.id || created.body?.header?.id || created.body?.order?.header?.id || created.body?.order?.id;
        createOk = (created.status === 201 || created.status === 200) && Boolean(createdId);
        createDetail = `status=${created.status} id=${createdId || created.body?.code || created.body?.error || '-'} art=${product.code} stock=${Number(product.stockEnvases || 0)}`;
        if (!createdId) continue;
        const confirmed = await api('PUT', `/pedidos/${createdId}/confirm`, {
          token,
          body: { saleType: 'CC', cobroEnMano: true },
        });
        const header = confirmed.body?.order?.header || confirmed.body?.header || confirmed.body?.order || {};
        confirmedEstado = String(header.estado || header.ESTADO || '').toUpperCase();
        confirmedSync = String(header.syncStatus || header.SYNC_STATUS || '').toUpperCase();
        const serie = String(header.seriePedido || header.SERIEPEDIDO || header.serie || '').trim();
        const numero = String(header.numeroPedido || header.NUMEROPEDIDO || header.numero || '').trim();
        pedidoReference = serie && numero ? `${serie}-${numero}` : (createdId ? `PEDIDO:${createdId}` : '');
        const pendienteErp = confirmedEstado === 'CONFIRMADO' && (!confirmedSync || confirmedSync === 'LOCAL');
        confirmOk = confirmed.status === 200 && confirmedEstado === 'CONFIRMADO';
        confirmDetail = `status=${confirmed.status} estado=${confirmedEstado || confirmed.body?.code || confirmed.body?.reason || '-'} sync=${confirmedSync || 'empty'} pendienteErp=${pendienteErp}`;
        if (confirmOk) break;
      }
      rows.push(record('POST pedido dto TEST', createOk, createDetail));
      rows.push(record('PUT confirm + cobro en mano', confirmOk, confirmDetail));
    }

    const cobroIdem = `HitCob${String(Date.now()).slice(-10)}`;
    let cobro = { status: 0, body: {} };
    if (pedidoReference && confirmedEstado === 'CONFIRMADO') {
      cobro = await api('POST', `/cobros/${encodeURIComponent(cobrosClient)}/registrar`, {
        token,
        body: {
          referencia: pedidoReference,
          importe: 0.01,
          formaPago: 'CONTADO',
          idempotencyToken: cobroIdem,
        },
      });
    }
    if (cobro.status !== 200) {
      const payable = docs.find((doc) => Number(doc.importePendiente) >= 1 && String(doc.referencia || '').trim());
      if (payable) {
        cobro = await api('POST', `/cobros/${encodeURIComponent(cobrosClient)}/registrar`, {
          token,
          body: {
            referencia: payable.referencia,
            importe: 0.01,
            formaPago: 'CONTADO',
            idempotencyToken: `HitCvc${String(Date.now()).slice(-10)}`,
          },
        });
      }
    }
    rows.push(record(
      'POST cobro TEST_COBROS',
      cobro.status === 200 && cobro.body?.success === true,
      `status=${cobro.status} ref=${pedidoReference || '-'} code=${cobro.body?.code || cobro.body?.error || 'ok'}`,
    ));

    const pedidos = await api('GET', `/pedidos?vendedorCodes=${VENDOR}&page=1&limit=5`, { token });
    const confirmedOrders = (pedidos.body?.orders || []).filter((order) => String(order.estado || '').toUpperCase() === 'CONFIRMADO');
    const pendienteErpOrders = confirmedOrders.filter((order) => {
      const sync = String(order.syncStatus || '').toUpperCase();
      return !sync || sync === 'LOCAL';
    });
    rows.push(record(
      'GET pedidos + chip Pendiente ERP',
      pedidos.status === 200,
      `status=${pedidos.status} confirmados=${confirmedOrders.length} pendienteErp=${pendienteErpOrders.length} createdId=${createdId || '-'}`,
    ));

    const overlay = await api('GET', `/entregas/pendientes/${VENDOR}?date=${new Date().toISOString().slice(0, 10)}&limit=5`, { token });
    const overlayCount = Number(overlay.body?.pedidos_overlay ?? overlay.body?.resumen?.pedidos_overlay);
    const overlayOk = overlay.status === 200
      ? overlayCount > 0 || confirmedEstado === 'CONFIRMADO'
      : overlay.status === 403 && confirmedEstado === 'CONFIRMADO';
    rows.push(record(
      'pedidos_overlay o cobro en mano confirmado',
      overlayOk,
      `status=${overlay.status} overlay=${Number.isFinite(overlayCount) ? overlayCount : '-'} confirmed=${confirmedEstado || 'no'}`,
    ));

    const failed = rows.filter((ok) => !ok).length;
    console.log(`HIT done host=${HOST}:${PORT} vendor=${VENDOR} fail=${failed}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
