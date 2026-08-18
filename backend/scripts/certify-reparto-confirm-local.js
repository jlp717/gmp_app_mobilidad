'use strict';

/*
 * Narrow, deliberately write-limited local certification of the canonical
 * delivery confirmation flow.  It only targets localhost:3336, logs a small
 * JSONL allowlist, and reads the authorized actors from the private temp file
 * in memory.  It never prints request/response bodies, credentials or tokens.
 */

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { assertDecodablePng } = require('../utils/png-image-validator');

const HOST = '127.0.0.1';
const PORT = 3336;
const BASE = '/api';
const ACTORS_FILE = 'C:/Users/Javier/AppData/Local/Temp/gmp-cert-actors.json';
const UA = 'GMP-App/1.0 Dart/3.0';
const TIMEOUT_MS = 45000;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function buildCertificationSignatureDataUri() {
  const width = 320;
  const height = 120;
  const stride = (width * 4) + 1;
  const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * stride] = 0;
  const pixel = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const offset = (py * stride) + 1 + (px * 4);
        raw[offset] = 20;
        raw[offset + 1] = 20;
        raw[offset + 2] = 20;
        raw[offset + 3] = 255;
      }
    }
  };
  const line = (startX, startY, endX, endY) => {
    let x = startX;
    let y = startY;
    const dx = Math.abs(endX - startX);
    const sx = startX < endX ? 1 : -1;
    const dy = -Math.abs(endY - startY);
    const sy = startY < endY ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      pixel(x, y);
      if (x === endX && y === endY) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x += sx; }
      if (doubled <= dx) { error += dx; y += sy; }
    }
  };
  [[35, 76, 70, 35], [70, 35, 103, 80], [103, 80, 137, 45],
    [137, 45, 170, 73], [170, 73, 230, 54], [62, 88, 248, 88]].forEach((points) => line(...points));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  assertDecodablePng(png);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const PNG_CERT_SIGNATURE = buildCertificationSignatureDataUri();

const output = [];
function emit(step, pass, extra = {}) {
  const row = { step, pass: Boolean(pass), ...extra };
  output.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
  return pass;
}

function safeCode(json) {
  return typeof json?.code === 'string' ? json.code : null;
}

