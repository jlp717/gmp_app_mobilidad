'use strict';

const {
  classifyFormaPago,
  buildComercialLiquidacionSummary,
  parseIsoDate,
  sanitizeVendorCodes,
  listReturns,
  getDailySummary,
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
