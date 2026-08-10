'use strict';

const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');
const { TABLE_MAPPINGS, validateFinanceTableMapping } = require('../config/reparto-runtime');

const IDENTIFIER = /^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const FINANCIAL_DOCUMENT_COLUMNS = Object.freeze([
  'DOCUMENTO_TIPO', 'DOCUMENTO_ORIGEN', 'DOCUMENTO_SUBEMPRESA',
  'DOCUMENTO_EJERCICIO', 'DOCUMENTO_SERIE', 'DOCUMENTO_TERMINAL',
  'DOCUMENTO_NUMERO', 'DOCUMENTO_XDE', 'DOCUMENTO_DEX',
]);
const REQUIRED = Object.freeze({
  confirmation: Object.freeze([
    'ID', 'IDEMPOTENCY_KEY', 'DOCUMENT_ID', 'REPARTIDOR_ID', 'CLIENTE_CODIGO',
    'CLIENTE_NOMBRE', 'PEDIDO_EJERCICIO', 'PEDIDO_NUMERO', ...FINANCIAL_DOCUMENT_COLUMNS,
    'STATUS', 'OCCURRED_AT', 'CONFIRMED_AT', 'RECEPTOR_NOMBRE', 'RECEPTOR_APELLIDOS',
    'RECEPTOR_DNI', 'FIRMA_EVIDENCE_ID', 'INCIDENCIA_CODIGO',
    'INCIDENCIA_DESCRIPCION', 'INCIDENCIA_OBSERVACIONES', 'OBSERVACIONES',
    'LATITUD', 'LONGITUD',
  ]),
  lines: Object.freeze([
    'CONFIRMACION_ID', 'LINEA_ID', 'CODIGO_ARTICULO', 'DESCRIPCION',
    'CANTIDAD_PEDIDA', 'CANTIDAD_ENTREGADA', 'CANTIDAD_RECHAZADA',
    'CANTIDAD_PENDIENTE', 'MOTIVO_DIFERENCIA', 'OBSERVACIONES', 'PRECIO_UNITARIO',
  ]),
  evidences: Object.freeze(['EVIDENCE_ID', 'EVIDENCE_KIND', 'MIME_TYPE']),
  confirmationEvidences: Object.freeze(['CONFIRMACION_ID', 'EVIDENCE_ID']),
  cobros: Object.freeze([
    'ID', 'IDEMPOTENCY_TOKEN', 'CODIGOCLIENTEALBARAN', 'CODIGOVENDEDOR',
    'TIPODOCUMENTO', 'ORIGENDOCUMENTO', 'SUBEMPRESADOCUMENTO',
    'EJERCICIODOCUMENTO', 'SERIEDOCUMENTO', 'TERMINALDOCUMENTO',
    'NUMERODOCUMENTO', 'XDEDOCUMENTO', 'DEXDOCUMENTO', 'IMPORTEVENCIMIENTO',
    'CODIGOFORMAPAGO', 'DIACOBRO', 'MESCOBRO', 'ANOCOBRO',
  ]),
});

class RepartoReceiptUnavailableError extends RepartoPersistenceError {
  constructor(message, details) {
    super(message, { code: 'REPARTO_RECEIPT_UNAVAILABLE', statusCode: 503, details });
    this.name = 'RepartoReceiptUnavailableError';
  }
}

function value(item, key) {
  return item?.[key] ?? item?.[key.toLowerCase()] ?? item?.[key.toUpperCase()];
}

function resultRows(result) {
  return Array.isArray(result) ? result : (result?.rows || []);
}

function ref(identifier) {
  const [schema, table] = String(identifier).split('.');
  return { schema, table };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new RepartoPersistenceError('La consulta del recibo fue cancelada', {
      code: 'REPARTO_RECEIPT_TIMEOUT', statusCode: 504,
    });
  }
}

