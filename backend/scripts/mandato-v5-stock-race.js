'use strict';
/** Stock race: concurrent confirm on same article — expect at most one success. */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const http = require('http');
const { getProbeCredentials } = require('./probe-credentials');
const UA = 'GMP-Mandato-V5/1.0';

function call(method, path, body, token, extra = {}) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const h = { 'User-Agent': UA, ...extra };
    if (token) h.Authorization = `Bearer ${token}`;
    if (d) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(d); }
    const r = http.request({ hostname: '127.0.0.1', port: 3335, path: '/api' + path, method, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(b || '{}'); } catch (_) { parsed = { raw: b.slice(0, 200) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const out = { ts: new Date().toISOString() };
  const login = await call('POST', '/auth/login', getProbeCredentials('mandato v5 stock race'));
  const token = login.body.token;
  const clientCode = '4300000354';
  const products = await call('GET', `/pedidos/products?vendedorCodes=93&clientCode=${clientCode}&limit=5`, null, token);
  const article = products.body.products?.[0]?.code;
  out.article = article;
  if (!article) { console.log(JSON.stringify(out, null, 2)); process.exit(1); }

  const creates = await Promise.all([0, 1].map(async (i) => {
    const idem = `mandato-stock-race-${Date.now()}-${i}`;
    const cr = await call('POST', '/pedidos/create', {
      clientCode, clientName: 'Stock Race', vendedorCode: '93',
      lines: [{ codigoArticulo: article, descripcion: 'race', cantidadEnvases: 9999, precio: 1, precioCosto: 0.5 }],
    }, token, { 'Idempotency-Key': idem });
    return { status: cr.status, oid: cr.body?.id ?? cr.body?.header?.id, blocked: cr.body?.blocked };
  }));
  out.creates = creates;

  const confirms = await Promise.all(creates.filter((c) => c.oid).map(async (c) => {
    const cf = await call('PUT', `/pedidos/${c.oid}/confirm`, { saleType: 'CC' }, token);
    return { oid: c.oid, status: cf.status, blocked: cf.body?.blocked, reason: cf.body?.reason, error: cf.body?.error };
  }));
  out.confirms = confirms;
  const success = confirms.filter((c) => c.status === 200 && !c.blocked).length;
  const blocked = confirms.filter((c) => c.blocked || c.status === 400 || c.status === 409).length;
  out.summary = { success, blocked, total: confirms.length, pass: success <= 1 };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.summary.pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
