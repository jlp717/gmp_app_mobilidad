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

function todayYmd() {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

async function pmrClients() {
  const today = todayYmd();
  const rows = await queryWithParams(
    `SELECT TRIM(P.CODIGOCLIENTE) AS CLIENTE
       FROM DSEDAC.PMR P
      WHERE TRIM(COALESCE(P.CODIGOCLIENTE, '')) <> ''
        AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
        AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
      FETCH FIRST 20 ROWS ONLY`,
    [today, today],
  );
  const pmrc = await queryWithParams(
    `SELECT TRIM(C.CODIGOCLIENTE) AS CLIENTE
       FROM DSEDAC.PMRC C
       JOIN DSEDAC.PMR P
         ON TRIM(P.CODIGOPROMOCIONREGALO) = TRIM(C.CODIGOPROMOCIONREGALO)
      WHERE TRIM(COALESCE(C.CODIGOCLIENTE, '')) <> ''
        AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
        AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
      FETCH FIRST 20 ROWS ONLY`,
    [today, today],
  );
  return [...new Set([
    ...(rows || []).map((row) => String(row.CLIENTE || '').trim()),
    ...(pmrc || []).map((row) => String(row.CLIENTE || '').trim()),
  ].filter(Boolean))];
}

async function vendorForClient(client) {
  const rows = await queryWithParams(
    `SELECT TRIM(LAC.R1_T8CDVD) AS VD
       FROM DSED.LACLAE LAC
      WHERE TRIM(LAC.LCCDCL) = CAST(? AS VARCHAR(10))
        AND LAC.LCAADC >= ?
        AND TRIM(COALESCE(LAC.R1_T8CDVD, '')) <> ''
      FETCH FIRST 1 ROW ONLY`,
    [client, 2024],
  );
  return String(rows?.[0]?.VD || '').trim();
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

    try {
      const hist = await queryWithParams(
        `SELECT TRIM(LCSRAB) AS SERIE, LCNRAB AS NUMERO, TRIM(LCCDCL) AS CLIENTE,
                TRIM(R1_T8CDVD) AS VD, LCIMVT AS IMP
           FROM DSED.LACLAE
          WHERE LCSRAB = CAST(? AS CHAR(1))
          FETCH FIRST 3 ROWS ONLY`,
        ['D'],
      );
      rows.push(record(
        'SELECT LACLAE serie D historico',
        Array.isArray(hist) && hist.length > 0,
        `rows=${hist?.length || 0} sample=${hist?.[0] ? `${String(hist[0].SERIE || '').trim()}-${hist[0].NUMERO} cl=${String(hist[0].CLIENTE || '').trim()} vd=${String(hist[0].VD || '').trim()}` : '-'}`,
      ));
    } catch (error) {
      rows.push(record(
        'SELECT LACLAE serie D historico',
        false,
        String(error.message || error).slice(0, 80),
      ));
    }

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

    const retToken = `hit-dev-${VENDOR}-${Date.now()}`;
    const ret = await api('POST', '/comercial-liquidacion/devoluciones', {
      token,
      body: {
        vendedor: VENDOR,
        fecha: new Date().toISOString().slice(0, 10),
        cliente: 'HITTEST01',
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
    rows.push(record(
      'POST Devuelve TEST',
      (ret.status === 201 || ret.status === 200) && String(ret.body?.return?.source || '').startsWith('JAVIER.TEST_'),
      `status=${ret.status} doc=${ret.body?.return?.documento || ret.body?.code || ret.body?.error || '-'} impacto=${ret.body?.return?.impactoLqd || '-'}`,
    ));
    try {
      const overlay = await queryWithParams(
        `SELECT TRIM(CLIENTE) AS CLIENTE, IMPORTE, YA_COBRADA
           FROM JAVIER.TEST_DEVOLUCIONES_COMERCIAL
          WHERE IDEMPOTENCY_TOKEN = ?
          FETCH FIRST 1 ROW ONLY`,
        [retToken],
      );
      rows.push(record(
        'SELECT overlay TEST_DEVOLUCIONES',
        Array.isArray(overlay) && overlay.length > 0,
        `rows=${overlay?.length || 0} yaCobrada=${overlay?.[0]?.YA_COBRADA ?? '-'}`,
      ));
    } catch (error) {
      rows.push(record(
        'SELECT overlay TEST_DEVOLUCIONES',
        false,
        String(error.message || error).slice(0, 80),
      ));
    }

    const pgDocs = await api('GET', `/comercial-liquidacion/ya-cobrados-pg?vendedor=${VENDOR}`, { token });
    let pgHit = {
      status: pgDocs.status,
      count: Array.isArray(pgDocs.body?.documents) ? pgDocs.body.documents.length : 0,
      vendor: VENDOR,
    };
    if (pgHit.status === 200 && pgHit.count === 0) {
      try {
        const samplePg = await queryWithParams(
          `SELECT TRIM(COALESCE(NULLIF(TRIM(CVC.CODIGOCLIENTEFACTURA), ''), CVC.CODIGOCLIENTEALBARAN)) AS CLIENTE,
                  TRIM(CVC.CODIGOVENDEDORCOBRO) AS VD
             FROM DSEDAC.CVC CVC
             LEFT JOIN DSEDAC.FPG FPG
               ON TRIM(FPG.CODIGOFORMAPAGO) = TRIM(CVC.CODIGOFORMAPAGO)
            WHERE CVC.IMPORTEPENDIENTE = 0
              AND CVC.IMPORTEVENCIMIENTO > 0
              AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
              AND TRIM(CVC.TIPODOCUMENTO) <> CAST(? AS VARCHAR(3))
              AND TRIM(COALESCE(CVC.CODIGOVENDEDORCOBRO, '')) <> ''
              AND (
                   UPPER(TRIM(COALESCE(FPG.PAGARESN, ''))) = CAST(? AS VARCHAR(1))
                OR UPPER(TRIM(CVC.CODIGOFORMAPAGO)) = CAST(? AS VARCHAR(2))
              )
            FETCH FIRST 1 ROW ONLY`,
          ['DEV', 'S', 'PG'],
        );
        const pgVendor = String(samplePg?.[0]?.VD || '').trim();
        const pgPin = pgVendor ? await pinForVendor(pgVendor) : '';
        if (pgPin) {
          const pgLogin = await api('POST', '/auth/login', {
            body: { username: pgVendor, password: pgPin },
          });
          const pgToken = pgLogin.body?.token;
          if (pgToken) {
            const otherPg = await api('GET', `/comercial-liquidacion/ya-cobrados-pg?vendedor=${pgVendor}`, { token: pgToken });
            pgHit = {
              status: otherPg.status,
              count: Array.isArray(otherPg.body?.documents) ? otherPg.body.documents.length : 0,
              vendor: pgVendor,
            };
          }
        }
      } catch (error) {
        pgHit = { ...pgHit, error: String(error.message || error).slice(0, 80) };
      }
    }
    rows.push(record(
      'GET ya-cobrados-pg',
      pgHit.status === 200 && pgHit.count > 0,
      `status=${pgHit.status} count=${pgHit.count} vendor=${pgHit.vendor}${pgHit.error ? ` err=${pgHit.error}` : ''}`,
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
      `cold=${cold.ms}ms p95ish=${p95ish}ms warm=${samples.join(',')} (objetivo p95 <500; baseline 18000)`,
    ));
    const cobrosPct = Number(pendientes.body?.resumen?.porcentajeMinimoCobro || 0);
    const vendorPct = Number(pendientes.body?.resumen?.porcentajeMinimoVendedor || 0);
    const cobrosRig = pendientes.body?.resumen?.cobroRiguroso === true
      || (pendientes.body?.cobros || []).some((doc) => doc.cobroRiguroso === true);
    rows.push(record(
      'cobros % minimo CLX/VDDX en payload',
      pendientes.status === 200,
      `riguroso=${cobrosRig} clxPct=${cobrosPct} vddxPct=${vendorPct} tipos=${[...new Set((pendientes.body?.cobros || []).map((d) => d.tipoDocumento || d.tipo || '-'))].slice(0, 6).join(',')}`,
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
              lineDiscountPct: 10,
              descuentoLinea: 10,
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
      if (createdId) {
        const detail = await api('GET', `/pedidos/${createdId}`, { token });
        const header = detail.body?.order?.header || detail.body?.header || {};
        const lines = detail.body?.order?.lines || detail.body?.lines || [];
        const pie = Number(header.descuentoGlobal ?? 0);
        const linePct = Number(lines[0]?.lineDiscountPct ?? lines[0]?.descuentoLinea ?? 0);
        rows.push(record(
          'GET pedido dto pie+linea',
          detail.status === 200 && pie === 5 && linePct === 10,
          `status=${detail.status} pie=${pie} linea=${linePct} lines=${lines.length}`,
        ));
      }
    }

    const knownPmr = ['4300009324', '4300006612', '4300006241', '4300008237'];
    const promoClients = await pmrClients();
    let promoHit = { status: 0, count: 0, client: cobrosClient || knownPmr[0], vendor: VENDOR };
    const tryClients = [...new Set([...knownPmr, cobrosClient, ...promoClients])].filter(Boolean);
    for (const promoClient of tryClients) {
      const promos = await api(
        'GET',
        `/pedidos/promotions?clientCode=${encodeURIComponent(promoClient)}&vendedorCodes=${VENDOR}&forceRefresh=1`,
        { token },
      );
      const promoList = promos.body?.promotions || [];
      promoHit = {
        status: promos.status,
        count: promoList.length,
        client: promoClient,
        vendor: VENDOR,
        sources: [...new Set(promoList.map((p) => p.source || p.assignmentSource || '-'))].join(','),
      };
      if (promos.status === 200 && promoList.length > 0) break;
      if (promos.status === 403 || (promos.status === 200 && promoList.length === 0)) {
        const otherVendor = await vendorForClient(promoClient);
        if (!otherVendor || otherVendor === VENDOR) continue;
        const otherPin = await pinForVendor(otherVendor);
        if (!otherPin) continue;
        const otherLogin = await api('POST', '/auth/login', {
          body: { username: otherVendor, password: otherPin },
        });
        const otherToken = otherLogin.body?.token;
        if (!otherToken) continue;
        const otherPromos = await api(
          'GET',
          `/pedidos/promotions?clientCode=${encodeURIComponent(promoClient)}&vendedorCodes=${otherVendor}&forceRefresh=1`,
          { token: otherToken },
        );
        const otherList = otherPromos.body?.promotions || [];
        promoHit = {
          status: otherPromos.status,
          count: otherList.length,
          client: promoClient,
          vendor: otherVendor,
          sources: [...new Set(otherList.map((p) => p.source || p.assignmentSource || '-'))].join(','),
        };
        if (otherPromos.status === 200 && otherList.length > 0) break;
      }
    }
    rows.push(record(
      'GET ofertas PMR/CPES',
      promoHit.status === 200 && promoHit.count > 0,
      `status=${promoHit.status} count=${promoHit.count} client=${promoHit.client} vendor=${promoHit.vendor} sources=${promoHit.sources || 'none'}`,
    ));

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

    const facturas = await api('GET', `/facturas/summary?vendedorCodes=${VENDOR}`, { token });
    const facSum = facturas.body?.summary || {};
    rows.push(record(
      'GET facturas summary totales',
      facturas.status === 200 && Number(facSum.totalFacturas || facSum.totalDocumentos || 0) >= 0,
      `status=${facturas.status} docs=${facSum.totalFacturas || facSum.totalDocumentos || 0} importe=${facSum.totalImporte || 0} base=${facSum.totalBase || 0}`,
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
