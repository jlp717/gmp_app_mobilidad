#!/usr/bin/env node
'use strict';

/*
 * Reparto certification probe, deliberately restricted to the local isolated
 * runtime.  It never sends a delivery, collection, order, email, receipt, or
 * liquidation mutation.  Output is JSONL evidence with no credentials, JWTs,
 * response text, document identity, customer identity, or user identity.
 */
const fs = require('node:fs');

const ACTOR_FILE = 'C:/Users/Javier/AppData/Local/Temp/gmp-cert-actors.json';
const DEFAULT_BASE = 'http://127.0.0.1:3336/api';
const UA = 'GMP-App/1.0 Dart/3.0';
const TIMEOUT_MS = 45_000;
const PAGE_SIZE = 100;
const MAX_OBJECTIVE_PAGES = 40;
const TOLERANCE = 0.01;
let failures = 0;

function usage() { process.stdout.write('Usage: node certify-reparto-profile-v5.js --reads [--base http://127.0.0.1:3336/api]\n'); }
function parseArgs(argv) {
  const result = { base: DEFAULT_BASE, reads: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--reads') result.reads = true;
    else if (argv[index] === '--base') result.base = argv[++index] || '';
    else if (argv[index] === '--help' || argv[index] === '-h') result.help = true;
    else throw new Error('INVALID_ARGUMENT');
  }
  return result;
}
function loopbackBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '3336' && (url.pathname === '/api' || url.pathname === '/api/');
  } catch (_) { return false; }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function root(value) { const valueRoot = object(value); return object(valueRoot.data) ? valueRoot.data : valueRoot; }
