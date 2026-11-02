'use strict';

const {
  classifyFormaPago,
  isPagareFormaPago,
  buildComercialLiquidacionSummary,
  parseIsoDate,
  sanitizeVendorCodes,
  listReturns,
  listPgCollectedDocuments,
  getDailyCobrosByFormaPago,
  getLqdForVendorDay,
  getDailySummary,
  saveLiquidacion,
  registerReturn,
  parseDiasFormaPago,
  lookupFormaPagoDias,
  addDaysIso,
  isColumnMissingError,
} = require('../services/comercial-devoluciones-service');

const mockQueryWithParams = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockClose = jest.fn();
const mockOpenDedicatedConnection = jest.fn();

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../adapters/pedidos-transaction-connection', () => ({
  openDedicatedPedidosTransactionConnection: (...args) => mockOpenDedicatedConnection(...args),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../utils/db2-schemas', () => ({
  db2AppTable: () => 'JAVIER.COBROS',
}));

describe('comercial devoluciones domain', () => {
  test('does not treat ALL as a vendor code', () => {
    expect(sanitizeVendorCodes(['ALL', '80', '72'])).toEqual(['80', '72']);
  });

  test('parses ISO dates and rejects invalid values', () => {
    expect(parseIsoDate('2026-05-31')).toEqual({
      year: 2026,
      month: 5,
      day: 31,
      iso: '2026-05-31',
    });
    expect(parseIsoDate('31-5-26')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('2026-11-31')).toBeNull();
    expect(parseIsoDate('2024-02-29')).toEqual({
      year: 2024,
      month: 2,
      day: 29,
      iso: '2024-02-29',
    });
    expect(parseIsoDate('2025-02-29')).toBeNull();
  });

  test('classifies commercial vs repartidor payment methods', () => {
    expect(classifyFormaPago('CONTADO')).toBe('EFECTIVO');
    expect(classifyFormaPago('TJ')).toBe('TARJETA');
    expect(classifyFormaPago('TARJETA')).toBe('TARJETA');
    expect(classifyFormaPago('TR')).toBe('TRANSFERENCIA');
    expect(classifyFormaPago('T0')).toBe('TRANSFERENCIA');
    expect(classifyFormaPago('CHEQUE')).toBe('CHEQUES');
    expect(classifyFormaPago('POSTDATADO')).toBe('POSTDATADOS');
    expect(classifyFormaPago('CTR')).toBe('REPARTIDOR');
    expect(classifyFormaPago('PG')).toBe('POSTDATADOS');
    expect(classifyFormaPago('P1')).toBe('POSTDATADOS');
  });

  test('detects ODBC 42S22 from state even if message omits SQLSTATE', () => {
    const error = Object.assign(new Error('[odbc] Error preparing the SQL statement'), {
      odbcErrors: [{ state: '42S22', code: -206 }],
    });
    expect(isColumnMissingError(error)).toBe(true);
  });

  test('reads FPG days from PRIMERPAGO and never hardcodes 30', () => {
    expect(parseDiasFormaPago({ primerPago: 30, descripcion: 'PAGARE 30 DFF' })).toBe(30);
    expect(parseDiasFormaPago({ primerPago: 75, descripcion: 'PAGARE 75 DFF' })).toBe(75);
    expect(parseDiasFormaPago({ primerPago: 0, descripcion: 'PAGARE 60 DFF' })).toBe(60);
    expect(parseDiasFormaPago({ primerPago: 0, descripcion: 'PAGARE' })).toBeNull();
    expect(addDaysIso('2025-12-24', 30)).toBe('2026-01-23');
    expect(addDaysIso('2025-10-23', 75)).toBe('2026-01-06');
  });

  test('does not subtract returns from the amount to deposit', () => {
    const summary = buildComercialLiquidacionSummary({
      totalEfectivo: 1000,
      totalCheques: 0,
      totalPostdatados: 0,
      saldoActual: 0,
      devolucionesYaCobradas: -1000,
    });
    expect(summary.devolucionesYaCobradas).toBe(1000);
    expect(summary.totalAIngresar).toBe(1000);
    expect(summary.cashImpactHypothesis).toBe('lqd_importetotalaingresar_no_subtract_returns');
  });

  test('uses LQD.IMPORTETOTALAINGRESAR when provided', () => {
    const summary = buildComercialLiquidacionSummary({
      totalEfectivo: 1000,
      devolucionesYaCobradas: 1000,
      totalAIngresar: 2500,
      source: 'DSEDAC.LQD',
    });
    expect(summary.totalAIngresar).toBe(2500);
    expect(summary.source).toBe('DSEDAC.LQD');
  });

  test('cash total excludes card, transfer, cheques and postdated methods', () => {
    const summary = buildComercialLiquidacionSummary({
      totalEfectivo: 100,
      totalTarjeta: 70,
      totalTransferencia: 60,
      totalCheques: 50,
      totalPostdatados: 40,
      saldoActual: 29.15,
    });
    expect(summary.totalAIngresar).toBe(129.15);
    expect(summary.totalTarjeta).toBe(70);
    expect(summary.totalTransferencia).toBe(60);
  });
});

