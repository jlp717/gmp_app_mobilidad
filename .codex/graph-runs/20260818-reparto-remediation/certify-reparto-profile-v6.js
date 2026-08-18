#!/usr/bin/env node
'use strict';

/* Local, read-only reparto certification. JSONL output intentionally excludes
 * credentials, tokens, document/customer ids, names and response text. */
const fs = require('node:fs');
const ACTOR_FILE = 'C:/Users/Javier/AppData/Local/Temp/gmp-cert-actors.json';
const DEFAULT_BASE = 'http://127.0.0.1:3336/api';
const UA = 'GMP-App/1.0 Dart/3.0';
const TIMEOUT_MS = 45_000;
const PAGE_SIZE = 100;
const MAX_OBJECTIVE_PAGES = 40;
const TOLERANCE = 0.01;
let failures = 0;

function usage() { process.stdout.write('Usage: node certify-reparto-profile-v6.js --reads [--base http://127.0.0.1:3336/api]\n'); }
function args(argv) { const out = { base: DEFAULT_BASE, reads: false }; for (let i = 0; i < argv.length; i += 1) { if (argv[i] === '--reads') out.reads = true; else if (argv[i] === '--base') out.base = argv[++i] || ''; else if (argv[i] === '--help' || argv[i] === '-h') out.help = true; else throw new Error('INVALID_ARGUMENT'); } return out; }
function localBase(value) { try { const u = new URL(value); return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === '3336' && (u.pathname === '/api' || u.pathname === '/api/'); } catch (_) { return false; } }
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function data(value) { const top = obj(value); return obj(top.data) ? top.data : top; }
function list(value) { const top = obj(value); const nested = obj(top.data); for (const candidate of [top.data, top.items, top.rows, top.repartidores, top.documents, nested.items, nested.rows, nested.repartidores, nested.documents]) if (Array.isArray(candidate)) return candidate; return []; }
function pick(value, names) { const source = obj(value); for (const name of names) if (source[name] != null) return source[name]; return undefined; }
function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function code(value, success) { const text = typeof value === 'string' ? value : ''; return success ? 'OK' : (/^[A-Z][A-Z0-9_:-]{0,79}$/.test(text) ? text : 'HTTP_ERROR'); }
function origin(endpoint) { if (/^(auth|chatbot)/.test(endpoint)) return 'API'; if (/^(order|signature|receipt)/.test(endpoint)) return 'TEST_APP'; return 'DSEDAC+TEST_OVERLAY'; }
function numeric(body, aliases) { return num(pick(data(body), aliases)); }
function endpointMetrics(endpoint, body) {
  const metrics = {}; const add = (name, aliases) => { const value = numeric(body, aliases); if (value !== undefined && Object.keys(metrics).length < 3) metrics[name] = value; };
  if (endpoint === 'panel.delivery') { add('total', ['total', 'totalDeliveries', 'totalEntregas']); add('delivered', ['delivered', 'entregados']); add('amount', ['amount', 'importe', 'importeTotal', 'totalAmount']); }
  else if (endpoint === 'panel.finance') { add('collected', ['cobrado', 'collected', 'totalCollected']); add('liquidated', ['liquidado', 'liquidated', 'totalLiquidated']); add('balance', ['saldo', 'balance']); }
  else if (endpoint === 'panel.collections') { add('collectable', ['collectable', 'cobrable', 'importeCobrable', 'totalPendiente']); add('collected', ['collected', 'cobrado', 'importeCobrado']); add('pending', ['pending', 'pendiente', 'importePendiente']); }
  else if (/^(liquidacion|cuentas)/.test(endpoint)) { add('balance', ['saldo', 'balance', 'aIngresar']); add('collections', ['cobros', 'collections', 'totalCobros']); add('expenses', ['gastos', 'expenses', 'totalGastos']); }
  else if (endpoint === 'commissions.summary') { add('delivered', ['delivered', 'entregado', 'importeEntregado']); add('collected', ['collected', 'cobrado', 'importeCobrado']); add('percentage', ['percentage', 'porcentaje', 'pct']); }
  else { metrics.count = list(body).length; add('total', ['total', 'totalCount', 'totalItems', 'pageTotal']); add('amount', ['amount', 'importe', 'importeTotal', 'importePendiente']); }
  return metrics;
}
function shape(endpoint, body, contentType) {
  if (/^(pdf\.|receipt\.|signature\.|albaran)/.test(endpoint)) return contentType === 'application/pdf' || contentType.startsWith('image/') || contentType.includes('json');
  const payload = data(body);
  if (!payload || typeof payload !== 'object') return false;
  if (/^(clientes|history|vencimientos|objectives|history\.documents|rutero\.pending|rutero\.week|rutero\.order|rutero\.geo)/.test(endpoint)) return Array.isArray(list(body)) || num(pick(payload, ['total', 'totalCount', 'totalItems'])) !== undefined;
  return true;
}
function emit(actor, endpoint, result, expected = [200], extra = {}) {
  const pass = expected.includes(result.response.status) && shape(endpoint, result.body, result.contentType);
  if (!pass) failures += 1;
  process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint, status: result.response.status, expected, code: code(pick(data(result.body), ['code', 'errorCode']), pass), metrics: endpointMetrics(endpoint, result.body), origin: origin(endpoint), verdict: pass ? 'PASS' : 'FAIL', latencyMs: result.latencyMs, ...extra })}\n`);
  return pass;
}
function localFail(actor, endpoint, error) { failures += 1; process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint, status: 0, expected: [200], code: error, metrics: {}, origin: origin(endpoint), verdict: 'FAIL', latencyMs: 0 })}\n`); }
async function request(base, actor, method, path, body) {
  const headers = { Accept: 'application/json', 'User-Agent': UA }; if (actor && actor.token) headers.Authorization = `Bearer ${actor.token}`; if (body !== undefined) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  try {
    const expected = new URL(`${base}${path}`);
    const response = await fetch(expected, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const final = new URL(response.url);
    if (final.protocol !== 'http:' || final.hostname !== '127.0.0.1' || final.port !== '3336') throw new Error('NON_LOOPBACK_RESPONSE');
    const type = response.headers.get('content-type') || ''; const json = type.includes('json') ? await response.json().catch(() => ({})) : {};
    return { response, body: json, contentType: type.split(';')[0], bytes: num(response.headers.get('content-length')) || 0, latencyMs: Date.now() - started };
  } catch (_) { return { response: { status: 0 }, body: { code: 'REQUEST_FAILED' }, contentType: '', bytes: 0, latencyMs: Date.now() - started }; }
}
async function get(base, actor, endpoint, path, expected = [200], extra) { const result = await request(base, actor, 'GET', path); emit(actor, endpoint, result, expected, extra); return result; }
function normalize(value) { const raw = String(value == null ? '' : value).trim(); return /^\d{1,3}$/.test(raw) ? raw.padStart(2, '0') : undefined; }
function authFacts(body) { const payload = data(body); const user = obj(payload.user || payload.usuario || payload); return { token: pick(payload, ['token', 'accessToken', 'jwt']) || pick(user, ['token', 'accessToken', 'jwt']), role: String(pick(user, ['role', 'rol']) || pick(payload, ['role', 'rol']) || ''), activeMode: String(pick(payload, ['activeMode', 'active_mode']) || pick(user, ['activeMode', 'active_mode']) || ''), code: normalize(pick(user, ['repartidorId', 'repartidorCodigo', 'codigoRepartidor', 'deliveryPersonId'])) }; }
async function login(base, raw, label, requiredRole, switchBody) {
  if (typeof raw.username !== 'string' || typeof raw.password !== 'string') throw new Error('ACTOR_FILE_INVALID');
  const unknown = { label, role: 'UNKNOWN', activeMode: 'UNKNOWN' };
  const initialResponse = await request(base, null, 'POST', '/auth/login', { username: raw.username, password: raw.password });
  const initialFacts = authFacts(initialResponse.body); const initial = { ...unknown, ...initialFacts }; emit(initial, 'auth.login', initialResponse);
  if (initialResponse.response.status !== 200 || typeof initial.token !== 'string' || initial.token.length < 16 || initial.role !== requiredRole) throw new Error('AUTH_CLAIMS_INVALID');
  if (!switchBody) return initial;
  const switchedResponse = await request(base, initial, 'POST', '/auth/switch-role', switchBody);
  const switchedFacts = authFacts(switchedResponse.body); const switched = { ...initial, ...switchedFacts }; // explicitly replaces the JWT.
  emit(switched, 'auth.switchRole', switchedResponse);
  if (switchedResponse.response.status !== 200 || typeof switched.token !== 'string' || switched.token.length < 16 || switched.role !== requiredRole || switched.activeMode !== 'REPARTIDOR') throw new Error('SWITCH_CLAIMS_INVALID');
  return switched;
}
function selector(body) { return [...new Set(list(body).map(row => normalize(pick(row, ['codigo', 'code', 'id', 'repartidorId']))).filter(Boolean))].sort((a, b) => Number(a) - Number(b)); }
function fleet(ids) { return ids.join(','); } // Raw CSV is encoded once by pathParam.
function pathParam(value) { return encodeURIComponent(value); }
function today() { return new Date().toISOString().slice(0, 10); }
function month() { const now = new Date(); return `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`; }
function documentIdentity(row, owner) {
  const candidate = { owner: normalize(pick(row, ['repartidorId', 'repartidor', 'codigoRepartidor', 'driverId'])), number: pick(row, ['numero', 'NUMERO', 'albaran', 'number']), year: pick(row, ['ejercicio', 'EJERCICIO', 'year']), serie: pick(row, ['serie', 'SERIE']), terminal: pick(row, ['terminal', 'TERMINAL']), client: pick(row, ['cliente', 'CLIENTE', 'CODCLIENTE', 'clientId']), deliveryId: pick(row, ['entregaId', 'deliveryId', 'idEntrega', 'ID_ENTREGA']), confirmationId: pick(row, ['confirmationId', 'confirmacionId', 'idConfirmacion']) };
  return candidate.owner === owner && candidate.number != null && candidate.year != null && candidate.serie != null && candidate.terminal != null && candidate.client != null ? candidate : undefined;
}
function tabs(id, panel) {
  const value = pathParam(id); const core = [['clientes', `/repartidor/history/clients/${value}?limit=50&offset=0`], ['rutero.week', `/repartidor/rutero/week/${value}`], ['rutero.pending', `/entregas/pendientes/${value}?date=${today()}&limit=50&offset=0`], ['paymentConditions', '/entregas/payment-conditions'], ['liquidacion.daily', `/repartidor-finanzas/daily-summary/${value}?date=${today()}`], ['liquidacion.breakdown', `/repartidor-finanzas/liquidaciones/${value}/desglose?date=${today()}`], ['cuentas', `/repartidor-finanzas/cuentas/${value}?date=${today()}`], ['vencimientos', `/repartidor-finanzas/vencimientos/${value}?limit=50&offset=0`], ['evolution', `/repartidor-finanzas/evolution/${value}`], ['commissions.summary', `/repartidor-finanzas/commissions/summary/${value}`], ['commissions.tiers', '/repartidor-finanzas/commissions/tiers'], ['history', `/repartidor/history/${value}?limit=50&offset=0`], ['objectives', `/repartidor/history/objectives/${value}`], ['rutero.order', `/repartidor/rutero/order/${value}?date=${today()}`], ['rutero.geo', `/repartidor/rutero/stops-geo/${value}?date=${today()}`], ['chatbot.health', '/chatbot/health']];
  return panel ? [['panel.delivery', `/repartidor/history/delivery-summary/${value}?${month()}`], ['panel.finance', `/repartidor-finanzas/summary/${value}?${month()}`], ['panel.collections', `/repartidor/collections/daily/${value}?${month()}`], ...core] : core;
}
async function objectivePages(base, actor, id) { let offset = 0; for (let page = 0; page < MAX_OBJECTIVE_PAGES; page += 1) { const result = await get(base, actor, 'objectives.detail', `/repartidor/history/objectives-detail/${pathParam(id)}?limit=${PAGE_SIZE}&offset=${offset}`); if (result.response.status !== 200) return; const count = list(result.body).length; const total = numeric(result.body, ['total', 'totalCount', 'totalItems']); if (total === undefined) return localFail(actor, 'objectives.detail', 'OBJECTIVES_TOTAL_MISSING'); if (count === 0 || offset + count >= total) return; offset += count; } localFail(actor, 'objectives.detail', 'OBJECTIVES_PAGE_BOUND'); }
async function concreteDetails(base, actor, concreteId, clientSelector) {
  const pending = await get(base, actor, 'rutero.pending.detailSeed', `/entregas/pendientes/${pathParam(concreteId)}?date=${today()}&limit=1&offset=0`);
  const doc = documentIdentity(list(pending.body)[0], concreteId); if (!doc) return localFail(actor, 'albaran', 'DOCUMENT_IDENTITY_MISSING');
  const query = new URLSearchParams({ serie: String(doc.serie), terminal: String(doc.terminal), cliente: String(doc.client), repartidorId: doc.owner });
  await get(base, actor, 'albaran', `/entregas/albaran/${pathParam(doc.number)}/${pathParam(doc.year)}?${query}`);
  const albaranPdf = await request(base, actor, 'GET', `/repartidor/document/albaran/${pathParam(doc.year)}/${pathParam(doc.serie)}/${pathParam(doc.terminal)}/${pathParam(doc.number)}/pdf?repartidorId=${pathParam(doc.owner)}`); emit(actor, 'pdf.albaran', albaranPdf, [200], { metrics: { bytes: albaranPdf.bytes, pdf: albaranPdf.contentType === 'application/pdf' ? 1 : 0 } });
  if (doc.deliveryId != null) await get(base, actor, 'signature.delivery', `/repartidor/entregas/${pathParam(doc.deliveryId)}/firma?repartidorId=${pathParam(doc.owner)}`); else localFail(actor, 'signature.delivery', 'DELIVERY_ID_MISSING');
  if (doc.confirmationId != null) await get(base, actor, 'receipt.get', `/repartidor-finanzas/confirmations/${pathParam(doc.confirmationId)}/receipt?repartidorId=${pathParam(doc.owner)}`); else localFail(actor, 'receipt.get', 'CONFIRMATION_ID_MISSING');
  const isFleet = clientSelector.includes(','); const clients = await get(base, actor, isFleet ? 'clientes.all.drillSeed' : 'clientes.drillSeed', `/repartidor/history/clients/${pathParam(clientSelector)}?limit=1&offset=0`);
  const clientRow = list(clients.body)[0] || {}; const client = pick(clientRow, ['clientId', 'clienteId', 'CODCLIENTE', 'cliente']); const owner = normalize(pick(clientRow, ['repartidorId', 'repartidor', 'codigoRepartidor', 'driverId']));
  if (client == null || !owner || (isFleet ? !clientSelector.split(',').includes(owner) : owner !== concreteId)) return localFail(actor, 'history.documents', 'CLIENT_OWNER_IDENTITY_MISSING');
  const documents = await get(base, actor, isFleet ? 'history.documents.all' : 'history.documents', `/repartidor/history/documents/${pathParam(client)}?limit=1&offset=0&repartidorId=${pathParam(owner)}`);
  const invoice = list(documents.body).find(item => String(pick(item, ['tipo', 'type']) || '').toUpperCase().includes('FAC'));
  if (invoice) { const year = pick(invoice, ['ejercicio', 'year']); const serie = pick(invoice, ['serie']); const number = pick(invoice, ['numero', 'number']); if (year == null || serie == null || number == null) localFail(actor, 'pdf.invoice', 'INVOICE_IDENTITY_MISSING'); else { const result = await request(base, actor, 'GET', `/repartidor/document/invoice/${pathParam(year)}/${pathParam(serie)}/${pathParam(number)}/pdf?repartidorId=${pathParam(owner)}`); emit(actor, 'pdf.invoice', result, [200], { metrics: { bytes: result.bytes, pdf: result.contentType === 'application/pdf' ? 1 : 0 } }); } }
  const due = await get(base, actor, 'vencimientos.detailSeed', `/repartidor-finanzas/vencimientos/${pathParam(concreteId)}?limit=1&offset=0`); const dueId = pick(list(due.body)[0] || {}, ['docId', 'documentId', 'idDocumento', 'id']); if (dueId == null) localFail(actor, 'vencimientos.detail', 'VENCIMIENTO_IDENTITY_MISSING'); else await get(base, actor, 'vencimientos.detail', `/repartidor-finanzas/vencimientos/${pathParam(concreteId)}/${pathParam(dueId)}/detalle`);
}
async function matrix(base, actor, id, panel, concreteId) { for (const [endpoint, path] of tabs(id, panel)) await get(base, actor, endpoint, path); await objectivePages(base, actor, id); const chatbot = await request(base, actor, 'POST', '/chatbot/message', { message: 'Resumen operativo del repartidor actual', repartidorId: id }); emit(actor, 'chatbot.message', chatbot); if (concreteId) await concreteDetails(base, actor, concreteId, id); }
function aggregateFields(name) { if (name === 'delivery') return [['total', ['total', 'totalDeliveries', 'totalEntregas']], ['delivered', ['delivered', 'entregados']], ['amount', ['amount', 'importe', 'importeTotal', 'totalAmount']]]; if (name === 'finance') return [['collected', ['cobrado', 'collected', 'totalCollected']], ['liquidated', ['liquidado', 'liquidated', 'totalLiquidated']], ['balance', ['saldo', 'balance']]]; if (name === 'collections') return [['collectable', ['collectable', 'cobrable', 'importeCobrable', 'totalPendiente']], ['collected', ['collected', 'cobrado', 'importeCobrado']], ['pending', ['pending', 'pendiente', 'importePendiente']]]; return [['balance', ['saldo', 'balance', 'aIngresar']], ['collections', ['cobros', 'collections', 'totalCobros']], ['expenses', ['gastos', 'expenses', 'totalGastos']]]; }
async function aggregates(base, actor, ids) { const checks = [['delivery', id => `/repartidor/history/delivery-summary/${pathParam(id)}?${month()}`], ['finance', id => `/repartidor-finanzas/summary/${pathParam(id)}?${month()}`], ['collections', id => `/repartidor/collections/daily/${pathParam(id)}?${month()}`], ['daily', id => `/repartidor-finanzas/daily-summary/${pathParam(id)}?date=${today()}`]]; for (const [name, build] of checks) { const fields = aggregateFields(name); const all = await request(base, actor, 'GET', build(fleet(ids))); let valid = all.response.status === 200; const sums = Object.fromEntries(fields.map(([key]) => [key, 0])); for (const id of ids) { const one = await request(base, actor, 'GET', build(id)); valid &&= one.response.status === 200; for (const [key, aliases] of fields) { const value = numeric(one.body, aliases); if (value === undefined) valid = false; else sums[key] += value; } } let matched = 0; for (const [key, aliases] of fields) { const total = numeric(all.body, aliases); if (total !== undefined && Math.abs(total - sums[key]) <= TOLERANCE) matched += 1; } const pass = valid && matched === fields.length; if (!pass) failures += 1; process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint: `aggregate.${name}`, status: all.response.status, expected: [200], code: pass ? 'ALL_MATCHES_SUM' : 'ALL_SUM_MISMATCH', metrics: { actors: ids.length, fieldsMatched: matched, toleranceCents: 1 }, origin: origin('panel.finance'), verdict: pass ? 'PASS' : 'FAIL', latencyMs: all.latencyMs })}\n`); } }
async function main() { let options; try { options = args(process.argv.slice(2)); } catch (_) { usage(); process.exitCode = 2; return; } if (options.help) return usage(); if (!options.reads || !localBase(options.base)) { usage(); process.exitCode = 2; return; } let source; try { source = JSON.parse(fs.readFileSync(ACTOR_FILE, 'utf8')); } catch (_) { process.stdout.write('{"code":"ACTOR_FILE_UNAVAILABLE"}\n'); process.exitCode = 2; return; } const repartidor = await login(options.base, obj(source.repartidor), 'repartidor', 'REPARTIDOR'); if (repartidor.activeMode !== 'REPARTIDOR') throw new Error('REPARTIDOR_MODE_INVALID'); const jefeRaw = obj(source.jefeVentas); const jefe = await login(options.base, jefeRaw, 'jefeVentas', 'JEFE_VENTAS', obj(obj(jefeRaw.switchRole).body)); const mine = await get(options.base, repartidor, 'auth.repartidores', '/auth/repartidores'); const chiefs = await get(options.base, jefe, 'auth.repartidores', '/auth/repartidores'); const mineIds = selector(mine.body); const chiefIds = selector(chiefs.body); if (mineIds.length !== 1 || !repartidor.code || mineIds[0] !== repartidor.code) throw new Error('REPARTIDOR_SELECTOR_INVALID'); if (!chiefIds.length || !chiefIds.includes(repartidor.code)) throw new Error('JEFE_SELECTOR_INVALID'); const noAuth = { label: 'anonymous', role: 'NONE', activeMode: 'NONE' }; await get(options.base, noAuth, 'auth.required', `/repartidor/rutero/week/${pathParam(repartidor.code)}`, [401]); const foreign = chiefIds.find(id => id !== repartidor.code); if (!foreign) throw new Error('FOREIGN_BOLA_SEED_UNAVAILABLE'); await get(options.base, repartidor, 'bola.foreignRutero', `/repartidor/rutero/week/${pathParam(foreign)}`, [403]); await matrix(options.base, repartidor, repartidor.code, false, repartidor.code); await matrix(options.base, jefe, repartidor.code, true, repartidor.code); await matrix(options.base, jefe, fleet(chiefIds), true, repartidor.code); await aggregates(options.base, jefe, chiefIds); if (failures) process.exitCode = 1; }
main().catch(error => { process.stdout.write(`${JSON.stringify({ code: /^[A-Z_]+$/.test(error.message || '') ? error.message : 'CERTIFICATION_ABORTED' })}\n`); process.exitCode = 1; });
