'use strict';

const fs = require('fs');
const path = require('path');
const { TABLE_MAPPINGS } = require('../config/reparto-runtime');
const {
  createRepartidorLiquidacionDb2Repository, REQUIRED_COLUMNS, REQUIRED_COLUMN_MANIFEST,
  REQUIRED_CONSTRAINT_SIGNATURES, REQUIRED_INDEX_SIGNATURES,
} = require('../repositories/repartidor-liquidacion-db2-repository');
const { createRepartidorLiquidacionBootstrap } = require('../config/repartidor-liquidacion-bootstrap');

function runtime(overrides = {}) {
  return {
    valid: true, writesEnabled: true, financeCapabilityApproved: true,
    tableSet: 'isolated_test', tables: TABLE_MAPPINGS.isolated_test,
    environment: 'test', ...overrides,
  };
}

function mappedObjects() {
  const mappings = TABLE_MAPPINGS.isolated_test;
  const keyed = {
    ...Object.fromEntries(Object.entries(mappings.finance)),
    confirmations: mappings.confirmation.confirmations,
    lines: mappings.confirmation.lines,
  };
  return Object.entries(REQUIRED_COLUMNS).map(([key, columns]) => ({
    key, columns, identifier: keyed[key],
  }));
}

function catalogRows() {
  return mappedObjects().flatMap(({ key, columns, identifier }) => {
    const [TABLE_SCHEMA, TABLE_NAME] = identifier.split('.');
    return columns.map((COLUMN_NAME, index) => {
      const expected = REQUIRED_COLUMN_MANIFEST[key][COLUMN_NAME];
      return {
        TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION: index + 1,
        DATA_TYPE: expected.dataType, LENGTH: expected.length,
        NUMERIC_PRECISION: expected.numericPrecision, NUMERIC_SCALE: expected.numericScale,
        IS_NULLABLE: expected.isNullable, HAS_DEFAULT: expected.hasDefault,
        COLUMN_DEFAULT: expected.defaultValue, IS_IDENTITY: expected.isIdentity,
        IDENTITY_GENERATION: expected.identityGeneration,
        IDENTITY_START: expected.identityStart, IDENTITY_INCREMENT: expected.identityIncrement,
      };
    });
  });
}

function indexRows() {
  return mappedObjects().flatMap(({ key, identifier }) => {
    const [TABLE_SCHEMA, TABLE_NAME] = identifier.split('.');
    return (REQUIRED_INDEX_SIGNATURES[key] || []).flatMap((signature, index) => {
      const separator = signature.indexOf(':');
      const IS_UNIQUE = signature.slice(0, separator);
      const columns = signature.slice(separator + 1).split(',');
      let INDEX_NAME = `IDX_${key}_${index}`;
      if (key === 'liquidationOps') {
        if (columns.join(',') === 'IDEMPOTENCY_TOKEN:A') INDEX_NAME = 'U1';
        if (columns.join(',') === 'IDMARCALIQUIDACION:A') INDEX_NAME = 'U2';
        if (columns[0] === 'CODIGOVENDEDOR:A') INDEX_NAME = 'U3';
      }
      if (columns.join(',') === 'IDEMPOTENCY_TOKEN:A') {
        if (key === 'expenses') INDEX_NAME = 'UE0';
        if (key === 'adjustments') INDEX_NAME = 'UE1';
        if (key === 'bankDeposits') INDEX_NAME = 'UE2';
      }
      return columns.map((column, ordinal) => {
        const [COLUMN_NAME, ORDERING] = column.split(':');
        return {
          TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, IS_UNIQUE,
          COLUMN_NAME, ORDINAL_POSITION: ordinal + 1, ORDERING,
        };
      });
    });
  });
}

function constraintRows() {
  return mappedObjects().flatMap(({ key, identifier }) => {
    const [TABLE_SCHEMA, TABLE_NAME] = identifier.split('.');
    return (REQUIRED_CONSTRAINT_SIGNATURES[key] || []).map((signature, index) => {
      const separator = signature.indexOf(':');
      const type = signature.slice(0, separator);
      const value = signature.slice(separator + 1);
      return {
        TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME: `C_${key}_${index}`,
        CONSTRAINT_TYPE: type,
        CHECK_CONDITION: type === 'CHECK' ? value : null,
        KEY_COLUMNS: type === 'CHECK' ? '' : value,
      };
    });
  });
}

