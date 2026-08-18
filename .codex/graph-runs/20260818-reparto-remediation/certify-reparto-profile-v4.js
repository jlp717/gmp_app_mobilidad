#!/usr/bin/env node
'use strict';

/*
 * Reparto certification probe: local-loopback, evidence-only.
 * Deliberately emits no credentials, tokens, response bodies, identifiers, or text fields.
 */
const fs = require('node:fs');

const ACTOR_FILE = 'C:/Users/Javier/AppData/Local/Temp/gmp-cert-actors.json';
const DEFAULT_BASE = 'http://127.0.0.1:3336/api';
const UA = 'GMP-App/1.0 Dart/3.0';
const TIMEOUT_MS = 45_000;
const PAGE_SIZE = 100;
const MAX_OBJECTIVE_PAGES = 40;
const ALL_TOLERANCE = 0.01;

function usage() { process.stdout.write('Usage: node certify-reparto-profile-v4.js --reads [--base http://127.0.0.1:3336/api]\n'); }
function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, reads: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--reads') out.reads = true;
    else if (argv[i] === '--base') out.base = argv[++i] || '';
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
    else throw new Error('INVALID_ARGUMENT');
  }
  return out;
}
function isLoopbackBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '3336' && /^\/api\/?$/.test(url.pathname);
  } catch (_) { return false; }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function data(value) { const root = object(value); return object(root.data) && !Array.isArray(root.data) ? root.data : root; }
