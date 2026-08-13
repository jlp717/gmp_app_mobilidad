'use strict';

const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { TABLE_MAPPINGS } = require('../config/reparto-runtime');

const TEST_SCHEMA = 'JAVIER';
// A fixed batch of 80 caps line statements at 880 bind parameters and
// confirmation-evidence statements at 160. The canonical contract permits
// at most 250 lines, so each operation performs at most four set-based writes.
const DB2_WRITE_BATCH_SIZE = 80;
const TABLES = Object.freeze({
  confirmations: 'TEST_REPARTO_CONFIRMACIONES',
  lines: 'TEST_REPARTO_LINEAS',
  evidences: 'TEST_REPARTO_EVIDENCIAS',
  confirmationEvidences: 'TEST_REPARTO_CONFIRM_EVIDENCIAS',
});

const QUALIFIED_TABLES = Object.freeze(Object.fromEntries(
  Object.entries(TABLES).map(([key, table]) => [key, `${TEST_SCHEMA}.${table}`]),
));

const REQUIRED_COLUMNS = Object.freeze({
  TEST_REPARTO_CONFIRMACIONES: [
    'ID', 'IDEMPOTENCY_KEY', 'PAYLOAD_FINGERPRINT', 'DOCUMENT_ID',
    'REPARTIDOR_ID', 'ACTOR_USER_ID', 'CLIENTE_CODIGO', 'CLIENTE_NOMBRE',
    'PEDIDO_EJERCICIO', 'PEDIDO_NUMERO', 'DOCUMENTO_TIPO', 'DOCUMENTO_ORIGEN',
    'DOCUMENTO_SUBEMPRESA', 'DOCUMENTO_EJERCICIO', 'DOCUMENTO_SERIE',
    'DOCUMENTO_TERMINAL', 'DOCUMENTO_NUMERO', 'DOCUMENTO_XDE', 'DOCUMENTO_DEX',
    'STATUS', 'OCCURRED_AT', 'CONFIRMED_AT', 'RECEPTOR_NOMBRE', 'RECEPTOR_APELLIDOS', 'RECEPTOR_DNI',
    'FIRMA_EVIDENCE_ID', 'INCIDENCIA_CODIGO', 'INCIDENCIA_DESCRIPCION',
    'INCIDENCIA_OBSERVACIONES', 'OBSERVACIONES', 'LATITUD', 'LONGITUD', 'RESULT_JSON',
  ],
  TEST_REPARTO_LINEAS: [
    'CONFIRMACION_ID', 'LINEA_ID', 'CODIGO_ARTICULO', 'DESCRIPCION',
    'CANTIDAD_PEDIDA', 'CANTIDAD_ENTREGADA', 'CANTIDAD_RECHAZADA',
    'CANTIDAD_PENDIENTE', 'MOTIVO_DIFERENCIA', 'OBSERVACIONES', 'PRECIO_UNITARIO',
  ],
  TEST_REPARTO_EVIDENCIAS: [
    'EVIDENCE_ID', 'DOCUMENT_ID', 'REPARTIDOR_ID', 'EVIDENCE_KIND',
    'STORAGE_REFERENCE', 'MIME_TYPE', 'CONTENT_SHA256', 'CONTENT_BYTES',
    'CONTENT_BLOB', 'STATUS', 'CREATED_AT', 'LINKED_AT',
  ],
  TEST_REPARTO_CONFIRM_EVIDENCIAS: ['CONFIRMACION_ID', 'EVIDENCE_ID'],
});
const RECEIVER_NAME_CAPABILITY = Object.freeze({
  column: 'RECEPTOR_NOMBRE',
  minimumLength: 100,
  compatibleDataTypes: Object.freeze(new Set(['VARCHAR', 'CHARACTER VARYING'])),
});

class RepartoRepositoryUnavailableError extends RepartoPersistenceError {
  constructor(message, details) {
    super(message, {
      code: 'REPARTO_TEST_SCHEMA_UNAVAILABLE', statusCode: 503, details,
    });
    this.name = 'RepartoRepositoryUnavailableError';
  }
}

