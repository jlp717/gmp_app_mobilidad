'use strict';

const crypto = require('crypto');
const { queryWithParams, acquireConfiguredConnection } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');

const IDENTIFIER_RE = /^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/;
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;
const MAX_SAMPLES_PER_BATCH = 50;
const MAX_ACCURACY_METERS = 5000;

class RuteroTrackingUnavailableError extends Error {
  constructor(code = 'RUTERO_TRACKING_UNAVAILABLE', message = 'El seguimiento no está disponible') {
    super(message);
    this.name = 'RuteroTrackingUnavailableError';
    this.code = code;
    this.statusCode = 503;
  }
}

class RuteroTrackingValidationError extends Error {
  constructor(code, message = 'Los datos de seguimiento no son válidos') {
    super(message);
    this.name = 'RuteroTrackingValidationError';
    this.code = code;
    this.statusCode = 422;
  }
}

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

function trackingEnabled(env = process.env) {
  return String(env.REPARTIDOR_TRACKING_ENABLED || '').trim().toLowerCase() === 'true';
}

function resolveTrackingTable(env = process.env) {
  if (!trackingEnabled(env)) throw new RuteroTrackingUnavailableError();
  const runtime = resolveRepartoRuntime(env);
  const table = runtime?.tables?.routing?.tracking;
  if (!runtime?.valid || !table || !IDENTIFIER_RE.test(table)) {
    throw new RuteroTrackingUnavailableError('RUTERO_TRACKING_SCHEMA_UNAVAILABLE', 'La persistencia GPS no está configurada');
  }
  if (runtime.tableSet === 'isolated_test' && !table.startsWith('JAVIER.TEST_')) {
    throw new RuteroTrackingUnavailableError('RUTERO_TRACKING_SCHEMA_UNAVAILABLE', 'La persistencia de pruebas no está aislada');
  }
  if (runtime.tableSet === 'production' && table.startsWith('JAVIER.TEST_')) {
    throw new RuteroTrackingUnavailableError('RUTERO_TRACKING_SCHEMA_UNAVAILABLE', 'La persistencia de producción no es válida');
  }
  return table;
}

function tryResolveTrackingTable(env = process.env) {
  try {
    return resolveTrackingTable(env);
  } catch (_) {
    return null;
  }
}

function validDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!validDate(text)) throw new RuteroTrackingValidationError('DATE_INVALID');
  return text;
}

function dateValueToYmd(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : '';
}

function normalizeSessionId(value) {
  const id = String(value || '').trim();
  if (!SESSION_ID_RE.test(id)) throw new RuteroTrackingValidationError('TRACKING_SESSION_INVALID');
  return id;
}

function normalizeEventId(value) {
  const id = String(value || '').trim();
  if (!EVENT_ID_RE.test(id)) throw new RuteroTrackingValidationError('TRACKING_EVENT_INVALID');
  return id;
}

function normalizeCoordinate(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RuteroTrackingValidationError('TRACKING_COORDINATE_INVALID', field + ' no es válido');
  }
  return number;
}

function normalizeTimestamp(value) {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    throw new RuteroTrackingValidationError('TRACKING_TIMESTAMP_INVALID');
  }
  const ageMs = Date.now() - parsed.getTime();
  if (ageMs < -5 * 60 * 1000 || ageMs > 7 * 24 * 60 * 60 * 1000) {
    throw new RuteroTrackingValidationError('TRACKING_TIMESTAMP_OUT_OF_RANGE');
  }
  return parsed.toISOString();
}

function normalizeSample(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new RuteroTrackingValidationError('TRACKING_SAMPLE_INVALID');
  }
  const latitude = normalizeCoordinate(raw.latitude ?? raw.lat, 'latitude', -90, 90);
  const longitude = normalizeCoordinate(raw.longitude ?? raw.lng, 'longitude', -180, 180);
  const accuracy = normalizeCoordinate(raw.accuracy ?? 0, 'accuracy', 0, MAX_ACCURACY_METERS);
  const speed = raw.speed == null ? null : normalizeCoordinate(raw.speed, 'speed', 0, 150);
  const heading = raw.heading == null ? null : normalizeCoordinate(raw.heading, 'heading', 0, 360);
  return {
    eventId: normalizeEventId(raw.eventId),
    latitude,
    longitude,
    accuracy,
    speed,
    heading,
    recordedAt: normalizeTimestamp(raw.recordedAt ?? raw.timestamp),
  };
}

function normalizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > MAX_SAMPLES_PER_BATCH) {
    throw new RuteroTrackingValidationError('TRACKING_BATCH_INVALID');
  }
  const out = samples.map(normalizeSample);
  if (new Set(out.map((sample) => sample.eventId)).size !== out.length) {
    throw new RuteroTrackingValidationError('TRACKING_EVENT_DUPLICATE');
  }
  return out;
}

async function createSession({ repartidorId, sessionId, routeDate, updatedBy, env = process.env }) {
  const table = resolveTrackingTable(env);
  const session = normalizeSessionId(sessionId);
  const date = normalizeDate(routeDate);
  const owner = String(repartidorId || '').trim();
  if (!owner) throw new RuteroTrackingValidationError('REPARTIDOR_ID_INVALID');
  const existing = rowsOf(await queryWithParams(
    'SELECT REPARTIDOR_ID, ROUTE_DATE FROM ' + table
      + ' WHERE SESSION_ID = ? AND EVENT_TYPE = \'START\'',
    [session],
    false,
    false,
  ));
  if (existing.length > 0) {
    if (String(existing[0].REPARTIDOR_ID || '').trim() !== owner
        || dateValueToYmd(existing[0].ROUTE_DATE) !== date) {
      throw new RuteroTrackingValidationError('TRACKING_SESSION_OWNERSHIP_CONFLICT');
    }
    return { sessionId: session, routeDate: date, replayed: true };
  }
  await queryWithParams(
    'INSERT INTO ' + table
      + ' (SESSION_ID, EVENT_ID, REPARTIDOR_ID, ROUTE_DATE, EVENT_TYPE, RECORDED_AT, RECEIVED_AT, UPDATED_BY)'
      + ' VALUES (?, \'start\', ?, ?, \'START\', CURRENT TIMESTAMP, CURRENT TIMESTAMP, ?)',
    [session, owner, date, String(updatedBy || '').trim().slice(0, 40) || null],
    false,
    false,
  );
  return { sessionId: session, routeDate: date, replayed: false };
}

async function assertSession({ table, sessionId, repartidorId, routeDate }) {
  const rows = rowsOf(await queryWithParams(
    'SELECT SESSION_ID, REPARTIDOR_ID, ROUTE_DATE, EVENT_TYPE FROM ' + table
      + ' WHERE SESSION_ID = ? ORDER BY RECORDED_AT ASC FETCH FIRST 1 ROW ONLY',
    [sessionId],
    false,
    false,
  ));
  if (rows.length === 0
      || String(rows[0].REPARTIDOR_ID || '').trim() !== String(repartidorId || '').trim()
      || dateValueToYmd(rows[0].ROUTE_DATE) !== routeDate) {
    throw new RuteroTrackingValidationError('TRACKING_SESSION_NOT_FOUND');
  }
}