function statusOk(res, expected) {
  return expected.includes(res.status) && res.json?.success !== false;
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
        try { json = JSON.parse(raw); } catch (_) { /* receipt can be binary in future */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function tokenOf(json) {
  return json?.token || json?.accessToken || json?.data?.token || json?.data?.accessToken || null;
}

function decodedClaimsOf(token) {
  try {
    const [encoded, signature, unexpected] = String(token || '').split('.');
    if (!encoded || !signature || unexpected !== undefined) return null;
    const claims = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch (_) {
    return null;
  }
}

function userOf(json) {
  const user = json?.data?.user ?? json?.user;
  return user && typeof user === 'object' && !Array.isArray(user) ? user : null;
}

function arrayOf(json, keys = []) {
  for (const container of [json, json?.data]) {
    if (Array.isArray(container)) return container;
    if (!container || typeof container !== 'object') continue;
    for (const key of keys) {
      if (Array.isArray(container[key])) return container[key];
    }
  }
  return [];
}

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
  return raw;
}

function codesMatch(left, right) {
  const a = normalizeCode(left);
  const b = normalizeCode(right);
  return Boolean(a && b && a === b);
}

function signedRepartidorCodes(claims) {
  return [...new Set((Array.isArray(claims?.repartidorCodes) ? claims.repartidorCodes : [])
    .map(normalizeCode).filter(Boolean))];
}

function outsideFleetCode(fleetCodes) {
  const fleet = new Set((fleetCodes || []).map(normalizeCode).filter(Boolean));
  const candidates = ['ZZ', 'ZY', 'ZX', ...Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0'))];
  return candidates.find((code) => !fleet.has(code)) || null;
}

function credentials(actor) {
  const source = actor?.login || actor || {};
  const username = source.username || source.user || source.email;
  const password = source.password || source.pin || source.PIN;
  if (!username || !password) throw new Error('authorized actor lacks login credentials');
  return { username, password };
}

function actorCode(actor, loginJson) {
  const user = userOf(loginJson);
  return String(
    user?.repartidorId || user?.repartidorCode || user?.code || user?.id
    || actor?.repartidorId || actor?.repartidorCode || actor?.code || '',
  ).trim();
}

function listOf(json) {
  return arrayOf(json, ['albaranes', 'items', 'pendientes', 'deliveries', 'entregas', 'stops', 'paradas']);
}

function identityOf(row) {
  const numero = row?.numero ?? row?.numeroAlbaran ?? row?.NUMEROALBARAN;
  const ejercicio = row?.ejercicio ?? row?.EJERCICIOALBARAN;
  const serie = row?.serie ?? row?.SERIEALBARAN;
  const terminal = row?.terminal ?? row?.TERMINALALBARAN;
  const cliente = row?.codigoCliente ?? row?.cliente ?? row?.CLIENTE;
  const itemId = row?.id ?? row?.itemId ?? row?.entregaId;
  if ([numero, ejercicio, serie, terminal, cliente, itemId].some((v) => v === undefined || v === null || v === '')) return null;
  return { numero, ejercicio, serie, terminal, cliente, itemId: String(itemId) };
}

function detailLines(detail) {
  const rows = detail?.albaran?.lineas || detail?.albaran?.items || detail?.lineas || detail?.items || [];
  if (!Array.isArray(rows)) return null;
  const mapped = [];
  const seenLineIds = new Set();
  for (const line of rows) {
    const lineaId = String(line.lineaId ?? line.itemId ?? line.secuencia ?? '').trim();
    const codigoArticulo = String(line.codigoArticulo ?? line.articulo ?? '').trim();
    const cantidadPedida = Number(
      line.cantidadPedida ?? line.cantidad ?? line.unidades ?? line.bultos ?? line.cantidadEnvases,
    );
    if (!lineaId || seenLineIds.has(lineaId) || !codigoArticulo || /^0+$/.test(codigoArticulo)
        || !Number.isFinite(cantidadPedida) || cantidadPedida <= 0) {
      return null;
    }
    seenLineIds.add(lineaId);
    mapped.push({
      lineaId,
      codigoArticulo,
      cantidadPedida,
      cantidadEntregada: cantidadPedida,
      cantidadRechazada: 0,
      cantidadPendiente: 0,
    });
  }
  return mapped;
}

function amountOf(detail, row) {
  const raw = detail?.albaran?.importeTotal ?? detail?.albaran?.importe ?? detail?.albaran?.total
    ?? row?.importeTotal ?? row?.importe ?? row?.total ?? 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

function confirmationIdOf(json) {
  return json?.confirmationId || json?.data?.confirmationId || json?.confirmation?.id || json?.data?.confirmation?.id || null;
}

function isDelivered(rows, itemId) {
  const row = rows.find((entry) => String(entry?.id ?? entry?.itemId ?? entry?.entregaId) === String(itemId));
  return String(row?.estado ?? row?.status ?? '').toUpperCase() === 'ENTREGADO';
}

function weekDaysOf(json) {
  const days = json?.days ?? json?.data?.days;
  return Array.isArray(days) ? days : null;
}

function weekRowsOf(json) {
  const days = weekDaysOf(json);
  if (!days) return [];
  return days.flatMap((day) => arrayOf(day, [
    'deliveries', 'entregas', 'stops', 'paradas', 'albaranes', 'items', 'pendientes',
  ]));
}

function weekCompletedCount(json) {
  const days = weekDaysOf(json);
  if (!days) return 0;
  const counters = days.map((day) => Number(day?.completed));
  if (counters.every((value) => Number.isFinite(value) && value >= 0)) {
    return counters.reduce((sum, value) => sum + value, 0);
  }
  return weekRowsOf(json).filter((row) =>
    ['ENTREGADO', 'DELIVERED'].includes(String(row?.estado ?? row?.status ?? '').toUpperCase())).length;
}

async function login(actor) {
  const response = await request('POST', '/auth/login', { body: credentials(actor) });
  const token = tokenOf(response.json);
  if (!statusOk(response, [200]) || !token) throw new Error(`login failed (${response.status})`);
  return { token, response };
}

async function main() {
  // A private file is deliberately the only credential source.  No environment fallback.
  const actors = JSON.parse(fs.readFileSync(ACTORS_FILE, 'utf8'));
  if (!actors?.repartidor || !actors?.jefeVentas?.switchRole?.body) throw new Error('authorized actors file is incomplete');

  const ready = await request('GET', '/ready');
  const runtime = ready.json?.reparto?.runtime || {};
  const isolated = runtime.valid === true && runtime.errorCount === 0
    && String(runtime.tableSet || '').toLowerCase() === 'isolated_test';
  const capabilities = runtime.writesEnabled === true
    && runtime.confirmationCapabilityApproved === true
    && runtime.financeCapabilityApproved === true;
  if (!emit('ready.isolated_test', statusOk(ready, [200]) && isolated && capabilities, { status: ready.status, code: safeCode(ready.json) })) throw new Error('unsafe local runtime');

  const repartidor = await login(actors.repartidor);
  const repartidorClaims = decodedClaimsOf(repartidor.token);
  const driverCodes = signedRepartidorCodes(repartidorClaims);
  const responseDriver = actorCode(actors.repartidor, repartidor.response.json);
  const driver = driverCodes.length === 1 ? driverCodes[0] : '';
  const repartidorScopeValid = repartidorClaims?.claimsVersion === 4
    && String(repartidorClaims?.role || '').toUpperCase() === 'REPARTIDOR'
    && codesMatch(driver, responseDriver);
  if (!emit('auth.repartidor.signed_scope_v4', repartidorScopeValid, { status: repartidor.response.status })) throw new Error('repartidor identity absent');

  const bossLogin = await login(actors.jefeVentas);
  const switched = await request('POST', '/auth/switch-role', {
    token: bossLogin.token,
    body: actors.jefeVentas.switchRole.body,
  });
  const jefeToken = tokenOf(switched.json);
  const jefeClaims = decodedClaimsOf(jefeToken);
  const jefeCodes = signedRepartidorCodes(jefeClaims);
  const switchedUser = userOf(switched.json);
  const activeMode = switchedUser?.activeMode ?? switched.json?.data?.activeMode ?? switched.json?.activeMode;
  const jefeScopeValid = statusOk(switched, [200]) && Boolean(jefeToken)
    && ['JEFE_VENTAS', 'ADMIN'].includes(String(jefeClaims?.role || '').toUpperCase())
    && jefeClaims?.claimsVersion === 4 && activeMode === 'REPARTIDOR'
    && jefeCodes.length > 0 && jefeCodes.some((code) => codesMatch(code, driver));
  if (!emit('auth.jefe.reparto_mode_signed_scope_v4', jefeScopeValid, { status: switched.status, code: safeCode(switched.json) })) throw new Error('jefe switch failed');

  const fleetResponse = await request('GET', '/auth/repartidores', { token: jefeToken });
  const fleet = arrayOf(fleetResponse.json, ['repartidores', 'items']);
  const fleetCodes = [...new Set(fleet.map((entry) => normalizeCode(
    entry?.codigo ?? entry?.code ?? entry?.id,
  )).filter(Boolean))];
  const fleetMatchesSignedScope = statusOk(fleetResponse, [200])
    && fleetCodes.length === jefeCodes.length
    && fleetCodes.every((code) => jefeCodes.some((signed) => codesMatch(code, signed)));
  if (!emit('auth.jefe.selector_signed_scope', fleetMatchesSignedScope, { status: fleetResponse.status })) throw new Error('jefe fleet selector disagrees with signed scope');

  const outsideCode = outsideFleetCode(jefeCodes);
  const foreignCode = fleetCodes.find((code) => !codesMatch(code, driver)) || outsideCode;
  if (!outsideCode || !foreignCode) throw new Error('no bounded BOLA probe code available');
  const date = new Date().toISOString().slice(0, 10);
  const bola = await request('GET', `/entregas/pendientes/${encodeURIComponent(foreignCode)}?date=${new Date().toISOString().slice(0, 10)}&limit=1&offset=0`, { token: repartidor.token });
  if (!emit('repartidor.bola_foreign', bola.status === 403, { status: bola.status, code: safeCode(bola.json) })) throw new Error('BOLA guard failed');
  const jefeBola = await request('GET', `/entregas/pendientes/${encodeURIComponent(outsideCode)}?date=${date}&limit=1&offset=0`, { token: jefeToken });
  if (!emit('jefe.bola_outside_fleet', jefeBola.status === 403, { status: jefeBola.status, code: safeCode(jefeBola.json) })) throw new Error('jefe BOLA guard failed');

  const pending = await request('GET', `/entregas/pendientes/${encodeURIComponent(driver)}?date=${date}&limit=100&offset=0`, { token: repartidor.token });
  const candidates = listOf(pending.json).filter((row) => !['ENTREGADO', 'DELIVERED'].includes(String(row?.estado ?? row?.status ?? '').toUpperCase()));
  if (!statusOk(pending, [200]) || !candidates.length) throw new Error('no pending delivery available');

  let selected;
  for (const row of candidates) {
    const identity = identityOf(row);
    if (!identity) continue;
    const detail = await request('GET', `/entregas/albaran/${encodeURIComponent(identity.numero)}/${encodeURIComponent(identity.ejercicio)}?serie=${encodeURIComponent(identity.serie)}&terminal=${encodeURIComponent(identity.terminal)}&cliente=${encodeURIComponent(identity.cliente)}&repartidorId=${encodeURIComponent(driver)}`, { token: repartidor.token });
    const lines = detailLines(detail.json);
    const amount = amountOf(detail.json, row);
    if (!statusOk(detail, [200]) || lines === null || !Number.isFinite(amount)) continue;
    // Prefer actual prepaid 0€ empty documents, otherwise only a normal document with real lines.
    if (amount === 0 && lines.length === 0) { selected = { identity, detail, lines, amount }; break; }
    if (!selected && amount !== 0 && lines.length > 0) selected = { identity, detail, lines, amount };
  }
  if (!selected) throw new Error('no contract-safe pending delivery available');
  if (!emit('delivery.identity_owner_lines', true, { status: 200, zeroEmpty: selected.amount === 0 && selected.lines.length === 0 })) throw new Error('unreachable');
  const weekBefore = await request('GET', `/repartidor/rutero/week/${encodeURIComponent(driver)}?date=${date}`, { token: repartidor.token });
  const weekBeforeDays = weekDaysOf(weekBefore.json);
  if (!emit('week.before_days_shape', statusOk(weekBefore, [200]) && Boolean(weekBeforeDays), { status: weekBefore.status, code: safeCode(weekBefore.json) })) throw new Error('week before shape invalid');
  const completedBefore = weekCompletedCount(weekBefore.json);

  const signature = await request('POST', '/repartidor-finanzas/rutero/evidence/signature', {
    token: repartidor.token,
    body: { documentId: selected.identity.itemId, repartidorId: driver, signature: PNG_CERT_SIGNATURE },
  });
  const evidenceId = signature.json?.evidenceId ?? signature.json?.data?.evidenceId;
  if (!emit('evidence.signature', statusOk(signature, [200, 201]) && Boolean(evidenceId), { status: signature.status, code: safeCode(signature.json) })) throw new Error('signature stage failed');

  const key = `cert-local-${crypto.randomUUID()}`;
  const delivery = {
    itemId: selected.identity.itemId,
    repartidorId: driver,
    status: 'ENTREGADO',
    occurredAt: new Date().toISOString(),
    receiver: { nombre: 'Cert', apellidos: 'Local', dni: '12345678Z' },
    lineas: selected.lines,
    firma: evidenceId,
    observaciones: 'Certificacion local automatizada',
  };
  const body = { delivery };
  const confirm = await request('POST', '/repartidor-finanzas/rutero/confirm-delivery-cobro', { token: repartidor.token, body, headers: { 'Idempotency-Key': key } });
  const confirmationId = confirmationIdOf(confirm.json);
  if (!emit('confirm.created', statusOk(confirm, [201]) && Boolean(confirmationId), { status: confirm.status, code: safeCode(confirm.json) })) throw new Error('confirm failed');
  const replay = await request('POST', '/repartidor-finanzas/rutero/confirm-delivery-cobro', { token: repartidor.token, body, headers: { 'Idempotency-Key': key } });
  if (!emit('confirm.exact_replay', statusOk(replay, [200]), { status: replay.status, code: safeCode(replay.json) })) throw new Error('replay failed');
  const changed = { delivery: { ...delivery, observaciones: 'Certificacion local distinta' } };
  const changedReplay = await request('POST', '/repartidor-finanzas/rutero/confirm-delivery-cobro', { token: repartidor.token, body: changed, headers: { 'Idempotency-Key': key } });
  if (!emit('confirm.changed_replay_conflict', changedReplay.status === 409, { status: changedReplay.status, code: safeCode(changedReplay.json) })) throw new Error('changed replay guard failed');
  const duplicate = await request('POST', '/repartidor-finanzas/rutero/confirm-delivery-cobro', { token: repartidor.token, body, headers: { 'Idempotency-Key': `cert-local-${crypto.randomUUID()}` } });
  if (!emit('confirm.fresh_key_duplicate_conflict', duplicate.status === 409, { status: duplicate.status, code: safeCode(duplicate.json) })) throw new Error('duplicate delivery guard failed');

  const after = await request('GET', `/entregas/pendientes/${encodeURIComponent(driver)}?date=${date}&limit=100&offset=0`, { token: repartidor.token });
  const weekAfter = await request('GET', `/repartidor/rutero/week/${encodeURIComponent(driver)}?date=${date}`, { token: repartidor.token });
  const overlayValid = statusOk(after, [200])
    && isDelivered(listOf(after.json), selected.identity.itemId)
    && statusOk(weekAfter, [200]) && Boolean(weekDaysOf(weekAfter.json))
    && weekCompletedCount(weekAfter.json) === completedBefore + 1;
  if (!emit('overlay.pending_and_week_completed_plus_one', overlayValid, { status: after.status, code: safeCode(after.json) })) throw new Error('test overlay missing');

  const receipt = await request('GET', `/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(confirmationId)}/receipt?repartidorId=${encodeURIComponent(driver)}`, { token: jefeToken });
  const pdf = receipt.json?.pdfBase64 ?? receipt.json?.data?.pdfBase64;
  if (!emit('jefe.receipt_pdf_concrete_owner', statusOk(receipt, [200]) && Buffer.from(String(pdf || ''), 'base64').subarray(0, 4).toString() === '%PDF', { status: receipt.status, code: safeCode(receipt.json) })) throw new Error('receipt missing');
  const emailSink = String(process.env.REPARTO_EMAIL_TEST_SINK || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSink)) {
    throw new Error('authorized test email sink is missing');
  }
  const receiptEmail = await request('POST', `/repartidor-finanzas/rutero/confirmations/${encodeURIComponent(confirmationId)}/receipt/email`, {
    token: jefeToken,
    body: { destinatario: emailSink, repartidorId: driver },
  });
  const receiptEmailMessageId = receiptEmail.json?.messageId ?? receiptEmail.json?.data?.messageId;
  const receiptEmailOk = statusOk(receiptEmail, [200]) && Boolean(receiptEmailMessageId)
    && receiptEmail.json?.ledgerWritten === true;
  if (!emit('jefe.receipt_email_sink_ledger', receiptEmailOk, { status: receiptEmail.status, code: safeCode(receiptEmail.json) }))
    throw new Error('receipt email failed');

  const bossSelected = await request('GET', `/entregas/pendientes/${encodeURIComponent(driver)}?date=${date}&limit=1&offset=0`, { token: jefeToken });
  if (!emit('jefe.selected_scope', statusOk(bossSelected, [200]), { status: bossSelected.status, code: safeCode(bossSelected.json) })) throw new Error('jefe selected scope failed');

  for (const path of ['/repartidor/entregas', '/repartidor/entregas/cert-legacy/firma', '/repartidor/entregas/cert-legacy/lineas', '/repartidor/cobros']) {
    const legacy = await request('POST', path, { token: repartidor.token, body: {} });
    if (!emit('legacy.non_mutating', legacy.status === 410, { status: legacy.status, code: safeCode(legacy.json) })) throw new Error('legacy route not retired');
  }
  emit('summary', output.every((row) => row.pass), { checks: output.length });
}

if (require.main === module) {
  main().catch((error) => {
    emit('summary', false, { error: 'CERTIFICATION_FAILED', checks: output.length });
    process.exitCode = 1;
  });
}

module.exports = {
  ACTORS_FILE,
  BASE,
  HOST,
  PORT,
  identityOf,
  detailLines,
  amountOf,
  statusOk,
  tokenOf,
  decodedClaimsOf,
  userOf,
  arrayOf,
  signedRepartidorCodes,
  outsideFleetCode,
  weekDaysOf,
  weekRowsOf,
  weekCompletedCount,
  isDelivered,
  buildCertificationSignatureDataUri,
};