function assertRuntime(runtime) {
  const tables = runtime?.tables;
  const confirmationMatches = Object.entries(TABLE_MAPPINGS[runtime?.tableSet]?.confirmation || {})
    .every(([key, identifier]) => tables?.confirmation?.[key] === identifier);
  const references = [
    tables?.confirmation?.confirmations,
    tables?.confirmation?.lines,
    tables?.confirmation?.evidences,
    tables?.confirmation?.confirmationEvidences,
    tables?.finance?.cobros,
  ];
  if (!runtime?.valid
      || !['isolated_test', 'production'].includes(runtime.tableSet)
      || !runtime.confirmationCapabilityApproved
      || (runtime.environment === 'production'
        && (!runtime.productionWritesEnabled || !runtime.productionConfirmationApproved))
      || !confirmationMatches
      || !validateFinanceTableMapping(runtime).valid
      || references.some((identifier) => !IDENTIFIER.test(identifier || ''))) {
    throw new RepartoReceiptUnavailableError('El runtime canonico del recibo no esta disponible');
  }
  return tables;
}

function assertConfirmationId(id) {
  const normalized = String(id ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized) || !Number.isSafeInteger(Number(normalized))) {
    throw new RepartoPersistenceError('El identificador de confirmacion es invalido', {
      code: 'REPARTO_RECEIPT_INVALID_ID', statusCode: 422,
    });
  }
  return normalized;
}

function assertIdempotencyKey(key) {
  const normalized = String(key ?? '').trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) {
    throw new RepartoPersistenceError('La clave de idempotencia es invalida', {
      code: 'REPARTO_RECEIPT_INVALID_IDEMPOTENCY_KEY', statusCode: 422,
    });
  }
  return normalized;
}

function normalizeLookup(input) {
  if (typeof input !== 'object' || input == null || Array.isArray(input)) {
    return Object.freeze({ confirmationId: assertConfirmationId(input), idempotencyKey: null });
  }
  const hasId = input.confirmationId !== undefined && input.confirmationId !== null
    && String(input.confirmationId).trim() !== '';
  const hasKey = input.idempotencyKey !== undefined && input.idempotencyKey !== null
    && String(input.idempotencyKey).trim() !== '';
  if (hasId === hasKey) {
    throw new RepartoPersistenceError('Debe indicarse una sola identidad de recibo', {
      code: 'REPARTO_RECEIPT_INVALID_LOOKUP', statusCode: 422,
    });
  }
  return Object.freeze({
    confirmationId: hasId ? assertConfirmationId(input.confirmationId) : null,
    idempotencyKey: hasKey ? assertIdempotencyKey(input.idempotencyKey) : null,
  });
}

function hasValue(input) {
  return input != null && String(input).trim() !== '';
}

function normalizeOwnerScope(input) {
  if (input?.allowAnyOwner === true) {
    return Object.freeze({ allowAnyOwner: true, ownerRepartidorId: null });
  }
  const ownerRepartidorId = String(input?.ownerRepartidorId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(ownerRepartidorId)) {
    throw new RepartoPersistenceError('Alcance de propietario requerido para consultar el recibo', {
      code: 'REPARTO_RECEIPT_ACTOR_REQUIRED', statusCode: 403,
    });
  }
  return Object.freeze({ allowAnyOwner: false, ownerRepartidorId });
}