async function appendSamples({
  repartidorId,
  sessionId,
  routeDate,
  samples,
  updatedBy,
  env = process.env,
}) {
  const table = resolveTrackingTable(env);
  const session = normalizeSessionId(sessionId);
  const date = normalizeDate(routeDate);
  const normalized = normalizeSamples(samples);
  await assertSession({ table, sessionId: session, repartidorId, routeDate: date });
  const connection = await acquireConfiguredConnection();
  if (!connection || typeof connection.query !== 'function'
      || typeof connection.close !== 'function'
      || !['beginTransaction', 'commit', 'rollback'].every((method) => typeof connection[method] === 'function')) {
    throw new RuteroTrackingUnavailableError('RUTERO_TRACKING_TRANSACTION_UNAVAILABLE');
  }
  let inserted = 0;
  try {
    const execute = async (sql, params = []) => rowsOf(await connection.query(sql, params));
    await connection.beginTransaction();
    await execute('LOCK TABLE ' + table + ' IN EXCLUSIVE MODE');
    for (const sample of normalized) {
      const existing = await execute(
        'SELECT EVENT_ID FROM ' + table + ' WHERE SESSION_ID = ? AND EVENT_ID = ?',
        [session, sample.eventId],
      );
      if (existing.length > 0) continue;
      await execute(
        'INSERT INTO ' + table
          + ' (SESSION_ID, EVENT_ID, REPARTIDOR_ID, ROUTE_DATE, EVENT_TYPE, LATITUDE, LONGITUDE, ACCURACY_METERS, SPEED_KMH, HEADING_DEGREES, RECORDED_AT, RECEIVED_AT, UPDATED_BY)'
          + ' VALUES (?, ?, ?, ?, \'POSITION\', ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP, ?)',
        [
          session,
          sample.eventId,
          String(repartidorId || '').trim(),
          date,
          sample.latitude,
          sample.longitude,
          sample.accuracy,
          sample.speed,
          sample.heading,
          sample.recordedAt,
          String(updatedBy || '').trim().slice(0, 40) || null,
        ],
      );
      inserted += 1;
    }
    await connection.commit();
    return { sessionId: session, accepted: normalized.length, inserted, replayed: inserted === 0 };
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    try { await connection.close(); } catch (_) { /* best effort */ }
  }
}

async function stopSession({ repartidorId, sessionId, routeDate, eventId, updatedBy, env = process.env }) {
  const table = resolveTrackingTable(env);
  const session = normalizeSessionId(sessionId);
  const date = normalizeDate(routeDate);
  const event = normalizeEventId(eventId);
  await assertSession({ table, sessionId: session, repartidorId, routeDate: date });
  const existing = rowsOf(await queryWithParams(
    'SELECT EVENT_ID FROM ' + table + ' WHERE SESSION_ID = ? AND EVENT_ID = ?',
    [session, event],
    false,
    false,
  ));
  if (existing.length === 0) {
    await queryWithParams(
      'INSERT INTO ' + table
        + ' (SESSION_ID, EVENT_ID, REPARTIDOR_ID, ROUTE_DATE, EVENT_TYPE, RECORDED_AT, RECEIVED_AT, UPDATED_BY)'
        + ' VALUES (?, ?, ?, ?, \'STOP\', CURRENT TIMESTAMP, CURRENT TIMESTAMP, ?)',
      [session, event, String(repartidorId || '').trim(), date, String(updatedBy || '').trim().slice(0, 40) || null],
      false,
      false,
    );
  }
  return { sessionId: session, stopped: true, replayed: existing.length > 0 };
}

async function latestPosition({ repartidorId, routeDate, env = process.env }) {
  const table = resolveTrackingTable(env);
  const date = normalizeDate(routeDate);
  const rows = rowsOf(await queryWithParams(
    'SELECT SESSION_ID, EVENT_ID, LATITUDE, LONGITUDE, ACCURACY_METERS, SPEED_KMH, HEADING_DEGREES, RECORDED_AT, RECEIVED_AT'
      + ' FROM ' + table
      + ' WHERE REPARTIDOR_ID = ? AND ROUTE_DATE = ? AND EVENT_TYPE = \'POSITION\''
      + ' ORDER BY RECORDED_AT DESC FETCH FIRST 1 ROW ONLY',
    [String(repartidorId || '').trim(), date],
    false,
    false,
  ));
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    sessionId: String(row.SESSION_ID || '').trim(),
    eventId: String(row.EVENT_ID || '').trim(),
    latitude: Number(row.LATITUDE),
    longitude: Number(row.LONGITUDE),
    accuracy: Number(row.ACCURACY_METERS),
    speedKmh: row.SPEED_KMH == null ? null : Number(row.SPEED_KMH),
    heading: row.HEADING_DEGREES == null ? null : Number(row.HEADING_DEGREES),
    recordedAt: row.RECORDED_AT,
    receivedAt: row.RECEIVED_AT,
  };
}

module.exports = {
  RuteroTrackingUnavailableError,
  RuteroTrackingValidationError,
  trackingEnabled,
  resolveTrackingTable,
  tryResolveTrackingTable,
  normalizeDate,
  normalizeSessionId,
  normalizeEventId,
  normalizeSample,
  normalizeSamples,
  createSession,
  appendSamples,
  stopSession,
  latestPosition,
};
