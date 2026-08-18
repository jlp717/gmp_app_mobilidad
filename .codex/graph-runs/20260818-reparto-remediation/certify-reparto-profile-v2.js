#!/usr/bin/env node
'use strict';

/* Safe LOCAL Reparto-profile certification. Never print response bodies. */
const fs = require('node:fs');
const ACTORS = 'C:/Users/Javier/AppData/Local/Temp/gmp-cert-actors.json';
const UA = 'GMP-App/1.0 Dart/3.0';
const DEFAULT_BASE = 'http://127.0.0.1:3336/api';
const TOLERANCE = 0.01;

function help() {
  process.stdout.write('Usage: node certify-reparto-profile-v2.js --reads [--base http://127.0.0.1:3336/api]\n');
}
function args(argv) {
  const result = { base: DEFAULT_BASE, reads: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--reads') result.reads = true;
    else if (argv[i] === '--base') result.base = argv[++i] || '';
    else if (argv[i] === '--help' || argv[i] === '-h') result.help = true;
    else throw new Error('INVALID_ARGUMENT');
  }
  return result;
}
function localBase(base) {
  try {
    const url = new URL(base);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && /\/api\/?$/.test(url.pathname);
  } catch (_) { return false; }
}
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function data(body) { const root = obj(body); return obj(root.data && !Array.isArray(root.data) ? root.data : root); }
function items(body) {
  const root = obj(body); const nested = obj(root.data);
  for (const value of [root.data, root.items, root.rows, root.repartidores, nested.items, nested.rows, nested.repartidores]) if (Array.isArray(value)) return value;
  return [];
}
function pick(source, keys) { const value = obj(source); for (const key of keys) if (value[key] != null) return value[key]; }
function num(value) { const result = Number(value); return Number.isFinite(result) ? result : undefined; }
function code(body) { const value = pick(data(body), ['code', 'errorCode']); return typeof value === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : undefined; }
function json(record) { process.stdout.write(`${JSON.stringify(record)}\n`); }
function metric(endpoint, body) {
  const value = data(body); const list = items(body); const n = (keys) => num(pick(value, keys)); const out = {};
  const add = (key, input) => { if (Object.keys(out).length < 3 && input !== undefined) out[key] = input; };
  if (/delivery-summary/.test(endpoint)) { add('total', n(['total', 'totalDeliveries', 'totalEntregas'])); add('delivered', n(['delivered', 'entregados'])); add('amount', n(['amount', 'importe', 'importeTotal', 'totalAmount'])); }
  else if (/finanzas\/summary/.test(endpoint)) { add('collected', n(['cobrado', 'collected', 'totalCollected'])); add('liquidated', n(['liquidado', 'liquidated', 'totalLiquidated'])); add('balance', n(['saldo', 'balance'])); }
  else if (/collections\/daily/.test(endpoint)) { add('collectable', n(['collectable', 'cobrable', 'importeCobrable'])); add('collected', n(['collected', 'cobrado', 'importeCobrado'])); add('pending', n(['pending', 'pendiente', 'importePendiente'])); }
  else if (/daily-summary|\/cuentas\//.test(endpoint)) { add('balance', n(['saldo', 'balance', 'aIngresar'])); add('collections', n(['cobros', 'collections', 'totalCobros'])); add('expenses', n(['gastos', 'expenses', 'totalGastos'])); }
  else if (/commissions\/summary/.test(endpoint)) { add('delivered', n(['delivered', 'entregado', 'importeEntregado'])); add('collected', n(['collected', 'cobrado', 'importeCobrado'])); add('percentage', n(['percentage', 'porcentaje', 'pct'])); }
  else { add('count', list.length); add('total', n(['total', 'totalCount', 'totalItems', 'pageTotal'])); add('amount', n(['amount', 'importe', 'importeTotal', 'importePendiente'])); }
  return out;
}
function record(actor, endpoint, response, body, extra = {}) {
  return { actor: actor.label, username: actor.username, role: actor.role, activeMode: actor.activeMode, endpoint, status: response.status, code: code(body) || (response.ok ? 'OK' : 'HTTP_ERROR'), metrics: metric(endpoint, body), ...extra };
}
async function request(base, actor, method, endpoint, body) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (actor?.token) headers.Authorization = `Bearer ${actor.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${base}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const result = (response.headers.get('content-type') || '').includes('application/json') ? await response.json().catch(() => ({})) : {};
    return { response, body: result };
  } catch (_) { return { response: { status: 0, ok: false }, body: { code: 'REQUEST_FAILED' } }; }
}
async function get(base, actor, endpoint) { const result = await request(base, actor, 'GET', endpoint); json(record(actor, endpoint, result.response, result.body)); return result; }
function facts(body, fallback) {
  const root = data(body); const user = obj(root.user || root.usuario || root);
  return { token: pick(root, ['token', 'accessToken', 'jwt']) || pick(user, ['token', 'accessToken', 'jwt']), role: String(pick(user, ['role', 'rol']) || fallback), activeMode: String(pick(root, ['activeMode', 'active_mode']) || pick(user, ['activeMode', 'active_mode']) || 'UNKNOWN') };
}
async function login(base, raw, label, fallback, switchRole) {
  if (typeof raw.username !== 'string' || typeof raw.password !== 'string') throw new Error('ACTOR_FILE_INVALID');
  const initial = { label, username: raw.username, role: fallback, activeMode: 'UNKNOWN' };
  const loginResult = await request(base, null, 'POST', '/auth/login', { username: raw.username, password: raw.password });
  json(record(initial, '/auth/login', loginResult.response, loginResult.body));
  const loginFacts = facts(loginResult.body, fallback);
  if (!loginResult.response.ok || typeof loginFacts.token !== 'string' || loginFacts.token.length < 16) throw new Error('AUTH_FAILED');
  const actor = { ...initial, ...loginFacts };
  if (switchRole) {
    const result = await request(base, actor, 'POST', '/auth/switch-role', switchRole);
    const switched = facts(result.body, actor.role);
    json(record({ ...actor, activeMode: switched.activeMode }, '/auth/switch-role', result.response, result.body));
    if (!result.response.ok) throw new Error('SWITCH_FAILED');
    actor.role = switched.role; actor.activeMode = switched.activeMode;
  }
  return actor;
}
function day() { return new Date().toISOString().slice(0, 10); }
function month() { const now = new Date(); return `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`; }
function codeOf(raw, fallback) { const value = String(pick(raw, ['repartidorId', 'codigo', 'code']) || fallback).trim(); if (!/^[A-Za-z0-9]{1,12}$/.test(value)) throw new Error('ACTOR_CODE_INVALID'); return value; }
function endpoints(id, panel) {
  const codeValue = encodeURIComponent(id); const common = [
    `/repartidor/history/clients/${codeValue}?limit=50&offset=0`, `/repartidor/rutero/week/${codeValue}`, `/entregas/pendientes/${codeValue}?date=${day()}&limit=50&offset=0`,
    `/repartidor-finanzas/daily-summary/${codeValue}?date=${day()}`, `/repartidor-finanzas/liquidaciones/${codeValue}/desglose?date=${day()}`, `/repartidor-finanzas/cuentas/${codeValue}?date=${day()}`,
    `/repartidor-finanzas/vencimientos/${codeValue}?limit=50&offset=0`, `/repartidor-finanzas/evolution/${codeValue}`, `/repartidor-finanzas/commissions/summary/${codeValue}`, `/repartidor-finanzas/commissions/tiers`,
    `/repartidor/history/${codeValue}?limit=50&offset=0`, `/repartidor/history/objectives/${codeValue}`, `/repartidor/history/objectives-detail/${codeValue}?limit=100&offset=0`, `/repartidor/rutero/order/${codeValue}?date=${day()}`, `/repartidor/rutero/stops-geo/${codeValue}?date=${day()}`, '/chatbot/health'
  ];
  return panel ? [`/repartidor/history/delivery-summary/${codeValue}?${month()}`, `/repartidor-finanzas/summary/${codeValue}?${month()}`, `/repartidor/collections/daily/${codeValue}?${month()}`, ...common] : common;
}
async function matrix(base, actor, id, panel) {
  for (const endpoint of endpoints(id, panel)) await get(base, actor, endpoint);
  const result = await request(base, actor, 'POST', '/chatbot/message', { message: 'Resumen operativo del repartidor actual', repartidorId: id });
  json(record(actor, '/chatbot/message', result.response, result.body));
}
function codes(body) { return [...new Set(items(body).map((row) => String(pick(row, ['codigo', 'code', 'id', 'repartidorId']) || '').trim()).filter((value) => /^\d{1,2}$/.test(value)).map((value) => value.padStart(2, '0')))].sort((a, b) => Number(a) - Number(b)); }
function v(body, field) { return num(pick(data(body), [field])); }
async function aggregates(base, actor, ids, all) {
  const specs = [
    ['delivery', (id) => `/repartidor/history/delivery-summary/${id}?${month()}`, ['total', 'delivered', 'amount']],
    ['finance', (id) => `/repartidor-finanzas/summary/${id}?${month()}`, ['cobrado', 'liquidado', 'saldo']],
    ['collections', (id) => `/repartidor/collections/daily/${id}?${month()}`, ['collectable', 'collected', 'pending']],
    ['daily', (id) => `/repartidor-finanzas/daily-summary/${id}?date=${day()}`, ['saldo', 'cobros', 'gastos']],
    ['cuentas', (id) => `/repartidor-finanzas/cuentas/${id}?date=${day()}`, ['saldo', 'cobros', 'gastos']]
  ];
  for (const [name, endpoint, fields] of specs) {
    const fleet = await request(base, actor, 'GET', endpoint(encodeURIComponent(all))); let complete = fleet.response.ok; const sums = Object.fromEntries(fields.map((field) => [field, 0]));
    for (const id of ids) { const result = await request(base, actor, 'GET', endpoint(encodeURIComponent(id))); complete &&= result.response.ok; for (const field of fields) { const value = v(result.body, field); if (value === undefined) complete = false; else sums[field] += value; } }
    const matched = fields.filter((field) => { const value = v(fleet.body, field); return value !== undefined && Math.abs(value - sums[field]) <= TOLERANCE; }).length;
    json({ actor: actor.label, username: actor.username, role: actor.role, activeMode: actor.activeMode, endpoint: `aggregate:${name}`, status: fleet.response.status, code: complete && matched === fields.length ? 'ALL_MATCHES_SUM' : 'ALL_SUM_MISMATCH', metrics: { actors: ids.length, fieldsMatched: matched, tolerance: TOLERANCE } });
  }
}
async function details(base, actor, id) {
  const pending = await request(base, actor, 'GET', `/entregas/pendientes/${encodeURIComponent(id)}?date=${day()}&limit=1&offset=0`); const row = items(pending.body)[0] || {};
  const number = pick(row, ['numero', 'NUMERO', 'albaran']); const year = pick(row, ['ejercicio', 'EJERCICIO', 'year']);
  if (number !== undefined && year !== undefined) { const query = new URLSearchParams({ repartidorId: id }); for (const [key, fields] of Object.entries({ serie: ['serie', 'SERIE'], terminal: ['terminal', 'TERMINAL'], cliente: ['cliente', 'CLIENTE', 'CODCLIENTE'] })) { const value = pick(row, fields); if (value !== undefined) query.set(key, String(value)); } await get(base, actor, `/entregas/albaran/${encodeURIComponent(String(number))}/${encodeURIComponent(String(year))}?${query}`); }
  await get(base, actor, `/repartidor/history/signature?repartidorId=${encodeURIComponent(id)}`);
}
async function main() {
  let parsed; try { parsed = args(process.argv.slice(2)); } catch (_) { help(); process.exitCode = 2; return; }
  if (parsed.help) { help(); return; } if (!parsed.reads || !localBase(parsed.base)) { help(); process.exitCode = 2; return; }
  let source; try { source = JSON.parse(fs.readFileSync(ACTORS, 'utf8')); } catch (_) { json({ code: 'ACTOR_FILE_UNAVAILABLE' }); process.exitCode = 2; return; }
  const reparto = await login(parsed.base, obj(source.repartidor), 'repartidor', 'REPARTIDOR');
  const jefeRaw = obj(source.jefeVentas); const jefe = await login(parsed.base, jefeRaw, 'jefeVentas', 'JEFE_VENTAS', obj(jefeRaw.switchRole).body);
  const repartoId = codeOf(obj(source.repartidor), reparto.username); const anonymous = { label: 'anonymous', username: 'ANON', role: 'NONE', activeMode: 'NONE' };
  await get(parsed.base, reparto, '/auth/repartidores'); await get(parsed.base, jefe, '/auth/repartidores');
  const selector = await request(parsed.base, jefe, 'GET', '/auth/repartidores'); const ids = codes(selector.body); if (!ids.length) throw new Error('REPARTIDORES_UNAVAILABLE'); const all = ids.join(',');
  await get(parsed.base, anonymous, `/repartidor/rutero/week/${encodeURIComponent(repartoId)}`); await get(parsed.base, reparto, `/repartidor/rutero/week/${encodeURIComponent(ids.find((id) => id !== repartoId) || '99')}`);
  await matrix(parsed.base, reparto, repartoId, false); await details(parsed.base, reparto, repartoId); await matrix(parsed.base, jefe, repartoId, true); await details(parsed.base, jefe, repartoId); await matrix(parsed.base, jefe, all, true); await aggregates(parsed.base, jefe, ids, all);
}
main().catch(() => { json({ code: 'CERTIFICATION_ABORTED' }); process.exitCode = 1; });
