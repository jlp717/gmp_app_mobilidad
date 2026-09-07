'use strict';

const { queryWithParams, acquireConfiguredConnection } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');

class RuteroOrderConflictError extends Error {
  constructor() {
    super('El orden ha sido modificado por otro usuario');
    this.name = 'RuteroOrderConflictError';
    this.code = 'RUTERO_ORDER_CONFLICT';
    this.statusCode = 409;
  }
}

class RuteroOrderTransactionError extends Error {
  constructor(message = 'No se puede guardar el orden de ruta ahora') {
    super(message);
    this.name = 'RuteroOrderTransactionError';
    this.code = 'RUTERO_ORDER_TRANSACTION_UNAVAILABLE';
    this.statusCode = 503;
  }
}

class RuteroOrdenSchemaError extends Error {
  constructor(message = 'Tabla de orden de rutero no disponible') {
    super(message);
    this.name = 'RuteroOrdenSchemaError';
    this.code = 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE';
    this.statusCode = 503;
  }
}

class RuteroOrderReadTimeoutError extends Error {
  constructor() {
    super('La lectura del orden de rutero excedio el tiempo maximo');
    this.name = 'RuteroOrderReadTimeoutError';
    this.code = 'RUTERO_ORDER_READ_TIMEOUT';
    this.statusCode = 503;
  }
}

const ORDER_READ_TIMEOUT_MS = 8000;
const ORDER_READ_SQL = 'SELECT DOCUMENT_ID, CLIENTE_CODIGO, ORDEN, UPDATED_AT, UPDATED_BY'
  + ' FROM %TABLE% WHERE REPARTIDOR_ID = ? AND FECHA_RUTA = ?'
  + ' ORDER BY ORDEN ASC, DOCUMENT_ID ASC WITH UR';

function resolveOrderTable(env = process.env) {
  const runtime = resolveRepartoRuntime(env);
  const table = runtime?.tables?.routing?.order;
  if (!runtime?.valid || !table || !/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/.test(table)) {
    throw new RuteroOrdenSchemaError();
  }
  if (runtime.tableSet === 'isolated_test' && !table.startsWith('JAVIER.TEST_')) {
    throw new RuteroOrdenSchemaError();
  }
  if (runtime.tableSet === 'production' && table.startsWith('JAVIER.TEST_')) {
    throw new RuteroOrdenSchemaError();
  }
  return table;
}

async function withDedicatedConnection(work, timeoutMs = 0) {
  const connection = await acquireConfiguredConnection();
  let timer = null;
  let timedOut = false;
  const run = Promise.resolve().then(() => work(connection));
  try {
    if (!timeoutMs) return await run;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new RuteroOrderReadTimeoutError());
      }, timeoutMs);
    });
    return await Promise.race([run, timeout]);
  } catch (error) {
    if (timedOut) run.catch(() => { /* query aborted by close() */ });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    try { await connection.close(); } catch (_) { /* best effort */ }
  }
}

async function queryOrderRows(connection, sql, params) {
  const result = typeof connection.query === 'function'
    ? await connection.query(sql, params)
    : await connection.execute(sql, params);
  return rowsOf(result);
}

async function listOrder(repartidorId, fechaRuta, env = process.env) {
  const state = await readOrderState(repartidorId, fechaRuta, env);
  return state.orden;
}

