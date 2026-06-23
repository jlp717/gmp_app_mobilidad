'use strict';

require('dotenv').config();

const http = require('http');
const { queryWithParams } = require('../config/db');

const UA = 'GMP-App/CertProbe';
const PORT = parseInt(process.env.API_PORT || '3335', 10);
const HOST = process.env.API_HOST || '127.0.0.1';
const USERNAME = process.env.CERT_USERNAME || 'diego';
const PASSWORD = process.env.CERT_PASSWORD || '9322';
const TARGET = String(process.env.CERT_TARGET || 'JAVIER').trim().toUpperCase();
const COUNT = Math.max(1, Math.min(parseInt(process.env.CERT_ORDER_COUNT || '1', 10) || 1, 50));
const CONCURRENCY = Math.max(1, Math.min(parseInt(process.env.CERT_CONCURRENCY || String(COUNT), 10) || COUNT, COUNT));
const VENDOR_CODE = String(process.env.CERT_VENDOR_CODE || '02').trim();
const CLIENT_CODE = String(process.env.CERT_CLIENT_CODE || '4300007781').trim();
const CONFIRM_ORDERS = String(process.env.CERT_CONFIRM_ORDERS || 'true').trim().toLowerCase() !== 'false';

function assertSafeTarget() {
  const writeSchema = String(process.env.DB2_WRITE_SCHEMA || process.env.PEDIDOS_CONFIRMATION_SCHEMA || 'JAVIER')
    .trim()
    .toUpperCase();
  const exportToSystem = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false').trim().toLowerCase() === 'true';
  const allowDsedac = String(process.env.CERT_ALLOW_DSEDAC_WRITES || 'false').trim().toLowerCase() === 'true';
  if (TARGET !== 'DSEDAC' && (writeSchema === 'DSEDAC' || exportToSystem)) {
    throw new Error(`Unsafe cert target: TARGET=${TARGET} writeSchema=${writeSchema} exportToSystem=${exportToSystem}`);
  }
  if (TARGET === 'DSEDAC' && !allowDsedac) {
    throw new Error('DSEDAC cert writes require CERT_ALLOW_DSEDAC_WRITES=true');
  }
}

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const t0 = Date.now();
    const req = http.request({ hostname: HOST, port: PORT, path: `/api${path}`, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(raw || '{}'); } catch { parsed = { raw: raw.slice(0, 500) }; }
        resolve({ status: res.statusCode, body: parsed, ms: Date.now() - t0 });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function record(out, id, name, pass, detail, ms) {
  out.tests.push({ id, name, pass, detail, ms });
}

function uniqueKey(index) {
  const stamp = Date.now().toString(36).toUpperCase();
  return `C${stamp}${String(index).padStart(2, '0')}`.slice(0, 28);
}

function pickProduct(products) {
  return products.find((p) => Number(p.stockEnvases ?? p.envases ?? p.stock ?? 0) > 0 && Number(p.precioCliente || p.precioTarifaCliente || p.precioTarifa1 || p.price || 0) > 0)
    || products.find((p) => Number(p.precioCliente || p.precioTarifaCliente || p.precioTarifa1 || p.price || 0) > 0)
    || products[0];
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function orderIdFromCreate(body) {
  return body?.order?.header?.id ?? body?.order?.id ?? body?.order?.pedidoId ?? body?.id ?? null;
}

function productCode(product) {
  return String(product?.code || product?.codigoArticulo || product?.CODIGOARTICULO || '').trim();
}

function productName(product) {
  return String(product?.name || product?.descripcion || product?.DESCRIPCION || productCode(product)).trim();
}

function productPrice(product) {
  return Number(product?.precioCliente || product?.precioTarifaCliente || product?.precioTarifa1 || product?.price || 1);
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

function formatDate(row) {
  const day = String(Number(row.DIADOCUMENTO || 0)).padStart(2, '0');
  const month = String(Number(row.MESDOCUMENTO || 0)).padStart(2, '0');
  const year = String(Number(row.ANODOCUMENTO || row.EJERCICIOPEDIDO || 0));
  return `${day}-${month}-${year}`;
}

function formatPedido(row) {
  const serie = String(row.SERIEPEDIDO || '').trim() || 'P';
  const terminal = String(Number(row.TERMINALPEDIDO || 0)).padStart(3, '0');
  const numero = String(Number(row.NUMEROPEDIDO || 0)).padStart(6, '0');
  return `${serie}-${terminal}-${numero}`;
}

function paymentLabel(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (normalized === '02' || normalized === 'RE') return 'REPOSICION';
  return normalized || 'REPOSICION';
}

function routeLabel(code) {
  const normalized = String(code || '').trim();
  return normalized || 'SIN RUTA ASIGNADA';
}

function toTsv(rows) {
  const headers = [
    'Ejercicio pedido',
    'Pedido',
    'Fecha documento',
    'Codigo cliente',
    'Nombre cliente',
    'Nombre comercial',
    'Localizacion',
    'Importe total',
    'Observaciones',
    'Forma de pago',
    'Ruta',
    'Codigo usuario',
    'Codigo vendedor',
    'Codigo vendedor cobro',
    'Codigo promotor / Preventa',
    'Codigo Comercial',
    'Codigo vendedor usuario',
    'Poblacion del cliente',
    'Deleg.',
    'Almacen',
    'Ref.Pedido',
    'St',
  ];
  const lines = [headers.join('\t')];
  for (const row of rows) {
    lines.push([
      row.EJERCICIOPEDIDO,
      formatPedido(row),
      formatDate(row),
      row.CODIGOCLIENTE,
      row.NOMBRECLIENTE,
      row.NOMBRECOMERCIAL,
      '',
      formatMoney(row.IMPORTETOTAL),
      row.OBSERVACIONES,
      paymentLabel(row.CODIGOFORMAPAGO),
      routeLabel(row.CODIGORUTA),
      row.CODIGOUSUARIO,
      row.CODIGOVENDEDOR,
      row.CODIGOVENDEDORCOBRO,
      row.CODIGOPROMOTORPREVENTA,
      row.CODIGOCOMERCIAL,
      row.CODIGOVENDEDORUSUARIO,
      row.POBLACION,
      row.DELEGACION,
      row.CODIGOALMACEN,
      '',
      row.SITUACIONPEDIDO,
    ].map((value) => String(value ?? '').trim()).join('\t'));
  }
  return lines.join('\n');
}

async function fetchPedidoLogs(orderIds) {
  if (!orderIds.length) return [];
  const placeholders = orderIds.map(() => '?').join(', ');
  return queryWithParams(`
    SELECT C.ID,
           C.EJERCICIOPEDIDO,
           TRIM(C.SERIEPEDIDO) AS SERIEPEDIDO,
           C.TERMINALPEDIDO,
           C.NUMEROPEDIDO,
           C.DIADOCUMENTO,
           C.MESDOCUMENTO,
           C.ANODOCUMENTO,
           TRIM(C.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
           TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBRECLIENTE), ''), C.CODIGOCLIENTEALBARAN)) AS NOMBRECLIENTE,
           TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, C.CODIGOCLIENTEALBARAN)) AS NOMBRECOMERCIAL,
           C.IMPORTETOTAL,
           TRIM(COALESCE(C.OBSERVACION1, '')) AS OBSERVACIONES,
           TRIM(C.CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
           TRIM(C.CODIGORUTA) AS CODIGORUTA,
           TRIM(C.CODIGOUSUARIO) AS CODIGOUSUARIO,
           TRIM(C.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
           TRIM(C.CODIGOVENDEDORCOBRO) AS CODIGOVENDEDORCOBRO,
           TRIM(C.CODIGOPROMOTORPREVENTA) AS CODIGOPROMOTORPREVENTA,
           TRIM(C.CODIGOCOMERCIAL) AS CODIGOCOMERCIAL,
           TRIM(C.CODIGOVENDEDORUSUARIO) AS CODIGOVENDEDORUSUARIO,
           TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
           TRIM(COALESCE(CLI.CODIGODELEGACION, '')) AS DELEGACION,
           C.CODIGOALMACEN,
           TRIM(C.SITUACIONPEDIDO) AS SITUACIONPEDIDO
      FROM JAVIER.PEDIDOS_CAB C
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(C.CODIGOCLIENTEALBARAN)
     WHERE C.ID IN (${placeholders})
     ORDER BY C.ID
  `, orderIds, false);
}

async function main() {
  assertSafeTarget();
  const out = {
    ts: new Date().toISOString(),
    target: TARGET,
    config: {
      host: HOST,
      port: PORT,
      vendorCode: VENDOR_CODE,
      clientCode: CLIENT_CODE,
      count: COUNT,
      concurrency: CONCURRENCY,
      confirmOrders: CONFIRM_ORDERS,
      db2WriteSchema: process.env.DB2_WRITE_SCHEMA || null,
      pedidosConfirmationSchema: process.env.PEDIDOS_CONFIRMATION_SCHEMA || null,
      pedidosExportToSystem: process.env.PEDIDOS_EXPORT_TO_SYSTEM || null,
    },
    tests: [],
    createdOrderIds: [],
    tsv: '',
  };

  const login = await api('POST', '/auth/login', { username: USERNAME, password: PASSWORD });
  const token = login.body?.token;
  record(out, 'AUTH', 'Login API', login.status === 200 && !!token, `status=${login.status} role=${login.body?.user?.role || login.body?.role || ''}`, login.ms);
  if (!token) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const products = await api('GET', `/pedidos/products?vendedorCodes=${encodeURIComponent(VENDOR_CODE)}&clientCode=${encodeURIComponent(CLIENT_CODE)}&limit=20`, null, token);
  const productList = products.body.products || [];
  const sample = pickProduct(productList);
  const code = productCode(sample);
  record(out, 'CATALOG', 'Catalogo con producto vendible', products.status === 200 && !!code, `status=${products.status} products=${productList.length} code=${code}`, products.ms);
  if (!code) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const indices = Array.from({ length: COUNT }, (_, index) => index);
  const created = await mapLimit(indices, CONCURRENCY, async (_value, index) => {
    const key = uniqueKey(index);
    const create = await api('POST', '/pedidos/create', {
      clientRequestId: key,
      clientCode: CLIENT_CODE,
      clientName: '',
      vendedorCode: VENDOR_CODE,
      tipoventa: 'CC',
      almacen: 1,
      tarifa: sample.codigoTarifaCliente || sample.codigoTarifa || 1,
      observaciones: `CERT JAVIER ${key}`,
      lines: [{
        codigoArticulo: code,
        descripcion: productName(sample),
        cantidadEnvases: 1,
        cantidadUnidades: 0,
        unidadMedida: 'CAJAS',
        unidadesCaja: Number(sample.unidadesCaja || 1),
        precio: productPrice(sample),
        precioVenta: productPrice(sample),
        precioTarifa: Number(sample.precioTarifa1 || productPrice(sample)),
        precioTarifaCliente: Number(sample.precioTarifaCliente || sample.precioCliente || productPrice(sample)),
        precioCosto: Number(sample.precioCosto || 0),
        codigoIva: sample.codigoIva || '2',
      }],
    }, token);
    const orderId = orderIdFromCreate(create.body);
    const result = { index, key, createStatus: create.status, orderId, createMs: create.ms };
    if (orderId && CONFIRM_ORDERS) {
      const confirm = await api('PUT', `/pedidos/${orderId}/confirm`, {
        saleType: 'CC',
        forceConfirm: true,
        forceConfirmReason: 'CERT JAVIER CONTROLLED TEST',
      }, token);
      result.confirmStatus = confirm.status;
      result.confirmMs = confirm.ms;
      result.confirmBlocked = confirm.body?.blocked === true;
      result.confirmCode = confirm.body?.code || confirm.body?.reason || '';
    }
    return result;
  });

  out.created = created;
  out.createdOrderIds = created.map((row) => row.orderId).filter(Boolean);
  const createOk = created.every((row) => row.createStatus === 201 || row.createStatus === 200);
  const confirmOk = !CONFIRM_ORDERS || created.every((row) => row.confirmStatus === 200);
  record(out, 'CREATE', `Crear ${COUNT} pedido(s) en JAVIER`, createOk, `orders=${out.createdOrderIds.join(',')}`, Math.max(...created.map((row) => row.createMs || 0)));
  record(out, 'CONFIRM', `Confirmar ${COUNT} pedido(s) en JAVIER`, confirmOk, `statuses=${created.map((row) => row.confirmStatus || '-').join(',')}`, Math.max(...created.map((row) => row.confirmMs || 0)));

  const replay = created[0]
    ? await api('POST', '/pedidos/create', {
      clientRequestId: created[0].key,
      clientCode: CLIENT_CODE,
      clientName: '',
      vendedorCode: VENDOR_CODE,
      tipoventa: 'CC',
      almacen: 1,
      tarifa: sample.codigoTarifaCliente || sample.codigoTarifa || 1,
      observaciones: `CERT JAVIER ${created[0].key}`,
      lines: [{
        codigoArticulo: code,
        descripcion: productName(sample),
        cantidadEnvases: 1,
        cantidadUnidades: 0,
        unidadMedida: 'CAJAS',
        unidadesCaja: Number(sample.unidadesCaja || 1),
        precio: productPrice(sample),
        precioVenta: productPrice(sample),
        precioTarifa: Number(sample.precioTarifa1 || productPrice(sample)),
        precioTarifaCliente: Number(sample.precioTarifaCliente || sample.precioCliente || productPrice(sample)),
        precioCosto: Number(sample.precioCosto || 0),
        codigoIva: sample.codigoIva || '2',
      }],
    }, token)
    : null;
  record(out, 'IDEMPOTENCY', 'Replay idempotente no duplica pedido', !!replay && replay.status === 200 && replay.body?.idempotent === true, `status=${replay?.status} idempotent=${replay?.body?.idempotent}`, replay?.ms || 0);

  const logs = await fetchPedidoLogs(out.createdOrderIds);
  out.dbRows = logs;
  out.tsv = toTsv(logs);
  const terminalOk = logs.every((row) => Number(row.TERMINALPEDIDO) === 93);
  const sellerOk = logs.every((row) =>
    String(row.CODIGOVENDEDOR).trim() === VENDOR_CODE.padStart(2, '0') &&
    String(row.CODIGOVENDEDORCOBRO).trim() === VENDOR_CODE.padStart(2, '0') &&
    String(row.CODIGOCOMERCIAL).trim() === VENDOR_CODE.padStart(2, '0'));
  record(out, 'DB2_LOG_ROWS', 'Filas recuperadas desde JAVIER.PEDIDOS_CAB', logs.length === out.createdOrderIds.length, `rows=${logs.length}/${out.createdOrderIds.length}`, 0);
  record(out, 'P093_FORMAT', 'Formato ERP P-093 con vendedor real separado', terminalOk && sellerOk, `terminalOk=${terminalOk} sellerOk=${sellerOk}`, 0);

  out.pass = out.tests.every((test) => test.pass);
  console.log(JSON.stringify(out, null, 2));
  console.log('--- TSV_LOGS ---');
  console.log(out.tsv);
  process.exit(out.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  if (error.odbcErrors) console.error(JSON.stringify(error.odbcErrors, null, 2));
  process.exit(1);
});
