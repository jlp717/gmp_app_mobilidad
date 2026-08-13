'use strict';

const { queryWithParams } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');

class RuteroOrdenSchemaError extends Error {
  constructor(message = 'Tabla de orden de rutero no disponible') {
    super(message);
    this.name = 'RuteroOrdenSchemaError';
    this.code = 'RUTERO_ORDEN_SCHEMA_UNAVAILABLE';
    this.statusCode = 503;
  }
}

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

async function listOrder(repartidorId, fechaRuta, env = process.env) {
  const table = resolveOrderTable(env);
  const rows = await queryWithParams(
    `SELECT DOCUMENT_ID, CLIENTE_CODIGO, ORDEN
     FROM ${table}
     WHERE REPARTIDOR_ID = ? AND FECHA_RUTA = ?
     ORDER BY ORDEN ASC, DOCUMENT_ID ASC`,
    [repartidorId, fechaRuta],
    false,
    false,
  );
  return (rows || []).map((row) => ({
    documentId: String(row.DOCUMENT_ID || '').trim(),
    cliente: String(row.CLIENTE_CODIGO || '').trim() || null,
    posicion: Number(row.ORDEN),
  }));
}

async function replaceOrder(repartidorId, fechaRuta, orden, updatedBy, env = process.env) {
  const table = resolveOrderTable(env);
  await queryWithParams(
    `DELETE FROM ${table} WHERE REPARTIDOR_ID = ? AND FECHA_RUTA = ?`,
    [repartidorId, fechaRuta],
    false,
    false,
  );
  for (const row of orden) {
    await queryWithParams(
      `INSERT INTO ${table}
        (REPARTIDOR_ID, FECHA_RUTA, DOCUMENT_ID, CLIENTE_CODIGO, ORDEN, UPDATED_AT, UPDATED_BY)
       VALUES (?, ?, ?, ?, ?, CURRENT TIMESTAMP, ?)`,
      [
        repartidorId,
        fechaRuta,
        row.documentId,
        row.cliente,
        row.posicion,
        String(updatedBy || '').slice(0, 40) || null,
      ],
      false,
      false,
    );
  }
  return orden;
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
    try {
      const movilRows = await queryWithParams(
        `SELECT TRIM(CODIGO) AS CODIGO, LATITUD, LONGITUD
         FROM DSEMOVIL.CLIENTES
         WHERE TRIM(CODIGO) IN (${placeholders})
           AND LATITUD IS NOT NULL AND LONGITUD IS NOT NULL
           AND ABS(LATITUD) > 0.01 AND ABS(LONGITUD) > 0.01`,
        batch,
        false,
        false,
      );
      for (const row of movilRows || []) {
        const code = String(row.CODIGO || row.codigo || '').trim();
        if (!code || byCliente.has(code)) continue;
        const lat = Number(row.LATITUD ?? row.latitud);
        const lng = Number(row.LONGITUD ?? row.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        byCliente.set(code, { lat, lng, source: 'DSEMOVIL.CLIENTES' });
      }
    } catch (_) {
      // Mobile GPS table optional.
    }

    const missing = batch.filter((code) => !byCliente.has(code));
    if (missing.length === 0) continue;
    const missPlaceholders = missing.map(() => '?').join(',');
    try {
      const locRows = await queryWithParams(
        `SELECT TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE, LATITUD, LONGITUD
         FROM DSEDAC.LOC
         WHERE TRIM(CODIGOCLIENTE) IN (${missPlaceholders})
           AND LATITUD IS NOT NULL AND LONGITUD IS NOT NULL
           AND ABS(LATITUD) > 0.01 AND ABS(LONGITUD) > 0.01`,
        missing,
        false,
        false,
      );
      for (const row of locRows || []) {
        const code = String(row.CODIGOCLIENTE || row.codigocliente || '').trim();
        if (!code || byCliente.has(code)) continue;
        const lat = Number(row.LATITUD ?? row.latitud);
        const lng = Number(row.LONGITUD ?? row.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        byCliente.set(code, { lat, lng, source: 'DSEDAC.LOC' });
      }
    } catch (_) {
      // LOC fallback optional.
    }
  }
  return byCliente;
}

module.exports = {
  RuteroOrdenSchemaError,
  resolveOrderTable,
  listOrder,
  replaceOrder,
  fetchClientWindows,
  fetchClientGeo,
  uniqueClientCodes,
};
