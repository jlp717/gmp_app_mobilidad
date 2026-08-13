'use strict';

const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { TABLE_MAPPINGS } = require('../config/reparto-runtime');
const { db2Timestamp } = require('./reparto-confirmation-db2-repository');

const TEST_SCHEMA = 'JAVIER';
// Legacy exports preserve the isolated-test contract; runtime selection is
// validated against the versioned mapping below.
const EVIDENCE_TABLE = 'TEST_REPARTO_EVIDENCIAS';
const QUALIFIED_EVIDENCE_TABLE = `${TEST_SCHEMA}.${EVIDENCE_TABLE}`;
const QUALIFIED_CONFIRMATION_EVIDENCE_TABLE = `${TEST_SCHEMA}.TEST_REPARTO_CONFIRM_EVIDENCIAS`;
const REQUIRED_EVIDENCE_COLUMNS = Object.freeze([
  'EVIDENCE_ID', 'DOCUMENT_ID', 'REPARTIDOR_ID', 'EVIDENCE_KIND',
  'STORAGE_REFERENCE', 'MIME_TYPE', 'CONTENT_SHA256', 'CONTENT_BYTES',
  'CONTENT_BLOB', 'STATUS', 'CREATED_AT', 'LINKED_AT', 'EXPIRES_AT',
]);

class RepartoEvidenceRepositoryError extends RepartoPersistenceError {
  constructor(message, { code = 'REPARTO_EVIDENCE_STORE_UNAVAILABLE', statusCode = 503, details } = {}) {
    super(message, { code, statusCode, details });
    this.name = 'RepartoEvidenceRepositoryError';
  }
}

