'use strict';

const db = require('../config/db');
const {
  resolveDayMoveTables,
  tryResolveDayOverrideTable,
  monday,
  requestHash,
  assertMoveInput,
  visibleDocumentsSql,
  moveDocuments,
  RuteroDayMoveConflictError,
  RuteroDayMoveUnavailableError,
} = require('../repositories/repartidor-rutero-day-move-db2-repository');

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  acquireConfiguredConnection: jest.fn(),
}));

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    ODBC_DSN: 'GMP',
    REPARTO_WRITES_ENABLED: 'false',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    REPARTIDOR_DAY_MOVE_ENABLED: 'true',
    ...overrides,
  };
}

describe('repartidor rutero day move repository', () => {
  beforeEach(() => jest.clearAllMocks());

  test('resolves only the exact isolated test tables when enabled', () => {
    expect(resolveDayMoveTables(testEnv())).toEqual({
      override: 'JAVIER.TEST_REPARTIDOR_RUTERO_DIA_OVERRIDE',
      requests: 'JAVIER.TEST_REPARTIDOR_RUTERO_MOVE_REQUESTS',
    });
    expect(tryResolveDayOverrideTable(testEnv({
      REPARTIDOR_DAY_MOVE_ENABLED: 'false',
    }))).toBeNull();
  });

  test('rejects invalid dates, outside-week moves and malformed positions', () => {
    expect(monday('2026-08-27')).toBe('2026-08-24');
    expect(monday('2026-02-30')).toBeNull();
    expect(() => assertMoveInput({
      repartidorId: '05', sourceDate: '2026-02-30',
      targetDate: '2026-02-31', position: 0,
      documents: [{ documentId: 'DOC-1' }],
      idempotencyKey: 'move-test-1234',
    })).toThrow(RuteroDayMoveConflictError);
    expect(() => assertMoveInput({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-31',
      position: 0,
      documents: [{ documentId: 'DOC-1' }],
      idempotencyKey: 'move-test-1234',
    })).toThrow(RuteroDayMoveConflictError);
    expect(() => assertMoveInput({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 500,
      documents: [{ documentId: 'DOC-1' }],
      idempotencyKey: 'move-test-1234',
    })).toThrow(RuteroDayMoveConflictError);
    expect(() => assertMoveInput({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 499,
      documents: [{ documentId: 'DOC-1' }, { documentId: 'DOC-2' }],
      idempotencyKey: 'move-test-1234',
    })).toThrow(RuteroDayMoveConflictError);
    expect(() => assertMoveInput({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 0,
      documents: [{ documentId: 'DOC-1' }],
      idempotencyKey: 'short',
    })).toThrow(RuteroDayMoveConflictError);
  });

  test('visible document SQL is read-only against DSEDAC and owner-scoped', () => {
    const result = visibleDocumentsSql({
      override: 'JAVIER.TEST_REPARTIDOR_RUTERO_DIA_OVERRIDE',
      documents: [{ documentId: '2026-A-1-10-C1' }],
    });
    expect(result.sql).toContain('FROM DSEDAC.OPP');
    expect(result.sql).toContain('LEFT JOIN JAVIER.TEST_REPARTIDOR_RUTERO_DIA_OVERRIDE');
    expect(result.sql).toContain('TRIM(OPP.CODIGOREPARTIDOR) = ?');
    expect(result.sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  test('moves documents atomically and returns an acknowledgement', async () => {
    const connection = {
      query: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      close: jest.fn(),
    };
    connection.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT REQUEST_HASH')) return [];
      if (sql.startsWith('SELECT DOCUMENT_ID, VERSION')) return [];
      if (sql.startsWith('SELECT TRIM(VARCHAR(CPC.EJERCICIOALBARAN))')) {
        return [
          { DOCUMENT_ID: '2026-A-1-10-C1', CLIENTE: 'C1' },
          { DOCUMENT_ID: '2026-A-1-11-C2', CLIENTE: 'C2' },
        ];
      }
      return [];
    });
    db.acquireConfiguredConnection.mockResolvedValue(connection);

    const result = await moveDocuments({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 2,
      documents: [
        { documentId: '2026-A-1-10-C1', cliente: 'C1' },
        { documentId: '2026-A-1-11-C2', cliente: 'C2' },
      ],
      updatedBy: '05',
      idempotencyKey: 'move-test-1234',
      env: testEnv(),
    });

    expect(result).toMatchObject({
      replayed: false,
      targetDate: '2026-08-25',
      position: 2,
      affectedDocuments: ['2026-A-1-10-C1', '2026-A-1-11-C2'],
    });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(connection.query.mock.calls.some(([sql]) => /INSERT INTO DSEDAC/.test(sql))).toBe(false);
  });

  test('rejects reuse of an idempotency key for a different request', async () => {
    const connection = {
      query: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      close: jest.fn(),
    };
    connection.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT REQUEST_HASH')) {
        return [{
          REQUEST_HASH: 'wrong',
          STATUS: 'APPLIED',
          DOCUMENT_IDS: 'DOC-1',
          TARGET_DATE: '2026-08-25',
          TARGET_POSITION: 0,
        }];
      }
      return [];
    });
    db.acquireConfiguredConnection.mockResolvedValue(connection);

    await expect(moveDocuments({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 0,
      documents: [{ documentId: 'DOC-1' }],
      idempotencyKey: 'move-test-1234',
      env: testEnv(),
    })).rejects.toMatchObject({ code: 'RUTERO_MOVE_IDEMPOTENCY_CONFLICT' });
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
  test('replays an identical idempotency request without rewriting', async () => {
    const connection = {
      query: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      close: jest.fn(),
    };
    const input = {
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 0,
      documents: [{ documentId: 'DOC-1' }],
    };
    connection.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT REQUEST_HASH')) {
        return [{
          REQUEST_HASH: requestHash(input),
          STATUS: 'APPLIED',
          DOCUMENT_IDS: 'DOC-1',
          TARGET_DATE: '2026-08-25',
          TARGET_POSITION: 0,
        }];
      }
      return [];
    });
    db.acquireConfiguredConnection.mockResolvedValue(connection);

    await expect(moveDocuments({
      repartidorId: '05',
      ...input,
      idempotencyKey: 'move-test-1234',
      env: testEnv(),
    })).resolves.toMatchObject({
      replayed: true,
      affectedDocuments: ['DOC-1'],
    });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.query.mock.calls.some(([sql]) => /INSERT|DELETE/i.test(sql))).toBe(false);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  test('fails closed when the transaction contract is unavailable', async () => {
    db.acquireConfiguredConnection.mockResolvedValue(null);
    await expect(moveDocuments({
      repartidorId: '05',
      sourceDate: '2026-08-24',
      targetDate: '2026-08-25',
      position: 0,
      documents: [{ documentId: 'DOC-1' }],
      idempotencyKey: 'move-test-1234',
      env: testEnv(),
    })).rejects.toBeInstanceOf(RuteroDayMoveUnavailableError);
  });
});
