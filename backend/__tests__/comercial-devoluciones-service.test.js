'use strict';

const {
  classifyFormaPago,
  isPagareFormaPago,
  buildComercialLiquidacionSummary,
  parseIsoDate,
  sanitizeVendorCodes,
  listReturns,
  listPgCollectedDocuments,
  getDailySummary,
  saveLiquidacion,
  registerReturn,
} = require('../services/comercial-devoluciones-service');

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQueryWithParams(...args),
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
  });

  test('classifies commercial vs repartidor payment methods', () => {
    expect(classifyFormaPago('CONTADO')).toBe('EFECTIVO');
    expect(classifyFormaPago('CHEQUE')).toBe('CHEQUES');
    expect(classifyFormaPago('POSTDATADO')).toBe('POSTDATADOS');
    expect(classifyFormaPago('CTR')).toBe('REPARTIDOR');
    expect(classifyFormaPago('PG')).toBe('POSTDATADOS');
    expect(classifyFormaPago('P1')).toBe('POSTDATADOS');
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
});

describe('listReturns', () => {
  beforeEach(() => {
    mockQueryWithParams.mockReset();
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
    expect(sql).toMatch(/FPG\.PAGARESN/);
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
  });

  test('combines commercial cobros and return documents without subtracting returns from deposit', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/JAVIER\.COBROS/i.test(sql)) {
        return [
          { FORMA_PAGO: 'CONTADO', TOTAL: '1000' },
          { FORMA_PAGO: 'CTR', TOTAL: '50' },
        ];
      }
      if (/DSED\.LACLAE/i.test(sql)) {
        return [{
          YEAR: 2026,
          MONTH: 5,
          DAY: 31,
          SERIE: 'D',
          NUMERO: 1,
          CLIENTE: 'C1',
          VENDEDOR: '80',
          AMOUNT: '-1000',
          UNITS: '-1',
        }];
      }
      if (/DSEDAC\.LQD/i.test(sql)) return [];
      return [];
    });

    const result = await getDailySummary({
      vendorCodes: ['80'],
      date: '2026-05-31',
    });

    expect(result.summary.totalEfectivo).toBe(1000);
    expect(result.cobros.totalRepartidorExcluded).toBe(50);
    expect(result.summary.devolucionesYaCobradas).toBe(1000);
    expect(result.summary.totalAIngresar).toBe(1000);
    expect(result.returns).toHaveLength(1);

    const cobrosSql = mockQueryWithParams.mock.calls.find(([sql]) => /JAVIER\.COBROS/i.test(sql))[0];
    expect(cobrosSql).toMatch(/JAVIER\.COBROS/);
    expect(cobrosSql).toMatch(/YEAR\(FECHA\) = \?/);
    expect(cobrosSql).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
  });

  test('uses LQD.IMPORTETOTALAINGRESAR and does not double-count LACLAE returns', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/JAVIER\.COBROS/i.test(sql)) {
        return [{ FORMA_PAGO: 'CONTADO', TOTAL: '1000' }];
      }
      if (/DSED\.LACLAE/i.test(sql)) {
        return [{
          YEAR: 2026, MONTH: 5, DAY: 31, SERIE: 'D', NUMERO: 1,
          CLIENTE: 'C1', VENDEDOR: '80', AMOUNT: '-400', UNITS: '-1',
        }];
      }
      if (/DSEDAC\.LQD/i.test(sql)) {
        return [{
          TOTAL_EFECTIVO: '800',
          TOTAL_CHEQUES: '0',
          TOTAL_POSTDATADOS: '0',
          SALDO_ACTUAL: '0',
          TOTAL_A_INGRESAR: '2500',
          FILAS: 1,
        }];
      }
      return [];
    });

    const result = await getDailySummary({
      vendorCodes: ['80'],
      date: '2026-05-31',
    });

    expect(result.summary.source).toBe('DSEDAC.LQD');
    expect(result.summary.totalAIngresar).toBe(2500);
    expect(result.summary.devolucionesYaCobradas).toBe(400);
    expect(result.summary.totalAIngresar).not.toBe(2500 - 400);
    const lqdSql = mockQueryWithParams.mock.calls.find(([sql]) => /DSEDAC\.LQD/i.test(sql))[0];
    expect(lqdSql).toMatch(/IMPORTETOTALAINGRESAR/);
    expect(lqdSql).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
    expect(lqdSql).not.toMatch(/VISTA_DEUDA_BASE/i);
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
    restoreEnv = isolatedWriteEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test('saveLiquidacion inserts JAVIER.TEST_LIQUIDACION_COMERCIAL and never DSEDAC', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/IDEMPOTENCY_TOKEN/i.test(sql) && /SELECT/i.test(sql)) return [];
      if (/SELECT ID FROM JAVIER\.TEST_LIQUIDACION_COMERCIAL/i.test(sql)) return [];
      return [];
    });

    const saved = await saveLiquidacion({
      vendorCodes: ['80'],
      date: '2026-09-11',
      ingresoBanco: 120,
      entregado: 80,
      expectedTotal: 200,
      idempotencyToken: 'liq-80-2026-09-11',
      createdBy: '80',
    });

    expect(saved.source).toBe('JAVIER.TEST_LIQUIDACION_COMERCIAL');
    expect(saved.ingresoBanco).toBe(120);
    const insertSql = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO/i.test(sql))[0];
    expect(insertSql).toMatch(/JAVIER\.TEST_LIQUIDACION_COMERCIAL/);
    expect(insertSql).not.toMatch(/DSEDAC/i);
    expect(insertSql).not.toMatch(/VISTA_DEUDA_BASE/i);
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
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/IDEMPOTENCY_TOKEN/i.test(sql) && /SELECT/i.test(sql)) return [];
      if (/MAX\(NUMERO\)/i.test(sql)) return [{ LAST_NUM: 3 }];
      return [];
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
    mockQueryWithParams.mockImplementation(async (sql) => {
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
      TIPO: 'COB',
      SERIE: 'M',
      NUMERO: 88,
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
      NUM_ALB: 21,
    }]);

    const docs = await listPgCollectedDocuments({ vendorCodes: ['80'] });
    expect(docs[0]).toMatchObject({
      cliente: '4300010001',
      formaPago: 'P1',
      pagare: true,
      vencimiento: '2026-08-31',
      albaran: 'P-21',
      impactoLqd: 'YA_COBRADOS',
    });
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/DSEDAC\.CVC/);
    expect(sql).toMatch(/DSEDAC\.FPG/);
    expect(sql).toMatch(/DSEDAC\.CAC/);
    expect(sql).toMatch(/EJERCICIOFACTURA/);
    expect(sql).toMatch(/IMPORTEPENDIENTE = 0/);
    expect(sql).toMatch(/CODIGOCLIENTEFACTURA/);
    expect(sql).toMatch(/TIPODOCUMENTO = CAST\(\? AS CHAR\(3\)\)/);
    expect(sql).toMatch(/PAGARESN = CAST\(\? AS CHAR\(1\)\)/);
    expect(sql).toMatch(/CAC\.CODIGOVENDEDOR/);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
    expect(sql).not.toMatch(/VISTA_DEUDA_BASE/i);
    expect(params[0]).toBe('PAG');
    expect(params[1]).toBe('S');
  });

  test('registerReturn keeps PG already-collected impact on TEST overlay', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/IDEMPOTENCY_TOKEN/i.test(sql) && /SELECT/i.test(sql)) return [];
      if (/MAX\(NUMERO\)/i.test(sql)) return [{ LAST_NUM: 1 }];
      return [];
    });

    const created = await registerReturn({
      vendorCodes: ['80'],
      date: '2026-05-31',
      clientCode: '4300010001',
      amount: 1000,
      formaPago: 'PG',
      albaranOrigen: 'P-21',
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
