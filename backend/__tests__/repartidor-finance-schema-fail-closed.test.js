'use strict';

const fs = require('fs');
const path = require('path');

Object.assign(process.env, {
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
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

const validCobro = {
  codigoCliente: '4300009479',
  codigoRepartidor: '94',
  tipoDocumento: 'CAC',
  origenDocumento: 'B',
  subempresaDocumento: 'GMP',
  ejercicioDocumento: 2026,
  serieDocumento: 'A',
  terminalDocumento: 1,
  numeroDocumento: 42,
  xdeDocumento: 1,
  dexDocumento: 1,
  importeCobrado: 10,
  importePendiente: 0,
  formaPago: 'EFECTIVO',
  idempotencyToken: 'schema-fail-closed-cobro-001',
};

async function expectSchemaUnavailable(promise) {
  try {
    await promise;
    throw new Error('Expected a schema availability error');
  } catch (error) {
    expect(error).toBeInstanceOf(financeService.FinanceSchemaUnavailableError);
    expect(error.code).toBe('REPARTO_SCHEMA_UNAVAILABLE');
    expect(error.statusCode).toBe(503);
  }
}

function expectNoMutations() {
  const sql = [
    ...mockQueryWithParams.mock.calls.map(([statement]) => statement),
    ...mockConnQuery.mock.calls.map(([statement]) => statement),
  ].join('\n').toUpperCase();
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|BEGIN\s+WORK|COMMIT)\b/);
  expect(mockConnQuery).not.toHaveBeenCalled();
}

describe('repartidor finance schema catalog fails closed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['DB2 catalog query rejects', () => mockQueryWithParams.mockRejectedValue(new Error('HYT00 timeout'))],
    ['DB2 catalog is empty', () => mockQueryWithParams.mockResolvedValue([])],
    ['DB2 catalog is malformed', () => mockQueryWithParams.mockResolvedValue([{ TABLE_NAME: 'REPARTIDOR_COBROS', COLUMN_NAME: 'UNKNOWN_COLUMN' }])],
  ])('%s blocks daily finance reads with typed 503', async (_caseName, arrange) => {
    arrange();

    await expectSchemaUnavailable(financeService.getDailySummary({
      repartidorId: '94',
      date: '2026-08-03',
    }));

    expectNoMutations();
  });

  test.each([
    ['DB2 catalog query rejects', () => mockQueryWithParams.mockRejectedValue(new Error('HYT00 timeout'))],
    ['DB2 catalog is empty', () => mockQueryWithParams.mockResolvedValue([])],
    ['DB2 catalog is malformed', () => mockQueryWithParams.mockResolvedValue([{ TABLE_NAME: 'REPARTIDOR_COBROS', COLUMN_NAME: 'UNKNOWN_COLUMN' }])],
  ])('%s blocks cobro before a transaction or write', async (_caseName, arrange) => {
    arrange();

    await expectSchemaUnavailable(financeService.registerCobro(validCobro));

    expectNoMutations();
  });

  test('DB2 42S22 after catalog refresh returns 503 instead of a zero summary', async () => {
    const compatibleCatalog = [
      { TABLE_NAME: 'REPARTIDOR_COBROS', COLUMN_NAME: 'CODIGOVENDEDOR' },
      { TABLE_NAME: 'REPARTIDOR_COBROS', COLUMN_NAME: 'IMPORTEVENCIMIENTO' },
    ];
    const missingColumn = Object.assign(new Error('42S22 column not found'), {
      odbcErrors: [{ state: '42S22' }],
    });
    mockQueryWithParams.mockImplementation((sql) => {
      if (/QSYS2.SYSCOLUMNS/i.test(sql)) return Promise.resolve(compatibleCatalog);
      return Promise.reject(missingColumn);
    });

    await expectSchemaUnavailable(financeService.getDailySummary({
      repartidorId: '94',
      date: '2026-08-03',
    }));

    expect(mockQueryWithParams.mock.calls.filter(([sql]) => /QSYS2.SYSCOLUMNS/i.test(sql))).toHaveLength(2);
    expectNoMutations();
  });

  test('saldo propagates catalog failures instead of returning zero', async () => {
    mockQueryWithParams.mockRejectedValue(new Error('HYT00 timeout'));

    await expectSchemaUnavailable(financeService.getSaldoActual('94'));

    expectNoMutations();
  });
});

describe('repartidor finance detalle ownership binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('binds the owner independently for both vendor columns', async () => {
    mockQueryWithParams.mockResolvedValue([]);

    await expect(financeService.getDetalleVencimiento({
      repartidorId: '94',
      tipo: 'CAC',
      ejercicio: 2026,
      serie: 'A',
      terminal: 1,
      numero: 42,
      xde: 1,
    })).resolves.toBeNull();

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('TRIM(CVC.CODIGOVENDEDOR) = ? OR TRIM(CVC.CODIGOVENDEDORCOBRO) = ?');
    expect(params).toEqual(['CAC', 2026, 'A', 1, 42, 1, '94', '94']);
    expect(params).toHaveLength(8);
  });
});

describe('repartidor finance destructive cleanup is retired', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'repartidor-finance-service.js'),
    'utf8',
  );
  const runtimeSource = fs.readFileSync(
    path.join(__dirname, '..', 'config', 'reparto-runtime.js'),
    'utf8',
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('contains no DELETE against a runtime finance ledger and no DML against finance.lqd', () => {
    expect(source).not.toMatch(/DELETE\s+FROM\s+\$\{FINANCE_TABLES\.[A-Za-z]+\}/i);
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+\$\{FINANCE_TABLES\.lqd\}/i,
    );
  });

  test('canonical finance runtime has no LQD mapping or DSEDAC LQD dependency', () => {
    expect(source).not.toMatch(/(?:FINANCE_TABLES\.)?lqd\b|DSEDAC\.LQD/i);
    expect(runtimeSource).not.toMatch(/(?:lqd\s*:|TEST_LQD|DSEDAC\.LQD)/i);
  });

  test.each(['test', 'production'])('%s cleanup fails closed before every query or connection', async (environment) => {
    const previousEnvironment = process.env.REPARTO_ENVIRONMENT;
    process.env.REPARTO_ENVIRONMENT = environment;
    try {
      await expect(financeService.deleteTestData('cleanup-must-never-run'))
        .rejects.toMatchObject({ code: 'REPARTO_SCHEMA_UNAVAILABLE', statusCode: 503 });
    } finally {
      process.env.REPARTO_ENVIRONMENT = previousEnvironment;
    }

    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
    expect(mockConnClose).not.toHaveBeenCalled();
  });
});