describe('listReturns', () => {
  beforeEach(() => {
    mockQueryWithParams.mockReset();
    delete process.env.REPARTO_TABLE_SET;
  });

  test('queries LACLAE return documents with bound vendor and date', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{
      YEAR: 2026,
      MONTH: 5,
      DAY: 31,
      SERIE: 'D',
      NUMERO: 12,
      CLIENTE: '4300000354',
      VENDEDOR: '80',
      AMOUNT: '-1000',
      UNITS: '-4',
      YA_COBRADA: 1,
      FORMA_PAGO: 'PAGARE',
    }]);

    const returns = await listReturns({
      vendorCodes: ['80'],
      date: '2026-05-31',
    });

    expect(returns).toEqual([
      expect.objectContaining({
        documento: 'D-12',
        cliente: '4300000354',
        amount: -1000,
        date: '2026-05-31',
        yaCobrada: true,
      }),
    ]);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/DSED\.LACLAE/);
    expect(sql).toMatch(/LEFT JOIN DSEDAC\.CVC CVC/);
    expect(sql).toMatch(/LEFT JOIN DSEDAC\.FPG FPG/);
    expect(sql).toMatch(/TIPODOCUMENTO\) = 'DEV'/);
    expect(sql).toMatch(/FPG\.PRIMERPAGO/);
    expect(sql).not.toMatch(/NUMERODIASVENCIMIENTO/);
    expect(sql).toMatch(/L\.LCSRAB = \? OR L\.LCTPVT = \?/);
    expect(sql).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
    expect(sql).not.toMatch(/VISTA_DEUDA_BASE/i);
    expect(params).toEqual(['D', 'DV', 2026, 5, 31, '80']);
  });

  test('rejects invalid dates before touching DB2', async () => {
    await expect(listReturns({ vendorCodes: ['80'], date: 'ayer' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

describe('getDailySummary', () => {
  beforeEach(() => {
    mockQueryWithParams.mockReset();
    delete process.env.REPARTO_TABLE_SET;
  });

  test('combines commercial cash with the latest ERP residual and keeps methods informative', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/JAVIER\.COBROS/i.test(sql)) return [
        { FORMA_PAGO: 'CONTADO', TOTAL: '1000', FILAS: 2 },
        { FORMA_PAGO: 'TJ', TOTAL: '50', FILAS: 1 },
        { FORMA_PAGO: 'TR', TOTAL: '25', FILAS: 1 },
      ];
      if (/DSED\.LACLAE/i.test(sql)) return [{
        YEAR: 2026, MONTH: 5, DAY: 31, SERIE: 'D', NUMERO: 1,
        CLIENTE: 'C1', VENDEDOR: '80', AMOUNT: '-1000', UNITS: '-1', YA_COBRADA: 1,
      }];
      if (/DSEDAC\.LQD/i.test(sql)) return [{
        VENDEDOR: '80', TOTAL_EFECTIVO: 100, TOTAL_CHEQUES: 0,
        TOTAL_POSTDATADOS: 0, TOTAL_TARJETA: 0, TOTAL_A_INGRESAR: 1314.15,
        INGRESO_BANCO: 1285, GASTOS: 0, EFECTIVO_2: 0, ENTREGADO_2: 0,
        NUMERO_LIQUIDACION: 170, ID: 13178742,
      }];
      return [];
    });

    const result = await getDailySummary({ vendorCodes: ['80'], date: '2026-05-31' });
    expect(result.summary).toEqual(expect.objectContaining({
      totalEfectivo: 1000,
      totalTarjeta: 50,
      totalTransferencia: 25,
      saldoActual: 29.15,
      devolucionesYaCobradas: 1000,
      totalAIngresar: 1029.15,
    }));
    expect(result.cobros.count).toBe(4);
    const cobrosSql = mockQueryWithParams.mock.calls.find(([sql]) => /JAVIER\.COBROS/i.test(sql))[0];
    expect(cobrosSql).toMatch(/TIPO_USUARIO/);
  });

  test('uses one latest LQD row per vendor, never a historical SUM', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/JAVIER\.COBROS/i.test(sql)) return [{ FORMA_PAGO: 'CONTADO', TOTAL: 1000, FILAS: 1 }];
      if (/DSEDAC\.LQD/i.test(sql)) return [{
        VENDEDOR: '80', TOTAL_A_INGRESAR: 2500, INGRESO_BANCO: 2400,
        GASTOS: 0, EFECTIVO_2: 0, ENTREGADO_2: 0, NUMERO_LIQUIDACION: 170, ID: 1,
      }];
      return [];
    });
    const result = await getDailySummary({ vendorCodes: ['80'], date: '2026-05-31' });
    expect(result.summary.saldoActual).toBe(100);
    expect(result.summary.totalAIngresar).toBe(1100);
    const sql = mockQueryWithParams.mock.calls.find(([text]) => /DSEDAC\.LQD/i.test(text))[0];
    expect(sql).toMatch(/ROW_NUMBER\(\)/);
    expect(sql).toMatch(/HORALIQUIDACION DESC/);
    expect(sql).toMatch(/NUMEROLIQUIDACION DESC/);
    expect(sql).toMatch(/ID DESC/);
    expect(sql).not.toMatch(/SUM\(LQD\.IMPORTETOTALAINGRESAR/i);
  });

  test('isolated_test still reads live DSEDAC.LQD and never TEST_LQD', async () => {
    const restore = isolatedWriteEnv();
    try {
    mockQueryWithParams.mockImplementation((sql) => {
        if (/TEST_COBROS|JAVIER\.COBROS/i.test(sql) && /FORMA_PAGO/i.test(sql)) {
          return [{ FORMA_PAGO: 'CONTADO', TOTAL: 12.34, FILAS: 1 }];
        }
        if (/DSEDAC\.LQD/i.test(sql)) return [{
          VENDEDOR: '35', TOTAL_A_INGRESAR: 1411.8, INGRESO_BANCO: 1400,
          GASTOS: 0, EFECTIVO_2: 0, ENTREGADO_2: 0, NUMERO_LIQUIDACION: 170, ID: 1,
        }];
        return [];
      });
      const result = await getDailySummary({ vendorCodes: ['35'], date: '2026-09-16' });
      expect(result.lqd).toEqual(expect.objectContaining({ saldoActual: 11.8, source: 'DSEDAC.LQD' }));
      expect(result.summary.totalAIngresar).toBe(24.14);
      expect(mockQueryWithParams.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/TEST_LQD/);
    } finally {
      restore();
    }
  });

  test('latest LQD query returns zero carry explicitly when no row exists', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);
    await expect(getLqdForVendorDay({ vendorCodes: ['35'], date: '2026-11-02' }))
      .resolves.toEqual(expect.objectContaining({ saldoActual: 0, filas: 0, source: 'DSEDAC.LQD' }));
  });

  test('counts registered commercial collections instead of requiring a positive sum', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ FORMA_PAGO: 'CONTADO', TOTAL: 0, FILAS: 1 }]);
    const totals = await getDailyCobrosByFormaPago({ vendorCodes: ['35'], date: '2026-11-02' });
    expect(totals.count).toBe(1);
    expect(totals.totalEfectivo).toBe(0);
  });
});