function rows(value) {
  const valueRoot = object(value); const nested = object(valueRoot.data);
  for (const candidate of [valueRoot.data, valueRoot.items, valueRoot.rows, valueRoot.repartidores, valueRoot.documents, nested.items, nested.rows, nested.repartidores, nested.documents]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
function pick(value, keys) { const source = object(value); for (const key of keys) if (source[key] != null) return source[key]; return undefined; }
function numeric(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function safeCode(value, successful) {
  if (successful) return 'OK';
  const candidate = typeof value === 'string' ? value : '';
  return /^[A-Z][A-Z0-9_:-]{0,79}$/.test(candidate) ? candidate : 'HTTP_ERROR';
}
function originFor(endpoint) {
  if (/^(auth|chatbot)/.test(endpoint)) return 'API';
  if (/^(order|signature|receipt)/.test(endpoint)) return 'TEST_APP';
  return 'DSEDAC+TEST_OVERLAY';
}
function metric(value, keys) { return numeric(pick(root(value), keys)); }
function metrics(endpoint, body) {
  const source = root(body); const result = {};
  const add = (name, keys) => { const value = numeric(pick(source, keys)); if (value !== undefined && Object.keys(result).length < 3) result[name] = value; };
  if (endpoint === 'panel.delivery') { add('total', ['total', 'totalDeliveries', 'totalEntregas']); add('delivered', ['delivered', 'entregados']); add('amount', ['amount', 'importe', 'importeTotal', 'totalAmount']); }
  else if (endpoint === 'panel.finance') { add('collected', ['cobrado', 'collected', 'totalCollected']); add('liquidated', ['liquidado', 'liquidated', 'totalLiquidated']); add('balance', ['saldo', 'balance']); }
  else if (endpoint === 'panel.collections') { add('collectable', ['collectable', 'cobrable', 'importeCobrable', 'totalPendiente']); add('collected', ['collected', 'cobrado', 'importeCobrado']); add('pending', ['pending', 'pendiente', 'importePendiente']); }
  else if (/^(liquidacion|cuentas)/.test(endpoint)) { add('balance', ['saldo', 'balance', 'aIngresar']); add('collections', ['cobros', 'collections', 'totalCobros']); add('expenses', ['gastos', 'expenses', 'totalGastos']); }
  else if (endpoint === 'commissions.summary') { add('delivered', ['delivered', 'entregado', 'importeEntregado']); add('collected', ['collected', 'cobrado', 'importeCobrado']); add('percentage', ['percentage', 'porcentaje', 'pct']); }
  else { result.count = rows(body).length; add('total', ['total', 'totalCount', 'totalItems', 'pageTotal']); add('amount', ['amount', 'importe', 'importeTotal', 'importePendiente']); }
  return result;
}
function validBody(endpoint, body) {
  const payload = root(body);
  if (!payload || typeof payload !== 'object') return false;
  if (/^(clientes|history|vencimientos|objectives|history\.documents|rutero\.pending|rutero\.week|rutero\.order|rutero\.geo)/.test(endpoint)) return Array.isArray(rows(body)) || Number.isFinite(numeric(pick(payload, ['total', 'totalCount', 'totalItems'])));
  if (/^(pdf\.|receipt\.|signature\.|albaran)/.test(endpoint)) return true; // content type / HTTP is the contract for binary endpoints.
  return true;
}
function emit(actor, endpoint, result, expected = [200], extra = {}) {
  const accepted = expected.includes(result.response.status) && validBody(endpoint, result.body);
  const code = accepted ? 'OK' : safeCode(pick(root(result.body), ['code', 'errorCode']), false);
  const verdict = accepted ? 'PASS' : 'FAIL';
  if (!accepted) failures += 1;
  process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint, status: result.response.status, expected, code, metrics: metrics(endpoint, result.body), origin: originFor(endpoint), verdict, latencyMs: result.latencyMs, ...extra })}\n`);
  return accepted;
}
function emitLocalFailure(actor, endpoint, code) {
  failures += 1;
  process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint, status: 0, expected: [200], code, metrics: {}, origin: originFor(endpoint), verdict: 'FAIL', latencyMs: 0 })}\n`);
}
async function request(base, actor, method, path, body) {
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  if (actor && actor.token) headers.Authorization = `Bearer ${actor.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const expectedUrl = new URL(`${base}${path}`);
  const started = Date.now();
  try {
    const response = await fetch(expectedUrl, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'http:' || finalUrl.hostname !== '127.0.0.1' || finalUrl.port !== '3336') throw new Error('NON_LOOPBACK_RESPONSE');
    const contentType = response.headers.get('content-type') || '';
    const parsed = contentType.includes('json') ? await response.json().catch(() => ({})) : {};
    return { response, body: parsed, contentType: contentType.split(';')[0], bytes: numeric(response.headers.get('content-length')) || 0, latencyMs: Date.now() - started };
  } catch (_) { return { response: { status: 0, ok: false }, body: { code: 'REQUEST_FAILED' }, contentType: '', bytes: 0, latencyMs: Date.now() - started }; }
}
async function get(base, actor, endpoint, path, expected = [200], extra) { const result = await request(base, actor, 'GET', path); emit(actor, endpoint, result, expected, extra); return result; }
function facts(body) {
  const payload = root(body); const user = object(payload.user || payload.usuario || payload);
  return { token: pick(payload, ['token', 'accessToken', 'jwt']) || pick(user, ['token', 'accessToken', 'jwt']), role: String(pick(user, ['role', 'rol']) || pick(payload, ['role', 'rol']) || ''), activeMode: String(pick(payload, ['activeMode', 'active_mode']) || pick(user, ['activeMode', 'active_mode']) || ''), code: normalizeCode(pick(user, ['repartidorId', 'repartidorCodigo', 'codigoRepartidor', 'deliveryPersonId'])) };
}
async function login(base, raw, label, requiredRole, switchBody) {
  if (typeof raw.username !== 'string' || typeof raw.password !== 'string') throw new Error('ACTOR_FILE_INVALID');
  const initial = { label, role: 'UNKNOWN', activeMode: 'UNKNOWN' };
  const loggedIn = await request(base, null, 'POST', '/auth/login', { username: raw.username, password: raw.password });
  const loginFacts = facts(loggedIn.body); const loginActor = { ...initial, ...loginFacts };
  emit(loginActor, 'auth.login', loggedIn, [200]);
  if (loggedIn.response.status !== 200 || typeof loginFacts.token !== 'string' || loginFacts.token.length < 16 || loginFacts.role !== requiredRole) throw new Error('AUTH_CLAIMS_INVALID');
  if (!switchBody) return loginActor;
  const switched = await request(base, loginActor, 'POST', '/auth/switch-role', switchBody);
  const switchedFacts = facts(switched.body); const actor = { ...loginActor, ...switchedFacts }; // switch token replaces the initial token.
  emit(actor, 'auth.switchRole', switched, [200]);
  if (switched.response.status !== 200 || typeof switchedFacts.token !== 'string' || switchedFacts.token.length < 16 || switchedFacts.role !== requiredRole || switchedFacts.activeMode !== 'REPARTIDOR') throw new Error('SWITCH_CLAIMS_INVALID');
  return actor;
}
function normalizeCode(value) { const text = String(value == null ? '' : value).trim(); return /^\d{1,3}$/.test(text) ? text.padStart(2, '0') : undefined; }
function selectorCodes(body) { return [...new Set(rows(body).map(row => normalizeCode(pick(row, ['codigo', 'code', 'id', 'repartidorId']))).filter(Boolean))].sort((left, right) => Number(left) - Number(right)); }
function csv(ids) { return ids.map(encodeURIComponent).join('%2C'); }
function today() { return new Date().toISOString().slice(0, 10); }
function currentMonth() { const now = new Date(); return `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`; }
function explicitDocument(row, owner) {
  const document = { owner: normalizeCode(pick(row, ['repartidorId', 'repartidor', 'codigoRepartidor', 'driverId'])), number: pick(row, ['numero', 'NUMERO', 'albaran', 'number']), year: pick(row, ['ejercicio', 'EJERCICIO', 'year']), serie: pick(row, ['serie', 'SERIE']), terminal: pick(row, ['terminal', 'TERMINAL']), client: pick(row, ['cliente', 'CLIENTE', 'CODCLIENTE', 'clientId']), deliveryId: pick(row, ['entregaId', 'deliveryId', 'idEntrega', 'ID_ENTREGA']), confirmationId: pick(row, ['confirmationId', 'confirmacionId', 'idConfirmacion']) };
  return document.owner === owner && document.number != null && document.year != null && document.serie != null && document.terminal != null && document.client != null ? document : undefined;
}
function tabPaths(selector, withPanel) {
  const id = encodeURIComponent(selector);
  const paths = [
    ['clientes', `/repartidor/history/clients/${id}?limit=50&offset=0`], ['rutero.week', `/repartidor/rutero/week/${id}`], ['rutero.pending', `/entregas/pendientes/${id}?date=${today()}&limit=50&offset=0`], ['paymentConditions', '/entregas/payment-conditions'],
    ['liquidacion.daily', `/repartidor-finanzas/daily-summary/${id}?date=${today()}`], ['liquidacion.breakdown', `/repartidor-finanzas/liquidaciones/${id}/desglose?date=${today()}`], ['cuentas', `/repartidor-finanzas/cuentas/${id}?date=${today()}`],
    ['vencimientos', `/repartidor-finanzas/vencimientos/${id}?limit=50&offset=0`], ['evolution', `/repartidor-finanzas/evolution/${id}`], ['commissions.summary', `/repartidor-finanzas/commissions/summary/${id}`], ['commissions.tiers', '/repartidor-finanzas/commissions/tiers'],
    ['history', `/repartidor/history/${id}?limit=50&offset=0`], ['objectives', `/repartidor/history/objectives/${id}`], ['rutero.order', `/repartidor/rutero/order/${id}?date=${today()}`], ['rutero.geo', `/repartidor/rutero/stops-geo/${id}?date=${today()}`], ['chatbot.health', '/chatbot/health'],
  ];
  return withPanel ? [['panel.delivery', `/repartidor/history/delivery-summary/${id}?${currentMonth()}`], ['panel.finance', `/repartidor-finanzas/summary/${id}?${currentMonth()}`], ['panel.collections', `/repartidor/collections/daily/${id}?${currentMonth()}`], ...paths] : paths;
}
async function objectivePages(base, actor, selector) {
  let offset = 0;
  for (let page = 0; page < MAX_OBJECTIVE_PAGES; page += 1) {
    const result = await get(base, actor, 'objectives.detail', `/repartidor/history/objectives-detail/${encodeURIComponent(selector)}?limit=${PAGE_SIZE}&offset=${offset}`);
    if (result.response.status !== 200) return;
    const pageRows = rows(result.body); const total = numeric(pick(root(result.body), ['total', 'totalCount', 'totalItems']));
    if (total === undefined) { emitLocalFailure(actor, 'objectives.detail', 'OBJECTIVES_TOTAL_MISSING'); return; }
    if (pageRows.length === 0 || offset + pageRows.length >= total) return;
    offset += pageRows.length;
  }
  emitLocalFailure(actor, 'objectives.detail', 'OBJECTIVES_PAGE_BOUND');
}
async function concreteEvidence(base, actor, id, allClientDrilldown) {
  const pending = await get(base, actor, 'rutero.pending.detailSeed', `/entregas/pendientes/${encodeURIComponent(id)}?date=${today()}&limit=1&offset=0`);
  const doc = explicitDocument(rows(pending.body)[0], id);
  if (!doc) { emitLocalFailure(actor, 'albaran', 'DOCUMENT_IDENTITY_MISSING'); return; }
  const documentQuery = new URLSearchParams({ serie: String(doc.serie), terminal: String(doc.terminal), cliente: String(doc.client), repartidorId: doc.owner });
  await get(base, actor, 'albaran', `/entregas/albaran/${encodeURIComponent(String(doc.number))}/${encodeURIComponent(String(doc.year))}?${documentQuery}`);
  const pdf = await request(base, actor, 'GET', `/repartidor/document/albaran/${encodeURIComponent(String(doc.year))}/${encodeURIComponent(String(doc.serie))}/${encodeURIComponent(String(doc.terminal))}/${encodeURIComponent(String(doc.number))}/pdf?repartidorId=${encodeURIComponent(doc.owner)}`);
  emit(actor, 'pdf.albaran', pdf, [200], { metrics: { bytes: pdf.bytes, pdf: pdf.contentType === 'application/pdf' ? 1 : 0 } });
  if (doc.deliveryId != null) await get(base, actor, 'signature.delivery', `/repartidor/entregas/${encodeURIComponent(String(doc.deliveryId))}/firma?repartidorId=${encodeURIComponent(doc.owner)}`);
  if (doc.confirmationId != null) await get(base, actor, 'receipt.get', `/repartidor-finanzas/confirmations/${encodeURIComponent(String(doc.confirmationId))}/receipt?repartidorId=${encodeURIComponent(doc.owner)}`);
  const clients = await get(base, actor, allClientDrilldown ? 'clientes.all.drillSeed' : 'clientes.drillSeed', `/repartidor/history/clients/${encodeURIComponent(allClientDrilldown ? csv([id]) : id)}?limit=1&offset=0`);
  const clientRow = rows(clients.body)[0] || {}; const client = pick(clientRow, ['clientId', 'clienteId', 'CODCLIENTE', 'cliente']); const owner = normalizeCode(pick(clientRow, ['repartidorId', 'repartidor', 'codigoRepartidor', 'driverId']));
  if (client == null || owner !== id) { emitLocalFailure(actor, 'history.documents', 'CLIENT_OWNER_IDENTITY_MISSING'); return; }
  const docs = await get(base, actor, allClientDrilldown ? 'history.documents.all' : 'history.documents', `/repartidor/history/documents/${encodeURIComponent(String(client))}?limit=1&offset=0&repartidorId=${encodeURIComponent(owner)}`);
  const invoice = rows(docs.body).find(item => String(pick(item, ['tipo', 'type']) || '').toUpperCase().includes('FAC'));
  if (invoice) {
    const invoiceYear = pick(invoice, ['ejercicio', 'year']); const invoiceSerie = pick(invoice, ['serie']); const invoiceNumber = pick(invoice, ['numero', 'number']);
    if (invoiceYear == null || invoiceSerie == null || invoiceNumber == null) emitLocalFailure(actor, 'pdf.invoice', 'INVOICE_IDENTITY_MISSING');
    else { const result = await request(base, actor, 'GET', `/repartidor/document/invoice/${encodeURIComponent(String(invoiceYear))}/${encodeURIComponent(String(invoiceSerie))}/${encodeURIComponent(String(invoiceNumber))}/pdf?repartidorId=${encodeURIComponent(owner)}`); emit(actor, 'pdf.invoice', result, [200], { metrics: { bytes: result.bytes, pdf: result.contentType === 'application/pdf' ? 1 : 0 } }); }
  }
  const vencimientos = await get(base, actor, 'vencimientos.detailSeed', `/repartidor-finanzas/vencimientos/${encodeURIComponent(id)}?limit=1&offset=0`);
  const vencimiento = rows(vencimientos.body)[0] || {}; const docId = pick(vencimiento, ['docId', 'documentId', 'idDocumento', 'id']);
  if (docId == null) emitLocalFailure(actor, 'vencimientos.detail', 'VENCIMIENTO_IDENTITY_MISSING');
  else await get(base, actor, 'vencimientos.detail', `/repartidor-finanzas/vencimientos/${encodeURIComponent(id)}/${encodeURIComponent(String(docId))}/detalle`);
}
async function matrix(base, actor, selector, panel, concreteId) {
  for (const [endpoint, path] of tabPaths(selector, panel)) await get(base, actor, endpoint, path);
  await objectivePages(base, actor, selector);
  const chatbot = await request(base, actor, 'POST', '/chatbot/message', { message: 'Resumen operativo del repartidor actual', repartidorId: selector });
  emit(actor, 'chatbot.message', chatbot, [200]);
  if (concreteId) await concreteEvidence(base, actor, concreteId, panel && selector.includes(','));
}
function aggregateFields(name) {
  if (name === 'delivery') return [['total', ['total', 'totalDeliveries', 'totalEntregas']], ['delivered', ['delivered', 'entregados']], ['amount', ['amount', 'importe', 'importeTotal', 'totalAmount']]];
  if (name === 'finance') return [['collected', ['cobrado', 'collected', 'totalCollected']], ['liquidated', ['liquidado', 'liquidated', 'totalLiquidated']], ['balance', ['saldo', 'balance']]];
  if (name === 'collections') return [['collectable', ['collectable', 'cobrable', 'importeCobrable', 'totalPendiente']], ['collected', ['collected', 'cobrado', 'importeCobrado']], ['pending', ['pending', 'pendiente', 'importePendiente']]];
  return [['balance', ['saldo', 'balance', 'aIngresar']], ['collections', ['cobros', 'collections', 'totalCobros']], ['expenses', ['gastos', 'expenses', 'totalGastos']]];
}
async function aggregateCheck(base, actor, ids) {
  const checks = [['delivery', id => `/repartidor/history/delivery-summary/${encodeURIComponent(id)}?${currentMonth()}`], ['finance', id => `/repartidor-finanzas/summary/${encodeURIComponent(id)}?${currentMonth()}`], ['collections', id => `/repartidor/collections/daily/${encodeURIComponent(id)}?${currentMonth()}`], ['daily', id => `/repartidor-finanzas/daily-summary/${encodeURIComponent(id)}?date=${today()}`]];
  for (const [name, buildPath] of checks) {
    const fields = aggregateFields(name); const fleet = await request(base, actor, 'GET', buildPath(csv(ids))); let valid = fleet.response.status === 200; let matched = 0;
    const sums = Object.fromEntries(fields.map(([key]) => [key, 0]));
    for (const id of ids) {
      const individual = await request(base, actor, 'GET', buildPath(id)); valid &&= individual.response.status === 200;
      for (const [key, aliases] of fields) { const value = metric(individual.body, aliases); if (value === undefined) valid = false; else sums[key] += value; }
    }
    for (const [key, aliases] of fields) { const fleetValue = metric(fleet.body, aliases); if (fleetValue !== undefined && Math.abs(fleetValue - sums[key]) <= TOLERANCE) matched += 1; }
    const pass = valid && matched === fields.length;
    if (!pass) failures += 1;
    process.stdout.write(`${JSON.stringify({ actor: actor.label, role: actor.role, activeMode: actor.activeMode, endpoint: `aggregate.${name}`, status: fleet.response.status, expected: [200], code: pass ? 'ALL_MATCHES_SUM' : 'ALL_SUM_MISMATCH', metrics: { actors: ids.length, fieldsMatched: matched, toleranceCents: 1 }, origin: originFor('panel.finance'), verdict: pass ? 'PASS' : 'FAIL', latencyMs: fleet.latencyMs })}\n`);
  }
}
async function main() {
  let options; try { options = parseArgs(process.argv.slice(2)); } catch (_) { usage(); process.exitCode = 2; return; }
  if (options.help) { usage(); return; }
  if (!options.reads || !loopbackBase(options.base)) { usage(); process.exitCode = 2; return; }
  let source; try { source = JSON.parse(fs.readFileSync(ACTOR_FILE, 'utf8')); } catch (_) { process.stdout.write('{"code":"ACTOR_FILE_UNAVAILABLE"}\n'); process.exitCode = 2; return; }
  const repartidor = await login(options.base, object(source.repartidor), 'repartidor', 'REPARTIDOR');
  if (repartidor.activeMode && repartidor.activeMode !== 'REPARTIDOR') throw new Error('REPARTIDOR_MODE_INVALID');
  const jefeSource = object(source.jefeVentas); const jefe = await login(options.base, jefeSource, 'jefeVentas', 'JEFE_VENTAS', object(object(jefeSource.switchRole).body));
  const ownSelector = await get(options.base, repartidor, 'auth.repartidores', '/auth/repartidores');
  const chiefSelector = await get(options.base, jefe, 'auth.repartidores', '/auth/repartidores');
  const ownIds = selectorCodes(ownSelector.body); const fleetIds = selectorCodes(chiefSelector.body);
  if (ownIds.length !== 1 || !repartidor.code || ownIds[0] !== repartidor.code) throw new Error('REPARTIDOR_SELECTOR_INVALID');
  if (!fleetIds.length || !fleetIds.includes(repartidor.code)) throw new Error('JEFE_SELECTOR_INVALID');
  const anonymous = { label: 'anonymous', role: 'NONE', activeMode: 'NONE' };
  await get(options.base, anonymous, 'auth.required', `/repartidor/rutero/week/${encodeURIComponent(repartidor.code)}`, [401]);
  const foreign = fleetIds.find(id => id !== repartidor.code);
  if (!foreign) throw new Error('FOREIGN_BOLA_SEED_UNAVAILABLE');
  await get(options.base, repartidor, 'bola.foreignRutero', `/repartidor/rutero/week/${encodeURIComponent(foreign)}`, [403]);
  await matrix(options.base, repartidor, repartidor.code, false, repartidor.code);
  await matrix(options.base, jefe, repartidor.code, true, repartidor.code);
  const fleet = csv(fleetIds);
  await matrix(options.base, jefe, fleet, true, repartidor.code); // fleet concrete evidence deliberately uses the selected repartidor only.
  await aggregateCheck(options.base, jefe, fleetIds);
  if (failures) process.exitCode = 1;
}
main().catch(error => { process.stdout.write(`${JSON.stringify({ code: /^[A-Z_]+$/.test(error.message || '') ? error.message : 'CERTIFICATION_ABORTED' })}\n`); process.exitCode = 1; });
