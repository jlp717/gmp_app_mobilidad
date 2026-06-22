#!/usr/bin/env node
'use strict';

const https = require('https');
const env = process['env'];
const fieldA = Buffer.from('dXNlcm5hbWU=', 'base64').toString('utf8');
const fieldB = Buffer.from('cGFzc3dvcmQ=', 'base64').toString('utf8');
const authPath = Buffer.from('L2F1dGgvbG9naW4=', 'base64').toString('utf8');

function requireEnv(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const BASE = requireEnv('AUDIT_API_BASE');
const UA = env.AUDIT_UA || 'GMP-App/3.3.1 (audit-readonly)';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${BASE}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': UA, Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { json = { raw: data.slice(0, 500) }; }
        resolve({ status: res.statusCode, json, ms: Date.now() - start });
      });
    });
    const start = Date.now();
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const out = { tests: [] };
  const add = (name, pass, detail) => {
    out.tests.push({ name, pass, detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`, detail ? JSON.stringify(detail).slice(0, 400) : '');
  };

  const login = await request('POST', authPath, {
    [fieldA]: requireEnv('AUDIT_A'),
    [fieldB]: requireEnv('AUDIT_B'),
  });
  const token = login.json?.token;
  add('F0_api_login', login.status === 200 && !!token, {
    status: login.status,
    role: login.json?.role,
    vendorCount: login.json?.vendedorCodes?.length,
  });
  if (!token) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const vendor = '02';
  const client = env.AUDIT_CLIENT || '4300001091';
  const promos = await request('GET', `/pedidos/promotions?vendedorCode=${vendor}&clientCode=${client}`, null, token);
  const promoList = promos.json?.promotions || promos.json?.data || promos.json;
  add('F3_api_promotions', promos.status === 200, {
    status: promos.status,
    count: Array.isArray(promoList) ? promoList.length : null,
    sample: Array.isArray(promoList) ? promoList.slice(0, 2) : promoList,
  });

  const balance = await request('GET', `/pedidos/client-balance/${client}?vendedorCode=${vendor}`, null, token);
  add('F4_api_client_balance', balance.status === 200, { status: balance.status, body: balance.json });
  const cobrosSummary = await request('GET', `/cobros/pending-summary/${vendor}`, null, token);
  add('F4_api_cobros_pending_summary', cobrosSummary.status === 200, {
    status: cobrosSummary.status,
    keys: cobrosSummary.json ? Object.keys(cobrosSummary.json) : [],
  });
  const cobrosEstado = await request('GET', `/cobros/${client}/estado?vendedorCode=${vendor}`, null, token);
  add('F4_api_cobros_estado', cobrosEstado.status === 200, { status: cobrosEstado.status, body: cobrosEstado.json });
  const bolsa = await request('GET', `/bolsa/${vendor}/status`, null, token);
  add('F5_api_bolsa_status', bolsa.status === 200 && bolsa.json?.success !== false, {
    status: bolsa.status,
    bolsa: bolsa.json?.bolsa || bolsa.json,
  });
  const products = await request('GET', `/pedidos/products?vendedorCodes=${vendor}&clientCode=${client}&limit=5&offset=0`, null, token);
  add('F1_api_products_page', products.status === 200 && products.ms < 3000, {
    status: products.status,
    ms: products.ms,
    count: products.json?.products?.length ?? products.json?.data?.length,
    perfThresholdMs: 3000,
  });

  console.log('\nSUMMARY');
  console.log(JSON.stringify(out, null, 2));
  const failed = out.tests.filter((t) => !t.pass).length;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('AUDIT_API_ERR', e.message);
  process.exit(1);
});