function list(value) {
  const root = object(value); const nested = object(root.data);
  for (const candidate of [root.data, root.items, root.rows, root.repartidores, root.documents, nested.items, nested.rows, nested.repartidores, nested.documents]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
function pick(value, names) { const source = object(value); for (const name of names) if (source[name] != null) return source[name]; return undefined; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function safeCode(value, ok) {
  const raw = typeof value === 'string' ? value : '';
  return ok ? 'OK' : (/^[A-Z][A-Z0-9_:-]{0,79}$/.test(raw) ? raw : 'HTTP_ERROR');
}
function endpointOrigin(name) {
  if (/^(rutero|pendientes|albaran|paymentConditions|history|pdf|vencimientos|panel|finance\.summary|collections|evolution|commissions|objectives)/.test(name)) return 'DSEDAC+TEST_OVERLAY';
  if (/^(order|signature)/.test(name)) return 'TEST_APP';
  if (/^(auth|chatbot)/.test(name)) return 'API';
  return 'UNKNOWN';
}
function metric(name, body) {
  const root = data(body); const rows = list(body); const value = keys => number(pick(root, keys));
  const out = {};
  const add = (key, result) => { if (Object.keys(out).length < 3 && result !== undefined) out[key] = result; };
  if (name === 'panel.delivery') { add('total', value(['total', 'totalDeliveries', 'totalEntregas'])); add('delivered', value(['delivered', 'entregados'])); add('amount', value(['amount', 'importe', 'importeTotal', 'totalAmount'])); }
  else if (name === 'panel.finance') { add('collected', value(['cobrado', 'collected', 'totalCollected'])); add('liquidated', value(['liquidado', 'liquidated', 'totalLiquidated'])); add('balance', value(['saldo', 'balance'])); }
  else if (name === 'panel.collections') { add('collectable', value(['collectable', 'cobrable', 'importeCobrable'])); add('collected', value(['collected', 'cobrado', 'importeCobrado'])); add('pending', value(['pending', 'pendiente', 'importePendiente'])); }
  else if (/^(liquidacion|cuentas)/.test(name)) { add('balance', value(['saldo', 'balance', 'aIngresar'])); add('collections', value(['cobros', 'collections', 'totalCobros'])); add('expenses', value(['gastos', 'expenses', 'totalGastos'])); }
  else if (name === 'commissions.summary') { add('delivered', value(['delivered', 'entregado', 'importeEntregado'])); add('collected', value(['collected', 'cobrado', 'importeCobrado'])); add('percentage', value(['percentage', 'porcentaje', 'pct'])); }
  else { add('count', rows.length); add('total', value(['total', 'totalCount', 'totalItems', 'pageTotal'])); add('amount', value(['amount', 'importe', 'importeTotal', 'importePendiente'])); }
  return out;
}
function emit(actor, name, result, extra = {}) {
  const resultCode = pick(data(result.body), ['code', 'errorCode']);
  process.stdout.write(`${JSON.stringify({
    actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint: name,
    status: result.response.status, code: safeCode(resultCode, result.response.ok), metrics: metric(name, result.body),
    origin: endpointOrigin(name), verdict: result.response.ok ? 'PASS' : 'FAIL', latencyMs: result.latencyMs, ...extra,
  })}\n`);
}
async function request(base, actor, method, path, body) {
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  if (actor && actor.token) headers.Authorization = `Bearer ${actor.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const contentType = response.headers.get('content-type') || '';
    const parsed = contentType.includes('json') ? await response.json().catch(() => ({})) : {};
    return { response, body: parsed, contentType: contentType.split(';')[0], bytes: Number(response.headers.get('content-length')) || 0, latencyMs: Date.now() - started };
  } catch (_) { return { response: { status: 0, ok: false }, body: { code: 'REQUEST_FAILED' }, contentType: '', bytes: 0, latencyMs: Date.now() - started }; }
}
async function get(base, actor, name, path) { const result = await request(base, actor, 'GET', path); emit(actor, name, result); return result; }
function authFacts(body, fallbackRole) {
  const root = data(body); const user = object(root.user || root.usuario || root);
  return {
    token: pick(root, ['token', 'accessToken', 'jwt']) || pick(user, ['token', 'accessToken', 'jwt']),
    role: String(pick(user, ['role', 'rol']) || fallbackRole),
    activeMode: String(pick(root, ['activeMode', 'active_mode']) || pick(user, ['activeMode', 'active_mode']) || 'UNKNOWN'),
    claimedCode: pick(user, ['repartidorId', 'repartidorCodigo', 'codigoRepartidor', 'deliveryPersonId']),
  };
}
async function login(base, raw, label, role, switchBody) {
  if (typeof raw.username !== 'string' || typeof raw.password !== 'string') throw new Error('ACTOR_FILE_INVALID');
  const initial = { label, role, activeMode: 'UNKNOWN' };
  const response = await request(base, null, 'POST', '/auth/login', { username: raw.username, password: raw.password });
  emit(initial, 'auth.login', response);
  const facts = authFacts(response.body, role);
  if (!response.response.ok || typeof facts.token !== 'string' || facts.token.length < 16) throw new Error('AUTH_FAILED');
  const actor = { ...initial, ...facts };
  if (switchBody) {
    const switched = await request(base, actor, 'POST', '/auth/switch-role', switchBody);
    const switchFacts = authFacts(switched.body, actor.role);
    emit({ ...actor, activeMode: switchFacts.activeMode }, 'auth.switchRole', switched);
    if (!switched.response.ok) throw new Error('SWITCH_FAILED');
    actor.role = switchFacts.role; actor.activeMode = switchFacts.activeMode;
  }
  return actor;
}
function day() { return new Date().toISOString().slice(0, 10); }
function month() { const now = new Date(); return `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`; }
function normalizeCode(value) { const raw = String(value == null ? '' : value).trim(); return /^\d{1,3}$/.test(raw) ? raw.padStart(2, '0') : undefined; }
function selectorCodes(body) { return [...new Set(list(body).map(row => normalizeCode(pick(row, ['codigo', 'code', 'id', 'repartidorId']))).filter(Boolean))].sort((a, b) => Number(a) - Number(b)); }
function ownerFromRows(rows, fallback) { return normalizeCode(pick(rows[0] || {}, ['repartidorId', 'repartidor', 'codigoRepartidor', 'driverId'])) || fallback; }
function responseTotal(body) { return number(pick(data(body), ['total', 'totalCount', 'totalItems'])); }

function tabPaths(id, panel) {
  const encoded = encodeURIComponent(id);
  const core = [
    ['clientes', `/repartidor/history/clients/${encoded}?limit=50&offset=0`], ['rutero.week', `/repartidor/rutero/week/${encoded}`],
    ['rutero.pending', `/entregas/pendientes/${encoded}?date=${day()}&limit=50&offset=0`], ['paymentConditions', '/entregas/payment-conditions'],
    ['liquidacion.daily', `/repartidor-finanzas/daily-summary/${encoded}?date=${day()}`], ['liquidacion.breakdown', `/repartidor-finanzas/liquidaciones/${encoded}/desglose?date=${day()}`], ['cuentas', `/repartidor-finanzas/cuentas/${encoded}?date=${day()}`],
    ['vencimientos', `/repartidor-finanzas/vencimientos/${encoded}?limit=50&offset=0`], ['evolution', `/repartidor-finanzas/evolution/${encoded}`],
    ['commissions.summary', `/repartidor-finanzas/commissions/summary/${encoded}`], ['commissions.tiers', '/repartidor-finanzas/commissions/tiers'],
    ['history', `/repartidor/history/${encoded}?limit=50&offset=0`], ['objectives', `/repartidor/history/objectives/${encoded}`],
    ['rutero.order', `/repartidor/rutero/order/${encoded}?date=${day()}`], ['rutero.geo', `/repartidor/rutero/stops-geo/${encoded}?date=${day()}`], ['chatbot.health', '/chatbot/health'],
  ];
  return panel ? [['panel.delivery', `/repartidor/history/delivery-summary/${encoded}?${month()}`], ['panel.finance', `/repartidor-finanzas/summary/${encoded}?${month()}`], ['panel.collections', `/repartidor/collections/daily/${encoded}?${month()}`], ...core] : core;
}
async function objectivePages(base, actor, id) {
  let offset = 0;
  for (let page = 0; page < MAX_OBJECTIVE_PAGES; page += 1) {
    const result = await get(base, actor, 'objectives.detail', `/repartidor/history/objectives-detail/${encodeURIComponent(id)}?limit=${PAGE_SIZE}&offset=${offset}`);
    if (!result.response.ok) return;
    const count = list(result.body).length; const total = responseTotal(result.body);
    if (count === 0 || (total !== undefined && offset + count >= total)) return;
    offset += count;
  }
  process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint: 'objectives.detail', status: 0, code: 'OBJECTIVES_PAGE_BOUND', metrics: {}, origin: endpointOrigin('objectives.detail'), verdict: 'FAIL', latencyMs: 0 })}\n`);
}
async function concreteDetails(base, actor, concreteId) {
  const pending = await request(base, actor, 'GET', `/entregas/pendientes/${encodeURIComponent(concreteId)}?date=${day()}&limit=1&offset=0`);
  emit(actor, 'rutero.pending.detailSeed', pending);
  const row = list(pending.body)[0] || {};
  const owner = ownerFromRows(list(pending.body), concreteId);
  const numberValue = pick(row, ['numero', 'NUMERO', 'albaran']); const year = pick(row, ['ejercicio', 'EJERCICIO', 'year']);
  if (numberValue != null && year != null) {
    const query = new URLSearchParams({ repartidorId: owner });
    for (const [key, fields] of Object.entries({ serie: ['serie', 'SERIE'], terminal: ['terminal', 'TERMINAL'], cliente: ['cliente', 'CLIENTE', 'CODCLIENTE'] })) {
      const value = pick(row, fields); if (value != null) query.set(key, String(value));
    }
    await get(base, actor, 'albaran', `/entregas/albaran/${encodeURIComponent(String(numberValue))}/${encodeURIComponent(String(year))}?${query}`);
    const serie = pick(row, ['serie', 'SERIE']); const terminal = pick(row, ['terminal', 'TERMINAL']);
    if (serie != null && terminal != null) {
      const pdf = await request(base, actor, 'GET', `/repartidor/document/albaran/${encodeURIComponent(String(year))}/${encodeURIComponent(String(serie))}/${encodeURIComponent(String(terminal))}/${encodeURIComponent(String(numberValue))}/pdf?repartidorId=${encodeURIComponent(owner)}`);
      emit(actor, 'pdf.albaran', pdf, { metrics: { bytes: pdf.bytes, pdf: pdf.contentType === 'application/pdf' ? 1 : 0 } });
    }
  }
  const historic = await request(base, actor, 'GET', `/repartidor/history/${encodeURIComponent(concreteId)}?limit=1&offset=0`);
  emit(actor, 'history.detailSeed', historic);
  const historyRow = list(historic.body)[0] || {}; const client = pick(historyRow, ['clientId', 'clienteId', 'CODCLIENTE', 'cliente']);
  const historyOwner = ownerFromRows(list(historic.body), concreteId);
  if (client != null) {
    const docs = await get(base, actor, 'history.documents', `/repartidor/history/documents/${encodeURIComponent(String(client))}?limit=1&offset=0&repartidorId=${encodeURIComponent(historyOwner)}`);
    const document = list(docs.body)[0] || {}; const year = pick(document, ['ejercicio', 'year']); const series = pick(document, ['serie']); const numberValue = pick(document, ['numero', 'number']);
    if (year != null && series != null && numberValue != null && String(pick(document, ['tipo', 'type']) || '').toUpperCase().includes('FAC')) {
      const pdf = await request(base, actor, 'GET', `/repartidor/document/invoice/${encodeURIComponent(String(year))}/${encodeURIComponent(String(series))}/${encodeURIComponent(String(numberValue))}/pdf?repartidorId=${encodeURIComponent(historyOwner)}`);
      emit(actor, 'pdf.invoice', pdf, { metrics: { bytes: pdf.bytes, pdf: pdf.contentType === 'application/pdf' ? 1 : 0 } });
    }
  }
  await get(base, actor, 'signature', `/repartidor/history/signature?repartidorId=${encodeURIComponent(concreteId)}`);
  await get(base, actor, 'signature.legacy', `/repartidor/history/legacy-signature/${encodeURIComponent(concreteId)}?repartidorId=${encodeURIComponent(concreteId)}`);
}
async function runMatrix(base, actor, id, panel, concreteDetailId) {
  for (const [name, path] of tabPaths(id, panel)) await get(base, actor, name, path);
  await objectivePages(base, actor, id);
  const chat = await request(base, actor, 'POST', '/chatbot/message', { message: 'Resumen operativo del repartidor actual', repartidorId: id });
  emit(actor, 'chatbot.message', chat);
  // ALL must never flow into a concrete document, signature, or albaran endpoint.
  await concreteDetails(base, actor, concreteDetailId);
}
function fieldValue(body, field) { return number(pick(data(body), field)); }
async function aggregateCheck(base, actor, ids) {
  const checks = [
    ['delivery', id => `/repartidor/history/delivery-summary/${encodeURIComponent(id)}?${month()}`, ['total', 'delivered', 'amount']],
    ['finance', id => `/repartidor-finanzas/summary/${encodeURIComponent(id)}?${month()}`, ['cobrado', 'liquidado', 'saldo']],
    ['collections', id => `/repartidor/collections/daily/${encodeURIComponent(id)}?${month()}`, ['collectable', 'collected', 'pending']],
    ['daily', id => `/repartidor-finanzas/daily-summary/${encodeURIComponent(id)}?date=${day()}`, ['saldo', 'cobros', 'gastos']],
  ];
  for (const [name, path, fields] of checks) {
    const fleet = await request(base, actor, 'GET', path('ALL'));
    let valid = fleet.response.ok; const sum = Object.fromEntries(fields.map(field => [field, 0]));
    for (const id of ids) {
      const result = await request(base, actor, 'GET', path(id));
      valid &&= result.response.ok;
      for (const field of fields) { const value = fieldValue(result.body, [field]); if (value === undefined) valid = false; else sum[field] += value; }
    }
    let matches = 0;
    for (const field of fields) { const actual = fieldValue(fleet.body, [field]); if (actual !== undefined && Math.abs(actual - sum[field]) <= ALL_TOLERANCE) matches += 1; }
    const verdict = valid && matches === fields.length ? 'PASS' : 'FAIL';
    process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint: `aggregate.${name}`, status: fleet.response.status, code: verdict === 'PASS' ? 'ALL_MATCHES_SUM' : 'ALL_SUM_MISMATCH', metrics: { actors: ids.length, fieldsMatched: matches, toleranceCents: Math.round(ALL_TOLERANCE * 100) }, origin: endpointOrigin('panel.finance'), verdict, latencyMs: fleet.latencyMs })}\n`);
  }
}
async function main() {
  let options; try { options = parseArgs(process.argv.slice(2)); } catch (_) { usage(); process.exitCode = 2; return; }
  if (options.help) { usage(); return; }
  if (!options.reads || !isLoopbackBase(options.base)) { usage(); process.exitCode = 2; return; }
  let source; try { source = JSON.parse(fs.readFileSync(ACTOR_FILE, 'utf8')); } catch (_) { process.stdout.write('{"code":"ACTOR_FILE_UNAVAILABLE"}\n'); process.exitCode = 2; return; }
  const reparto = await login(options.base, object(source.repartidor), 'repartidor', 'REPARTIDOR');
  const chiefRaw = object(source.jefeVentas);
  const chief = await login(options.base, chiefRaw, 'jefeVentas', 'JEFE_VENTAS', object(chiefRaw.switchRole).body);
  const ownSelector = await get(options.base, reparto, 'auth.repartidores', '/auth/repartidores');
  const chiefSelector = await get(options.base, chief, 'auth.repartidores', '/auth/repartidores');
  const ownIds = selectorCodes(ownSelector.body); const allIds = selectorCodes(chiefSelector.body);
  const repartoId = normalizeCode(reparto.claimedCode) || (ownIds.length === 1 ? ownIds[0] : undefined);
  if (!repartoId || !allIds.length || !allIds.includes(repartoId)) throw new Error('ACTOR_CODE_NOT_DERIVABLE');
  const anonymous = { label: 'anonymous', role: 'NONE', activeMode: 'NONE' };
  await get(options.base, anonymous, 'auth.required', `/repartidor/rutero/week/${encodeURIComponent(repartoId)}`);
  const foreignId = allIds.find(id => id !== repartoId);
  if (foreignId) await get(options.base, reparto, 'bola.foreignRutero', `/repartidor/rutero/week/${encodeURIComponent(foreignId)}`);
  await runMatrix(options.base, reparto, repartoId, false, repartoId);
  await runMatrix(options.base, chief, repartoId, true, repartoId);
  await runMatrix(options.base, chief, 'ALL', true, repartoId);
  await aggregateCheck(options.base, chief, allIds);
}
main().catch(error => { process.stdout.write(`${JSON.stringify({ code: /^[A-Z_]+$/.test(error.message || '') ? error.message : 'CERTIFICATION_ABORTED' })}\n`); process.exitCode = 1; });
