'use strict';

/**
 * Latency probe for REPARTO + ALMACÉN. Prints ms/status/bytes only.
 * Never prints PIN, tokens, or payloads.
 *
 *   GMP_JEFE_USER=98 GMP_JEFE_PIN=... GMP_REPARTIDOR_USER=.. GMP_REPARTIDOR_PIN=... \
 *     node backend/scripts/hit-reparto-almacen-latency.js
 *
 * Host defaults to 127.0.0.1:3335 ([servidor] when run on 230).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('http');
const { initDb, closePool, queryWithParams } = require('../config/db');

const HOST = process.env.API_HOST || process.env.E2E_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.API_PORT || process.env.E2E_PORT || '3335', 10);
const UA = 'GMP-Reparto-Latency/1.0';
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();
const MONTH = new Date().getMonth() + 1;
const DAY = new Date().getDate();

function request(method, path, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const headers = { 'User-Agent': UA };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: path.startsWith('/api') ? path : `/api${path}`,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch (_) { json = null; }
        resolve({
          status: res.statusCode,
          ms: Date.now() - started,
          bytes: raw.length,
          json,
        });
      });
    });
    req.setTimeout(90000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickToken(json) {
  return json?.token || json?.data?.token || json?.accessToken || null;
}

function row(label, res, extra = {}) {
  const out = {
    label,
    status: res?.status ?? 0,
    ms: res?.ms ?? null,
    bytes: res?.bytes ?? null,
    ...extra,
  };
  console.log(JSON.stringify(out));
  return out;
}

async function pinForVendor(vendor) {
  const code = String(vendor || '').trim();
  if (!code) return '';
  const rows = await queryWithParams(
    `SELECT TRIM(CODIGOPIN) AS PIN
       FROM DSEDAC.VDPL1
      WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
      FETCH FIRST 1 ROW ONLY`,
    [code],
  );
  return String(rows?.[0]?.PIN || '').trim();
}

async function login(user, pin, tag) {
  if (!user || !pin) {
    row(`${tag}.login`, { status: 0, ms: 0, bytes: 0 }, { skipped: 'missing_pin' });
    return null;
  }
  const res = await request('POST', '/auth/login', {
    body: { username: user, password: pin },
  });
  row(`${tag}.login`, res, { role: res.json?.user?.role || res.json?.role || null });
  return pickToken(res.json);
}

async function switchReparto(token, userId) {
  const res = await request('POST', '/auth/switch-role', {
    token,
    body: { userId, newRole: 'REPARTIDOR' },
  });
  const mode = res.json?.user?.activeMode || res.json?.activeMode || null;
  row('jefe.switch-reparto', res, { activeMode: mode });
  return pickToken(res.json) || token;
}

function fleetCodes(json) {
  const list = Array.isArray(json)
    ? json
    : (json?.repartidores || json?.data || json?.items || []);
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
    return String(entry.code || entry.codigo || entry.id || '').trim();
  }).filter(Boolean))];
}

function countRows(json) {
  if (!json || typeof json !== 'object') return null;
  for (const key of ['entregas', 'items', 'data', 'days', 'vencimientos', 'cobros', 'albaranes']) {
    if (Array.isArray(json[key])) return json[key].length;
  }
  if (Array.isArray(json)) return json.length;
  if (typeof json.count === 'number') return json.count;
  if (typeof json.total === 'number') return json.total;
  return null;
}

async function hit(label, token, path) {
  const cold = await request('GET', path, { token });
  const warm = await request('GET', path, { token });
  row(`${label}.cold`, cold, { rows: countRows(cold.json) });
  row(`${label}.warm`, warm, { rows: countRows(warm.json) });
}

async function main() {
  await initDb();
  const jefeUser = String(process.env.GMP_JEFE_USER || process.env.GMP_TEST_VENDOR || '98').trim();
  const jefePin = String(process.env.GMP_JEFE_PIN || process.env.GMP_TEST_PIN || '').trim()
    || await pinForVendor(jefeUser);
  const driverUser = String(process.env.GMP_REPARTIDOR_USER || process.env.GMP_REPARTIDOR_ID || '').trim();

  console.log(JSON.stringify({
    host: HOST,
    port: PORT,
    date: TODAY,
    tag: '[servidor]',
  }));

  const ready = await request('GET', '/ready');
  row('ready', ready, { statusBody: ready.json?.status || ready.json?.ready || null });

  let jefeToken = await login(jefeUser, jefePin, 'jefe');
  let codes = [];
  if (jefeToken && jefeUser) {
    jefeToken = await switchReparto(jefeToken, jefeUser);
    const fleet = await request('GET', '/auth/repartidores', { token: jefeToken });
    codes = fleetCodes(fleet.json);
    row('jefe.fleet', fleet, { count: codes.length });
    const allSelector = codes.slice(0, 80).join(',') || jefeUser;
    const single = codes[0] || jefeUser;
    await hit('jefe.week.all', jefeToken, `/repartidor/rutero/week/${encodeURIComponent(allSelector)}?date=${TODAY}`);
    await hit('jefe.week.one', jefeToken, `/repartidor/rutero/week/${encodeURIComponent(single)}?date=${TODAY}`);
    await hit('jefe.pendientes.all', jefeToken, `/entregas/pendientes/${encodeURIComponent(allSelector)}?date=${TODAY}&limit=80&offset=0`);
    await hit('jefe.pendientes.one', jefeToken, `/entregas/pendientes/${encodeURIComponent(single)}?date=${TODAY}&limit=80&offset=0`);
    await hit('jefe.daily-summary.one', jefeToken, `/repartidor-finanzas/daily-summary/${encodeURIComponent(single)}?date=${TODAY}`);
    await hit('jefe.vencimientos.one', jefeToken, `/repartidor-finanzas/vencimientos/${encodeURIComponent(single)}?from=${YEAR}-01-01&to=${TODAY}&limit=40`);
    const almacen = await request('POST', '/auth/switch-role', {
      token: jefeToken,
      body: { userId: jefeUser, newRole: 'ALMACEN' },
    });
    const almacenToken = pickToken(almacen.json) || jefeToken;
    row('jefe.switch-almacen', almacen, {
      activeMode: almacen.json?.user?.activeMode || almacen.json?.activeMode || null,
    });
    await hit('warehouse.dashboard', almacenToken, `/warehouse/dashboard?year=${YEAR}&month=${MONTH}&day=${DAY}`);
    await hit('warehouse.articles', almacenToken, '/warehouse/articles?limit=80');
  }

  const rasoCandidates = [...new Set([
    driverUser,
    ...codes.filter((code) => String(code).replace(/^0+/, '') !== String(jefeUser).replace(/^0+/, '')),
    '94',
    '08',
    '05',
  ].filter(Boolean))];

  let rasoId = null;
  let driverToken = null;
  for (const candidate of rasoCandidates.slice(0, 8)) {
    const rasoPin = String(process.env.GMP_REPARTIDOR_PIN || '').trim() || await pinForVendor(candidate);
    const token = await login(candidate, rasoPin, `repartidor.${candidate}`);
    if (!token) continue;
    const switched = await request('POST', '/auth/switch-role', {
      token,
      body: { userId: candidate, newRole: 'REPARTIDOR' },
    });
    const switchedRole = switched.json?.user?.role || switched.json?.role || null;
    const switchedMode = switched.json?.user?.activeMode || switched.json?.activeMode || null;
    row('repartidor.switch-reparto', switched, {
      user: candidate,
      role: switchedRole,
      activeMode: switchedMode,
    });
    if (switched.status === 200 && (switchedRole === 'REPARTIDOR' || switchedMode === 'REPARTIDOR')) {
      rasoId = candidate;
      driverToken = pickToken(switched.json) || token;
      break;
    }
  }
  if (driverToken && rasoId) {
    await hit('raso.week', driverToken, `/repartidor/rutero/week/${encodeURIComponent(rasoId)}?date=${TODAY}`);
    await hit('raso.pendientes', driverToken, `/entregas/pendientes/${encodeURIComponent(rasoId)}?date=${TODAY}&limit=80&offset=0`);
    await hit('raso.daily-summary', driverToken, `/repartidor-finanzas/daily-summary/${encodeURIComponent(rasoId)}?date=${TODAY}`);
    await hit('raso.vencimientos', driverToken, `/repartidor-finanzas/vencimientos/${encodeURIComponent(rasoId)}?from=${YEAR}-01-01&to=${TODAY}&limit=40`);
  }
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ fatal: true, message: error.message || 'probe_failed' }));
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => undefined));