function isolatedWriteEnv() {
  const previous = {};
  const env = {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'true',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  };
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

describe('TEST-only commercial writes', () => {
  let restoreEnv;

  beforeEach(() => {
    mockQueryWithParams.mockReset();
    mockBeginTransaction.mockReset().mockResolvedValue(undefined);
    mockCommit.mockReset().mockResolvedValue(undefined);
    mockRollback.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockOpenDedicatedConnection.mockReset().mockResolvedValue({
      query: (...args) => mockQueryWithParams(...args),
      beginTransaction: mockBeginTransaction,
      commit: mockCommit,
      rollback: mockRollback,
      close: mockClose,
    });
    restoreEnv = isolatedWriteEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('saveLiquidacion inserts JAVIER.TEST_LIQUIDACION_COMERCIAL and never DSEDAC', async () => {
    let liquidacionSelects = 0;
    mockQueryWithParams.mockImplementation((sql) => {
      if (/SET TRANSACTION|LOCK TABLE/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql)) {
        liquidacionSelects += 1;
        if (liquidacionSelects < 3) return [];
        return [{
          VENDEDOR: '80', FECHA: '2026-09-11', INGRESO_BANCO: 120, ENTREGADO: 80,
          TOTAL_ESPERADO: 200, TOTAL_EFECTIVO: 200, TOTAL_CHEQUES: 0,
          TOTAL_POSTDATADOS: 0, SALDO_ACTUAL: 0, DEVOLUCIONES_YA_COBRADAS: 0,
          TOTAL_A_INGRESAR: 200, STATUS: 'SAVED', ['TOKEN']: 'liq-80-2026-09-11',
          REVISION: '2026-11-02-10.11.12.123456',
        }];
      }
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [{ FORMA_PAGO: 'CONTADO', TOTAL: 200, FILAS: 1 }];
      if (/FROM DSEDAC\.LQD/i.test(sql)) return [];
      return [];
    });

    const saved = await saveLiquidacion({
      vendorCodes: ['80'],
      date: '2026-09-11',
      ingresoBanco: 120,
      entregado: 80,
      expectedTotal: 200,
      totals: { totalAIngresar: 999999, saldoActual: 999999 },
      idempotencyToken: 'liq-80-2026-09-11',
      createdBy: '80',
    });

    expect(saved.source).toBe('JAVIER.TEST_LIQUIDACION_COMERCIAL');
    expect(saved.ingresoBanco).toBe(120);
    expect(saved.totalAIngresar).toBe(200);
    const insertSql = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO/i.test(sql))[0];
    expect(insertSql).toMatch(/JAVIER\.TEST_LIQUIDACION_COMERCIAL/);
    expect(insertSql).not.toMatch(/DSEDAC/i);
    expect(insertSql).not.toMatch(/VISTA_DEUDA_BASE/i);
    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  test('replay compares date, vendor and actions and returns persisted amounts first', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/SET TRANSACTION|LOCK TABLE/i.test(sql)) return [];
      if (/WHERE IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [{
        VENDEDOR: '80', FECHA: '2026-09-11', INGRESO_BANCO: 120, ENTREGADO: 80,
        TOTAL_ESPERADO: 200, TOTAL_EFECTIVO: 170, TOTAL_CHEQUES: 99,
        TOTAL_POSTDATADOS: 88, SALDO_ACTUAL: 30, DEVOLUCIONES_YA_COBRADAS: 0,
        TOTAL_A_INGRESAR: 200, STATUS: 'SAVED', ['TOKEN']: 'liq-replay',
        REVISION: '2026-11-02-10.11.12.123456',
      }];
      throw new Error(`unexpected SQL after replay: ${sql}`);
    });
    const saved = await saveLiquidacion({
      vendorCodes: ['80'], date: '2026-09-11', ingresoBanco: 120, entregado: 80,
      expectedTotal: 999, totals: { totalAIngresar: 999 }, idempotencyToken: 'liq-replay',
    });
    expect(saved).toEqual(expect.objectContaining({
      idempotent: true, totalEsperado: 200, totalAIngresar: 200,
      revision: '2026-11-02-10.11.12.123456',
    }));
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /JAVIER\.COBROS/i.test(sql))).toBe(false);
  });

  test('new closure requires at least one registered commercial collection', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/LOCK TABLE/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql)) return [];
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });
    await expect(saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 0, entregado: 0,
      idempotencyToken: 'liq-no-cobros',
    })).rejects.toMatchObject({ code: 'LIQUIDACION_NO_COMMERCIAL_COLLECTIONS', status: 409 });
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });

  test('nonzero unsupported ERP auxiliary amounts block a new closure after replay', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/LOCK TABLE/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql)) return [];
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [{ FORMA_PAGO: 'CONTADO', TOTAL: 100, FILAS: 1 }];
      if (/FROM DSEDAC\.LQD/i.test(sql)) return [{
        VENDEDOR: '80', TOTAL_A_INGRESAR: 100, INGRESO_BANCO: 90,
        GASTOS: 1, EFECTIVO_2: 0, ENTREGADO_2: 0, NUMERO_LIQUIDACION: 170, ID: 1,
      }];
      return [];
    });
    await expect(saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 100, entregado: 10,
      idempotencyToken: 'liq-aux-block',
    })).rejects.toMatchObject({ code: 'LIQUIDACION_ERP_AUXILIARY_UNSUPPORTED', status: 409 });
  });

  test('optimistic revision prevents a stale retry from overwriting a newer SAVED edit', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/LOCK TABLE/i.test(sql)) return [];
      if (/WHERE IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql) && /FECHA = \?/i.test(sql)) return [{
        VENDEDOR: '80', FECHA: '2026-11-02', INGRESO_BANCO: 110, ENTREGADO: 20,
        TOTAL_ESPERADO: 130, TOTAL_EFECTIVO: 100, TOTAL_CHEQUES: 0,
        TOTAL_POSTDATADOS: 0, SALDO_ACTUAL: 30, DEVOLUCIONES_YA_COBRADAS: 0,
        TOTAL_A_INGRESAR: 130, STATUS: 'SAVED', ['TOKEN']: 'newer-token',
        REVISION: '2026-11-02-10.11.13.000002',
      }];
      return [];
    });
    await expect(saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 100, entregado: 30,
      idempotencyToken: 'old-token', expectedRevision: '2026-11-02-10.11.12.000001',
    })).rejects.toMatchObject({ code: 'LIQUIDACION_STALE_REVISION', status: 409 });
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /^\s*UPDATE/i.test(sql))).toBe(false);
  });

  test('new token with the same actions recalculates and updates the current revision', async () => {
    let dayReads = 0;
    mockQueryWithParams.mockImplementation((sql) => {
      if (/SET TRANSACTION|LOCK TABLE/i.test(sql)) return [];
      if (/WHERE IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql) && /FECHA = \?/i.test(sql)) {
        dayReads += 1;
        return dayReads === 1 ? [{
          VENDEDOR: '80', FECHA: '2026-11-02', INGRESO_BANCO: 80, ENTREGADO: 20,
          TOTAL_ESPERADO: 100, TOTAL_EFECTIVO: 90, TOTAL_CHEQUES: 0,
          TOTAL_POSTDATADOS: 0, SALDO_ACTUAL: 10, DEVOLUCIONES_YA_COBRADAS: 0,
          TOTAL_A_INGRESAR: 100, STATUS: 'SAVED', ['TOKEN']: 'old-token',
          REVISION: '2026-11-02-10.11.12.000001',
        }] : [{
          VENDEDOR: '80', FECHA: '2026-11-02', INGRESO_BANCO: 80, ENTREGADO: 20,
          TOTAL_ESPERADO: 130, TOTAL_EFECTIVO: 100, TOTAL_CHEQUES: 0,
          TOTAL_POSTDATADOS: 0, SALDO_ACTUAL: 30, DEVOLUCIONES_YA_COBRADAS: 0,
          TOTAL_A_INGRESAR: 130, STATUS: 'SAVED', ['TOKEN']: 'new-token',
          REVISION: '2026-11-02-10.11.13.000002',
        }];
      }
      if (/FROM JAVIER\.COBROS/i.test(sql)) {
        return [{ FORMA_PAGO: 'CONTADO', TOTAL: 100, FILAS: 1 }];
      }
      if (/FROM DSEDAC\.LQD/i.test(sql)) return [{
        VENDEDOR: '80', TOTAL_A_INGRESAR: 40, INGRESO_BANCO: 10,
        GASTOS: 0, EFECTIVO_2: 0, ENTREGADO_2: 0, NUMERO_LIQUIDACION: 170, ID: 1,
      }];
      return [];
    });

    const saved = await saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 80, entregado: 20,
      idempotencyToken: 'new-token', expectedRevision: '2026-11-02-10.11.12.000001',
    });

    expect(saved).toEqual(expect.objectContaining({
      idempotent: false,
      token: 'new' + '-token',
      totalAIngresar: 130,
      revision: '2026-11-02-10.11.13.000002',
    }));
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /^\s*UPDATE/i.test(sql))).toBe(true);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM JAVIER\.COBROS/i.test(sql))).toBe(true);
  });

  test.each([
    ['missing row', []],
    ['wrong token', [{
      VENDEDOR: '80', FECHA: '2026-11-02', INGRESO_BANCO: 10, ENTREGADO: 0,
      TOTAL_ESPERADO: 10, TOTAL_EFECTIVO: 10, TOTAL_CHEQUES: 0,
      TOTAL_POSTDATADOS: 0, SALDO_ACTUAL: 0, DEVOLUCIONES_YA_COBRADAS: 0,
      TOTAL_A_INGRESAR: 10, STATUS: 'SAVED', ['TOKEN']: 'other-token',
      REVISION: '2026-11-02-10.11.12.123456',
    }]],
  ])('rolls back when persistence read-back has %s', async (_label, persistedRows) => {
    let liquidacionSelects = 0;
    mockQueryWithParams.mockImplementation((sql) => {
      if (/SET TRANSACTION|LOCK TABLE/i.test(sql)) return [];
      if (/FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql)) {
        liquidacionSelects += 1;
        return liquidacionSelects < 3 ? [] : persistedRows;
      }
      if (/FROM JAVIER\.COBROS/i.test(sql)) {
        return [{ FORMA_PAGO: 'CONTADO', TOTAL: 10, FILAS: 1 }];
      }
      if (/FROM DSEDAC\.LQD/i.test(sql)) return [];
      return [];
    });

    await expect(saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 10, entregado: 0,
      idempotencyToken: 'expected-token',
    })).rejects.toMatchObject({
      code: 'LIQUIDACION_PERSISTENCE_NOT_CONFIRMED',
      status: 503,
    });
    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  test('rejects non-finite action inputs before opening a transaction', async () => {
    await expect(saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 'NaN', entregado: 0,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(mockOpenDedicatedConnection).not.toHaveBeenCalled();
  });

  test('requires an idempotency token before opening a transaction', async () => {
    await expect(saveLiquidacion({
      vendorCodes: ['80'], date: '2026-11-02', ingresoBanco: 10, entregado: 0,
    })).rejects.toMatchObject({ code: 'LIQUIDACION_IDEMPOTENCY_REQUIRED', status: 400 });
    expect(mockOpenDedicatedConnection).not.toHaveBeenCalled();
  });

  test('saveLiquidacion refuses writes outside isolated_test', async () => {
    process.env.REPARTO_TABLE_SET = 'production';
    process.env.REPARTO_ENVIRONMENT = 'production';
    process.env.NODE_ENV = 'production';
    process.env.REPARTO_WRITES_ENABLED = 'false';
    process.env.REPARTIDOR_FINANCE_ERP_SCHEMA = 'DSEDAC';
    await expect(saveLiquidacion({
      vendorCodes: ['80'],
      date: '2026-09-11',
      ingresoBanco: 10,
      entregado: 0,
      expectedTotal: 10,
    })).rejects.toMatchObject({ code: 'WRITES_TEST_ONLY', status: 409 });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('registerReturn inserts TEST overlay without touching LACLAE', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/IDEMPOTENCY_TOKEN/i.test(sql) && /SELECT/i.test(sql)) {
        return Promise.resolve([]);
      }
      if (/MAX\(NUMERO\)/i.test(sql)) return Promise.resolve([{ LAST_NUM: 3 }]);
      return Promise.resolve([]);
    });

    const created = await registerReturn({
      vendorCodes: ['80'],
      date: '2026-09-11',
      clientCode: '4300000354',
      amount: 1000,
      yaCobrada: true,
      documentoOrigen: 'F-88',
      idempotencyToken: 'dev-80-2026-09-11-c1',
    });

    expect(created.documento).toBe('D-4');
    expect(created.amount).toBe(-1000);
    expect(created.yaCobrada).toBe(true);
    expect(created.source).toBe('JAVIER.TEST_DEVOLUCIONES_COMERCIAL');
    const insertSql = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO/i.test(sql))[0];
    expect(insertSql).toMatch(/JAVIER\.TEST_DEVOLUCIONES_COMERCIAL/);
    expect(insertSql).not.toMatch(/DSED\.LACLAE/);
    expect(insertSql).not.toMatch(/DSEDAC/i);
  });

  test('listReturns merges TEST overlay without double-counting ERP docs', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/DSED\.LACLAE/i.test(sql)) {
        return [{
          YEAR: 2026, MONTH: 9, DAY: 11, SERIE: 'D', NUMERO: 1,
          CLIENTE: 'C1', VENDEDOR: '80', AMOUNT: '-400', UNITS: '-1', YA_COBRADA: 1,
        }];
      }
      if (/TEST_DEVOLUCIONES_COMERCIAL/i.test(sql)) {
        return [{
          YEAR: 2026, MONTH: 9, DAY: 11, SERIE: 'D', NUMERO: 1,
          CLIENTE: 'C1', VENDEDOR: '80', AMOUNT: '-400', UNITS: '-1', YA_COBRADA: 1,
          DOCUMENTO_ORIGEN: 'F-1',
        }, {
          YEAR: 2026, MONTH: 9, DAY: 11, SERIE: 'D', NUMERO: 9,
          CLIENTE: 'C2', VENDEDOR: '80', AMOUNT: '-250', UNITS: '-1', YA_COBRADA: 1,
        }];
      }
      return [];
    });

    const returns = await listReturns({ vendorCodes: ['80'], date: '2026-09-11' });
    expect(returns).toHaveLength(2);
    expect(returns.map((item) => item.documento).sort()).toEqual(['D-1', 'D-9']);
  });
});

