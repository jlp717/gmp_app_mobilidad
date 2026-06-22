'use strict';
const http = require('http');
const UA = 'GMP-Cert-Mandate/1.0';
const PORT = parseInt(process.env.API_PORT || '3335', 10);

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const t0 = Date.now();
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: `/api${path}`, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(raw || '{}'); } catch { parsed = { raw: raw.slice(0, 200) }; }
        resolve({ status: res.statusCode, body: parsed, ms: Date.now() - t0 });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const out = { ts: new Date().toISOString(), tests: [] };
  const login = await api('POST', '/auth/login', { username: 'diego', password: '9322' });
  out.login = { status: login.status, role: login.body?.user?.role };
  const token = login.body?.token;
  if (!token) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const record = (id, name, pass, detail, ms) => {
    out.tests.push({ id, name, pass, detail, ms });
  };

  const tOrders0 = Date.now();
  const orders = await api('GET', '/pedidos?vendedorCodes=93&page=1&limit=20', null, token);
  record('B5', 'Mis pedidos paginado', orders.status === 200 && Array.isArray(orders.body.orders) && orders.ms < 1000,
    `status=${orders.status} count=${(orders.body.orders || []).length} ms=${orders.ms}`, orders.ms);

  const cobros = await api('GET', '/cobros/pending-summary/93', null, token);
  record('B6a', 'Cobros pending-summary', cobros.status === 200,
    `grandTotal=${cobros.body.grandTotal} clients=${(cobros.body.clients || []).length}`, cobros.ms);

  const cobrosFilt = await api('GET', '/cobros/4300001091/pendientes?tipoDocumento=FAC&fechaDesde=2025-01-01', null, token);
  record('B6b', 'Cobros pendientes filtros', cobrosFilt.status === 200,
    `docs=${(cobrosFilt.body.pendientes?.cobros || cobrosFilt.body.cobros || []).length}`, cobrosFilt.ms);

  const bolsa = await api('GET', '/bolsa/93/status', null, token);
  record('B7a', 'Bolsa status', bolsa.status === 200, JSON.stringify(bolsa.body).slice(0, 120), bolsa.ms);

  const products = await api('GET', '/pedidos/products?vendedorCodes=93&clientCode=4300001091&limit=10', null, token);
  const list = products.body.products || [];
  const withIva = list.filter((p) => Number(p.ivaRate) > 0);
  const sample = withIva[0] || list.find((p) => Number(p.precioCliente) > 0) || list[0];
  record('B2', 'IVA en catálogo', products.status === 200 && sample && sample.codigoIva,
    `code=${sample?.code} codigoIva=${sample?.codigoIva} ivaRate=${sample?.ivaRate}`, products.ms);

  const create = await api('POST', '/pedidos/create', {
    clientCode: '4300001091',
    clientName: 'Cert Mandate',
    vendedorCode: '93',
    lines: [{
      codigoArticulo: sample?.code || '6612',
      descripcion: 'Cert line',
      cantidadEnvases: 1,
      precio: Number(sample?.precioCliente || sample?.precioTarifa1 || 1),
      precioVenta: Number(sample?.precioCliente || sample?.precioTarifa1 || 1),
      precioCosto: 0.5,
    }],
  }, token);
  const orderId = create.body?.order?.header?.id ?? create.body?.order?.id;
  record('B1', 'Create sin idempotency key', create.status === 201 || create.status === 200,
    `status=${create.status} id=${orderId} err=${create.body?.error || create.body?.code || ''}`, create.ms);

  if (orderId) {
    const confirm = await api('PUT', `/pedidos/${orderId}/confirm`, { saleType: 'CC' }, token);
    record('B7b', 'Confirm pedido cert', confirm.status === 200 || confirm.body?.blocked === true,
      `status=${confirm.status} blocked=${confirm.body?.blocked}`, confirm.ms);
    const bolsaHist = await api('GET', '/bolsa/93/movements?limit=5', null, token);
    record('B7c', 'Bolsa movements', bolsaHist.status === 200,
      `rows=${(bolsaHist.body.movements || bolsaHist.body || []).length || 0}`, bolsaHist.ms);
    await api('PUT', `/pedidos/${orderId}/status`, { estado: 'ANULADO' }, token).catch(() => null);
  }

  const qa = await api('POST', '/pedidos/acciones-rapidas', {
    codigoArticulo: sample?.code || '6612',
    cantidadEnvases: 99999,
  }, token);
  record('B4', 'Acciones rápidas alternativas', qa.status === 200,
    `sufficient=${qa.body.sufficient} alt=${(qa.body.alternatives || []).length}`, qa.ms);

  const art = await api('GET', `/pedidos/products/${encodeURIComponent(sample?.code || '6612')}?clientCode=4300001091`, null, token);
  const detail = art.body?.product || art.body;
  const codeIva = detail?.codigoIva;
  const rate = detail?.ivaRate;
  record('B2b', 'IVA detalle producto', art.status === 200 && codeIva,
    `codigoIva=${codeIva} ivaRate=${rate}`, art.ms);

  out.pass = out.tests.every((t) => t.pass);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
