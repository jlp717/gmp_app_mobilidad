'use strict';

const crypto = require('crypto');
const { queryWithParams, acquireConfiguredConnection } = require('../config/db');
const { resolveRepartoRuntime, TABLE_MAPPINGS } = require('../config/reparto-runtime');

const IDENTIFIER_RE = /^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DOCUMENTS_PER_MOVE = 100;

class RuteroDayMoveUnavailableError extends Error {
  constructor(code = 'RUTERO_DAY_MOVE_UNAVAILABLE', message = 'El cambio de día no está habilitado') {
    super(message);
    this.name = 'RuteroDayMoveUnavailableError';
    this.code = code;
    this.statusCode = 503;
  }
}

class RuteroDayMoveConflictError extends Error {
  constructor(code, message = 'La ruta ha cambiado mientras se aplicaba el traslado') {
    super(message);
    this.name = 'RuteroDayMoveConflictError';
    this.code = code;
    this.statusCode = 409;
  }
}

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

function dayMoveEnabled(env = process.env) {
  return String(env.REPARTIDOR_DAY_MOVE_ENABLED || '').trim().toLowerCase() === 'true';
}

function resolveDayMoveTables(env = process.env) {
  if (!dayMoveEnabled(env)) throw new RuteroDayMoveUnavailableError();
  const runtime = resolveRepartoRuntime(env);
  const routing = runtime?.tables?.routing;
  const expected = TABLE_MAPPINGS[runtime?.tableSet]?.routing;
  const override = routing?.dayOverride;
  const requests = routing?.moveRequests;
  if (!runtime?.valid || !override || !requests
      || !IDENTIFIER_RE.test(override) || !IDENTIFIER_RE.test(requests)
      || override !== expected?.dayOverride || requests !== expected?.moveRequests) {
    throw new RuteroDayMoveUnavailableError('RUTERO_DAY_MOVE_SCHEMA_UNAVAILABLE', 'La persistencia de cambios de día no está disponible');
  }
  if (runtime.tableSet === 'isolated_test'
      && (!override.startsWith('JAVIER.TEST_') || !requests.startsWith('JAVIER.TEST_'))) {
    throw new RuteroDayMoveUnavailableError('RUTERO_DAY_MOVE_SCHEMA_UNAVAILABLE', 'La persistencia de pruebas no está aislada');
  }
  if (runtime.tableSet === 'production'
      && (override.startsWith('JAVIER.TEST_') || requests.startsWith('JAVIER.TEST_'))) {
    throw new RuteroDayMoveUnavailableError('RUTERO_DAY_MOVE_SCHEMA_UNAVAILABLE', 'La persistencia de producción no es válida');
  }
  return { override, requests };
}

function tryResolveDayOverrideTable(env = process.env) {
  try {
    return resolveDayMoveTables(env).override;
  } catch (_) {
    return null;
  }
}

