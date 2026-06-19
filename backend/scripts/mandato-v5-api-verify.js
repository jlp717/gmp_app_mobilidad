'use strict';
const http = require('http');
const UA = 'GMP-Mandato-V5/1.0';
const BASE = '/api';

function request(method, path, body, token, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, 'Content-Type': 'application/json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { hostname: '127.0.0.1', port: 3335, path: BASE + path, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed, raw });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const out = { ts: new Date().toISOString() };
  const login = await request('POST', '/auth/login', { username: 'diego', password: '9322' });
  out.login = { status: login.status, hasToken: Boolean(login.body?.token), role: login.body?.user?.role };
  const token = login.body?.token;
  if (!token) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const cob = await request('GET', '/cobros/pending-summary/93', null, token);
  out.cobros93 = {
    status: cob.status,
    grandTotal: cob.body?.grandTotal,
    portfolioGrandTotal: cob.body?.portfolioGrandTotal,
    totalPendingAmount: cob.body?.totalPendingAmount,
    clientsOnPage: (cob.body?.clients || []).length,
    pagination: cob.body?.pagination,
    keys: Object.keys(cob.body || {}),
  };

  const bolsa = await request('GET', '/bolsa/93/status', null, token);
  out.bolsa93 = { status: bolsa.status, body: bolsa.body };

  const clients = await request('GET', '/clients/list?vendedorCodes=93&limit=3&offset=0', null, token);
  const clientList = clients.body?.clients || clients.body?.data || [];
  const firstClient = Array.isArray(clientList) ? clientList[0] : null;
  const clientCode = firstClient?.code || firstClient?.codigo;
  out.clients93 = { status: clients.status, total: clients.body?.total, count: clientList.length, sample: firstClient };

  if (clientCode) {
    const promos = await request('GET', `/pedidos/promotions?clientCode=${encodeURIComponent(clientCode)}&vendedorCodes=93`, null, token);
    out.promotions = { status: promos.status, count: (promos.body?.promotions || []).length };
  }

  const products = await request('GET', '/pedidos/products?vendedorCodes=93&clientCode=' + encodeURIComponent(clientCode || ''), null, token);
  const plist = products.body?.products || [];
  const prod = plist[0];
  out.productsSample = { status: products.status, count: plist.length, firstCode: prod?.code || prod?.codigoArticulo };

  const order87 = await request('GET', '/pedidos/87', null, token);
  const o87 = order87.body?.order || order87.body;
  out.pedido87 = {
    status: order87.status,
    TERMINAL: o87?.TERMINAL ?? o87?.terminal,
    numeroPedidoFormatted: o87?.numeroPedidoFormatted,
    SYNC_STATUS: o87?.SYNC_STATUS ?? o87?.syncStatus,
    vendedor: o87?.CODIGOVENDEDOR ?? o87?.vendedorCode,
  };

  const article = prod?.code || prod?.codigoArticulo;
  if (clientCode && article) {
    const idem = `mandato-v5-${Date.now()}`;
    const create = await request(
      'POST',
      '/pedidos/create',
      {
        clientCode,
        clientName: firstClient?.name || 'Mandato V5 Test',
        vendedorCode: '93',
        lines: [{
          codigoArticulo: article,
          descripcion: prod?.name || prod?.descripcion || 'Test',
          cantidadEnvases: 1,
          precio: Number(prod?.price || prod?.precio || 1),
          precioCosto: Number(prod?.cost || prod?.precioCosto || 0.5),
        }],
      },
      token,
      { 'Idempotency-Key': idem },
    );
    out.create = { status: create.status, error: create.body?.error, code: create.body?.code, orderId: create.body?.id ?? create.body?.header?.id };
    const oid = out.create.orderId;
    if (oid) {
      const confirm = await request('PUT', `/pedidos/${oid}/confirm`, { saleType: 'CC' }, token);
      out.confirm = { status: confirm.status, error: confirm.body?.error, code: confirm.body?.code };
      const detail = await request('GET', `/pedidos/${oid}`, null, token);
      const ord = detail.body?.order || detail.body;
      out.testPedido = {
        id: oid,
        TERMINAL: ord?.TERMINAL ?? ord?.terminal,
        numeroPedidoFormatted: ord?.numeroPedidoFormatted,
        NUMEROPEDIDO: ord?.NUMEROPEDIDO ?? ord?.numeroPedido,
        SERIEPEDIDO: ord?.SERIEPEDIDO ?? ord?.seriePedido,
        SYNC_STATUS: ord?.SYNC_STATUS ?? ord?.syncStatus,
      };
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