function rowValue(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

function assertReceiverNameCapacity(columnRows, confirmationTable) {
  const capability = RECEIVER_NAME_CAPABILITY;
  const table = String(confirmationTable || '').trim().toUpperCase();
  const receiverName = columnRows.find((row) =>
    String(rowValue(row, 'TABLE_NAME')).toUpperCase() === table
    && String(rowValue(row, 'COLUMN_NAME')).toUpperCase() === capability.column);
  const dataType = String(rowValue(receiverName, 'DATA_TYPE') || '').trim().toUpperCase();
  const length = Number(rowValue(receiverName, 'LENGTH'));
  if (!capability.compatibleDataTypes.has(dataType)
      || !Number.isSafeInteger(length) || length < capability.minimumLength) {
    throw new RepartoRepositoryUnavailableError(
      'La columna de nombre del receptor no soporta el contrato canonico',
      {
        table,
        column: capability.column,
        minimumLength: capability.minimumLength,
        dataType: dataType || null,
        length: Number.isSafeInteger(length) ? length : null,
      },
    );
  }
}

function first(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : null;
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
    throw new RepartoRepositoryUnavailableError(
      'La conexion DB2 no permite transacciones explicitas',
      { missingMethods },
    );
  }
}

function validateSchema(schema) {
  if (schema !== TEST_SCHEMA) {
    throw new RepartoRepositoryUnavailableError('El repositorio canónico solo permite el esquema de pruebas JAVIER', {
      schema,
    });
  }
  return schema;
}

function batches(values) {
  const result = [];
  for (let index = 0; index < values.length; index += DB2_WRITE_BATCH_SIZE) {
    result.push(values.slice(index, index + DB2_WRITE_BATCH_SIZE));
  }
  return result;
}

function validateTables(tables) {
  if (!tables || typeof tables !== 'object') {
    throw new RepartoRepositoryUnavailableError('Falta el mapping central de tablas de confirmacion');
  }
  const matchesKnownMapping = Object.values(TABLE_MAPPINGS).some(({ confirmation }) =>
    Object.entries(confirmation).every(([key, identifier]) => tables[key] === identifier));
  if (!matchesKnownMapping) {
    throw new RepartoRepositoryUnavailableError('El mapping central contiene un identificador DB2 no permitido');
  }
  return Object.freeze({ ...tables });
}

async function rows(connection, sql, params = []) {
  const result = typeof connection.query === 'function'
    ? await connection.query(sql, params)
    : await connection.execute(sql, params);
  return Array.isArray(result) ? result : (result?.rows || []);
}

async function execute(connection, sql, params = []) {
  return typeof connection.query === 'function'
    ? connection.query(sql, params)
    : connection.execute(sql, params);
}

async function scalarIdentity(connection) {
  const value = first(await rows(connection, 'SELECT IDENTITY_VAL_LOCAL() AS ID FROM SYSIBM.SYSDUMMY1'));
  const id = rowValue(value, 'ID');
  if (id == null) throw new RepartoRepositoryUnavailableError('DB2 no devolvió el identificador de la confirmación');
  return id;
}
function isUniqueConstraintError(error) {
  const candidates = [error, error?.cause, ...(Array.isArray(error?.odbcErrors) ? error.odbcErrors : [])];
  return candidates.some((item) => {
    const state = String(item?.state || item?.sqlState || item?.sqlstate || '').toUpperCase();
    const code = String(item?.code ?? item?.nativeError ?? item?.nativeCode ?? '').toUpperCase();
    return code === 'REPARTO_COBRO_IDEMPOTENCY_RACE'
      || state === '23505' || code === 'SQL0803' || code === '-803' || code === '803';
  });
}

function boundPort(port, connection, method, name) {
  const bound = port.forConnection(connection);
  if (!bound || typeof bound[method] !== 'function') {
    throw new RepartoRepositoryUnavailableError(`${name}.${method} no esta disponible para la conexion transaccional`);
  }
  return bound;
}

