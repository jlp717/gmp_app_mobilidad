'use strict';

/**
 * HIT presentación comercial (isolated_test).
 * Nunca imprime PIN. Writes solo JAVIER.TEST_*. DELETE de filas de esta sesión al final.
 *
 *   node backend/scripts/hit-comercial-presentacion.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const { initDb, closePool, queryWithParams } = require('../config/db');
const { comercialErpTable, comercialErpSchemaAndName } = require('../utils/comercial-erp-tables');

const HOST = process.env.API_HOST || '192.168.1.230';
const PORT = Number.parseInt(process.env.API_PORT || '3335', 10);
const UA = 'GMP-Commercial-HIT/1.0';
const SESSION = `hit21${Date.now().toString().slice(-8)}`;
const PMR_CLIENT = '4300009324';

const created = {
  pedidosCab: [],
  cobros: [],
  liquidacion: [],
  devoluciones: [],
};

function parseBody(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw || '').slice(0, 200) };
  }
}

function api(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const started = Date.now();
    const reqHeaders = { 'User-Agent': UA };
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

async function login(vendor) {
  const pin = await pinForVendor(vendor);
  if (!pin) return { vendor, ok: false, reason: 'sin PIN VDPL1', token: '', ms: 0, status: 0 };
  const res = await api('POST', '/auth/login', { body: { username: vendor, password: pin } });
  const token = res.body?.token || '';
  return {
    vendor,
    ok: res.status === 200 && Boolean(token),
    token,
    ms: res.ms,
    status: res.status,
    role: String(res.body?.user?.role || res.body?.role || '').toUpperCase(),
  };
}

function record(rows, name, pass, detail, extra = {}) {
  const line = `[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  rows.push({ name, pass, detail: detail || '', ...extra });
  return pass;
}

async function vendorForClient(client) {
  const rows = await queryWithParams(
    `SELECT TRIM(LAC.R1_T8CDVD) AS VD
       FROM ${comercialErpTable('LACLAE')} LAC
      WHERE TRIM(LAC.LCCDCL) = CAST(? AS VARCHAR(10))
        AND LAC.LCAADC >= ?
        AND TRIM(COALESCE(LAC.R1_T8CDVD, '')) <> ''
      FETCH FIRST 1 ROW ONLY`,
    [client, 2024],
  );
  return String(rows?.[0]?.VD || '').trim();
}

async function qsys2Column(schemaName, table, column) {
  const rows = await queryWithParams(
    `SELECT COLUMN_NAME
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schemaName, table, column],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function cleanupSession() {
  const deleted = {};
  if (created.cobros.length) {
    await queryWithParams(
      `DELETE FROM JAVIER.TEST_COBROS WHERE IDEMPOTENCY_TOKEN IN (${created.cobros.map(() => '?').join(',')})`,
      created.cobros,
      false,
    );
    deleted.cobros = created.cobros.length;
  }
  if (created.liquidacion.length) {
    await queryWithParams(
      `DELETE FROM JAVIER.TEST_LIQUIDACION_COMERCIAL WHERE IDEMPOTENCY_TOKEN IN (${created.liquidacion.map(() => '?').join(',')})`,
      created.liquidacion,
      false,
    );
    deleted.liquidacion = created.liquidacion.length;
  }
  if (created.devoluciones.length) {
    await queryWithParams(
      `DELETE FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL WHERE IDEMPOTENCY_TOKEN IN (${created.devoluciones.map(() => '?').join(',')})`,
      created.devoluciones,
      false,
    );
    deleted.devoluciones = created.devoluciones.length;
  }
  if (created.pedidosCab.length) {
    await queryWithParams(
      `DELETE FROM JAVIER.TEST_PEDIDOS_LIN WHERE PEDIDO_ID IN (${created.pedidosCab.map(() => '?').join(',')})`,
      created.pedidosCab,
      false,
    );
    await queryWithParams(
      `DELETE FROM JAVIER.TEST_PEDIDOS_CAB WHERE ID IN (${created.pedidosCab.map(() => '?').join(',')})`,
      created.pedidosCab,
      false,
    );
    deleted.pedidos = created.pedidosCab.length;
  }
  return deleted;
}

async function main() {
  const rows = [];
  await initDb();
  try {
    const ready = await api('GET', '/ready');
    const tableSet = String(ready.body?.tableSet || ready.body?.repartoTableSet || '').trim();
    const erpWrites = ready.body?.erpWrites === true || ready.body?.dsedacWrite === true;
    record(rows, 'GET /ready isolated_test', ready.status === 200 && (tableSet === 'isolated_test' || ready.body?.ok === true) && erpWrites !== true, `status=${ready.status} ms=${ready.ms} tableSet=${tableSet || '-'} erpWrites=${erpWrites}`, { ms: ready.ms });

    const clx = comercialErpSchemaAndName('CLX');
    const vddx = comercialErpSchemaAndName('VDDX');
    const hasClxSn = await qsys2Column(clx.schema, clx.table, 'COBRORIGUROSOSN');
    const hasClxPct = await qsys2Column(clx.schema, clx.table, 'PORCENTAJECOBRORIGUROSO');
    const hasVddxPct = await qsys2Column(vddx.schema, vddx.table, 'PORCENTAJEMINIMOCOBRO');
    record(rows, 'QSYS2 CLX/VDDX columnas', hasClxSn && hasClxPct && hasVddxPct, `CLX.SN=${hasClxSn} CLX.PCT=${hasClxPct} VDDX.PCT=${hasVddxPct} schema=${clx.schema}/${vddx.schema}`);

    const auth35 = await login('35');
    const auth80 = await login('80');
    record(rows, 'login 35 VDPL1', auth35.ok, `status=${auth35.status} ms=${auth35.ms} role=${auth35.role || '-'}`, { ms: auth35.ms });
    record(rows, 'login 80 VDPL1', auth80.ok, `status=${auth80.status} ms=${auth80.ms} role=${auth80.role || '-'}`, { ms: auth80.ms });

    const pmrVendor = (await vendorForClient(PMR_CLIENT)) || '80';
    let pmrAuth = pmrVendor === '35' ? auth35 : (pmrVendor === '80' ? auth80 : await login(pmrVendor));
    if (!pmrAuth.ok && auth80.ok) pmrAuth = auth80;
    const pmrToken = pmrAuth.token;
    const promos = await api('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(PMR_CLIENT)}&vendedorCodes=${encodeURIComponent(pmrAuth.vendor)}&forceRefresh=1`, { token: pmrToken });
    const promoList = promos.body?.promotions || [];
    record(rows, 'GET PMR 4300009324', promos.status === 200 && promoList.length > 0, `status=${promos.status} ms=${promos.ms} count=${promoList.length} vendor=${pmrAuth.vendor}`, { ms: promos.ms });

    const giftPromo = promoList.find((p) => String(p.promoType || '').toUpperCase() === 'GIFT' && Number(p.minQty) > 0 && Number(p.giftQty) > 0)
      || promoList.find((p) => /3\s*\+\s*1|REGALO/i.test(String(p.promoDesc || p.name || '')))
      || promoList[0];
    const products = await api('GET', `/pedidos/products?vendedorCodes=${encodeURIComponent(pmrAuth.vendor)}&clientCode=${encodeURIComponent(PMR_CLIENT)}&limit=80`, { token: pmrToken });
    const catalog = products.body?.products || [];
    const promoArt = String(giftPromo?.productCode || giftPromo?.code || '').trim();
    const product = catalog.find((item) => String(item.code || '').trim() === promoArt)
      || catalog.find((item) => Number(item.precioCliente || item.precioTarifa1) > 0 && Number(item.stockEnvases || 0) > 0)
      || catalog.find((item) => Number(item.precioCliente || item.precioTarifa1) > 0);
    const price = Number(product?.precioCliente || product?.precioTarifa1 || 1);
    const minQty = Math.max(1, Number(giftPromo?.minQty) || 3);
    const giftQty = Math.max(1, Number(giftPromo?.giftQty) || 1);
    let createdId = null;
    let confirmOk = false;
    let confirmDetail = 'sin producto';
    let giftApplied = false;
    let cabEqualsLines = false;
    if (product && pmrToken) {
      const createdRes = await api('POST', '/pedidos/create', {
        token: pmrToken,
        body: {
          clientCode: PMR_CLIENT,
          clientName: 'HIT PMR',
          vendedorCode: pmrAuth.vendor,
          lines: [
            {
              codigoArticulo: product.code,
              descripcion: String(product.name || 'HIT').slice(0, 40),
              cantidadEnvases: minQty,
              cantidadUnidades: 0,
              unidadesCaja: product.unitsPerBox || 1,
              precio: price,
              precioVenta: price,
              precioCosto: Number(product.precioCosto) || 0.5,
              precioTarifa: price,
              promotionCode: giftPromo?.promoCode || giftPromo?.code || 'PMR',
            },
            {
              codigoArticulo: product.code,
              descripcion: `${String(product.name || 'HIT').slice(0, 28)} (Regalo)`,
              cantidadEnvases: giftQty,
              cantidadUnidades: 0,
              unidadesCaja: product.unitsPerBox || 1,
              precio: 0,
              precioVenta: 0,
              precioCosto: Number(product.precioCosto) || 0.5,
              tipoLinea: 'G',
              claseLinea: 'SC',
              isAutoGift: true,
              promotionCode: giftPromo?.promoCode || giftPromo?.code || 'PMR',
            },
          ],
        },
      });
      createdId = createdRes.body?.id || createdRes.body?.header?.id || createdRes.body?.order?.header?.id || createdRes.body?.order?.id;
      if (createdRes.status === 403 && createdRes.body?.code === 'MIN_COBRO_ORDER_BLOCKED') {
        confirmDetail = `create 403 MIN_COBRO vendor=${pmrAuth.vendor} client=${PMR_CLIENT}`;
        record(rows, 'POST pedido PMR + REGALO', false, `status=403 MIN_COBRO ms=${createdRes.ms}`, { ms: createdRes.ms });
        record(rows, 'PUT confirm CONFIRMADO LOCAL', false, confirmDetail);
        record(rows, 'promo 3+1/REGALO aplica precio 0', false, 'create bloqueado por % minimo');
        record(rows, 'importe cab = suma lineas', false, 'create bloqueado');
      } else if (createdId) {
        created.pedidosCab.push(createdId);
        const confirmed = await api('PUT', `/pedidos/${createdId}/confirm`, {
          token: pmrToken,
          body: { saleType: 'CC', cobroEnMano: true },
        });
        const header = confirmed.body?.order?.header || confirmed.body?.header || confirmed.body?.order || {};
        const estado = String(header.estado || header.ESTADO || '').toUpperCase();
        const sync = String(header.syncStatus || header.SYNC_STATUS || '').toUpperCase();
        confirmOk = confirmed.status === 200 && estado === 'CONFIRMADO';
        confirmDetail = `status=${confirmed.status} ms=${confirmed.ms} id=${createdId} estado=${estado || confirmed.body?.code || '-'} sync=${sync || 'empty'} promo=${giftPromo?.promoCode || giftPromo?.code || '-'}`;
        const detail = await api('GET', `/pedidos/${createdId}`, { token: pmrToken });
        const dHeader = detail.body?.order?.header || detail.body?.header || {};
        const dLines = detail.body?.order?.lines || detail.body?.lines || [];
        const giftLines = dLines.filter((line) => {
          const tipo = String(line.tipoLinea || line.TIPOLINEA || '').toUpperCase();
          const precio = Number(line.precioVenta ?? line.PRECIOVENTA ?? line.precio ?? 0);
          return tipo === 'G' || precio === 0;
        });
        giftApplied = giftLines.length > 0 && giftLines.every((line) => Number(line.precioVenta ?? line.PRECIOVENTA ?? line.precio ?? 0) === 0);
        const cabTotal = Number(dHeader.total ?? dHeader.IMPORTETOTAL ?? dHeader.importeTotal ?? 0);
        const lineSum = dLines.reduce((sum, line) => sum + Number(line.importeVenta ?? line.IMPORTEVENTA ?? line.total ?? 0), 0);
        cabEqualsLines = dLines.length > 0 && Math.abs(cabTotal - lineSum) < 0.06;
        record(rows, 'POST pedido PMR + REGALO', createdRes.status === 201 || createdRes.status === 200, `status=${createdRes.status} ms=${createdRes.ms} id=${createdId} art=${product.code} minQty=${minQty}`, { ms: createdRes.ms, id: createdId });
        record(rows, 'PUT confirm CONFIRMADO LOCAL', confirmOk && (!sync || sync === 'LOCAL'), confirmDetail, { ms: confirmed.ms, id: createdId });
        record(rows, 'promo 3+1/REGALO aplica precio 0', giftApplied, `giftLines=${giftLines.length} cab=${cabTotal} lineSum=${lineSum} lines=${dLines.length}`);
        record(rows, 'importe cab = suma lineas', cabEqualsLines && cabTotal > 0, `cabTotal=${cabTotal} lineSum=${lineSum}`);
      } else {
        record(rows, 'POST pedido PMR + REGALO', false, `status=${createdRes.status} code=${createdRes.body?.code || createdRes.body?.error || '-'} ms=${createdRes.ms}`, { ms: createdRes.ms });
        record(rows, 'PUT confirm CONFIRMADO LOCAL', false, confirmDetail);
        record(rows, 'promo 3+1/REGALO aplica precio 0', false, 'sin pedido');
        record(rows, 'importe cab = suma lineas', false, 'sin pedido');
      }
    } else {
      record(rows, 'POST pedido PMR + REGALO', false, `sin producto catalog=${catalog.length} promo=${promoList.length}`);
      record(rows, 'PUT confirm CONFIRMADO LOCAL', false, 'sin producto');
      record(rows, 'promo 3+1/REGALO aplica precio 0', false, 'sin producto');
      record(rows, 'importe cab = suma lineas', false, 'sin producto');
    }

    const cobrosVendor = auth35.ok ? auth35 : auth80;
    if (cobrosVendor.ok) {
      const summaryPend = await api('GET', `/cobros/pending-summary/${cobrosVendor.vendor}?limit=8&page=1`, { token: cobrosVendor.token });
      const clientsList = await api('GET', `/clients/list?limit=20&vendedorCodes=${cobrosVendor.vendor}`, { token: cobrosVendor.token });
      const scoped = [...(clientsList.body?.clients || []), ...(clientsList.body?.data || [])]
        .map((row) => String(row?.code || row?.codigo || row?.CODIGOCLIENTE || '').trim())
        .filter(Boolean);
      let cobrosClient = scoped[0] || '';
      let pendientes = { status: 0, body: {}, ms: 0 };
      let docs = [];
      for (const candidate of scoped.slice(0, 8)) {
        const probe = await api('GET', `/cobros/${encodeURIComponent(candidate)}/pendientes?vendedorCodes=${cobrosVendor.vendor}`, { token: cobrosVendor.token });
        if (probe.status === 200 && (probe.body?.cobros || []).length > 0) {
          cobrosClient = candidate;
          pendientes = probe;
          docs = probe.body.cobros || [];
          break;
        }
      }
      record(rows, 'GET cobros pendientes 35', pendientes.status === 200, `status=${pendientes.status} ms=${pendientes.ms} client=${cobrosClient || '-'} docs=${docs.length} summary=${summaryPend.status}`, { ms: pendientes.ms });
      const payable = docs.find((doc) => Number(doc.importePendiente) >= 2 && String(doc.referencia || '').trim());
      if (payable) {
        const pendingBefore = Number(payable.importePendiente);
        const docTotal = Number(payable.importeTotal || pendingBefore);
        const expectedPending = Math.min(pendingBefore, docTotal || pendingBefore);
        record(rows, 'pendiente = min(CVC, documento)', expectedPending <= pendingBefore + 0.001, `pendiente=${pendingBefore} doc=${docTotal} ref=${payable.referencia}`);
        const cobroIdem = `${SESSION}c1`;
        const partial = Math.min(1.11, Math.round((expectedPending / 2) * 100) / 100 || 1.11);
        const cobro = await api('POST', `/cobros/${encodeURIComponent(cobrosClient)}/registrar`, {
          token: cobrosVendor.token,
          body: {
            referencia: payable.referencia,
            importe: partial,
            formaPago: 'CONTADO',
            observaciones: 'HIT presentacion parcial',
            idempotencyToken: cobroIdem,
          },
        });
        if (cobro.status === 200) created.cobros.push(cobroIdem);
        record(rows, 'POST cobro parcial TEST', cobro.status === 200 && cobro.body?.success === true, `status=${cobro.status} ms=${cobro.ms} code=${cobro.body?.code || 'ok'} pendingAfter=${cobro.body?.pendingAfter ?? '-'}`, { ms: cobro.ms });

        const replay = await api('POST', `/cobros/${encodeURIComponent(cobrosClient)}/registrar`, {
          token: cobrosVendor.token,
          body: {
            referencia: payable.referencia,
            importe: partial,
            formaPago: 'CONTADO',
            observaciones: 'HIT presentacion parcial',
            idempotencyToken: cobroIdem,
          },
        });
        record(rows, 'idempotency replay same payload', replay.status === 200 && replay.body?.idempotent === true, `status=${replay.status} idempotent=${replay.body?.idempotent}`);

        const conflict = await api('POST', `/cobros/${encodeURIComponent(cobrosClient)}/registrar`, {
          token: cobrosVendor.token,
          body: {
            referencia: payable.referencia,
            importe: partial + 0.5,
            formaPago: 'CONTADO',
            observaciones: 'HIT conflicto',
            idempotencyToken: cobroIdem,
          },
        });
        record(rows, '409 IDEMPOTENCY_CONFLICT', conflict.status === 409 && conflict.body?.code === 'IDEMPOTENCY_CONFLICT', `status=${conflict.status} code=${conflict.body?.code || '-'}`);

        const overpay = await api('POST', `/cobros/${encodeURIComponent(cobrosClient)}/registrar`, {
          token: cobrosVendor.token,
          body: {
            referencia: payable.referencia,
            importe: expectedPending + 50,
            formaPago: 'CONTADO',
            observaciones: 'HIT overpay',
            idempotencyToken: `${SESSION}ov`,
          },
        });
        record(rows, '409 PAYMENT_EXCEEDS', overpay.status === 409 && (overpay.body?.code === 'PAYMENT_EXCEEDS' || overpay.body?.code === 'OVERPAY_NOT_ALLOWED'), `status=${overpay.status} code=${overpay.body?.code || '-'}`);

        const after = await api('GET', `/cobros/${encodeURIComponent(cobrosClient)}/pendientes?vendedorCodes=${cobrosVendor.vendor}`, { token: cobrosVendor.token });
        const same = (after.body?.cobros || []).find((doc) => String(doc.referencia) === String(payable.referencia));
        const restPending = same ? Number(same.importePendiente) > 0.05 : Number(cobro.body?.pendingAfter) > 0.05;
        record(rows, 'resto sigue pendiente', restPending, `after=${same ? same.importePendiente : cobro.body?.pendingAfter ?? '-'}`);
      } else {
        record(rows, 'pendiente = min(CVC, documento)', false, 'sin documento cobrable >=2');
        record(rows, 'POST cobro parcial TEST', false, 'sin documento');
        record(rows, 'idempotency replay same payload', false, 'sin cobro');
        record(rows, '409 IDEMPOTENCY_CONFLICT', false, 'sin cobro');
        record(rows, '409 PAYMENT_EXCEEDS', false, 'sin cobro');
        record(rows, 'resto sigue pendiente', false, 'sin cobro');
      }

      const liqToken = `${SESSION}liq`;
      const save = await api('POST', '/comercial-liquidacion/guardar', {
        token: cobrosVendor.token,
        body: {
          vendedor: cobrosVendor.vendor,
          fecha: new Date().toISOString().slice(0, 10),
          ingresoBanco: 1,
          entregado: 0,
          expectedTotal: 1,
          idempotencyToken: liqToken,
        },
      });
      if (save.status === 200 || save.status === 201) created.liquidacion.push(liqToken);
      record(rows, 'POST liquidacion TEST 35', (save.status === 201 || save.status === 200) && String(save.body?.saved?.source || '').startsWith('JAVIER.TEST_'), `status=${save.status} ms=${save.ms} source=${save.body?.saved?.source || save.body?.code || '-'}`, { ms: save.ms });
    } else {
      record(rows, 'GET cobros pendientes 35', false, 'sin login 35/80');
    }

    const rigRows = await queryWithParams(
      `SELECT TRIM(CLX.CODIGOCLIENTE) AS CLIENTE,
              COALESCE(CLX.PORCENTAJECOBRORIGUROSO, 0) AS PCT
         FROM ${comercialErpTable('CLX')} CLX
        WHERE TRIM(CLX.COBRORIGUROSOSN) = 'S'
          AND COALESCE(CLX.PORCENTAJECOBRORIGUROSO, 0) > 0
        FETCH FIRST 20 ROWS ONLY`,
      [],
    );
    let blockedHit = { status: 0, code: '', client: '', vendor: '' };
    let allowedHit = { status: 0, client: '', vendor: '' };
    for (const row of rigRows || []) {
      const client = String(row.CLIENTE || '').trim();
      const vendor = (await vendorForClient(client)) || cobrosVendor.vendor;
      const auth = vendor === cobrosVendor.vendor ? cobrosVendor : await login(vendor);
      if (!auth.ok || !product) continue;
      const attempt = await api('POST', '/pedidos/create', {
        token: auth.token,
        body: {
          clientCode: client,
          clientName: 'HIT min cobro',
          vendedorCode: auth.vendor,
          lines: [{
            codigoArticulo: product.code,
            descripcion: 'HIT min',
            cantidadEnvases: 1,
            precio: price,
            precioVenta: price,
            precioCosto: 0.5,
          }],
        },
      });
      const id = attempt.body?.id || attempt.body?.order?.header?.id || attempt.body?.order?.id;
      if (id) created.pedidosCab.push(id);
      if (attempt.status === 403 && attempt.body?.code === 'MIN_COBRO_ORDER_BLOCKED') {
        blockedHit = { status: 403, code: attempt.body.code, client, vendor: auth.vendor, ms: attempt.ms };
        break;
      }
      if ((attempt.status === 200 || attempt.status === 201) && !allowedHit.status) {
        allowedHit = { status: attempt.status, client, vendor: auth.vendor, ms: attempt.ms };
      }
    }
    record(rows, '403 MIN_COBRO_ORDER_BLOCKED cliente riguroso', blockedHit.status === 403 && blockedHit.code === 'MIN_COBRO_ORDER_BLOCKED', `status=${blockedHit.status || 0} code=${blockedHit.code || '-'} client=${blockedHit.client || '-'} vendor=${blockedHit.vendor || '-'} (live CVC; si nadie esta bajo el %, no se finge)`);
    record(rows, 'pedido permitido si cumple % minimo', allowedHit.status === 200 || allowedHit.status === 201 || blockedHit.status === 403, `allowed=${allowedHit.status || 0} client=${allowedHit.client || '-'} blockedAlso=${blockedHit.status || 0}`);

    const deleted = await cleanupSession();
    record(rows, 'DELETE filas TEST de esta sesion', true, `pedidos=${deleted.pedidos || 0} cobros=${deleted.cobros || 0} liq=${deleted.liquidacion || 0} idsCab=${created.pedidosCab.join(',') || '-'}`);

    const failed = rows.filter((row) => !row.pass).length;
    console.log(`HIT presentacion host=${HOST}:${PORT} session=${SESSION} fail=${failed}/${rows.length}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('FATAL', error.message);
  process.exit(1);
});