function connection({
  missingColumn, missingIndexSignature, omitTableKey, omitOutbox = false,
  closeError, uniqueOnce = false, fakeVarcharColumns = false,
  malformedNullDefault = false, omitConstraints = false, malformedSequence = false,
  malformedIdentity = false, malformedIndexOrdering = false, extraColumn = false,
  extraConstraint = null, extraIndex = null, missingConstraintSignature = null,
} = {}) {
  let raced = false;
  const query = jest.fn(async (sql) => {
    if (sql.includes('QSYS2.SYSTABLES')) {
      return mappedObjects()
        .filter(({ key }) => key !== omitTableKey && !(omitOutbox && key === 'liquidationOutbox'))
        .map(({ identifier }) => {
          const [TABLE_SCHEMA, TABLE_NAME] = identifier.split('.');
          return { TABLE_SCHEMA, TABLE_NAME };
        });
    }
    if (sql.includes('QSYS2.SYSCOLUMNS2')) {
      const actual = catalogRows().filter((row) => row.COLUMN_NAME !== missingColumn).map((row) => ({
        ...row,
        ...(fakeVarcharColumns ? {
          DATA_TYPE: 'VARCHAR', LENGTH: 1, NUMERIC_PRECISION: null, NUMERIC_SCALE: null,
          IS_NULLABLE: 'YES', HAS_DEFAULT: 'NO', COLUMN_DEFAULT: null,
        } : {}),
        ...(malformedNullDefault && row.COLUMN_NAME === 'IDEMPOTENCY_TOKEN' ? {
          IS_NULLABLE: 'YES', HAS_DEFAULT: 'YES', COLUMN_DEFAULT: "'unsafe-default'",
        } : {}),
        ...(malformedIdentity && row.IS_IDENTITY === 'YES' ? { IDENTITY_INCREMENT: 7 } : {}),
      }));
      if (extraColumn) actual.push({
        ...actual.find((row) => row.TABLE_NAME === 'TEST_REPARTIDOR_LIQUIDACION_OPS'),
        COLUMN_NAME: 'UNEXPECTED_LEDGER_COLUMN', ORDINAL_POSITION: 999,
      });
      return actual;
    }
    if (sql.includes('QSYS2.SYSCST')) {
      let actual = omitConstraints ? [] : constraintRows();
      if (missingConstraintSignature) {
        const [tableName, type, detail] = missingConstraintSignature.split(':');
        actual = actual.filter((row) => !(
          row.TABLE_NAME === tableName
          && String(row.CONSTRAINT_TYPE).toUpperCase() === type
          && (
            type === 'CHECK'
              ? String(row.CHECK_CONDITION || '').replace(/\s+/g, '').toUpperCase().includes(detail)
              : String(row.KEY_COLUMNS || '').toUpperCase() === detail
          )
        ));
      }
      if (extraConstraint) actual.push({
        TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_LIQUIDACION_OPS',
        CONSTRAINT_NAME: 'C_UNEXPECTED', CONSTRAINT_TYPE: extraConstraint,
        CHECK_CONDITION: extraConstraint === 'CHECK' ? 'NUMEROLIQUIDACION >= 0' : null,
        KEY_COLUMNS: extraConstraint === 'UNIQUE' ? 'NUMEROLIQUIDACION' : '',
      });
      return actual;
    }
    if (sql.includes('QSYS2.SYSINDEXES')) {
      const actual = indexRows().filter((row) => row.INDEX_NAME !== missingIndexSignature)
        .map((row) => row.INDEX_NAME === 'U2' && malformedIndexOrdering
          ? { ...row, ORDERING: 'D' } : row);
      if (extraIndex) actual.push({
        TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_LIQUIDACION_OPS',
        INDEX_NAME: 'IX_UNEXPECTED', IS_UNIQUE: extraIndex,
        COLUMN_NAME: 'NUMEROLIQUIDACION', ORDINAL_POSITION: 1, ORDERING: 'A',
      });
      return actual;
    }
    if (sql.includes('QSYS2.SYSSEQUENCES')) return [{
      SEQUENCE_SCHEMA: 'JAVIER', SEQUENCE_NAME: 'TEST_REPARTIDOR_LIQUIDACION_SEQ',
      DATA_TYPE: malformedSequence ? 'INTEGER' : 'BIGINT',
      NUMERIC_PRECISION: malformedSequence ? '10' : '19',
      START: '1', INCREMENT: malformedSequence ? '9' : '1',
      MINIMUM_VALUE: '1', MAXIMUM_VALUE: '9223372036854775807', CYCLE_OPTION: 'NO', CACHE: '20',
      ORDER_OPTION: 'NO',
    }];
    if (sql.includes('SUM(L.CANTIDAD_ENTREGADA')) return [{ ID: 11, STATUS: 'PARCIAL', IMPORTE_ENTREGADO: '25', IMPORTE_PENDIENTE: '2', PRECIOS_NULOS: 0, LINEAS: 1 }];
    if (sql.includes('IMPORTEVENCIMIENTO') && sql.includes('FROM JAVIER.TEST_REPARTIDOR_COBROS')) return [{ ID: 21, IMPORTEVENCIMIENTO: '25', CODIGOFORMAPAGO: 'EF', CREATED_AT: '2026-08-09T10:00:00Z' }];
    if (sql.includes('OBSERVACION') && sql.includes('WHERE IDEMPOTENCY_TOKEN')) return [];
    if (sql.includes('OBSERVACION') && sql.includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS')) return [{ ID: 31, CODIGO_REPARTIDOR: '94', DIA: 9, MES: 8, ANO: 2026, IMPORTE: '3', CATEGORIA: 'PEAJE', STATUS: 'PENDING', CREATED_AT: '2026-08-09T10:00:00Z' }];
    if (sql.includes('OBSERVACION') && sql.includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES')) return [{ ID: 41, CODIGO_REPARTIDOR: '94', DIA: 9, MES: 8, ANO: 2026, IMPORTE: '-1', MOTIVO: 'DIFERENCIA', STATUS: 'PENDING', CREATED_AT: '2026-08-09T10:00:00Z' }];
    if (sql.includes('OBSERVACION') && sql.includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS')) return [{ ID: 51, CODIGO_REPARTIDOR: '94', DIA: 9, MES: 8, ANO: 2026, IMPORTE: '4', REFERENCIA: 'TRX-1', STATUS: 'PENDING', CREATED_AT: '2026-08-09T10:00:00Z' }];
    if (sql.includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS')) return [{ ID: 31, IMPORTE: '3', CATEGORIA: 'PEAJE' }];
    if (sql.includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES')) return [{ ID: 41, IMPORTE: '-1', MOTIVO: 'DIFERENCIA' }];
    if (sql.includes('FROM JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS')) return [{ ID: 51, IMPORTE: '4' }];
    if (sql.includes('SELECT SALDO_PENDIENTE')) return [{ SALDO_PENDIENTE: '4' }];
    if (sql.includes('IDENTITY_VAL_LOCAL')) return [{ ID: 71 }];
    if (sql.includes('SELECT NUMEROLIQUIDACION')) return [{ NUMEROLIQUIDACION: 88 }];
    if (/^INSERT INTO .*LIQUIDACION_OPS/i.test(sql.trim()) && uniqueOnce && !raced) {
      raced = true;
      throw Object.assign(new Error('duplicate'), { sqlState: '23505' });
    }
    if (/^UPDATE /i.test(sql.trim())) return { count: 1 };
    return [];
  });
  return {
    query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(),
    close: jest.fn(async () => { if (closeError) throw closeError; }),
  };
}

describe('repartidor-liquidacion-db2-repository', () => {
  test('fails closed when the exact finance mapping is unavailable', () => {
    expect(() => createRepartidorLiquidacionDb2Repository({
      runtime: runtime({ tables: { finance: {} } }), connectionFactory: jest.fn(),
    })).toThrow(expect.objectContaining({ code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503 }));
  });

  test('catalog validation happens before BEGIN and checks physical column names', async () => {
    const conn = connection({ missingColumn: 'IDMARCALIQUIDACION' });
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => conn });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { missingColumns: expect.arrayContaining([expect.stringContaining('.IDMARCALIQUIDACION')]) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalledTimes(1);
  });

  test('catalog rejects a same-name VARCHAR(1) fake schema before BEGIN', async () => {
    const conn = connection({ fakeVarcharColumns: true });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { mismatchedColumns: expect.arrayContaining([
        expect.stringContaining('IDEMPOTENCY_TOKEN'),
        expect.stringContaining('IMPORTEVENCIMIENTO'),
      ]) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog rejects nullable/default drift before BEGIN', async () => {
    const conn = connection({ malformedNullDefault: true });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { mismatchedColumns: expect.arrayContaining([expect.stringContaining('IDEMPOTENCY_TOKEN')]) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test.each([
    ['an extra column', { extraColumn: true }, 'unexpectedColumns'],
    ['an extra CHECK constraint', { extraConstraint: 'CHECK' }, 'unexpectedConstraints'],
    ['an extra UNIQUE constraint', { extraConstraint: 'UNIQUE' }, 'unexpectedConstraints'],
    ['an extra unique index', { extraIndex: 'U' }, 'unexpectedIndexes'],
    ['an extra nonunique index', { extraIndex: 'D' }, 'unexpectedIndexes'],
  ])('catalog rejects %s before BEGIN', async (_label, options, detailKey) => {
    const conn = connection(options);
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });

    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { [detailKey]: expect.any(Array) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog rejects missing checks/constraints before BEGIN', async () => {
    const conn = connection({ omitConstraints: true });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { missingConstraints: expect.any(Array) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog rejects identity increment drift before BEGIN', async () => {
    const conn = connection({ malformedIdentity: true });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { mismatchedColumns: expect.arrayContaining([expect.stringContaining('.ID')]) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog rejects a malformed mapped sequence before BEGIN', async () => {
    const conn = connection({ malformedSequence: true });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { sequenceMismatches: expect.any(Array) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog blocks before BEGIN when an authoritative unique signature is absent', async () => {
    const conn = connection({ missingIndexSignature: 'U2' });
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => conn });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE',
      details: { missingUniqueIndexes: ['JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS:IDMARCALIQUIDACION:A'] },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog rejects a wrong unique-index ordering before BEGIN', async () => {
    const conn = connection({ malformedIndexOrdering: true });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503,
      details: { missingUniqueIndexes: [
        'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS:IDMARCALIQUIDACION:A',
      ] },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('catalog blocks writers before BEGIN when a structured token is not unique', async () => {
    const conn = connection({
      missingConstraintSignature: 'TEST_REPARTIDOR_LIQUIDACION_GASTOS:UNIQUE:IDEMPOTENCY_TOKEN',
    });
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE',
      details: {
        missingConstraints: ['JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS:UNIQUE:IDEMPOTENCY_TOKEN'],
      },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('missing structured input ledger blocks before BEGIN instead of producing zero totals', async () => {
    const conn = connection({ omitTableKey: 'expenses' });
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => conn });
    await expect(repository.withTransaction(jest.fn())).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE',
      details: { missingTables: expect.arrayContaining(['JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS']) },
    });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  test('uses one connection, one tx, set-wise snapshot and exact physical writes', async () => {
    const conn = connection();
    const factory = jest.fn(async () => conn);
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: factory });
    await repository.withTransaction(async (tx) => {
      const snapshot = await tx.deriveDaySnapshot({ repartidorId: '94', date: '2026-08-09' });
      expect(snapshot).toMatchObject({ openingBalance: 4, balance: 21,
        breakdown: { deliveries: 25, payments: 25, expenses: 3, adjustments: -1, bankDeposits: 4, pending: 2 } });
      const operation = await tx.insertOperation({
        idempotencyToken: 'token-12345678', marker: 'LQD_123', repartidorId: '94', date: '2026-08-09',
        replayIdentity: { repartidorId: '94' }, snapshot, actorId: 'U-1', actorRole: 'ADMIN',
      });
      expect(operation).toEqual({ id: 71, numeroLiquidacion: 88 });
      const common = { repartidorId: '94', date: '2026-08-09', marker: 'LQD_123', operationId: 71, numeroLiquidacion: 88 };
      await tx.markCobrosLiquidated({ ...common, cobroIds: [21] });
      await tx.markExpensesLiquidated({ ...common, ids: [31] });
      await tx.markAdjustmentsLiquidated({ ...common, ids: [41] });
      await tx.markBankDepositsLiquidated({ ...common, ids: [51] });
      await tx.updateBalance({ repartidorId: '94', snapshot });
      await tx.appendAudit({ event: 'REPARTIDOR_LIQUIDACION_CLOSED', actorId: 'U-1', actorRole: 'ADMIN', repartidorId: '94', date: '2026-08-09', operationId: 71, marker: 'LQD_123' });
      await tx.enqueueEmailOutbox({ liquidacionId: 71, type: 'REPARTIDOR_LIQUIDACION_EMAIL' });
    }, { requiresOutbox: true });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    const sql = conn.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('NEXT VALUE FOR JAVIER.TEST_REPARTIDOR_LIQUIDACION_SEQ');
    expect(sql).toContain('CODIGOVENDEDOR = ? AND DIACOBRO = ?');
    expect(sql).not.toMatch(/LOCK TABLE|MAX\s*\(|DSEDAC/i);
    expect(conn.query.mock.calls.filter(([statement]) => statement.includes('ID IN (?)'))).toHaveLength(4);
  });

  test('outbox catalog is conditional', async () => {
    const withoutEmails = connection({ omitOutbox: true });
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => withoutEmails });
    await expect(repository.withTransaction(async () => 'ok')).resolves.toBe('ok');
    const withEmails = connection({ omitOutbox: true });
    const required = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => withEmails });
    await expect(required.withTransaction(async () => 'no', { requiresOutbox: true })).rejects.toMatchObject({
      code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', details: { missingTables: expect.arrayContaining([expect.stringContaining('OUTBOX')]) },
    });
  });

  test('appends and lists structured entries with exact physical fields and no DELETE', async () => {
    const conn = connection();
    const repository = createRepartidorLiquidacionDb2Repository({
      runtime: runtime(), connectionFactory: async () => conn,
    });
    await repository.withTransaction(async (tx) => {
      await expect(tx.getStructuredEntryByToken({
        type: 'EXPENSE', idempotencyToken: 'expense-db2-00000001',
      })).resolves.toBeNull();
      await expect(tx.lockBalance({ repartidorId: '94' })).resolves.toEqual({ saldo: 4 });
      await expect(tx.isDayClosed({ repartidorId: '94', date: '2026-08-09' })).resolves.toBe(false);
      await expect(tx.insertStructuredEntry({
        type: 'EXPENSE', repartidorId: '94', date: '2026-08-09', amount: 3,
        category: 'PEAJE', observation: 'AP-7', idempotencyToken: 'expense-db2-00000001',
        actorId: '94', actorRole: 'REPARTIDOR',
      })).resolves.toMatchObject({ type: 'EXPENSE', status: 'PENDING', category: 'PEAJE' });
      await expect(tx.listStructuredEntries({ repartidorId: '94', date: '2026-08-09' }))
        .resolves.toMatchObject({ expenses: [expect.objectContaining({ id: '31' })], closed: false });
    });
    const sql = conn.query.mock.calls.map(([statement]) => statement)
      .filter((statement) => statement.includes('TEST_REPARTIDOR_LIQUIDACION_GASTOS')).join('\n');
    expect(sql).toContain('IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR');
    expect(sql).toContain('STATUS, ACTOR_ID, ACTOR_ROLE');
    expect(sql).not.toMatch(/\bDELETE\b|LIQUIDADO_SN|IDEMPOTENCY_KEY/i);
  });

  test('rolls back and retries once on SQL0803/23505', async () => {
    const conn = connection({ uniqueOnce: true });
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => conn });
    let calls = 0;
    await repository.withTransaction(async (tx) => {
      calls += 1;
      if (calls === 1) {
        await tx.insertOperation({ idempotencyToken: 'token-12345678', marker: 'LQD_123', repartidorId: '94', date: '2026-08-09', replayIdentity: {}, snapshot: { payments: [], breakdown: { bankDeposits: 0, expenses: 0, deliveries: 0 }, openingBalance: 0, balance: 0 }, actorId: '1', actorRole: 'ADMIN' });
      }
      return 'replay';
    });
    expect(calls).toBe(2);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(2);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  test('connection close failure cannot mask committed success', async () => {
    const conn = connection({ closeError: Object.assign(new Error('close'), { code: 'CLOSE_FAILED' }) });
    const logger = { warn: jest.fn(), error: jest.fn() };
    const repository = createRepartidorLiquidacionDb2Repository({ runtime: runtime(), connectionFactory: async () => conn, logger });
    await expect(repository.withTransaction(async () => 'committed')).resolves.toBe('committed');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('repository source contains no ERP writes, global locks, or MAX+1', () => {
    const source = fs.readFileSync(path.join(__dirname, '../repositories/repartidor-liquidacion-db2-repository.js'), 'utf8');
    expect(source).not.toMatch(/DSEDAC|LOCK TABLE|MAX\s*\(/i);
    expect(source).not.toContain('insertLqdMarker');
  });

  test('bootstrap remains disabled if finance capability is not explicitly approved', () => {
    const bootstrap = createRepartidorLiquidacionBootstrap({ runtime: runtime({ financeCapabilityApproved: false }) });
    expect(bootstrap.enabled).toBe(false);
    return expect(bootstrap.service.closeDay()).rejects.toMatchObject({ code: 'LIQUIDACION_CAPABILITY_UNAVAILABLE', statusCode: 503 });
  });

  test('bootstrap enables only after the catalog proves readers and writers', async () => {
    const conn = connection();
    const pool = { connect: jest.fn(async () => conn) };
    const db = { initDb: jest.fn(async () => pool), getPool: jest.fn(() => pool) };
    const bootstrap = createRepartidorLiquidacionBootstrap({
      runtime: runtime(), db,
    });
    expect(bootstrap.configured).toBe(true);
    expect(bootstrap.enabled).toBe(false);
    await expect(bootstrap.repository.withTransaction(async () => 'verified')).resolves.toBe('verified');
    expect(bootstrap.enabled).toBe(true);
    expect(bootstrap.diagnostic.catalogVerified).toBe(true);
  });
});