function db2Timestamp(value, field) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RepartoPersistenceError(`Fecha invalida en ${field}`, {
      code: 'REPARTO_INVALID_TIMESTAMP',
      statusCode: 422,
    });
  }
  // IBM i ODBC rejects JS Date binds (HY003). ISO-like strings bind as TIMESTAMP.
  const iso = parsed.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`;
}


function mapResult(row) {
  if (!row) return null;
  const raw = rowValue(row, 'RESULT_JSON');
  if (raw == null) {
    throw new RepartoPersistenceError(
      'El resultado persistido del replay no esta disponible',
      { code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE', statusCode: 503 },
    );
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw new RepartoPersistenceError(
        'El resultado persistido del replay no esta disponible',
        { code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE', statusCode: 503 },
      );
    }
  }
  return raw;
}

function createRepartoConfirmationDb2Repository({
  connectionFactory,
  schema = TEST_SCHEMA,
  tables,
  plannedDeliveryPort,
  evidenceOwnershipPort,
  cobrosPort,
  requireCobrosCapability = true,
  logger = console,
} = {}) {
  const safeSchema = validateSchema(schema);
  const safeTables = validateTables(tables);
  const tableNames = Object.fromEntries(
    Object.entries(safeTables).map(([key, identifier]) => [key, identifier.split('.')[1]]),
  );
  if (typeof connectionFactory !== 'function') throw new TypeError('connectionFactory is required');
  if (!plannedDeliveryPort || typeof plannedDeliveryPort.getPlannedDelivery !== 'function'
      || typeof plannedDeliveryPort.forConnection !== 'function') {
    throw new TypeError('plannedDeliveryPort.getPlannedDelivery and forConnection are required');
  }
  if (!cobrosPort || typeof cobrosPort.assertCapabilities !== 'function'
      || typeof cobrosPort.forConnection !== 'function') {
    throw new TypeError('cobrosPort.assertCapabilities and forConnection are required');
  }
  if (!evidenceOwnershipPort || typeof evidenceOwnershipPort.assertOwnership !== 'function'
      || typeof evidenceOwnershipPort.forConnection !== 'function') {
    throw new TypeError('evidenceOwnershipPort.assertOwnership and forConnection are required');
  }

  async function assertCapabilities(connection) {
    const tableRows = await rows(connection,
      'SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?)',
      [safeSchema, tableNames.confirmations, tableNames.lines, tableNames.evidences, tableNames.confirmationEvidences]);
    const foundTables = new Set(tableRows.map((row) => String(rowValue(row, 'TABLE_NAME')).toUpperCase()));
    const missingTables = Object.values(tableNames).filter((table) => !foundTables.has(table));
    if (missingTables.length) {
      throw new RepartoRepositoryUnavailableError('Faltan tablas de confirmación de reparto en el esquema de pruebas', { missingTables });
    }
    const columnRows = await rows(connection,
      'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?)',
      [safeSchema, tableNames.confirmations, tableNames.lines, tableNames.evidences, tableNames.confirmationEvidences]);
    const available = new Map();
    for (const row of columnRows) {
      const table = String(rowValue(row, 'TABLE_NAME')).toUpperCase();
      const column = String(rowValue(row, 'COLUMN_NAME')).toUpperCase();
      if (!available.has(table)) available.set(table, new Set());
      available.get(table).add(column);
    }
    const requiredColumns = Object.fromEntries(Object.entries(safeTables).map(([key, identifier]) => [
      identifier.split('.')[1], REQUIRED_COLUMNS[TABLES[key]],
    ]));
    const missingColumns = Object.entries(requiredColumns).flatMap(([table, columns]) =>
      columns.filter((column) => !available.get(table)?.has(column)).map((column) => `${table}.${column}`));
    if (missingColumns.length) {
      throw new RepartoRepositoryUnavailableError('El esquema de pruebas no contiene las columnas requeridas', { missingColumns });
    }
    assertReceiverNameCapacity(columnRows, tableNames.confirmations);
    if (requireCobrosCapability) await cobrosPort.assertCapabilities(connection);
  }

  async function withTransaction(work) {
    const connection = await connectionFactory();
    try {
      assertConnection(connection);
      assertExplicitTransaction(connection);
      // Capability gate: never enter a write transaction before catalog validation.
      try {
        await assertCapabilities(connection);
      } catch (error) {
        if (error instanceof RepartoPersistenceError) throw error;
        throw new RepartoRepositoryUnavailableError(
          'No se pudo verificar el esquema de confirmacion de reparto',
          { causeCode: error?.code || null },
        );
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let active = false;
        try {
          await connection.beginTransaction();
          active = true;
          const result = await work(createTransaction(connection));
          await connection.commit();
          active = false;
          return result;
        } catch (error) {
          if (active) {
            try { await connection.rollback(); } catch (rollbackError) {
              logger.error?.('reparto confirmation rollback failed', { code: rollbackError.code });
            }
          }
          // An absent-key race is resolved by the unique indexes. Re-run the
          // complete callback once so it reads the committed row and returns
          // an exact replay or the appropriate 409 conflict.
          if (attempt === 0 && isUniqueConstraintError(error)) continue;
          if (error instanceof RepartoPersistenceError) throw error;
          const odbc = Array.isArray(error?.odbcErrors) ? error.odbcErrors[0] : null;
          logger.error?.('reparto confirmation persist failed', {
            odbcState: odbc?.state || error?.state || null,
            odbcCode: odbc?.code ?? error?.code ?? null,
          });
          throw new RepartoPersistenceError('No se pudo persistir la confirmación de reparto', {
            code: isUniqueConstraintError(error)
              ? 'REPARTO_CONCURRENT_CONFIRMATION_CONFLICT'
              : 'REPARTO_DB2_PERSISTENCE_FAILED',
            statusCode: isUniqueConstraintError(error) ? 409 : 503,
          });
        }
      }
    } finally {
      if (typeof connection.close === 'function') await connection.close();
    }
  }

  function createTransaction(connection) {
    const confirmations = safeTables.confirmations;
    const lineTable = safeTables.lines;
    const linkTable = safeTables.confirmationEvidences;
    const transactionalPlannedDeliveryPort = boundPort(
      plannedDeliveryPort, connection, 'getPlannedDelivery', 'plannedDeliveryPort',
    );
    const transactionalEvidenceOwnershipPort = boundPort(
      evidenceOwnershipPort, connection, 'assertOwnership', 'evidenceOwnershipPort',
    );
    const transactionalEvidenceLinkPort = boundPort(
      evidenceOwnershipPort, connection, 'markLinked', 'evidenceOwnershipPort',
    );
    const transactionalCobrosPort = boundPort(
      cobrosPort, connection, 'insertCobro', 'cobrosPort',
    );
    return {
      async getByIdempotencyKey(key) {
        const row = first(await rows(connection,
          `SELECT PAYLOAD_FINGERPRINT, RESULT_JSON FROM ${confirmations} WHERE IDEMPOTENCY_KEY = ? FOR UPDATE WITH RS`, [key]));
        if (!row) return null;
        return { fingerprint: rowValue(row, 'PAYLOAD_FINGERPRINT'), result: mapResult(row) };
      },
      async getByDocumentId(documentId) {
        return first(await rows(connection,
          `SELECT ID FROM ${confirmations} WHERE DOCUMENT_ID = ? FOR UPDATE WITH RS`, [documentId]));
      },
      getPlannedDelivery(documentId, repartidorId) {
        return transactionalPlannedDeliveryPort.getPlannedDelivery(documentId, repartidorId);
      },
      assertEvidenceOwnership(ids, owner) {
        return transactionalEvidenceOwnershipPort.assertOwnership(ids, owner);
      },
      async insertConfirmation(record) {
        const receiver = record.receiver || {};
        const document = record.albaran || {};
        const incidencia = record.incidencia || {};
        await execute(connection,
          `INSERT INTO ${confirmations} (IDEMPOTENCY_KEY, PAYLOAD_FINGERPRINT, DOCUMENT_ID, REPARTIDOR_ID, ACTOR_USER_ID, CLIENTE_CODIGO, CLIENTE_NOMBRE, PEDIDO_EJERCICIO, PEDIDO_NUMERO, DOCUMENTO_TIPO, DOCUMENTO_ORIGEN, DOCUMENTO_SUBEMPRESA, DOCUMENTO_EJERCICIO, DOCUMENTO_SERIE, DOCUMENTO_TERMINAL, DOCUMENTO_NUMERO, DOCUMENTO_XDE, DOCUMENTO_DEX, STATUS, OCCURRED_AT, CONFIRMED_AT, RECEPTOR_NOMBRE, RECEPTOR_APELLIDOS, RECEPTOR_DNI, FIRMA_EVIDENCE_ID, INCIDENCIA_CODIGO, INCIDENCIA_DESCRIPCION, INCIDENCIA_OBSERVACIONES, OBSERVACIONES, LATITUD, LONGITUD) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.idempotencyKey, record.fingerprint, record.documentId, record.repartidorId, record.actorUserId,
            record.cliente.codigo, record.cliente.nombre, record.pedido?.ejercicio ?? null, record.pedido?.numero ?? null,
            document.tipo ?? null, document.origen ?? null, document.subempresa ?? null, document.ejercicio ?? null,
            document.serie ?? null, document.terminal ?? null, document.numero ?? null,
            document.xde ?? null, document.dex ?? null, record.status,
            db2Timestamp(record.occurredAt, 'occurredAt'), db2Timestamp(record.confirmedAt, 'confirmedAt'),
            receiver.nombre ?? null, receiver.apellidos ?? null, receiver.dni ?? null,
            record.firmaEvidenceId ?? null, incidencia.tipo ?? null, incidencia.motivo ?? null,
            incidencia.observaciones ?? null, record.observaciones ?? null, record.latitud ?? null,
            record.longitud ?? null]);
        return scalarIdentity(connection);
      },
      async insertLines(confirmationId, lineas) {
        for (const batch of batches(lineas)) {
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const params = batch.flatMap((line) => [
            confirmationId, line.lineaId, line.codigoArticulo, line.descripcion || null, line.cantidadPedida,
            line.cantidadEntregada, line.cantidadRechazada, line.cantidadPendiente, line.motivoDiferencia || null,
            line.observaciones || null, line.precioUnitario,
          ]);
          await execute(connection,
            `INSERT INTO ${lineTable} (CONFIRMACION_ID, LINEA_ID, CODIGO_ARTICULO, DESCRIPCION, CANTIDAD_PEDIDA, CANTIDAD_ENTREGADA, CANTIDAD_RECHAZADA, CANTIDAD_PENDIENTE, MOTIVO_DIFERENCIA, OBSERVACIONES, PRECIO_UNITARIO) VALUES ${placeholders}`,
            params);
        }
      },
      async linkEvidence(confirmationId, evidenceIds) {
        for (const batch of batches(evidenceIds)) {
          const placeholders = batch.map(() => '(?, ?)').join(', ');
          const params = batch.flatMap((evidenceId) => [confirmationId, evidenceId]);
          await execute(connection,
            `INSERT INTO ${linkTable} (CONFIRMACION_ID, EVIDENCE_ID) VALUES ${placeholders}`,
            params);
          await transactionalEvidenceLinkPort.markLinked(batch);
        }
      },
      async insertCobro(payment) {
        await cobrosPort.assertCapabilities(connection);
        return transactionalCobrosPort.insertCobro(payment);
      },
      async insertIdempotencyRecord({ idempotencyKey, fingerprint, documentId, result }) {
        await execute(connection,
          `UPDATE ${confirmations} SET RESULT_JSON = ? WHERE IDEMPOTENCY_KEY = ? AND PAYLOAD_FINGERPRINT = ? AND DOCUMENT_ID = ?`,
          [JSON.stringify(result), idempotencyKey, fingerprint, documentId]);
      },
    };
  }

  return Object.freeze({ withTransaction, assertCapabilities });
}

module.exports = {
  DB2_WRITE_BATCH_SIZE,
  RepartoRepositoryUnavailableError,
  createRepartoConfirmationDb2Repository,
  QUALIFIED_TABLES,
  REQUIRED_COLUMNS,
  TABLES,
  db2Timestamp,
};