function value(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

function first(result) {
  const rows = Array.isArray(result) ? result : (result?.rows || []);
  return rows.length ? rows[0] : null;
}

function assertConnection(connection) {
  if (!connection || (typeof connection.query !== 'function' && typeof connection.execute !== 'function')) {
    throw new TypeError('DB2 connection must expose query(sql, params) or execute(sql, params)');
  }
}

function assertExplicitTransaction(connection) {
  const missingMethods = ['beginTransaction', 'commit', 'rollback']
    .filter((method) => typeof connection?.[method] !== 'function');
  if (missingMethods.length) {
    throw new RepartoEvidenceRepositoryError(
      'La conexion DB2 no permite transacciones explicitas',
      { code: 'REPARTO_EVIDENCE_TRANSACTION_UNAVAILABLE', details: { missingMethods } },
    );
  }
}

function normalizeEvidenceRequirements(requirements) {
  const expectedKinds = new Set(['FIRMA', 'FOTO', 'OTRA']);
  const byId = new Map();
  for (const requirement of requirements || []) {
    const evidenceId = String(requirement?.evidenceId || '').trim();
    const expectedKind = String(requirement?.expectedKind || '').trim().toUpperCase();
    if (!evidenceId || !expectedKinds.has(expectedKind)) {
      throw new RepartoEvidenceRepositoryError('Requisito de evidencia invalido', {
        code: 'EVIDENCE_REQUIREMENT_INVALID', statusCode: 422,
      });
    }
    const previous = byId.get(evidenceId);
    if (previous && previous.expectedKind !== expectedKind) {
      throw new RepartoEvidenceRepositoryError('La evidencia no puede reutilizarse con otro tipo', {
        code: 'EVIDENCE_KIND_MISMATCH', statusCode: 422,
      });
    }
    byId.set(evidenceId, { evidenceId, expectedKind });
  }
  return [...byId.values()];
}

function validateSchema(schema) {
  if (schema !== TEST_SCHEMA) {
    throw new RepartoEvidenceRepositoryError(
      'El almacén de evidencias solo permite el esquema de pruebas JAVIER',
      { details: { schema } },
    );
  }
  return schema;
}

function abortError(signal) {
  if (signal?.reason instanceof RepartoPersistenceError) return signal.reason;
  return new RepartoEvidenceRepositoryError('La consulta de evidencia fue cancelada', {
    code: 'EVIDENCE_TIMEOUT', statusCode: 504,
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function cancelConnection(connection) {
  if (typeof connection?.cancel !== 'function') return;
  try {
    Promise.resolve(connection.cancel()).catch(() => {});
  } catch (_) {
    // Cancellation is best effort; the connection is still closed in finally.
  }
}

async function execute(connection, sql, params = [], signal) {
  throwIfAborted(signal);
  const operation = Promise.resolve().then(() => {
    throwIfAborted(signal);
    return typeof connection.query === 'function'
      ? connection.query(sql, params)
      : connection.execute(sql, params);
  });
  if (!signal) return operation;
  let abortHandler;
  const aborted = new Promise((_, reject) => {
    abortHandler = () => {
      cancelConnection(connection);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });
  try {
    const result = await Promise.race([operation, aborted]);
    throwIfAborted(signal);
    return result;
  } finally {
    signal.removeEventListener('abort', abortHandler);
  }
}

async function rows(connection, sql, params = [], signal) {
  const result = await execute(connection, sql, params, signal);
  return Array.isArray(result) ? result : (result?.rows || []);
}

function isUniqueConstraintError(error) {
  const candidates = [error, ...(Array.isArray(error?.odbcErrors) ? error.odbcErrors : [])];
  return candidates.some((item) => {
    const state = String(item?.state || item?.sqlState || item?.sqlstate || '').toUpperCase();
    const code = Number(item?.code ?? item?.nativeError ?? item?.nativeCode);
    return state === '23505' || code === -803 || code === 803;
  });
}

function normalizeBlob(blob) {
  if (Buffer.isBuffer(blob)) return blob;
  if (blob instanceof Uint8Array) return Buffer.from(blob);
  throw new RepartoEvidenceRepositoryError('DB2 devolvió contenido de evidencia inválido');
}

function normalizePendingTtlHours(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
    throw new TypeError('pendingTtlHours must be an integer between 1 and 168');
  }
  return parsed;
}

function assertPendingNotExpired(row, now) {
  if (String(value(row, 'STATUS')).trim().toUpperCase() !== 'PENDIENTE') return;
  const expiresAt = new Date(value(row, 'EXPIRES_AT'));
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new RepartoEvidenceRepositoryError('La evidencia pendiente no tiene caducidad valida');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new RepartoEvidenceRepositoryError('La evidencia pendiente ha caducado', {
      code: 'EVIDENCE_EXPIRED', statusCode: 410,
    });
  }
}

function createRepartoEvidenceDb2Repository({
  connectionFactory,
  plannedDeliveryPort,
  schema = TEST_SCHEMA,
  tables,
  pendingTtlHours,
  clock = () => new Date(),
  logger = console,
} = {}) {
  const safeSchema = validateSchema(schema);
  const evidenceMatches = Object.values(TABLE_MAPPINGS).some(({ confirmation }) =>
    confirmation.evidences === tables?.evidences);
  if (!evidenceMatches) {
    throw new RepartoEvidenceRepositoryError('El mapping central contiene una tabla de evidencias no permitida', {
      details: { key: 'evidences' },
    });
  }
  const linkMatches = Object.values(TABLE_MAPPINGS).some(({ confirmation }) =>
    confirmation.evidences === tables?.evidences
      && confirmation.confirmationEvidences === tables?.confirmationEvidences);
  if (!linkMatches) {
    throw new RepartoEvidenceRepositoryError('El mapping central contiene una tabla de enlaces de evidencia no permitida', {
      details: { key: 'confirmationEvidences' },
    });
  }
  const safePendingTtlHours = normalizePendingTtlHours(pendingTtlHours);
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof connectionFactory !== 'function') throw new TypeError('connectionFactory is required');
  if (!plannedDeliveryPort || typeof plannedDeliveryPort.forConnection !== 'function') {
    throw new TypeError('plannedDeliveryPort.forConnection is required');
  }
  const table = tables.evidences;
  const confirmationEvidenceTable = tables.confirmationEvidences;
  const evidenceTableName = table.split('.')[1];
  let capabilitiesVerified = false;

  async function assertCapabilities(connection, { signal } = {}) {
    if (capabilitiesVerified) return;
    const tableRows = await rows(connection,
      'SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [safeSchema, evidenceTableName], signal);
    if (!tableRows.some((row) => String(value(row, 'TABLE_NAME')).toUpperCase() === evidenceTableName)) {
      throw new RepartoEvidenceRepositoryError('Falta la tabla de evidencias en el esquema de pruebas');
    }
    const columnRows = await rows(connection,
      'SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [safeSchema, evidenceTableName], signal);
    const available = new Set(columnRows.map((row) => String(value(row, 'COLUMN_NAME')).toUpperCase()));
    const missingColumns = REQUIRED_EVIDENCE_COLUMNS.filter((column) => !available.has(column));
    if (missingColumns.length) {
      throw new RepartoEvidenceRepositoryError(
        'La tabla de evidencias no contiene las columnas requeridas',
        { details: { missingColumns } },
      );
    }
    capabilitiesVerified = true;
  }

  function bound(connection) {
    assertConnection(connection);

    async function assertOwnership(requirements, owner) {
      const normalizedRequirements = normalizeEvidenceRequirements(requirements);
      if (!normalizedRequirements.length) return;
      const ids = normalizedRequirements.map(({ evidenceId }) => evidenceId);
      const expectedKinds = new Map(normalizedRequirements.map((item) => [item.evidenceId, item.expectedKind]));
      const placeholders = ids.map(() => '?').join(', ');
      const found = await rows(connection,
        `SELECT EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STATUS, EXPIRES_AT FROM ${table} WHERE EVIDENCE_ID IN (${placeholders}) FOR UPDATE WITH RS`,
        ids);
      if (found.length !== ids.length) {
        throw new RepartoEvidenceRepositoryError('Alguna evidencia no existe', {
          code: 'EVIDENCE_NOT_FOUND', statusCode: 404,
        });
      }
      const mismatch = found.some((row) =>
        String(value(row, 'DOCUMENT_ID')).trim() !== String(owner?.documentId || '').trim()
        || String(value(row, 'REPARTIDOR_ID')).trim() !== String(owner?.repartidorId || '').trim());
      if (mismatch) {
        throw new RepartoEvidenceRepositoryError('La evidencia no pertenece a esta entrega', {
          code: 'EVIDENCE_OWNERSHIP_REQUIRED', statusCode: 403,
        });
      }
      const kindMismatch = found.some((row) => {
        const evidenceId = String(value(row, 'EVIDENCE_ID')).trim();
        const actualKind = String(value(row, 'EVIDENCE_KIND')).trim().toUpperCase();
        return actualKind !== expectedKinds.get(evidenceId);
      });
      if (kindMismatch) {
        throw new RepartoEvidenceRepositoryError('El tipo de evidencia no coincide con su uso', {
          code: 'EVIDENCE_KIND_MISMATCH', statusCode: 422,
        });
      }
      if (found.some((row) => String(value(row, 'STATUS')).trim().toUpperCase() !== 'PENDIENTE')) {
        throw new RepartoEvidenceRepositoryError('La evidencia ya está enlazada', {
          code: 'EVIDENCE_ALREADY_LINKED', statusCode: 409,
        });
      }
      const checkedAt = new Date(clock());
      for (const row of found) assertPendingNotExpired(row, checkedAt);
    }

    async function markLinked(evidenceIds) {
      const ids = [...new Set((evidenceIds || []).map(String))];
      if (!ids.length) return;
      const placeholders = ids.map(() => '?').join(', ');
      await execute(connection,
        `UPDATE ${table} SET STATUS = 'ENLAZADA', LINKED_AT = CURRENT TIMESTAMP, EXPIRES_AT = NULL WHERE STATUS = 'PENDIENTE' AND EVIDENCE_ID IN (${placeholders})`,
        ids);
    }

    return Object.freeze({ assertOwnership, markLinked });
  }

  async function withConnection(work, { signal } = {}) {
    throwIfAborted(signal);
    const connection = await connectionFactory({ signal });
    assertConnection(connection);
    try {
      try {
        await assertCapabilities(connection, { signal });
      } catch (error) {
        if (error instanceof RepartoPersistenceError) throw error;
        throw new RepartoEvidenceRepositoryError('No se pudo verificar el almacén de evidencias');
      }
      throwIfAborted(signal);
      return await work(connection, signal);
    } finally {
      if (typeof connection.close === 'function') {
        try {
          await connection.close();
        } catch (error) {
          if (!signal?.aborted) throw error;
        }
      }
    }
  }

  async function stage(record) {
    return withConnection(async (connection) => {
      assertExplicitTransaction(connection);
      const stagedAt = new Date(clock());
      if (!Number.isFinite(stagedAt.getTime())) {
        throw new RepartoEvidenceRepositoryError('El reloj de retencion de evidencias no es valido');
      }
      const expiresAt = new Date(stagedAt.getTime() + (safePendingTtlHours * 60 * 60 * 1000));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let active = false;
        try {
          await connection.beginTransaction();
          active = true;
          const planned = plannedDeliveryPort.forConnection(connection);
          if (!planned || typeof planned.getPlannedDelivery !== 'function') {
            throw new RepartoEvidenceRepositoryError('Puerto de entrega planificada no disponible');
          }
          await planned.getPlannedDelivery(record.documentId, record.repartidorId);
          const existing = first(await rows(connection,
            `SELECT DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STORAGE_REFERENCE, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, STATUS, EXPIRES_AT FROM ${table} WHERE EVIDENCE_ID = ? FOR UPDATE WITH RS`,
            [record.evidenceId]));
          if (existing) {
            const exact = String(value(existing, 'DOCUMENT_ID')).trim() === record.documentId
              && String(value(existing, 'REPARTIDOR_ID')).trim() === record.repartidorId
              && String(value(existing, 'EVIDENCE_KIND')).trim() === record.kind
              && String(value(existing, 'STORAGE_REFERENCE')).trim() === record.storageReference
              && String(value(existing, 'MIME_TYPE')).trim().toLowerCase() === record.mimeType
              && String(value(existing, 'CONTENT_SHA256')).trim().toLowerCase() === record.contentSha256
              && Number(value(existing, 'CONTENT_BYTES')) === record.contentBytes;
            if (!exact) {
              throw new RepartoEvidenceRepositoryError('El identificador de evidencia entra en conflicto', {
                code: 'EVIDENCE_ID_CONFLICT', statusCode: 409,
              });
            }
            assertPendingNotExpired(existing, stagedAt);
            await connection.commit();
            active = false;
            return { evidenceId: record.evidenceId, created: false, idempotent: true };
          }
          await execute(connection,
            `INSERT INTO ${table} (EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STORAGE_REFERENCE, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, CONTENT_BLOB, STATUS, CREATED_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', CURRENT TIMESTAMP, ?)`,
            [record.evidenceId, record.documentId, record.repartidorId, record.kind,
              record.storageReference, record.mimeType, record.contentSha256,
              record.contentBytes, record.content, db2Timestamp(expiresAt, 'expiresAt')]);
          await connection.commit();
          active = false;
          return { evidenceId: record.evidenceId, created: true, idempotent: false };
        } catch (error) {
          if (active) {
            try { await connection.rollback(); } catch (rollbackError) {
              logger.error?.('reparto evidence rollback failed', { code: rollbackError?.code || null });
            }
          }
          if (attempt === 0 && isUniqueConstraintError(error)) continue;
          if (error instanceof RepartoPersistenceError) throw error;
          const odbc = Array.isArray(error?.odbcErrors) ? error.odbcErrors[0] : null;
          logger.error?.('reparto evidence persist failed', {
            odbcState: odbc?.state || error?.state || null,
            odbcCode: odbc?.code ?? error?.code ?? null,
          });
          throw new RepartoEvidenceRepositoryError('No se pudo persistir la evidencia', {
            code: isUniqueConstraintError(error) ? 'EVIDENCE_ID_CONFLICT' : 'REPARTO_EVIDENCE_PERSISTENCE_FAILED',
            statusCode: isUniqueConstraintError(error) ? 409 : 503,
          });
        }
      }
      throw new RepartoEvidenceRepositoryError('No se pudo persistir la evidencia');
    });
  }

  async function purgeExpired() {
    return withConnection(async (connection) => {
      assertExplicitTransaction(connection);
      let active = false;
      try {
        await connection.beginTransaction();
        active = true;
        const expiredRows = await rows(connection,
          `SELECT E.EVIDENCE_ID FROM ${table} E WHERE E.STATUS = 'PENDIENTE' AND E.EXPIRES_AT <= CURRENT TIMESTAMP AND NOT EXISTS (SELECT 1 FROM ${confirmationEvidenceTable} CE WHERE CE.EVIDENCE_ID = E.EVIDENCE_ID) ORDER BY E.EXPIRES_AT, E.EVIDENCE_ID FETCH FIRST 100 ROWS ONLY FOR UPDATE WITH RS USE AND KEEP EXCLUSIVE LOCKS`);
        const ids = expiredRows.map((row) => String(value(row, 'EVIDENCE_ID')).trim()).filter(Boolean);
        if (ids.length) {
          const placeholders = ids.map(() => '?').join(', ');
          await execute(connection,
            `DELETE FROM ${table} E WHERE E.STATUS = 'PENDIENTE' AND E.EXPIRES_AT <= CURRENT TIMESTAMP AND NOT EXISTS (SELECT 1 FROM ${confirmationEvidenceTable} CE WHERE CE.EVIDENCE_ID = E.EVIDENCE_ID) AND E.EVIDENCE_ID IN (${placeholders})`,
            ids);
        }
        await connection.commit();
        active = false;
        return Object.freeze({ purged: ids.length });
      } catch (error) {
        if (active) {
          try { await connection.rollback(); } catch (rollbackError) {
            logger.error?.('reparto evidence purge rollback failed', { code: rollbackError?.code || null });
          }
        }
        if (error instanceof RepartoPersistenceError) throw error;
        throw new RepartoEvidenceRepositoryError('No se pudieron purgar las evidencias caducadas', {
          code: 'REPARTO_EVIDENCE_PURGE_FAILED', statusCode: 503,
        });
      }
    });
  }

  async function getLinked(evidenceId, { signal } = {}) {
    return withConnection(async (connection) => {
      const row = first(await rows(connection,
        `SELECT EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, CONTENT_BLOB, STATUS FROM ${table} WHERE EVIDENCE_ID = ?`,
        [evidenceId], signal));
      throwIfAborted(signal);
      if (!row || String(value(row, 'STATUS')).trim().toUpperCase() !== 'ENLAZADA') {
        throw new RepartoEvidenceRepositoryError('Evidencia no encontrada', {
          code: 'EVIDENCE_NOT_FOUND', statusCode: 404,
        });
      }
      return Object.freeze({
        evidenceId: String(value(row, 'EVIDENCE_ID')).trim(),
        documentId: String(value(row, 'DOCUMENT_ID')).trim(),
        repartidorId: String(value(row, 'REPARTIDOR_ID')).trim(),
        kind: String(value(row, 'EVIDENCE_KIND')).trim(),
        mimeType: String(value(row, 'MIME_TYPE')).trim().toLowerCase(),
        contentSha256: String(value(row, 'CONTENT_SHA256')).trim().toLowerCase(),
        contentBytes: Number(value(row, 'CONTENT_BYTES')),
        content: normalizeBlob(value(row, 'CONTENT_BLOB')),
      });
    }, { signal });
  }

  async function assertOwnership(requirements, owner) {
    return withConnection(async (connection) => bound(connection).assertOwnership(requirements, owner));
  }

  return Object.freeze({ stage, getLinked, purgeExpired, assertOwnership, assertCapabilities, forConnection: bound });
}

module.exports = {
  EVIDENCE_TABLE,
  QUALIFIED_EVIDENCE_TABLE,
  QUALIFIED_CONFIRMATION_EVIDENCE_TABLE,
  REQUIRED_EVIDENCE_COLUMNS,
  RepartoEvidenceRepositoryError,
  createRepartoEvidenceDb2Repository,
};
