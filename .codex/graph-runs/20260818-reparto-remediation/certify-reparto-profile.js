#!/usr/bin/env node
'use strict';

/*
 * Read-only local certification harness for the Reparto profile.
 * It intentionally refuses non-loopback bases.  Authentication, role switch,
 * and the explicitly requested chatbot probe are the only POST requests.
 * Never log response bodies: they may contain credentials, PII, or tokens.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = 'http://127.0.0.1:3336/api';
const ACTORS_FILE = 'C:/Users/Javier/AppData/Local/Temp/gmp-cert-actors.json';
const USER_AGENT = 'GMP-App/1.0 Dart/3.0';
const MONEY_TOLERANCE = 0.01;

function usage() {
  process.stdout.write([
    'Usage: node certify-reparto-profile.js --reads [--base http://127.0.0.1:3336/api]',
    '',
    'Runs a local, evidence-only Reparto-profile certification. The base must be loopback.',
    'It reads the authorized actor file only in memory and never prints credentials or tokens.',
    'Allowed POSTs: auth/login, auth/switch-role, chatbot/message.'
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const result = { base: DEFAULT_BASE, reads: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--reads') result.reads = true;
    else if (arg === '--base') {
      index += 1;
      result.base = argv[index] || '';
    } else {
      throw new Error('INVALID_ARGUMENT');
    }
  }
  return result;
}

function isLoopbackApi(base) {
  try {
    const url = new URL(base);
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
      && /\/api\/?$/.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function output(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function scalar(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function envelope(body) {
  const root = objectOf(body);
  return objectOf(root.data && !Array.isArray(root.data) ? root.data : root);
}

function arrayOf(body) {
  const root = objectOf(body);
  for (const candidate of [root.data, root.items, root.rows, root.repartidores, root.documents]) {
    if (Array.isArray(candidate)) return candidate;
  }
  if (root.data && typeof root.data === 'object') {
    for (const candidate of [root.data.items, root.data.rows, root.data.repartidores, root.data.documents]) {
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

function firstDefined(source, keys) {
  const value = objectOf(source);
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function metricsFor(endpoint, body) {
  const data = envelope(body);
  const items = arrayOf(body);
  const number = (keys) => scalar(firstDefined(data, keys));
  const count = () => items.length;
  const result = {};
  const add = (name, value) => {
    if (Object.keys(result).length < 3 && value !== undefined) result[name] = value;
  };
  if (/delivery-summary/.test(endpoint)) {
    add('total', number(['total', 'totalDeliveries', 'totalEntregas']));
    add('delivered', number(['delivered', 'entregados']));
    add('amount', number(['amount', 'importe', 'importeTotal', 'totalAmount']));
  } else if (/finanzas\/summary/.test(endpoint)) {
    add('collected', number(['cobrado', 'collected', 'totalCollected']));
    add('liquidated', number(['liquidado', 'liquidated', 'totalLiquidated']));
    add('balance', number(['saldo', 'balance']));
  } else if (/collections\/daily/.test(endpoint)) {
    add('collectable', number(['collectable', 'cobrable', 'importeCobrable']));
    add('collected', number(['collected', 'cobrado', 'importeCobrado']));
    add('pending', number(['pending', 'pendiente', 'importePendiente']));
  } else if (/daily-summary/.test(endpoint) || /\/cuentas\//.test(endpoint)) {
    add('balance', number(['saldo', 'balance', 'aIngresar']));
    add('collections', number(['cobros', 'collections', 'totalCobros']));
    add('expenses', number(['gastos', 'expenses', 'totalGastos']));
  } else if (/commissions\/summary/.test(endpoint)) {
    add('delivered', number(['delivered', 'entregado', 'importeEntregado']));
    add('collected', number(['collected', 'cobrado', 'importeCobrado']));
    add('percentage', number(['percentage', 'porcentaje', 'pct']));
  } else if (/vencimientos/.test(endpoint)) {
    add('count', count());
    add('pending', number(['pending', 'pendiente', 'importePendiente']));
  } else if (/week|pendientes|history\/|\/clients\//.test(endpoint)) {
    add('count', count());
    add('total', number(['total', 'totalCount', 'totalItems']));
    add('amount', number(['amount', 'importe', 'importeTotal']));
  } else if (/evolution/.test(endpoint)) {
    add('months', count());
    add('collected', number(['collected', 'cobrado', 'totalCollected']));
  } else if (/objectives/.test(endpoint)) {
    add('count', count());
    add('pageTotal', number(['pageTotal', 'total']));
    add('grandTotal', number(['grandTotal']));
  } else {
    add('count', count());
    add('ok', typeof data.ok === 'boolean' ? data.ok : undefined);
  }
  return result;
}

function bodyCode(body) {
  const source = envelope(body);
  const code = firstDefined(source, ['code', 'errorCode']);
  return typeof code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : undefined;
}

function actorRecord(actor, endpoint, response, body, extra = {}) {
  return {
    actor: actor.label,
    username: actor.username,
    role: actor.role,
    activeMode: actor.activeMode,
    endpoint,
    status: response.status,
    code: bodyCode(body) || (response.ok ? 'OK' : 'HTTP_ERROR'),
    metrics: metricsFor(endpoint, body),
    ...extra
  };
}

async function request(base, actor, method, pathname, options = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', ...options.headers };
  if (actor && actor.token) headers.Authorization = `Bearer ${actor.token}`;
  let response;
  let body = {};
  try {
    response = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs || 45000)
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) body = await response.json().catch(() => ({}));
  } catch (_) {
    response = { status: 0, ok: false };
    body = { code: 'REQUEST_FAILED' };
  }
  return { response, body };
}

async function evidence(base, actor, pathname) {
  const result = await request(base, actor, 'GET', pathname);
  output(actorRecord(actor, pathname, result.response, result.body));
  return result;
}

function loginActor(payload, label) {
  const raw = objectOf(payload[label]);
  if (typeof raw.username !== 'string' || typeof raw.password !== 'string') throw new Error('ACTOR_FILE_INVALID');
  return { label, username: raw.username, password: raw.password, switchRole: raw.switchRole };
}

function loginPayload(actor) {
  return { username: actor.username, password: actor.password };
}

function actorCode(actor, fallback) {
  const candidate = firstDefined(actor.raw, ['repartidorId', 'repartidor_id', 'codigo', 'code']) || fallback;
  const text = String(candidate || '').trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(text)) throw new Error('ACTOR_CODE_INVALID');
  return text;
}

function authFacts(body, fallbackRole) {
  const data = envelope(body);
  const user = objectOf(data.user || data.usuario || data);
  return {
    token: firstDefined(data, ['token', 'accessToken', 'jwt']) || firstDefined(user, ['token', 'accessToken', 'jwt']),
    role: String(firstDefined(user, ['role', 'rol']) || fallbackRole || 'UNKNOWN'),
    activeMode: String(firstDefined(data, ['activeMode', 'active_mode']) || firstDefined(user, ['activeMode', 'active_mode']) || 'UNKNOWN')
  };
}

async function authenticate(base, input, fallbackRole, switchBody) {
  const logged = await request(base, null, 'POST', '/auth/login', { body: loginPayload(input) });
  const initial = { label: input.label, username: input.username, role: fallbackRole, activeMode: 'UNKNOWN' };
  output(actorRecord(initial, '/auth/login', logged.response, logged.body));
  const facts = authFacts(logged.body, fallbackRole);
  if (!logged.response.ok || typeof facts.token !== 'string' || facts.token.length < 16) throw new Error('AUTH_FAILED');
  const actor = { ...initial, token: facts.token, role: facts.role, activeMode: facts.activeMode };
  if (switchBody) {
    const switched = await request(base, actor, 'POST', '/auth/switch-role', { body: switchBody });
    const switchedFacts = authFacts(switched.body, actor.role);
    output(actorRecord({ ...actor, activeMode: switchedFacts.activeMode }, '/auth/switch-role', switched.response, switched.body));
    if (!switched.response.ok) throw new Error('SWITCH_ROLE_FAILED');
    actor.activeMode = switchedFacts.activeMode;
    actor.role = switchedFacts.role || actor.role;
  }
  return actor;
}

function extractRepartidorCodes(body) {
  const found = [];
  for (const item of arrayOf(body)) {
    const candidate = firstDefined(item, ['codigo', 'code', 'id', 'repartidorId']);
    const value = String(candidate || '').trim();
    if (/^\d{1,2}$/.test(value)) found.push(value.padStart(2, '0'));
  }
  return [...new Set(found)].sort((a, b) => Number(a) - Number(b));
}

function dateQuery() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function monthQuery() {
  const now = new Date();
  return `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
}

function repartoEndpoints(code, { panel = false } = {}) {
  const date = dateQuery();
  const month = monthQuery();
  const encoded = encodeURIComponent(code);
  const common = [
    `/repartidor/history/clients/${encoded}?limit=50&offset=0`,
    `/repartidor/rutero/week/${encoded}`,
    `/entregas/pendientes/${encoded}?date=${date}&limit=50&offset=0`,
    `/repartidor-finanzas/daily-summary/${encoded}?date=${date}`,
    `/repartidor-finanzas/liquidaciones/${encoded}/desglose?date=${date}`,
    `/repartidor-finanzas/cuentas/${encoded}?date=${date}`,
    `/repartidor-finanzas/vencimientos/${encoded}?limit=50&offset=0`,
    `/repartidor-finanzas/evolution/${encoded}`,
    `/repartidor-finanzas/commissions/summary/${encoded}`,
    `/repartidor/history/${encoded}?limit=50&offset=0`,
    `/repartidor/history/objectives/${encoded}`,
    `/repartidor/history/objectives-detail/${encoded}?limit=100&offset=0`,
    `/repartidor/rutero/order/${encoded}?date=${date}`,
    `/repartidor/rutero/stops-geo/${encoded}?date=${date}`,
    `/chatbot/health`
  ];
  if (!panel) return common;
  return [
    `/repartidor/history/delivery-summary/${encoded}?${month}`,
    `/repartidor-finanzas/summary/${encoded}?${month}`,
    `/repartidor/collections/daily/${encoded}?${month}`,
    ...common
  ];
}

async function runMatrix(base, actor, code, panel) {
  for (const endpoint of repartoEndpoints(code, { panel })) await evidence(base, actor, endpoint);
  const chatbot = await request(base, actor, 'POST', '/chatbot/message', {
    body: { message: 'Resumen operativo del repartidor actual', repartidorId: code }
  });
  output(actorRecord(actor, '/chatbot/message', chatbot.response, chatbot.body));
}

function metricValue(body, names) {
  return scalar(firstDefined(envelope(body), names));
}

async function aggregateCheck(base, jefe, codes, allCsv) {
  const paths = [
    { name: 'delivery', path: (id) => `/repartidor/history/delivery-summary/${id}?${monthQuery()}`, fields: ['total', 'delivered', 'amount'] },
    { name: 'finance', path: (id) => `/repartidor-finanzas/summary/${id}?${monthQuery()}`, fields: ['cobrado', 'liquidado', 'saldo'] },
    { name: 'collections', path: (id) => `/repartidor/collections/daily/${id}?${monthQuery()}`, fields: ['collectable', 'collected', 'pending'] },
    { name: 'daily', path: (id) => `/repartidor-finanzas/daily-summary/${id}?date=${dateQuery()}`, fields: ['saldo', 'cobros', 'gastos'] },
    { name: 'cuentas', path: (id) => `/repartidor-finanzas/cuentas/${id}?date=${dateQuery()}`, fields: ['saldo', 'cobros', 'gastos'] }
  ];
  for (const definition of paths) {
    const all = await request(base, jefe, 'GET', definition.path(encodeURIComponent(allCsv)));
    const sums = Object.fromEntries(definition.fields.map((field) => [field, 0]));
    let exact = true;
    for (const code of codes) {
      const individual = await request(base, jefe, 'GET', definition.path(encodeURIComponent(code)));
      if (!individual.response.ok) { exact = false; continue; }
      for (const field of definition.fields) {
        const value = metricValue(individual.body, [field]);
        if (value === undefined) exact = false;
        else sums[field] += value;
      }
    }
    const comparisons = {};
    for (const field of definition.fields) {
      const value = metricValue(all.body, [field]);
      const difference = value === undefined ? null : Math.abs(value - sums[field]);
      comparisons[field] = difference !== null && difference <= MONEY_TOLERANCE;
    }
    output({
      actor: jefe.label,
      username: jefe.username,
      role: jefe.role,
      activeMode: jefe.activeMode,
      endpoint: `aggregate:${definition.name}`,
      status: all.response.status,
      code: all.response.ok && exact && Object.values(comparisons).every(Boolean) ? 'ALL_MATCHES_SUM' : 'ALL_SUM_MISMATCH',
      metrics: { actors: codes.length, fieldsMatched: Object.values(comparisons).filter(Boolean).length, tolerance: MONEY_TOLERANCE }
    });
  }
}

async function documentEvidence(base, actor, code) {
  const history = await request(base, actor, 'GET', `/repartidor/history/${encodeURIComponent(code)}?limit=1&offset=0`);
  const first = arrayOf(history.body)[0];
  const clientId = firstDefined(first, ['clientId', 'clienteId', 'CODCLIENTE', 'cliente']);
  if (clientId) await evidence(base, actor, `/repartidor/history/documents/${encodeURIComponent(String(clientId))}?limit=1&offset=0`);
  const pending = await request(base, actor, 'GET', `/entregas/pendientes/${encodeURIComponent(code)}?date=${dateQuery()}&limit=1&offset=0`);
  const row = arrayOf(pending.body)[0];
  const number = firstDefined(row, ['numero', 'NUMERO', 'albaran']);
  const year = firstDefined(row, ['ejercicio', 'EJERCICIO', 'year']);
  if (number !== undefined && year !== undefined) {
    const query = new URLSearchParams({ repartidorId: code });
    for (const [parameter, keys] of Object.entries({ serie: ['serie', 'SERIE'], terminal: ['terminal', 'TERMINAL'], cliente: ['cliente', 'CLIENTE', 'CODCLIENTE'] })) {
      const value = firstDefined(row, keys);
      if (value !== undefined) query.set(parameter, String(value));
    }
    await evidence(base, actor, `/entregas/albaran/${encodeURIComponent(String(number))}/${encodeURIComponent(String(year))}?${query}`);
  }
  await evidence(base, actor, `/repartidor/history/signature?repartidorId=${encodeURIComponent(code)}`);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (_) { usage(); process.exitCode = 2; return; }
  if (args.help) { usage(); return; }
  if (!args.reads || !isLoopbackApi(args.base)) { usage(); process.exitCode = 2; return; }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.resolve(ACTORS_FILE), 'utf8')); } catch (_) { output({ code: 'ACTOR_FILE_UNAVAILABLE' }); process.exitCode = 2; return; }
  const repartoInput = loginActor(raw, 'repartidor');
  const jefeInput = loginActor(raw, 'jefeVentas');
  repartoInput.raw = raw.repartidor;
  jefeInput.raw = raw.jefeVentas;
  const reparto = await authenticate(args.base, repartoInput, 'REPARTIDOR');
  const jefe = await authenticate(args.base, jefeInput, 'JEFE_VENTAS', objectOf(jefeInput.switchRole).body);
  const repartoCode = actorCode(repartoInput, reparto.username);
  await evidence(args.base, reparto, '/repartidores'); // expected role-restricted response, recorded as evidence
  await evidence(args.base, jefe, '/repartidores');
  const selector = await request(args.base, jefe, 'GET', '/repartidores');
  const codes = extractRepartidorCodes(selector.body);
  const allCsv = codes.join(',');
  if (!codes.length) throw new Error('REPARTIDORES_UNAVAILABLE');
  await evidence(args.base, null, `/repartidor/rutero/week/${encodeURIComponent(repartoCode)}`);
  const foreign = codes.find((code) => code !== repartoCode) || '99';
  await evidence(args.base, reparto, `/repartidor/rutero/week/${encodeURIComponent(foreign)}`);
  await runMatrix(args.base, reparto, repartoCode, false);
  await documentEvidence(args.base, reparto, repartoCode);
  await runMatrix(args.base, jefe, repartoCode, true);
  await documentEvidence(args.base, jefe, repartoCode);
  await runMatrix(args.base, jefe, allCsv, true);
  await aggregateCheck(args.base, jefe, codes, allCsv);
}

main().catch(() => {
  output({ code: 'CERTIFICATION_ABORTED' });
  process.exitCode = 1;
});