function rowsOf(result) { return Array.isArray(result) ? result : (result?.rows || []); }
function orderFromRows(rows) { return rows.map((row) => ({ documentId: String(row.DOCUMENT_ID || row.document_id || '').trim(), cliente: String(row.CLIENTE_CODIGO || row.cliente_codigo || '').trim() || null, posicion: Number(row.ORDEN ?? row.orden) })); }
function revisionForRows(rows) { return Buffer.from(JSON.stringify(rows.map((row) => [String(row.DOCUMENT_ID || row.document_id || '').trim(), String(row.CLIENTE_CODIGO || row.cliente_codigo || '').trim(), Number(row.ORDEN ?? row.orden ?? 0), String(row.UPDATED_AT || row.updated_at || ''), String(row.UPDATED_BY || row.updated_by || '')]))).toString('base64url'); }
async function readOrderState(repartidorId, fechaRuta, env = process.env) {
  const table = resolveOrderTable(env);
  const sql = ORDER_READ_SQL.replace('%TABLE%', table);
  const rows = await withDedicatedConnection(
    (connection) => queryOrderRows(connection, sql, [repartidorId, fechaRuta]),
    ORDER_READ_TIMEOUT_MS,
  );
  return { orden: orderFromRows(rows || []), revision: revisionForRows(rows || []) };
}
async function replaceOrder(repartidorId, fechaRuta, orden, updatedBy, baseRevision, env = process.env) {
  const table = resolveOrderTable(env);
  if (typeof baseRevision !== 'string' || !baseRevision) throw new RuteroOrderConflictError();
  let connection;
  try {
    connection = await acquireConfiguredConnection();
    if (typeof connection.query !== 'function' || typeof connection.close !== 'function' || !['beginTransaction', 'commit', 'rollback'].every((m) => typeof connection[m] === 'function')) throw new RuteroOrderTransactionError();
    const execute = async (sql, params = []) => rowsOf(await connection.query(sql, params));
    await connection.beginTransaction();
    await execute(`LOCK TABLE ${table} IN EXCLUSIVE MODE`);
    const before = await execute(`SELECT DOCUMENT_ID, CLIENTE_CODIGO, ORDEN, UPDATED_AT, UPDATED_BY FROM ${table} WHERE REPARTIDOR_ID = ? AND FECHA_RUTA = ? ORDER BY ORDEN ASC, DOCUMENT_ID ASC`, [repartidorId, fechaRuta]);
    if (revisionForRows(before) !== baseRevision) throw new RuteroOrderConflictError();
    await execute(`DELETE FROM ${table} WHERE REPARTIDOR_ID = ? AND FECHA_RUTA = ?`, [repartidorId, fechaRuta]);
    for (const row of orden) await execute(`INSERT INTO ${table} (REPARTIDOR_ID, FECHA_RUTA, DOCUMENT_ID, CLIENTE_CODIGO, ORDEN, UPDATED_AT, UPDATED_BY) VALUES (?, ?, ?, ?, ?, CURRENT TIMESTAMP, ?)`, [repartidorId, fechaRuta, row.documentId, row.cliente, row.posicion, String(updatedBy || '').slice(0, 40) || null]);
    const saved = await execute(`SELECT DOCUMENT_ID, CLIENTE_CODIGO, ORDEN, UPDATED_AT, UPDATED_BY FROM ${table} WHERE REPARTIDOR_ID = ? AND FECHA_RUTA = ? ORDER BY ORDEN ASC, DOCUMENT_ID ASC`, [repartidorId, fechaRuta]);
    await connection.commit();
    return { orden: orderFromRows(saved), revision: revisionForRows(saved) };
  } catch (error) {
    if (connection) try { await connection.rollback(); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    if (connection) {
      try { await connection.close(); } catch (_) { /* best effort */ }
    }
  }
}

function uniqueClientCodes(codes) {
  const out = [];
  const seen = new Set();
  for (const raw of codes || []) {
    const code = String(raw || '').trim();
    if (!code || seen.has(code)) continue;
    if (!/^[A-Za-z0-9]{1,20}$/.test(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= 300) break;
  }
  return out;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function mapWindowRow(row) {
  return {
    cliente: String(row.CODIGOCLIENTE || row.codigocliente || '').trim(),
    horaRepartoDesde: row.HORAREPARTODESDE ?? row.horarepartodesde ?? null,
    horaRepartoHasta: row.HORAREPARTOHASTA ?? row.horarepartohasta ?? null,
    horaVisita: row.HORAVISITA ?? row.horavisita ?? null,
    horaLlamada: row.HORALLAMADA ?? row.horallamada ?? null,
    observacionesReparto: String(
      row.OBSERVACIONESREPARTO ?? row.observacionesreparto ?? '',
    ).trim() || null,
    DIACIERRELUNESSN: row.DIACIERRELUNESSN,
    DIACIERREMARTESSN: row.DIACIERREMARTESSN,
    DIACIERREMIERCOLESSN: row.DIACIERREMIERCOLESSN,
    DIACIERREJUEVESSN: row.DIACIERREJUEVESSN,
    DIACIERREVIERNESSN: row.DIACIERREVIERNESSN,
    DIACIERRESABADOSN: row.DIACIERRESABADOSN,
    DIACIERREDOMINGOSN: row.DIACIERREDOMINGOSN,
    ordenRepartoLunes: row.ORDENREPARTOLUNES,
    ordenRepartoMartes: row.ORDENREPARTOMARTES,
    ordenRepartoMiercoles: row.ORDENREPARTOMIERCOLES,
    ordenRepartoJueves: row.ORDENREPARTOJUEVES,
    ordenRepartoViernes: row.ORDENREPARTOVIERNES,
    ordenRepartoSabado: row.ORDENREPARTOSABADO,
    ordenRepartoDomingo: row.ORDENREPARTODOMINGO,
  };
}

/** CRUT windows keyed by cliente (SECUENCIA=1 preferred). */
async function fetchClientWindows(clientCodes) {
  const codes = uniqueClientCodes(clientCodes);
  const byCliente = new Map();
  if (codes.length === 0) return byCliente;

  for (const batch of chunk(codes, 80)) {
    const placeholders = batch.map(() => '?').join(',');
    let rows = [];
    try {
      rows = await queryWithParams(
        `SELECT
           TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
           HORAREPARTODESDE,
           HORAREPARTOHASTA,
           HORAVISITA,
           HORALLAMADA,
           OBSERVACIONESREPARTO,
           DIACIERRELUNESSN,
           DIACIERREMARTESSN,
           DIACIERREMIERCOLESSN,
           DIACIERREJUEVESSN,
           DIACIERREVIERNESSN,
           DIACIERRESABADOSN,
           DIACIERREDOMINGOSN,
           ORDENREPARTOLUNES,
           ORDENREPARTOMARTES,
           ORDENREPARTOMIERCOLES,
           ORDENREPARTOJUEVES,
           ORDENREPARTOVIERNES,
           ORDENREPARTOSABADO,
           ORDENREPARTODOMINGO,
           SECUENCIA
         FROM DSEDAC.CRUT
         WHERE TRIM(CODIGOCLIENTE) IN (${placeholders})
           AND (SECUENCIA = 1 OR SECUENCIA IS NULL)
         ORDER BY SECUENCIA ASC`,
        batch,
        false,
        false,
      );
    } catch (_) {
      rows = await queryWithParams(
        `SELECT
           TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
           HORAREPARTODESDE,
           HORAREPARTOHASTA,
           HORAVISITA,
           HORALLAMADA,
           OBSERVACIONESREPARTO,
           DIACIERRELUNESSN,
           DIACIERREMARTESSN,
           DIACIERREMIERCOLESSN,
           DIACIERREJUEVESSN,
           DIACIERREVIERNESSN,
           DIACIERRESABADOSN,
           DIACIERREDOMINGOSN
         FROM DSEDAC.CRUT
         WHERE TRIM(CODIGOCLIENTE) IN (${placeholders})`,
        batch,
        false,
        false,
      );
    }
    for (const row of rows || []) {
      const mapped = mapWindowRow(row);
      if (!mapped.cliente || byCliente.has(mapped.cliente)) continue;
      byCliente.set(mapped.cliente, mapped);
    }
  }
  return byCliente;
}

/** GPS: DSEMOVIL.CLIENTES preferred, DSEDAC.LOC fallback. */
async function fetchClientGeo(clientCodes) {
  const codes = uniqueClientCodes(clientCodes);
  const byCliente = new Map();
  if (codes.length === 0) return byCliente;

  for (const batch of chunk(codes, 80)) {
    const placeholders = batch.map(() => '?').join(',');
    const batchKey = batch.slice().sort().join(',');
    try {
      const movilRows = await cachedQuery(
        (sql, params) => queryWithParams(sql, params, false, false),
        `SELECT TRIM(CODIGO) AS CODIGO, LATITUD, LONGITUD
         FROM DSEMOVIL.CLIENTES
         WHERE TRIM(CODIGO) IN (${placeholders})
           AND LATITUD IS NOT NULL AND LONGITUD IS NOT NULL
           AND ABS(LATITUD) > 0.01 AND ABS(LONGITUD) > 0.01
           AND LATITUD BETWEEN 27 AND 44 AND LONGITUD BETWEEN -18 AND 5`,
        `repartidor:geo:movil:${batchKey}`,
        TTL.LONG,
        batch,
      );
      for (const row of movilRows || []) {
        const code = String(row.CODIGO || row.codigo || '').trim();
        if (!code || byCliente.has(code)) continue;
        const lat = Number(row.LATITUD ?? row.latitud);
        const lng = Number(row.LONGITUD ?? row.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < 27 || lat > 44 || lng < -18 || lng > 5) continue; // ponytail: Spain bbox rejects Africa/0,0
        byCliente.set(code, { lat, lng, source: 'DSEMOVIL.CLIENTES' });
      }
    } catch (_) {
      // Mobile GPS table optional.
    }

    const missing = batch.filter((code) => !byCliente.has(code));
    if (missing.length === 0) continue;
    const missPlaceholders = missing.map(() => '?').join(',');
    try {
      const locRows = await cachedQuery(
        (sql, params) => queryWithParams(sql, params, false, false),
        `SELECT TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE, LATITUD, LONGITUD
         FROM DSEDAC.LOC
         WHERE TRIM(CODIGOCLIENTE) IN (${missPlaceholders})
           AND LATITUD IS NOT NULL AND LONGITUD IS NOT NULL
           AND ABS(LATITUD) > 0.01 AND ABS(LONGITUD) > 0.01
           AND LATITUD BETWEEN 27 AND 44 AND LONGITUD BETWEEN -18 AND 5`,
        `repartidor:geo:loc:${missing.slice().sort().join(',')}`,
        TTL.LONG,
        missing,
      );
      for (const row of locRows || []) {
        const code = String(row.CODIGOCLIENTE || row.codigocliente || '').trim();
        if (!code || byCliente.has(code)) continue;
        const lat = Number(row.LATITUD ?? row.latitud);
        const lng = Number(row.LONGITUD ?? row.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < 27 || lat > 44 || lng < -18 || lng > 5) continue;
        byCliente.set(code, { lat, lng, source: 'DSEDAC.LOC' });
      }
    } catch (_) {
      // LOC fallback optional.
    }
  }
  return byCliente;
}

module.exports = {
  RuteroOrderConflictError,
  RuteroOrderTransactionError,
  RuteroOrdenSchemaError,
  RuteroOrderReadTimeoutError,
  resolveOrderTable,
  listOrder,
  readOrderState,
  revisionForRows,
  replaceOrder,
  fetchClientWindows,
  fetchClientGeo,
  uniqueClientCodes,
};