describe('pizarra PG ya cobrados', () => {
  let restoreEnv;

  beforeEach(() => {
    mockQueryWithParams.mockReset();
    restoreEnv = isolatedWriteEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('lists CVC pagarés via FPG.PAGARESN without writing DSEDAC', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{
      CLIENTE: '4300010001',
      TIPO: 'PAG',
      SERIE: 'M',
      NUMERO: 88,
      TERM_DOC: 1,
      IMPORTE: '1000',
      PENDIENTE: '0',
      FP: 'P1',
      FP_DESC: 'PAGARE 30 DFF',
      PAGARESN: 'S',
      ANO: 2026,
      MES: 5,
      DIA: 31,
      ANOV: 2026,
      MESV: 8,
      DIAV: 31,
      SERIE_ALB: 'P',
      TERM_ALB: 2,
      NUM_ALB: 1,
      SERIE_FAC: 'F',
      TERM_FAC: 1,
      NUM_FAC: 1,
      DIAS_FP: 30,
    }]);

    const docs = await listPgCollectedDocuments({ vendorCodes: ['80'] });
    expect(docs[0]).toMatchObject({
      cliente: '4300010001',
      formaPago: 'P1',
      pagare: true,
      vencimiento: '2026-08-31',
      vencimientoCalculado: '2026-06-30',
      vencimientoSource: 'CVC.ANOVENCIMIENTO',
      albaran: 'P-2-1',
      factura: 'F-1-1',
      formaPagoDias: 30,
      formaPagoDiasLabel: '30 D F.Factura',
      pendienteTecnicoMovimiento: false,
      impactoLqd: 'YA_COBRADOS',
    });
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/DSEDAC\.CVC/);
    expect(sql).toMatch(/DSEDAC\.FPG/);
    expect(sql).toMatch(/DSEDAC\.CAC/);
    expect(sql).toMatch(/DSEDAC\.CPC/);
    expect(sql).toMatch(/EJERCICIOFACTURA/);
    expect(sql).toMatch(/TERMINALFACTURA/);
    expect(sql).toMatch(/TERMINALALBARAN/);
    expect(sql).toMatch(/PRIMERPAGO/);
    expect(sql).not.toMatch(/NUMERODIASVENCIMIENTO/);
    expect(sql).toMatch(/IMPORTEPENDIENTE = 0/);
    expect(sql).toMatch(/CODIGOCLIENTEFACTURA/);
    expect(sql).toMatch(/TIPODOCUMENTO = CAST\(\? AS CHAR\(3\)\)/);
    expect(sql).toMatch(/PAGARESN = CAST\(\? AS CHAR\(1\)\)/);
    expect(sql).toMatch(/CAC\.CODIGOVENDEDOR/);
    expect(sql).toMatch(/LEFT JOIN DSEDAC\.CAC/);
    expect(sql).toMatch(/TRIM\(CAC\.SERIEFACTURA\) = TRIM\(CVC\.SERIEDOCUMENTO\)/);
    expect(sql).toMatch(/TRIM\(CAC\.CODIGOVENDEDOR\)/);
    expect(sql).not.toMatch(/INSERT INTO DSEDAC|UPDATE DSEDAC|DELETE FROM DSEDAC/i);
    expect(sql).not.toMatch(/VISTA_DEUDA_BASE/i);
    expect(params[0]).toBe('PAG');
    expect(params[1]).toBe('S');
  });

  test('lists P2 75 D F.Factura from PRIMERPAGO not 30', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{
      CLIENTE: '4300008587',
      TIPO: 'PAG',
      SERIE: 'F',
      NUMERO: 1244,
      TERM_DOC: 0,
      IMPORTE: '659.29',
      PENDIENTE: '0',
      FP: 'P2',
      FP_DESC: 'PAGARE 75 DFF',
      PAGARESN: 'S',
      ANO: 2025,
      MES: 10,
      DIA: 23,
      ANOV: 2026,
      MESV: 1,
      DIAV: 10,
      SERIE_ALB: 'P',
      TERM_ALB: 2,
      NUM_ALB: 483,
      SERIE_FAC: 'F',
      TERM_FAC: 0,
      NUM_FAC: 1244,
      DIAS_FP: 75,
    }]);
    const docs = await listPgCollectedDocuments({ vendorCodes: ['02'] });
    expect(docs[0].formaPagoDias).toBe(75);
    expect(docs[0].formaPagoDiasLabel).toBe('75 D F.Factura');
    expect(docs[0].vencimiento).toBe('2026-01-10');
    expect(docs[0].vencimientoCalculado).toBe('2026-01-06');
    expect(docs[0].albaran).toBe('P-2-483');
  });

  test('lookupFormaPagoDias reads PRIMERPAGO', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ DIAS: 60, DESC: 'PAGARE 60 DFF' }]);
    await expect(lookupFormaPagoDias('P6')).resolves.toBe(60);
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/PRIMERPAGO/);
    expect(sql).not.toMatch(/NUMERODIASVENCIMIENTO/);
  });

  test('registerReturn keeps PG already-collected impact on TEST overlay', async () => {
    mockQueryWithParams.mockImplementation((sql) => {
      if (/IDEMPOTENCY_TOKEN/i.test(sql) && /SELECT/i.test(sql)) {
        return Promise.resolve([]);
      }
      if (/MAX\(NUMERO\)/i.test(sql)) return Promise.resolve([{ LAST_NUM: 1 }]);
      return Promise.resolve([]);
    });

    const created = await registerReturn({
      vendorCodes: ['80'],
      date: '2026-05-31',
      clientCode: '4300010001',
      amount: 1000,
      formaPago: 'PG',
      albaranOrigen: 'P-2-1',
      vencimiento: '2026-08-31',
      documentoOrigen: 'M-88',
      idempotencyToken: 'dev-pg-pizarra',
    });

    expect(created.yaCobrada).toBe(true);
    expect(created.impactoLqd).toBe('YA_COBRADOS');
    expect(created.formaPago).toBe('PG');
    expect(isPagareFormaPago('P1')).toBe(true);
    const insertSql = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO/i.test(sql))[0];
    expect(insertSql).toMatch(/JAVIER\.TEST_DEVOLUCIONES_COMERCIAL/);
    expect(insertSql).toMatch(/FORMA_PAGO/);
    expect(insertSql).not.toMatch(/DSEDAC/i);
  });
});