async function query(connection, sql, params, signal) {
  throwIfAborted(signal);
  let abortHandler;
  try {
    if (signal && typeof connection?.cancel === 'function') {
      abortHandler = () => {
        try { connection.cancel(); } catch (_error) { /* cancellation is best effort */ }
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    const result = typeof connection.query === 'function'
      ? await connection.query(sql, params)
      : await connection.execute(sql, params);
    throwIfAborted(signal);
    return resultRows(result);
  } catch (error) {
    if (error instanceof RepartoPersistenceError) throw error;
    throw new RepartoReceiptUnavailableError('No se pudo consultar el recibo de reparto', {
      causeCode: error?.code || null,
    });
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

function createRepartoReceiptDb2Repository({ connectionFactory, runtime } = {}) {
  if (typeof connectionFactory !== 'function') throw new TypeError('connectionFactory is required');
  const tables = assertRuntime(runtime);
  const references = Object.freeze({
    confirmation: ref(tables.confirmation.confirmations),
    lines: ref(tables.confirmation.lines),
    evidences: ref(tables.confirmation.evidences),
    confirmationEvidences: ref(tables.confirmation.confirmationEvidences),
    cobros: ref(tables.finance.cobros),
  });

  async function assertCapabilities(connection, { signal } = {}) {
    if (!connection || (typeof connection.query !== 'function' && typeof connection.execute !== 'function')) {
      throw new RepartoReceiptUnavailableError('La conexion DB2 del recibo no esta disponible');
    }
    const list = Object.values(references);
    const where = list.map(() => '(TABLE_SCHEMA = ? AND TABLE_NAME = ?)').join(' OR ');
    const params = list.flatMap(({ schema, table }) => [schema, table]);
    const tableRows = await query(connection,
      `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE ${where}`,
      params, signal);
    const found = new Set(tableRows.map((item) =>
      `${String(value(item, 'TABLE_SCHEMA')).trim().toUpperCase()}.${String(value(item, 'TABLE_NAME')).trim().toUpperCase()}`));
    const missingTables = list
      .filter(({ schema, table }) => !found.has(`${schema}.${table}`))
      .map(({ schema, table }) => `${schema}.${table}`);
    if (missingTables.length) {
      throw new RepartoReceiptUnavailableError('Faltan tablas del recibo de reparto', { missingTables });
    }
    const columns = await query(connection,
      `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE ${where}`,
      params, signal);
    const available = new Map();
    for (const item of columns) {
      const key = `${String(value(item, 'TABLE_SCHEMA')).trim().toUpperCase()}.${String(value(item, 'TABLE_NAME')).trim().toUpperCase()}`;
      if (!available.has(key)) available.set(key, new Set());
      available.get(key).add(String(value(item, 'COLUMN_NAME')).trim().toUpperCase());
    }
    const missingColumns = Object.entries(REQUIRED).flatMap(([key, names]) => {
      const current = references[key];
      const table = `${current.schema}.${current.table}`;
      return names.filter((name) => !available.get(table)?.has(name))
        .map((name) => `${table}.${name}`);
    });
    if (missingColumns.length) {
      throw new RepartoReceiptUnavailableError('Faltan columnas del recibo de reparto', { missingColumns });
    }
  }

  async function getReceipt(input) {
    const lookup = normalizeLookup(input);
    const ownerScope = normalizeOwnerScope(input);
    const signal = typeof input === 'object' && input ? input.signal : undefined;
    let connection;
    try {
      throwIfAborted(signal);
      try {
        connection = await connectionFactory({ signal });
      } catch (error) {
        if (error instanceof RepartoPersistenceError) throw error;
        throw new RepartoReceiptUnavailableError('La conexion DB2 del recibo no esta disponible');
      }
      await assertCapabilities(connection, { signal });
      const lookupColumn = lookup.confirmationId ? 'ID' : 'IDEMPOTENCY_KEY';
      const lookupValue = lookup.confirmationId || lookup.idempotencyKey;
      const confirmations = await query(connection,
        `SELECT ID, REPARTIDOR_ID FROM ${tables.confirmation.confirmations} WHERE ${lookupColumn} = ? FETCH FIRST 2 ROWS ONLY`,
        [lookupValue], signal);
      if (confirmations.length > 1) {
        throw new RepartoReceiptUnavailableError('La confirmacion del recibo es ambigua');
      }
      if (!confirmations.length) return null;
      const confirmationIdentity = confirmations[0];
      const confirmationOwner = String(value(confirmationIdentity, 'REPARTIDOR_ID') ?? '').trim();
      if (!confirmationOwner) {
        throw new RepartoReceiptUnavailableError('La confirmacion no contiene propietario');
      }
      if (!ownerScope.allowAnyOwner && confirmationOwner !== ownerScope.ownerRepartidorId) {
        throw new RepartoPersistenceError('El recibo no pertenece al repartidor autenticado', {
          code: 'REPARTO_RECEIPT_OWNERSHIP_REQUIRED', statusCode: 403,
        });
      }
      const confirmationId = value(confirmationIdentity, 'ID');
      if (!hasValue(confirmationId)) {
        throw new RepartoReceiptUnavailableError('La confirmacion no contiene un identificador');
      }
      const confirmationRows = await query(connection,
        `SELECT * FROM ${tables.confirmation.confirmations} WHERE ID = ? FETCH FIRST 2 ROWS ONLY`,
        [confirmationId], signal);
      if (confirmationRows.length !== 1
          || String(value(confirmationRows[0], 'REPARTIDOR_ID') ?? '').trim() !== confirmationOwner) {
        throw new RepartoReceiptUnavailableError('La confirmacion del recibo cambio durante la consulta');
      }
      const confirmation = confirmationRows[0];
      const lines = await query(connection,
        `SELECT * FROM ${tables.confirmation.lines} WHERE CONFIRMACION_ID = ? ORDER BY LINEA_ID`,
        [confirmationId], signal);
      const evidences = await query(connection,
        `SELECT E.EVIDENCE_ID, E.EVIDENCE_KIND, E.MIME_TYPE FROM ${tables.confirmation.confirmationEvidences} CE INNER JOIN ${tables.confirmation.evidences} E ON E.EVIDENCE_ID = CE.EVIDENCE_ID WHERE CE.CONFIRMACION_ID = ? ORDER BY E.EVIDENCE_ID`,
        [confirmationId], signal);

      const financialValues = FINANCIAL_DOCUMENT_COLUMNS.map((name) => value(confirmation, name));
      const presentFinancialValues = financialValues.filter(hasValue).length;
      let payments = [];
      if (presentFinancialValues !== 0 && presentFinancialValues !== financialValues.length) {
        throw new RepartoReceiptUnavailableError('La identidad financiera de la confirmacion esta incompleta');
      }
      if (presentFinancialValues === financialValues.length) {
        const paymentKey = [
          value(confirmation, 'IDEMPOTENCY_KEY'), value(confirmation, 'CLIENTE_CODIGO'),
          value(confirmation, 'REPARTIDOR_ID'), ...financialValues,
        ];
        if (paymentKey.some((item) => !hasValue(item))) {
          throw new RepartoReceiptUnavailableError('La identidad financiera de la confirmacion no esta disponible');
        }
        payments = await query(connection,
          `SELECT ID, IDEMPOTENCY_TOKEN, CODIGOCLIENTEALBARAN, CODIGOVENDEDOR, TIPODOCUMENTO, ORIGENDOCUMENTO, SUBEMPRESADOCUMENTO, EJERCICIODOCUMENTO, SERIEDOCUMENTO, TERMINALDOCUMENTO, NUMERODOCUMENTO, XDEDOCUMENTO, DEXDOCUMENTO, IMPORTEVENCIMIENTO, CODIGOFORMAPAGO, DIACOBRO, MESCOBRO, ANOCOBRO FROM ${tables.finance.cobros} WHERE IDEMPOTENCY_TOKEN = ? AND TRIM(CODIGOCLIENTEALBARAN) = ? AND TRIM(CODIGOVENDEDOR) = ? AND TRIM(TIPODOCUMENTO) = ? AND TRIM(ORIGENDOCUMENTO) = ? AND TRIM(SUBEMPRESADOCUMENTO) = ? AND EJERCICIODOCUMENTO = ? AND TRIM(SERIEDOCUMENTO) = ? AND TERMINALDOCUMENTO = ? AND NUMERODOCUMENTO = ? AND XDEDOCUMENTO = ? AND DEXDOCUMENTO = ? FETCH FIRST 2 ROWS ONLY`,
          paymentKey, signal);
      }
      return Object.freeze({
        confirmation,
        lines: Object.freeze(lines),
        evidences: Object.freeze(evidences),
        payments: Object.freeze(payments),
      });
    } finally {
      if (connection && typeof connection.close === 'function') {
        try {
          await connection.close();
        } catch (_error) {
          throw new RepartoReceiptUnavailableError('No se pudo cerrar la conexion DB2 del recibo');
        }
      }
    }
  }

  return Object.freeze({ assertCapabilities, getReceipt });
}

module.exports = {
  FINANCIAL_DOCUMENT_COLUMNS,
  REQUIRED,
  RepartoReceiptUnavailableError,
  createRepartoReceiptDb2Repository,
};