function monday(dateYmd) {
  if (!DATE_RE.test(String(dateYmd || ''))) return null;
  const date = new Date(`${dateYmd}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function sunday(dateYmd) {
  const start = monday(dateYmd);
  if (!start) return null;
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}


function numericDate(dateYmd) {
  const [year, month, day] = String(dateYmd).split('-').map(Number);
  return year * 10000 + month * 100 + day;
}

function documentIdExpression(alias = 'CPC') {
  return `TRIM(VARCHAR(${alias}.EJERCICIOALBARAN)) || '-' || TRIM(${alias}.SERIEALBARAN) || '-' || TRIM(VARCHAR(${alias}.TERMINALALBARAN)) || '-' || TRIM(VARCHAR(${alias}.NUMEROALBARAN)) || '-' || TRIM(${alias}.CODIGOCLIENTEALBARAN)`;
}

function normalizedDocuments(documents) {
  const out = [];
  const seen = new Set();
  for (const raw of documents || []) {
    const documentId = String(raw?.documentId || '').trim();
    if (!/^[\w.\-]{1,80}$/.test(documentId) || seen.has(documentId)) continue;
    seen.add(documentId);
    out.push({
      documentId,
      cliente: String(raw?.cliente ?? '').trim() || null,
    });
  }
  return out;
}

function requestHash({ sourceDate, targetDate, position, documents }) {
  const payload = {
    sourceDate,
    targetDate,
    position,
    documents: normalizedDocuments(documents).map((doc) => [doc.documentId, doc.cliente]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function assertMoveInput({ repartidorId, sourceDate, targetDate, position, documents, idempotencyKey }) {
  if (!String(repartidorId || '').trim()) throw new RuteroDayMoveConflictError('REPARTIDOR_ID_INVALID');
  if (!DATE_RE.test(sourceDate) || !DATE_RE.test(targetDate)) {
    throw new RuteroDayMoveConflictError('DATE_INVALID');
  }
  if (sourceDate === targetDate) throw new RuteroDayMoveConflictError('RUTERO_MOVE_SAME_DAY');
  if (monday(sourceDate) !== monday(targetDate)) {
    throw new RuteroDayMoveConflictError('RUTERO_MOVE_OUTSIDE_WEEK');
  }
  if (!Number.isInteger(position) || position < 0 || position >= 500) {
    throw new RuteroDayMoveConflictError('POSICION_INVALID');
  }
  const docs = normalizedDocuments(documents);
  if (docs.length === 0 || docs.length > MAX_DOCUMENTS_PER_MOVE) {
    throw new RuteroDayMoveConflictError('RUTERO_MOVE_DOCUMENTS_INVALID');
  }
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) {
    throw new RuteroDayMoveConflictError('RUTERO_MOVE_IDEMPOTENCY_REQUIRED');
  }
  return { docs, key, weekStart: monday(sourceDate) };
}

function visibleDocumentsSql({ override, documents }) {
  const expr = documentIdExpression('CPC');
  const placeholders = documents.map(() => '?').join(', ');
  return {
    sql: `SELECT ${expr} AS DOCUMENT_ID,
                   TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE
              FROM DSEDAC.OPP OPP
              INNER JOIN DSEDAC.CPC CPC
                ON CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
               AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
               AND CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
              INNER JOIN DSEDAC.CAC CAC
                ON CAC.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
               AND CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
               AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
               AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
               AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
               AND TRIM(CAC.CODIGOCLIENTEALBARAN) = TRIM(CPC.CODIGOCLIENTEALBARAN)
              LEFT JOIN ${override} MOVE
                ON MOVE.REPARTIDOR_ID = ?
               AND MOVE.WEEK_START = ?
               AND TRIM(MOVE.DOCUMENT_ID) = ${expr}
             WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
               AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
               AND (
                    (MOVE.DOCUMENT_ID IS NOT NULL AND MOVE.TARGET_DATE = ?)
                    OR (MOVE.DOCUMENT_ID IS NULL
                        AND OPP.DIAREPARTO = ? AND OPP.MESREPARTO = ? AND OPP.ANOREPARTO = ?)
               )
               AND ${expr} IN (${placeholders})
             GROUP BY ${expr}, TRIM(CPC.CODIGOCLIENTEALBARAN)`,
    expr,
  };
}

async function moveDocuments({
  repartidorId,
  sourceDate,
  targetDate,
  position,
  documents,
  updatedBy,
  idempotencyKey,
  env = process.env,
}) {
  const tables = resolveDayMoveTables(env);
  const input = assertMoveInput({
    repartidorId, sourceDate, targetDate, position, documents, idempotencyKey,
  });
  const hash = requestHash({
    sourceDate, targetDate, position, documents: input.docs,
  });
  let connection;
  try {
    connection = await acquireConfiguredConnection();
    if (!connection || typeof connection.query !== 'function'
        || typeof connection.close !== 'function'
        || !['beginTransaction', 'commit', 'rollback'].every((method) => typeof connection[method] === 'function')) {
      throw new RuteroDayMoveUnavailableError('RUTERO_DAY_MOVE_TRANSACTION_UNAVAILABLE');
    }
    const execute = async (sql, params = []) => rowsOf(await connection.query(sql, params));
    await connection.beginTransaction();
    await execute(`LOCK TABLE ${tables.requests} IN EXCLUSIVE MODE`);
    const existing = await execute(
      `SELECT REQUEST_HASH, STATUS, DOCUMENT_IDS, TARGET_DATE, TARGET_POSITION
         FROM ${tables.requests}
        WHERE REPARTIDOR_ID = ? AND WEEK_START = ? AND IDEMPOTENCY_KEY = ?`,
      [repartidorId, input.weekStart, input.key],
    );
    if (existing.length > 0) {
      const row = existing[0];
      if (String(row.REQUEST_HASH || '').trim() !== hash) {
        throw new RuteroDayMoveConflictError('RUTERO_MOVE_IDEMPOTENCY_CONFLICT');
      }
      if (String(row.STATUS || '').trim().toUpperCase() !== 'APPLIED') {
        throw new RuteroDayMoveUnavailableError('RUTERO_DAY_MOVE_INCOMPLETE');
      }
      await connection.commit();
      return {
        replayed: true,
        sourceDate,
        targetDate: String(row.TARGET_DATE || targetDate).slice(0, 10),
        position: Number(row.TARGET_POSITION ?? position),
        affectedDocuments: String(row.DOCUMENT_IDS || '').split(',').filter(Boolean),
      };
    }

    await execute(`LOCK TABLE ${tables.override} IN EXCLUSIVE MODE`);
    const validation = visibleDocumentsSql({ override: tables.override, documents: input.docs });
    const visible = await execute(validation.sql, [
      repartidorId,
      input.weekStart,
      repartidorId,
      numericDate(input.weekStart),
      numericDate(sunday(input.weekStart)),
      sourceDate,
      sourceDate.slice(8, 10) * 1,
      sourceDate.slice(5, 7) * 1,
      sourceDate.slice(0, 4) * 1,
      ...input.docs.map((doc) => doc.documentId),
    ]);
    const visibleIds = new Set(visible.map((row) => String(row.DOCUMENT_ID || '').trim()).filter(Boolean));
    if (visibleIds.size !== input.docs.length) {
      throw new RuteroDayMoveConflictError('RUTERO_MOVE_DOCUMENT_NOT_IN_SOURCE');
    }

    const ids = input.docs.map((doc) => doc.documentId);
    const idPlaceholders = ids.map(() => '?').join(', ');
    const previous = await execute(
      `SELECT DOCUMENT_ID, VERSION FROM ${tables.override}
        WHERE REPARTIDOR_ID = ? AND WEEK_START = ? AND DOCUMENT_ID IN (${idPlaceholders})`,
      [repartidorId, input.weekStart, ...ids],
    );
    const previousVersions = new Map(previous.map((row) => [
      String(row.DOCUMENT_ID || '').trim(),
      Number(row.VERSION) || 0,
    ]));
    await execute(
      `DELETE FROM ${tables.override}
        WHERE REPARTIDOR_ID = ? AND WEEK_START = ? AND DOCUMENT_ID IN (${idPlaceholders})`,
      [repartidorId, input.weekStart, ...ids],
    );
    for (let index = 0; index < input.docs.length; index += 1) {
      const doc = input.docs[index];
      await execute(
        `INSERT INTO ${tables.override}
          (REPARTIDOR_ID, WEEK_START, DOCUMENT_ID, SOURCE_DATE, TARGET_DATE,
           TARGET_POSITION, VERSION, UPDATED_AT, UPDATED_BY)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP, ?)`,
        [
          repartidorId,
          input.weekStart,
          doc.documentId,
          sourceDate,
          targetDate,
          position + index,
          (previousVersions.get(doc.documentId) || 0) + 1,
          String(updatedBy || '').trim().slice(0, 40) || null,
        ],
      );
    }
    await execute(
      `INSERT INTO ${tables.requests}
        (REPARTIDOR_ID, WEEK_START, IDEMPOTENCY_KEY, REQUEST_HASH, STATUS,
         DOCUMENT_IDS, TARGET_DATE, TARGET_POSITION, CREATED_AT, COMPLETED_AT, UPDATED_BY)
       VALUES (?, ?, ?, ?, 'APPLIED', ?, ?, ?, CURRENT TIMESTAMP, CURRENT TIMESTAMP, ?)`,
      [
        repartidorId,
        input.weekStart,
        input.key,
        hash,
        ids.join(','),
        targetDate,
        position,
        String(updatedBy || '').trim().slice(0, 40) || null,
      ],
    );
    await connection.commit();
    return {
      replayed: false,
      sourceDate,
      targetDate,
      position,
      affectedDocuments: ids,
    };
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (_) { /* best effort */ }
    }
    throw error;
  } finally {
    if (connection) {
      try { await connection.close(); } catch (_) { /* best effort */ }
    }
  }
}

module.exports = {
  dayMoveEnabled,
  resolveDayMoveTables,
  tryResolveDayOverrideTable,
  monday,
  documentIdExpression,
  normalizedDocuments,
  requestHash,
  assertMoveInput,
  visibleDocumentsSql,
  moveDocuments,
  RuteroDayMoveUnavailableError,
  RuteroDayMoveConflictError,
};
