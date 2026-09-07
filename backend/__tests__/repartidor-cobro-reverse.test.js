'use strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
});

const mockQueryWithParams = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: () => ({
    connect: jest.fn().mockResolvedValue({
      query: (...args) => mockConnQuery(...args),
      close: mockConnClose,
    }),
  }),
  initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(),
}));

const financeService = require('../services/repartidor-finance-service');

const catalogRows = [
  'CODIGOVENDEDOR', 'IMPORTEVENCIMIENTO', 'IDEMPOTENCY_TOKEN', 'LIQUIDADO_SN',
  'DIACOBRO', 'MESCOBRO', 'ANOCOBRO', 'ID',
].map((COLUMN_NAME) => ({ TABLE_NAME: 'REPARTIDOR_COBROS', COLUMN_NAME }));

function sqlLog() {
  return [
    ...mockQueryWithParams.mock.calls.map(([statement]) => statement),
    ...mockConnQuery.mock.calls.map(([statement]) => statement),
  ].join('\n');
}

describe('reverseCobro isolated_test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockResolvedValue(catalogRows);
  });

  test('deletes an open TEST cobro and writes PAYMENT_REVERSED audit', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SET TRANSACTION|LOCK TABLE|COMMIT|ROLLBACK/i.test(sql)) return [];
      if (/SELECT /i.test(sql) && /TEST_REPARTIDOR_COBROS/i.test(sql)) {
        return [{
          ID: 91,
          CODIGOVENDEDOR: '50',
          LIQUIDADO_SN: 'N',
          IMPORTEVENCIMIENTO: 12.5,
          IDEMPOTENCY_TOKEN: 'reverse-ok-0001',
        }];
      }
      if (/DELETE FROM /i.test(sql)) return { count: 1 };
      if (/INSERT INTO /i.test(sql)) return { count: 1 };
      throw new Error(`unexpected sql: ${sql}`);
    });

    const result = await financeService.reverseCobro({
      idempotencyToken: 'reverse-ok-0001',
      repartidorId: '50',
      operador: '50',
      reason: 'Duplicado de prueba',
    });

    expect(result).toMatchObject({ reversed: true, id: '91' });
    const sql = sqlLog();
    expect(sql).toMatch(/DELETE FROM JAVIER\.TEST_REPARTIDOR_COBROS/i);
    expect(sql).toMatch(/INSERT INTO JAVIER\.TEST_REPARTIDOR_COBROS_AUDIT/i);
    const insertCall = mockConnQuery.mock.calls.find(([statement]) => /INSERT INTO /i.test(statement));
    expect(insertCall[1]).toEqual([
      'PAYMENT_REVERSED',
      '50',
      '50',
      expect.stringContaining('reverse-ok-0001'),
    ]);
    expect(sql).not.toMatch(/JAVIER\.(?!TEST_)/);
    expect(sql).not.toMatch(/DSEDAC\./);
  });

  test('returns COBRO_NOT_FOUND without mutating when the token is missing', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SET TRANSACTION|LOCK TABLE|COMMIT|ROLLBACK/i.test(sql)) return [];
      if (/SELECT /i.test(sql)) return [];
      throw new Error(`unexpected sql: ${sql}`);
    });

    await expect(financeService.reverseCobro({
      idempotencyToken: 'missing-token-01',
      repartidorId: '50',
      operador: '50',
      reason: 'No existe',
    })).rejects.toMatchObject({ code: 'COBRO_NOT_FOUND' });

    expect(sqlLog()).not.toMatch(/\bDELETE\b|\bINSERT\b/i);
  });

  test('returns COBRO_ALREADY_LIQUIDADO for a closed cobro', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SET TRANSACTION|LOCK TABLE|COMMIT|ROLLBACK/i.test(sql)) return [];
      if (/SELECT /i.test(sql)) {
        return [{ ID: 7, CODIGOVENDEDOR: '50', LIQUIDADO_SN: 'S' }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    await expect(financeService.reverseCobro({
      idempotencyToken: 'already-liq-0001',
      repartidorId: '50',
      operador: '50',
      reason: 'Cerrado',
    })).rejects.toMatchObject({ code: 'COBRO_ALREADY_LIQUIDADO' });

    expect(sqlLog()).not.toMatch(/\bDELETE\b|\bINSERT\b/i);
  });

  test('denies reversing another driver cobro', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/SET TRANSACTION|LOCK TABLE|COMMIT|ROLLBACK/i.test(sql)) return [];
      if (/SELECT /i.test(sql)) {
        return [{ ID: 3, CODIGOVENDEDOR: '08', LIQUIDADO_SN: 'N' }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    await expect(financeService.reverseCobro({
      idempotencyToken: 'foreign-token-01',
      repartidorId: '50',
      operador: '50',
      reason: 'Ajeno',
    })).rejects.toMatchObject({ code: 'PAYMENT_AUTHZ_DENIED' });
  });
});
