'use strict';

const { validateFinanceTableMapping } = require('../config/reparto-runtime');
const { RepartoPersistenceError } = require('../services/reparto-confirmation-service');

const LEDGER_COLUMNS = Object.freeze([
  'ID', 'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR',
  'CODIGOVENDEDORCOBRO', 'TIPODOCUMENTO', 'ORIGENDOCUMENTO',
  'SUBEMPRESADOCUMENTO', 'EJERCICIODOCUMENTO', 'SERIEDOCUMENTO',
  'TERMINALDOCUMENTO', 'NUMERODOCUMENTO', 'XDEDOCUMENTO', 'DEXDOCUMENTO',
  'IMPORTEVENCIMIENTO', 'IMPORTEPENDIENTE', 'CODIGOFORMAPAGO', 'DIACOBRO',
  'MESCOBRO', 'ANOCOBRO', 'IDEMPOTENCY_TOKEN', 'PANTALLA_ORIGEN', 'OPERADOR',
  'OBSERVACIONES',
]);
const COMMERCIAL_COLUMNS = Object.freeze(['CODIGO_CLIENTE', 'REFERENCIA', 'IMPORTE']);

class RepartoCobrosCapabilityError extends RepartoPersistenceError {
  constructor(message, details) {
    super(message, { code: 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE', statusCode: 503, details });
    this.name = 'RepartoCobrosCapabilityError';
  }
}

// DB2 signals a duplicate idempotency-token insert as SQLSTATE 23505 or
// SQL0803. This is not a capability failure: the owning repository must
// roll back and retry its complete transaction so it can read the row that
// won the race and return an exact replay (or a payload conflict).
class RepartoCobrosIdempotencyRaceError extends RepartoPersistenceError {
  constructor(error) {
    super('El token de cobro fue confirmado de forma concurrente', {
      code: 'REPARTO_COBRO_IDEMPOTENCY_RACE',
      statusCode: 409,
      details: {
        causeCode: error?.code ?? error?.nativeCode ?? null,
        causeState: error?.state ?? error?.sqlState ?? error?.sqlstate ?? null,
      },
    });
    this.name = 'RepartoCobrosIdempotencyRaceError';
    this.cause = error;
  }
}

function isUniqueConstraintError(error) {
  const candidates = [error, ...(Array.isArray(error?.odbcErrors) ? error.odbcErrors : [])];
  return candidates.some((item) => {
    const state = String(item?.state || item?.sqlState || item?.sqlstate || '').toUpperCase();
    const code = String(item?.code ?? item?.nativeError ?? item?.nativeCode ?? '').toUpperCase();
    return state === '23505' || code === 'SQL0803' || code === '-803' || code === '803';
  });
}

function rowValue(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

async function rows(connection, sql, params = []) {
  try {
    const result = typeof connection?.query === 'function'
      ? await connection.query(sql, params)
      : await connection?.execute?.(sql, params);
    if (!Array.isArray(result) && !Array.isArray(result?.rows)) {
      throw new Error('invalid DB2 row result');
    }
    return Array.isArray(result) ? result : result.rows;
  } catch (error) {
    if (error instanceof RepartoPersistenceError) throw error;
    throw new RepartoCobrosCapabilityError('No se pudo verificar o usar el ledger de cobros', {
      causeCode: error?.code || null,
    });
  }
}

async function execute(connection, sql, params = [], { preserveUnique = false } = {}) {
  try {
    return typeof connection?.query === 'function'
      ? await connection.query(sql, params)
      : await connection?.execute?.(sql, params);
  } catch (error) {
    if (preserveUnique && isUniqueConstraintError(error)) {
      throw new RepartoCobrosIdempotencyRaceError(error);
    }
    throw new RepartoCobrosCapabilityError('No se pudo escribir el ledger de cobros', {
      causeCode: error?.code || null,
    });
  }
}

function parseQualified(identifier) {
  const [schema, table] = String(identifier || '').split('.');
  return Object.freeze({ schema, table });
}

function assertRuntime(runtime) {
  const validation = validateFinanceTableMapping(runtime);
  const allowedTableSet = runtime.tableSet === 'isolated_test'
    || runtime.tableSet === 'production';
  if (!validation.valid || !allowedTableSet || !runtime.writesEnabled
      || !runtime.financeCapabilityApproved) {
    throw new RepartoCobrosCapabilityError('El runtime de cobros no esta autorizado', {
      mappingErrors: validation.errors,
      tableSet: runtime.tableSet || null,
    });
  }
}

function normalizeText(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeDocumentType(value) {
  const normalized = normalizeText(value).toUpperCase();
  return ['ALBARAN', 'ALBARANES', 'ALB', 'COB. ALB.', 'COB_ALB'].includes(normalized)
    ? 'CAC'
    : normalized;
}

function paymentCode(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (['EFECTIVO', 'CONTADO', 'EF', 'F0'].includes(normalized)) return 'EF';
  if (['TARJETA', 'TPV', 'TJ'].includes(normalized)) return 'TJ';
  if (['TRANSFERENCIA', 'TRANSFER', 'TR', 'T0'].includes(normalized)) return 'TR';
  if (['BIZUM', 'BI'].includes(normalized)) return 'BI';
  if (['CHEQUE', 'TALON', 'TALON BANCARIO', 'CH'].includes(normalized)) return 'CH';
  if (['POSTDATADO', 'POSTDATADOS', 'PD'].includes(normalized)) return 'PD';
  return normalized.slice(0, 2);
}

function money(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RepartoPersistenceError(`${field} no es un importe valido`, {
      code: 'REPARTO_INVALID_PAYMENT', statusCode: 422,
    });
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function integer(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RepartoPersistenceError(`${field} no es valido`, {
      code: 'REPARTO_INVALID_PAYMENT', statusCode: 422,
    });
  }
  return parsed;
}

function normalizePayment(input, now) {
  const payment = Object.freeze({
    codigoCliente: normalizeText(input.codigoCliente),
    codigoRepartidor: normalizeText(input.codigoRepartidor),
    tipoDocumento: normalizeDocumentType(input.tipoDocumento),
    origenDocumento: normalizeText(input.origenDocumento),
    subempresaDocumento: normalizeText(input.subempresaDocumento),
    ejercicioDocumento: integer(input.ejercicioDocumento, 'ejercicioDocumento'),
    serieDocumento: normalizeText(input.serieDocumento),
    terminalDocumento: integer(input.terminalDocumento, 'terminalDocumento'),
    numeroDocumento: integer(input.numeroDocumento, 'numeroDocumento'),
    xdeDocumento: integer(input.xdeDocumento, 'xdeDocumento'),
    dexDocumento: integer(input.dexDocumento, 'dexDocumento'),
    importeCobrado: money(input.importeCobrado, 'importeCobrado'),
    importePendiente: money(input.importePendiente, 'importePendiente'),
    formaPago: paymentCode(input.formaPago),
    idempotencyToken: normalizeText(input.idempotencyToken),
    pantallaOrigen: normalizeText(input.pantallaOrigen) || 'RUTERO',
    operador: normalizeText(input.operador),
    notas: input.notas == null ? null : normalizeText(input.notas),
    diaCobro: now.getDate(),
    mesCobro: now.getMonth() + 1,
    anoCobro: now.getFullYear(),
  });
  const requiredText = [
    'codigoCliente', 'codigoRepartidor', 'tipoDocumento', 'origenDocumento',
    'subempresaDocumento', 'serieDocumento', 'formaPago', 'idempotencyToken',
    'pantallaOrigen', 'operador',
  ];
  if (requiredText.some((field) => !payment[field]) || payment.importeCobrado <= 0) {
    throw new RepartoPersistenceError('El cobro no contiene una identidad completa', {
      code: 'REPARTO_INVALID_PAYMENT', statusCode: 422,
    });
  }
  return payment;
}

function commercialReference(payment) {
  return [
    'CVC', payment.tipoDocumento, payment.origenDocumento, payment.subempresaDocumento,
    payment.ejercicioDocumento, payment.serieDocumento, payment.terminalDocumento,
    payment.numeroDocumento, payment.xdeDocumento, payment.dexDocumento,
  ].join(':');
}

function samePayment(row, payment) {
  const comparisons = [
    ['CODIGOCLIENTEALBARAN', payment.codigoCliente],
    ['CODIGOCLIENTEFACTURA', payment.codigoCliente],
    ['CODIGOVENDEDOR', payment.codigoRepartidor],
    ['CODIGOVENDEDORCOBRO', payment.codigoRepartidor],
    ['TIPODOCUMENTO', payment.tipoDocumento],
    ['ORIGENDOCUMENTO', payment.origenDocumento],
    ['SUBEMPRESADOCUMENTO', payment.subempresaDocumento],
    ['SERIEDOCUMENTO', payment.serieDocumento],
    ['CODIGOFORMAPAGO', payment.formaPago],
    ['PANTALLA_ORIGEN', payment.pantallaOrigen],
    ['OPERADOR', payment.operador],
    ['OBSERVACIONES', payment.notas],
  ];
  if (comparisons.some(([column, expected]) => normalizeText(rowValue(row, column)) !== expected)) return false;
  const integers = [
    ['EJERCICIODOCUMENTO', payment.ejercicioDocumento],
    ['TERMINALDOCUMENTO', payment.terminalDocumento],
    ['NUMERODOCUMENTO', payment.numeroDocumento],
    ['XDEDOCUMENTO', payment.xdeDocumento],
    ['DEXDOCUMENTO', payment.dexDocumento],
  ];
  if (integers.some(([column, expected]) => Number(rowValue(row, column)) !== expected)) return false;
  return money(rowValue(row, 'IMPORTEVENCIMIENTO'), 'importeCobrado') === payment.importeCobrado
    && money(rowValue(row, 'IMPORTEPENDIENTE'), 'importePendiente') === payment.importePendiente;
}

function createRepartoCobrosDb2Port({ runtime, now = () => new Date(), logger = console } = {}) {
  assertRuntime(runtime);
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const ledger = parseQualified(runtime.tables.finance.cobros);
  const commercial = parseQualified(runtime.tables.finance.commercialCobros);
  const approvedConnections = new WeakSet();

  async function assertCapabilities(connection) {
    if (!connection || (typeof connection.query !== 'function' && typeof connection.execute !== 'function')) {
      throw new RepartoCobrosCapabilityError('La conexion DB2 de cobros no esta disponible');
    }
    const tableRows = await rows(connection,
      'SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES WHERE (TABLE_SCHEMA = ? AND TABLE_NAME = ?) OR (TABLE_SCHEMA = ? AND TABLE_NAME = ?)',
      [ledger.schema, ledger.table, commercial.schema, commercial.table]);
    const foundTables = new Set(tableRows.map((row) =>
      `${normalizeText(rowValue(row, 'TABLE_SCHEMA')).toUpperCase()}.${normalizeText(rowValue(row, 'TABLE_NAME')).toUpperCase()}`));
    const missingTables = [ledger, commercial]
      .filter(({ schema, table }) => !foundTables.has(`${schema}.${table}`))
      .map(({ schema, table }) => `${schema}.${table}`);
    if (missingTables.length) {
      throw new RepartoCobrosCapabilityError('Faltan tablas requeridas para el ledger de cobros', { missingTables });
    }

    const columnRows = await rows(connection,
      'SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE (TABLE_SCHEMA = ? AND TABLE_NAME = ?) OR (TABLE_SCHEMA = ? AND TABLE_NAME = ?)',
      [ledger.schema, ledger.table, commercial.schema, commercial.table]);
    const available = new Map();
    for (const row of columnRows) {
      const key = `${normalizeText(rowValue(row, 'TABLE_SCHEMA')).toUpperCase()}.${normalizeText(rowValue(row, 'TABLE_NAME')).toUpperCase()}`;
      if (!available.has(key)) available.set(key, new Set());
      available.get(key).add(normalizeText(rowValue(row, 'COLUMN_NAME')).toUpperCase());
    }
    const required = [[ledger, LEDGER_COLUMNS], [commercial, COMMERCIAL_COLUMNS]];
    const missingColumns = required.flatMap(([tableRef, columns]) => {
      const key = `${tableRef.schema}.${tableRef.table}`;
      return columns.filter((column) => !available.get(key)?.has(column)).map((column) => `${key}.${column}`);
    });
    if (missingColumns.length) {
      throw new RepartoCobrosCapabilityError('Faltan columnas verificadas para el ledger de cobros', { missingColumns });
    }

    const uniqueRows = await rows(connection, `
      SELECT I.INDEX_SCHEMA, I.INDEX_NAME
      FROM QSYS2.SYSINDEXES I
      INNER JOIN QSYS2.SYSKEYS K
        ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME
      WHERE I.TABLE_SCHEMA = ? AND I.TABLE_NAME = ? AND I.IS_UNIQUE IN ('U', 'V')
      GROUP BY I.INDEX_SCHEMA, I.INDEX_NAME
      HAVING COUNT(*) = 1 AND MAX(K.COLUMN_NAME) = ?`,
    [ledger.schema, ledger.table, 'IDEMPOTENCY_TOKEN']);
    if (uniqueRows.length < 1) {
      throw new RepartoCobrosCapabilityError('No existe una clave unica verificable para el token de cobro');
    }
    approvedConnections.add(connection);
  }

  function forConnection(connection) {
    if (!approvedConnections.has(connection)) {
      throw new RepartoCobrosCapabilityError('La conexion no ha superado el capability gate de cobros');
    }
    return Object.freeze({
      async insertCobro(input) {
        const payment = normalizePayment(input, now());
        const replayRows = await rows(connection,
          `SELECT ${LEDGER_COLUMNS.join(', ')} FROM ${runtime.tables.finance.cobros} WHERE IDEMPOTENCY_TOKEN = ? FETCH FIRST 2 ROWS ONLY FOR UPDATE WITH RS`,
          [payment.idempotencyToken]);
        if (replayRows.length > 1) {
          throw new RepartoCobrosCapabilityError('El ledger contiene tokens de cobro ambiguos');
        }
        if (replayRows.length === 1) {
          if (!samePayment(replayRows[0], payment)) {
            throw new RepartoPersistenceError('Token de cobro reutilizado con otro payload', {
              code: 'REPARTO_COBRO_IDEMPOTENCY_CONFLICT', statusCode: 409,
            });
          }
          return Object.freeze({
            id: String(rowValue(replayRows[0], 'ID')).trim(),
            created: false,
          });
        }

        const reference = commercialReference(payment);
        const commercialRows = await rows(connection,
          `SELECT COALESCE(SUM(IMPORTE), 0) AS TOTAL_COBRADO FROM ${runtime.tables.finance.commercialCobros} WHERE TRIM(CODIGO_CLIENTE) = ? AND TRIM(REFERENCIA) = ?`,
          [payment.codigoCliente, reference]);
        if (commercialRows.length !== 1 || rowValue(commercialRows[0], 'TOTAL_COBRADO') == null) {
          throw new RepartoCobrosCapabilityError('No se pudo verificar la clave del ledger comercial');
        }
        const commercialAmount = money(rowValue(commercialRows[0], 'TOTAL_COBRADO'), 'commercialCobros');
        if (commercialAmount > 0) {
          throw new RepartoPersistenceError('El documento ya contiene cobros en el ledger comercial', {
            code: 'REPARTO_COBRO_COMMERCIAL_CONFLICT', statusCode: 409,
          });
        }

        await execute(connection,
          `INSERT INTO ${runtime.tables.finance.cobros} (${LEDGER_COLUMNS.slice(1).join(', ')}) VALUES (${LEDGER_COLUMNS.slice(1).map(() => '?').join(', ')})`,
          [
            payment.codigoCliente, payment.codigoCliente, payment.codigoRepartidor,
            payment.codigoRepartidor, payment.tipoDocumento, payment.origenDocumento,
            payment.subempresaDocumento, payment.ejercicioDocumento, payment.serieDocumento,
            payment.terminalDocumento, payment.numeroDocumento, payment.xdeDocumento,
            payment.dexDocumento, payment.importeCobrado, payment.importePendiente,
            payment.formaPago, payment.diaCobro, payment.mesCobro, payment.anoCobro,
            payment.idempotencyToken, payment.pantallaOrigen, payment.operador, payment.notas,
          ], { preserveUnique: true });
        const identityRows = await rows(connection, 'SELECT IDENTITY_VAL_LOCAL() AS ID FROM SYSIBM.SYSDUMMY1');
        const id = rowValue(identityRows[0], 'ID');
        if (id == null) throw new RepartoCobrosCapabilityError('DB2 no devolvio el identificador del cobro');
        logger.info?.('reparto cobro inserted', { tableSet: runtime.tableSet });
        return Object.freeze({ id: String(id).trim(), created: true });
      },
    });
  }

  return Object.freeze({ assertCapabilities, forConnection });
}

module.exports = {
  COMMERCIAL_COLUMNS,
  LEDGER_COLUMNS,
  RepartoCobrosCapabilityError,
  createRepartoCobrosDb2Port,
  RepartoCobrosIdempotencyRaceError,
};
