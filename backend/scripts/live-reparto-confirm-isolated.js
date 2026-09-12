'use strict';

/**
 * Live isolated_test confirmation against the TEST API.
 * Credentials: gitignored actors file, else INTEGRATION_USER/INTEGRATION_PASS.
 * Never prints tokens, PINs, or recipient emails.
 *
 *   node backend/scripts/live-reparto-confirm-isolated.js
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const {
  ACTORS_FILE,
  identityOf,
  detailLines,
  amountOf,
  statusOk,
  tokenOf,
  userOf,
  arrayOf,
  signedRepartidorCodes,
  decodedClaimsOf,
  buildCertificationSignatureDataUri,
} = require('./certify-reparto-confirm-local');

const HOST = process.env.GMP_API_HOST || '127.0.0.1';
const PORT = Number(process.env.GMP_API_PORT || 3335);
const BASE = '/api';
const TIMEOUT_MS = 45000;
const UA = 'GMP-App/1.0 Dart/3.0';

function emit(step, extra = {}) {
  process.stdout.write(`${JSON.stringify({ step, ...extra })}\n`);
}

function request(method, path, { token, body, headers = {} } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
      path: `${BASE}${path}`,
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': UA,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function credentials(actor) {
  const source = actor?.login || actor || {};
  const username = source.username || source.user || source.email || process.env.INTEGRATION_USER;
  const password = source.password || source.pin || source.PIN || process.env.INTEGRATION_PASS;
  if (!username || !password) throw new Error('no test actor credentials');
  return { username, password };
}

function loadActorFromE2eScript() {
  const file = path.join(__dirname, '_e2e_extra_tabs.js');
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const user = src.match(/username\s*:\s*['"]([^'"]+)['"]/i)
    || src.match(/user\s*:\s*['"]([^'"]+)['"]/i);
  const pass = src.match(/password\s*:\s*['"]([^'"]+)['"]/i)
    || src.match(/pin\s*:\s*['"]([^'"]+)['"]/i);
  if (!user || !pass) return null;
  const role = src.match(/newRole\s*:\s*['"]([^'"]+)['"]/);
  const userId = src.match(/userId\s*:\s*['"]([^'"]+)['"]/);
  const actor = { login: { username: user[1], password: pass[1] } };
  if (role && userId) {
    actor.switchRole = { body: { newRole: role[1], userId: userId[1] } };
  }
  return actor;
}

function loadActor() {
  if (fs.existsSync(ACTORS_FILE)) {
    const actors = JSON.parse(fs.readFileSync(ACTORS_FILE, 'utf8'));
    if (actors?.repartidor) return actors.repartidor;
  }
  if (process.env.INTEGRATION_USER && process.env.INTEGRATION_PASS) {
    return { login: { username: process.env.INTEGRATION_USER, password: process.env.INTEGRATION_PASS } };
  }
  const e2e = loadActorFromE2eScript();
  if (e2e) return e2e;
  throw new Error('missing actors file and INTEGRATION_USER/INTEGRATION_PASS');
}

function listOf(json) {
  return arrayOf(json, ['albaranes', 'items', 'pendientes', 'deliveries', 'entregas', 'stops', 'paradas']);
}

function confirmationIdOf(json) {
  return json?.confirmationId || json?.data?.confirmationId
    || json?.confirmation?.id || json?.data?.confirmation?.id || null;
}

function actorCode(actor, loginJson) {
  const user = userOf(loginJson);
  return String(
    user?.repartidorId || user?.repartidorCode || user?.code || user?.id
    || actor?.repartidorId || actor?.repartidorCode || actor?.code || '',
  ).trim();
}

function parcialLines(lines) {
  if (!lines.length) return null;
  const first = { ...lines[0] };
  const delivered = Math.max(0, Number(first.cantidadPedida) - 1);
  first.cantidadEntregada = delivered;
  first.cantidadPendiente = Number(first.cantidadPedida) - delivered;
  first.cantidadRechazada = 0;
  first.motivoDiferencia = delivered < Number(first.cantidadPedida) ? 'PRODUCTO_FALTANTE' : null;
  return [first, ...lines.slice(1)];
}

function isoDateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function findPending(token, driver) {
  let lastStatus = null;
  let lastCount = 0;
  let lastCode = null;
  for (let days = 0; days <= 14; days += 1) {
    const date = isoDateOffset(days);
    const pending = await request('GET', `/entregas/pendientes/${encodeURIComponent(driver)}?date=${date}&limit=80&offset=0`, { token });
    const candidates = listOf(pending.json).filter((row) =>
      !['ENTREGADO', 'DELIVERED', 'PARCIAL'].includes(String(row?.estado ?? row?.status ?? '').toUpperCase()));
    lastStatus = pending.status;
    lastCount = listOf(pending.json).length;
    lastCode = typeof pending.json?.code === 'string' ? pending.json.code : lastCode;
    if (statusOk(pending, [200]) && candidates.length) {
      return { date, pending, candidates };
    }
  }
  emit('pending_scan', { lastStatus, lastCount, lastCode, daysTried: 15 });
  return null;
}
async function main() {
  const actor = loadActor();
  const ready = await request('GET', '/ready');
  const runtime = ready.json?.reparto?.runtime || {};
  const isolated = String(runtime.tableSet || '').toLowerCase() === 'isolated_test'
    && runtime.valid === true;
  emit('ready', {
    host: HOST,
    port: PORT,
    status: ready.status,
    isolated,
    tableSet: runtime.tableSet || null,
    writesEnabled: runtime.writesEnabled === true,
  });
  if (!statusOk(ready, [200]) || !isolated) {
    throw new Error('API is not isolated_test');
  }

  let login = await request('POST', '/auth/login', { body: credentials(actor) });
  let token = tokenOf(login.json);
  if (!statusOk(login, [200]) || !token) throw new Error(`login failed (${login.status})`);
  const loginRole = String(decodedClaimsOf(token)?.role || userOf(login.json)?.role || '').toUpperCase();
  if (actor.switchRole?.body && ['JEFE_VENTAS', 'ADMIN'].includes(loginRole)) {
    const switched = await request('POST', '/auth/switch-role', {
      token,
      body: actor.switchRole.body,
    });
    const switchedToken = tokenOf(switched.json);
    emit('switch_role', { status: switched.status, ok: Boolean(switchedToken) });
    if (statusOk(switched, [200]) && switchedToken) {
      token = switchedToken;
      login = switched;
    }
  }
  const claims = signedRepartidorCodes(decodedClaimsOf(token));
  const switchedUser = userOf(login.json);
  const validate = await request('GET', '/auth/validate', { token });
  emit('validate', {
    status: validate.status,
    role: validate.json?.role || null,
    activeMode: validate.json?.activeMode || null,
    claimsVersion: validate.json?.claimsVersion ?? null,
  });
  const fleetResponse = await request('GET', '/auth/repartidores', { token });
  const fleet = arrayOf(fleetResponse.json, ['repartidores', 'items']);
  const fleetCodes = [...new Set(fleet.map((entry) => String(
    entry?.codigo ?? entry?.code ?? entry?.id ?? '',
  ).trim()).filter(Boolean))];
  emit('fleet', { status: fleetResponse.status, count: fleetCodes.length });
  const driverCandidates = [...new Set([
    ...fleetCodes,
    actor.switchRole?.body?.userId,
    switchedUser?.repartidorId,
    switchedUser?.repartidorCode,
    ...claims,
    actorCode(actor, login.json),
  ].filter(Boolean).map((value) => String(value).trim()))];

  let found = null;
  let driver = '';
  for (const candidate of driverCandidates) {
    found = await findPending(token, candidate);
    if (found) {
      driver = candidate;
      break;
    }
  }
  if (!driver) driver = String(driverCandidates[0] || '').trim();
  emit('auth', { status: login.status, driverPresent: Boolean(driver), role: loginRole || null });
  if (!found) throw new Error('no pending delivery');
  const { date, candidates } = found;
  emit('pending', { date, count: candidates.length });

  let selected;
  let fallback;
  let scanned = 0;
  let withSaldo = 0;
  for (const row of candidates) {
    const identity = identityOf(row);
    if (!identity) continue;
    const detail = await request('GET', `/entregas/albaran/${encodeURIComponent(identity.numero)}/${encodeURIComponent(identity.ejercicio)}?serie=${encodeURIComponent(identity.serie)}&terminal=${encodeURIComponent(identity.terminal)}&cliente=${encodeURIComponent(identity.cliente)}&repartidorId=${encodeURIComponent(driver)}`, { token });
    const lines = detailLines(detail.json);
    const amount = amountOf(detail.json, row);
    if (!statusOk(detail, [200]) || !lines || !lines.length || !Number.isFinite(amount) || amount === 0) continue;
    const parcial = parcialLines(lines);
    if (!parcial || Number(parcial[0].cantidadEntregada) <= 0) continue;
    scanned += 1;
    const saldo = Number(
      detail.json?.albaran?.importeDisponibleCobro
      ?? detail.json?.importeDisponibleCobro
      ?? row?.importeDisponibleCobro
      ?? 0,
    );
    const talon = Number.isFinite(saldo) && saldo > 0.01;
    if (talon) withSaldo += 1;
    const candidate = { identity, lines: parcial, talon };
    if (talon) {
      selected = candidate;
      break;
    }
    if (!fallback) fallback = candidate;
  }
  emit('scan', { scanned, withSaldo });
  selected = selected || fallback;
  if (!selected) throw new Error('no contract-safe pending delivery');

  const signature = await request('POST', '/repartidor-finanzas/rutero/evidence/signature', {
    token,
    body: {
      documentId: selected.identity.itemId,
      repartidorId: driver,
      signature: buildCertificationSignatureDataUri(),
    },
  });
  const evidenceId = signature.json?.evidenceId ?? signature.json?.data?.evidenceId;
  emit('signature', { status: signature.status, ok: Boolean(evidenceId) });
  if (!statusOk(signature, [200, 201]) || !evidenceId) throw new Error('signature failed');

  const key = `live-cierre-${crypto.randomUUID()}`;
  const confirmBody = {
    delivery: {
      itemId: selected.identity.itemId,
      repartidorId: driver,
      status: 'PARCIAL',
      occurredAt: new Date().toISOString(),
      receiver: { nombre: 'Cert', apellidos: 'Live', dni: '12345678Z' },
      lineas: selected.lines,
      firma: evidenceId,
      observaciones: 'Cierre vivo isolated_test PARCIAL',
    },
  };
  if (selected.talon) {
    confirmBody.cobro = {
      entregaId: selected.identity.itemId,
      importeCobrado: 0.01,
      formaPago: 'TALON',
      numeroTalon: '123456',
      fechaVencimientoTalon: '2026-12-01',
      codigoEntidadBancaria: '0049',
      nombreBanco: 'SANTANDER',
    };
  }
  const confirm = await request('POST', '/repartidor-finanzas/rutero/confirm-delivery-cobro', {
    token,
    headers: { 'Idempotency-Key': key },
    body: confirmBody,
  });
  const confirmationId = confirmationIdOf(confirm.json);
  emit('confirm', {
    status: confirm.status,
    created: Boolean(confirmationId),
    talonSent: selected.talon === true,
    code: typeof confirm.json?.code === 'string' ? confirm.json.code : null,
    error: typeof confirm.json?.error === 'string' ? String(confirm.json.error).slice(0, 120) : null,
  });
  if (!statusOk(confirm, [200, 201]) || !confirmationId) {
    throw new Error(`confirm failed (${confirm.status})`);
  }

  const after = await request('GET', `/entregas/pendientes/${encodeURIComponent(driver)}?date=${date}&limit=100&offset=0`, { token });
  const row = listOf(after.json).find((entry) =>
    String(entry?.id ?? entry?.itemId ?? entry?.entregaId) === String(selected.identity.itemId));
  const status = String(row?.estado ?? row?.status ?? '').toUpperCase();
  const still = ['ENTREGADO', 'PARCIAL'].includes(status);
  emit('get_after_post', { status: after.status, overlay: status || null, stillDelivered: still });
  if (!still) throw new Error(`GET-after-POST overlay=${status || 'missing'}`);

  const receiptEmail = await request('POST', `/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(confirmationId)}/receipt/email`, {
    token,
    body: { repartidorId: driver },
  });
  emit('receipt_email', {
    status: receiptEmail.status,
    ok: statusOk(receiptEmail, [200]),
    ledgerWritten: receiptEmail.json?.ledgerWritten === true,
  });

  emit('summary', {
    pass: true,
    confirmationIdPresent: true,
    overlay: status,
    host: HOST,
    port: PORT,
  });
}

main().catch((error) => {
  emit('summary', { pass: false, error: String(error.message || error).slice(0, 180) });
  process.exitCode = 1;
});
