'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const jwtAccessSecretName = ['JWT', 'ACCESS', 'SECRET'].join('_');
Object.assign(process.env, {
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  [jwtAccessSecretName]: 'test-jwt-secret-for-testing-only',
});

const mockQueryWithParams = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();
const mockSentryCaptureException = jest.fn();
const mockDeleteCachePattern = jest.fn();
let mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };

jest.mock('@sentry/node', () => ({ captureException: mockSentryCaptureException }));

jest.mock('../services/redis-cache', () => ({
  deleteCachePattern: (...args) => mockDeleteCachePattern(...args),
  invalidateCache: jest.fn(),
}));

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: () => ({
    connect: jest.fn().mockResolvedValue({
      query: (...args) => mockConnQuery(...args),
      close: mockConnClose,
    }),
  }),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { ...mockAuthUser };
    next();
  },
  requireRoles: () => (_req, _res, next) => next(),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn().mockResolvedValue({ success: true }),
}));

const finanzasRoutes = require('../routes/repartidor-finanzas');
const financeService = require('../services/repartidor-finance-service');
const logger = require('../middleware/logger');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/finanzas', finanzasRoutes);
  return app;
}
function validDeliveryDetails(suffix) {
  return {
    occurredAt: '2026-04-23T11:30:00.000Z',
    receiver: {
      nombre: 'Ana',
      apellidos: 'Lopez Ruiz',
      dni: '12345678Z',
    },
    lineas: [{
      lineaId: '1',
      codigoArticulo: 'ART-1',
      cantidadPedida: 4,
      cantidadEntregada: 4,
      cantidadRechazada: 0,
      cantidadPendiente: 0,
      motivoDiferencia: null,
    }],
    firma: `ev_${crypto.createHash('sha256').update(`signature-${suffix}`).digest('hex')}`,
  };
}

function validCanonicalConfirmation(suffix) {
  return {
    delivery: {
      itemId: '2026-S-10-404-4300009479',
      status: 'ENTREGADO',
      repartidorId: '94',
      ...validDeliveryDetails(suffix),
    },
    cobro: {
      entregaId: '2026-S-10-404-4300009479',
      importeCobrado: 189.60,
      formaPago: 'EFECTIVO',
    },
  };
}


describe('Repartidor finanzas routes', () => {
  let app;
  const originalCleanupFlag = process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP;
  const alignedSchemaRows = [
    ['REPARTIDOR_COBROS', 'TIPODOCUMENTO'],
    ['REPARTIDOR_COBROS', 'ORIGENDOCUMENTO'],
    ['REPARTIDOR_COBROS', 'SUBEMPRESADOCUMENTO'],
    ['REPARTIDOR_COBROS', 'EJERCICIODOCUMENTO'],
    ['REPARTIDOR_COBROS', 'SERIEDOCUMENTO'],
    ['REPARTIDOR_COBROS', 'TERMINALDOCUMENTO'],
    ['REPARTIDOR_COBROS', 'NUMERODOCUMENTO'],
    ['REPARTIDOR_COBROS', 'XDEDOCUMENTO'],
    ['REPARTIDOR_COBROS', 'DEXDOCUMENTO'],
    ['REPARTIDOR_COBROS', 'CODIGOCLIENTEALBARAN'],
    ['REPARTIDOR_COBROS', 'CODIGOVENDEDOR'],
    ['REPARTIDOR_COBROS', 'CODIGOFORMAPAGO'],
    ['REPARTIDOR_COBROS', 'DIAVENCIMIENTO'],
    ['REPARTIDOR_COBROS', 'MESVENCIMIENTO'],
    ['REPARTIDOR_COBROS', 'ANOVENCIMIENTO'],
    ['REPARTIDOR_COBROS', 'DIACOBRO'],
    ['REPARTIDOR_COBROS', 'MESCOBRO'],
    ['REPARTIDOR_COBROS', 'ANOCOBRO'],
    ['REPARTIDOR_COBROS', 'NUMEROLIQUIDACION'],
    ['REPARTIDOR_COBROS', 'IMPORTEVENCIMIENTO'],
    ['REPARTIDOR_COBROS', 'IMPORTEPENDIENTE'],
    ['REPARTIDOR_COBROS', 'IDEMPOTENCY_TOKEN'],
    ['REPARTIDOR_COBROS', 'PANTALLA_ORIGEN'],
    ['REPARTIDOR_COBROS', 'OPERADOR'],
    ['REPARTIDOR_COBROS', 'CREATED_AT'],
    ['REPARTIDOR_FINANCIAL_BALANCES', 'CODIGO_REPARTIDOR'],
    ['REPARTIDOR_FINANCIAL_BALANCES', 'SALDO_PENDIENTE'],
    ['REPARTIDOR_LIQUIDACION_OPS', 'IDEMPOTENCY_TOKEN'],
    ['REPARTIDOR_LIQUIDACION_OPS', 'CODIGOVENDEDOR'],
    ['REPARTIDOR_LIQUIDACION_OPS', 'TOTAL_COBROS_DIA'],
  ].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockReset();
    mockConnQuery.mockReset();
    mockConnClose.mockReset();
    mockSentryCaptureException.mockReset();
    mockDeleteCachePattern.mockReset();
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    finanzasRoutes.resetCanonicalConfirmationRuntime();
    app = makeApp();
  });

  afterEach(() => {
    jest.useRealTimers();
    finanzasRoutes.resetCanonicalConfirmationRuntime();
    finanzasRoutes.resetCanonicalLiquidacionService();
    // Restore process.env after each test
    if (originalCleanupFlag === undefined) {
      delete process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP;
    } else {
      process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP = originalCleanupFlag;
    }
  });

  afterAll(() => {
    if (originalCleanupFlag === undefined) {
      delete process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP;
    } else {
      process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP = originalCleanupFlag;
    }
  });

  test('legacy LQD PDF reconstruction preserves each payment method', () => {
    expect(financeService.shadowLiquidacionPayments({
      IMPORTEEFECTIVO: '100.25',
      IMPORTECHEQUES: '20',
      IMPORTETARJETA: '30.50',
      IMPORTEPOSTDATADOS: '4.25',
    }, '2026-08-15')).toEqual([
      expect.objectContaining({ id: 'LQD-EFECTIVO', amount: 100.25, paymentMethod: 'EFECTIVO' }),
      expect.objectContaining({ id: 'LQD-CHEQUE', amount: 20, paymentMethod: 'CHEQUE' }),
      expect.objectContaining({ id: 'LQD-TARJETA', amount: 30.5, paymentMethod: 'TARJETA' }),
      expect.objectContaining({ id: 'LQD-POSTDATADO', amount: 4.25, paymentMethod: 'POSTDATADO' }),
    ]);
  });
  test('GET /daily-summary uses repartidor cobros and balance to build the liquidation form', async () => {
     mockQueryWithParams
       .mockResolvedValueOnce(alignedSchemaRows)
       .mockResolvedValueOnce([{
         TOTAL_EFECTIVO: '222.79',
         TOTAL_CHEQUES: '0',
         TOTAL_TARJETA: '0',
         TOTAL_POSTDATADOS: '0',
         TOTAL_COBROS_DIA: '222.79',
         COBROS_COUNT: '2',
       }])
       .mockResolvedValueOnce([{ SALDO_PENDIENTE: '4.81' }])
       .mockResolvedValueOnce([
        {
          ID: 10,
          ANOVENCIMIENTO: 2026,
          MESVENCIMIENTO: 4,
          DIAVENCIMIENTO: 23,
          CODIGOCLIENTEALBARAN: '4300009479',
          CODIGOFORMAPAGO: 'EFECTIVO',
          TIPODOCUMENTO: 'CAC',
          SERIEDOCUMENTO: 'S',
          TERMINALDOCUMENTO: 10,
          NUMERODOCUMENTO: 404,
          EJERCICIODOCUMENTO: 2026,
          XDEDOCUMENTO: 1,
          IMPORTEVENCIMIENTO: '189.60',
          IMPORTEPENDIENTE: '0',
        },
      ])
       // selectDailyStructuredSums (gastos / ingresos / ajustes)
       .mockResolvedValueOnce([{ TOTAL: '0' }])
       .mockResolvedValueOnce([{ TOTAL: '0' }])
       .mockResolvedValueOnce([{ TOTAL: '0' }])
       // selectDeliveredAmount + selectDailyErpDebt
       .mockResolvedValueOnce([{ TOTAL_REPARTIDO: '0' }])
       .mockResolvedValueOnce([{ DEUDA_PENDIENTE: '0' }]);

    const res = await request(app)
      .get('/finanzas/daily-summary/94')
      .query({ date: '2026-04-23' });

    expect(res.status).toBe(200);
    expect(res.body.summary.totalEfectivo).toBe(222.79);
    expect(res.body.summary.saldoActual).toBe(4.81);
    expect(res.body.summary.totalAIngresar).toBe(227.6);
    expect(res.body.cobros[0].documento).toBe('E 2026-B-S-010-000404-01');
    const sqlText = mockQueryWithParams.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlText).not.toContain('LIQUIDADO_SN');
    expect(sqlText).toContain('COALESCE(NUMEROLIQUIDACION, 0) = 0');
    expect(sqlText).toContain('CODIGO_REPARTIDOR');
    expect(sqlText).toContain('FROM JAVIER.TEST_REPARTO_CONFIRMACIONES C');
    expect(sqlText).toContain('INNER JOIN DSEDAC.CPC CPC');
    expect(sqlText).toContain('LEFT JOIN DSEDAC.CVC CVC');
    expect(sqlText).not.toMatch(/JAVIER\.(?!TEST_)(?:REPARTIDOR_|REPARTO_)/);
    expect(sqlText).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO|FROM)?\s*/i);
    // First call is schema detection, second is the totals query
    const totalsCall = mockQueryWithParams.mock.calls.find(c => c[1] && c[1][0] === '94');
    expect(totalsCall[1]).toEqual(['94', 20260423]);
  });
  test('GET /daily-summary in isolated test uses the isolated balance over ERP LQD', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{
        TOTAL_EFECTIVO: '10',
        TOTAL_CHEQUES: '0',
        TOTAL_TARJETA: '0',
        TOTAL_POSTDATADOS: '0',
        TOTAL_COBROS_DIA: '10',
        COBROS_COUNT: '1',
      }])
      .mockResolvedValueOnce([{ SALDO_PENDIENTE: '70.04' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: '2.50' }])
      .mockResolvedValueOnce([{ TOTAL: '1.25' }])
      .mockResolvedValueOnce([{ TOTAL: '-0.75' }])
      .mockResolvedValueOnce([{ TOTAL_REPARTIDO: '0' }])
      .mockResolvedValueOnce([{ DEUDA_PENDIENTE: '0' }]);

    const res = await request(app)
      .get('/finanzas/daily-summary/94')
      .query({ date: '2026-08-25' });

    expect(res.status).toBe(200);
    expect(res.body.summary.saldoActual).toBe(70.04);
    expect(res.body.summary.totalAIngresar).toBe(76.79);
    const sqlText = mockQueryWithParams.mock.calls.map(([sql]) => sql).join('\n');
    expect(sqlText).not.toContain('FROM DSEDAC.LQD');
  });

  test('GET /daily-summary includes signed adjustments in totalAIngresar', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{
        TOTAL_EFECTIVO: '100',
        TOTAL_CHEQUES: '0',
        TOTAL_TARJETA: '0',
        TOTAL_POSTDATADOS: '0',
        TOTAL_COBROS_DIA: '100',
        COBROS_COUNT: '1',
      }])
      .mockResolvedValueOnce([{ SALDO_PENDIENTE: '50' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: '10' }])
      .mockResolvedValueOnce([{ TOTAL: '20' }])
      .mockResolvedValueOnce([{ TOTAL: '-5' }])
      .mockResolvedValueOnce([{ TOTAL_REPARTIDO: '0' }])
      .mockResolvedValueOnce([{ DEUDA_PENDIENTE: '0' }]);

    const res = await request(app)
      .get('/finanzas/daily-summary/94')
      .query({ date: '2026-08-15' });

    expect(res.status).toBe(200);
    expect(res.body.summary.gastos).toBe(10);
    expect(res.body.summary.ingresoBanco).toBe(20);
    expect(res.body.summary.ajustes).toBe(-5);
    expect(res.body.summary.totalAIngresar).toBe(135);
  });

  test('GET /summary returns real monthly cobros, liquidaciones and pending balance', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{ TOTAL_COBRADO: '350.00', COBROS_COUNT: '3' }])
      .mockResolvedValueOnce([
        {
          ID: 501,
          IDEMPOTENCY_TOKEN: 'liq_94_20260410',
          CODIGOVENDEDOR: '94',
          SUBEMPRESALIQUIDACION: 'GMP',
          EJERCICIOLIQUIDACION: 2026,
          SERIELIQUIDACION: 'A',
          TERMINALLIQUIDACION: 94,
          NUMEROLIQUIDACION: 10,
          DIALIQUIDACION: 10,
          MESLIQUIDACION: 4,
          ANOLIQUIDACION: 2026,
          TOTAL_COBROS_DIA: '125.00',
          TOTAL_LIQUIDADO_COBROS: '125.00',
        },
        {
          ID: 502,
          IDEMPOTENCY_TOKEN: 'liq_94_20260423',
          CODIGOVENDEDOR: '94',
          SUBEMPRESALIQUIDACION: 'GMP',
          EJERCICIOLIQUIDACION: 2026,
          SERIELIQUIDACION: 'A',
          TERMINALLIQUIDACION: 94,
          NUMEROLIQUIDACION: 11,
          DIALIQUIDACION: 23,
          MESLIQUIDACION: 4,
          ANOLIQUIDACION: 2026,
          TOTAL_COBROS_DIA: '175.00',
          TOTAL_LIQUIDADO_COBROS: '175.00',
        },
      ]);

    const res = await request(app)
      .get('/finanzas/summary/94')
      .query({ year: 2026, month: 4 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      repartidorId: '94',
      year: 2026,
      month: 4,
      period: { year: 2026, month: 4 },
      summary: {
        totalCobrado: 350,
        totalLiquidado: 300,
        saldoPendiente: 50,
        cobrosCount: 3,
        liquidacionesCount: 2,
      },
    });
    expect(res.body.liquidaciones).toHaveLength(2);
    expect(res.body.liquidaciones[0]).toMatchObject({
      idempotencyToken: 'liq_94_20260410',
      date: '2026-04-10',
      totalLiquidado: 125,
    });

    const cobrosCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /SUM\(RC\.IMPORTEVENCIMIENTO\)/i.test(sql)
    );
    const liquidacionesCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /REPARTIDOR_LIQUIDACION_OPS OPS/i.test(sql)
    );
    expect(cobrosCall[1]).toEqual(['94', 20260401, 20260501]);
    expect(liquidacionesCall[1]).toEqual(['94', 2026, 4]);
    expect(liquidacionesCall[0]).toContain('OPS.ANOLIQUIDACION = ?');
    expect(liquidacionesCall[0]).toContain('OPS.MESLIQUIDACION = ?');
  });

  test('GET /summary returns an empty monthly contract when there is no activity', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{ TOTAL_COBRADO: 0, COBROS_COUNT: 0 }])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/finanzas/summary/94')
      .query({ year: 2026, month: 4 });

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({
      totalCobrado: 0,
      totalLiquidado: 0,
      saldoPendiente: 0,
      cobrosCount: 0,
      liquidacionesCount: 0,
    });
    expect(res.body.liquidaciones).toEqual([]);
  });

  test('GET /summary returns typed 503 when the finance catalog is unavailable', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/finanzas/summary/94')
      .query({ year: 2026, month: 4 });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('REPARTO_SCHEMA_UNAVAILABLE');
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('GET /daily-summary aggregates multiple repartidores for jefe view', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', isJefeVentas: true, repartidorCodes: ['94', '95'] };
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{
        TOTAL_EFECTIVO: '300',
        TOTAL_CHEQUES: '0',
        TOTAL_TARJETA: '50',
        TOTAL_POSTDATADOS: '0',
        TOTAL_COBROS_DIA: '350',
        COBROS_COUNT: '3',
      }])
      .mockResolvedValueOnce([{ SALDO_PENDIENTE: '25' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ TOTAL: '0' }])
      .mockResolvedValueOnce([{ TOTAL: '0' }])
      .mockResolvedValueOnce([{ TOTAL: '0' }])
      .mockResolvedValueOnce([{ TOTAL_REPARTIDO: '0' }])
      .mockResolvedValueOnce([{ DEUDA_PENDIENTE: '0' }]);

    const res = await request(app)
      .get('/finanzas/daily-summary/94,95')
      .query({ date: '2026-04-23' });

    expect(res.status).toBe(200);
    expect(res.body.repartidorId).toBe('94,95');
    expect(res.body.summary.totalCobrosDia).toBe(350);
    expect(res.body.summary.totalAIngresar).toBe(325);

    const totalsCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /SUM\(CASE WHEN UPPER\(TRIM\(CODIGOFORMAPAGO\)\)/i.test(sql)
    );
    expect(totalsCall[0]).toContain('TRIM(CODIGOVENDEDOR) IN (?, ?)');
    expect(totalsCall[0]).toContain('JAVIER.TEST_REPARTIDOR_COBROS');
    expect(totalsCall[0]).not.toMatch(/JAVIER\.(?!TEST_)REPARTIDOR_COBROS/);
    expect(totalsCall[1]).toEqual(['94', '95', 20260423]);
  });

  test('GET /daily-summary blocks repartidor access to another repartidor', async () => {
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    const res = await request(app)
      .get('/finanzas/daily-summary/95')
      .query({ date: '2026-04-23' });

    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[REPARTIDOR_FINANZAS] Access denied', {
      code: 'REPARTIDOR_ACCESS_DENIED',
    });
    const warningArguments = JSON.stringify(logger.warn.mock.calls);
    expect(warningArguments).not.toContain('94');
    expect(warningArguments).not.toContain('95');
  });

  test('GET /evolution uses app cobros schema and delivered products from ERP LAC', async () => {
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR', repartidorCodes: ['94'] };
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{
        CODIGO: 'ART001',
        NOMBRE: 'HELADO TEST',
        UNIDADES: '12',
        IMPORTE: '240.50',
      }])
      .mockResolvedValueOnce([{
        ANO: 2026,
        MES: 4,
        TOTAL: '222.79',
        NUM_COBROS: '2',
      }]);

    const res = await request(app).get('/finanzas/evolution/94');

    expect(res.status).toBe(200);
    expect(res.body.evolution).toMatchObject([{
      period: '2026-04',
      ano: 2026,
      mes: 4,
      total: 222.79,
      totalSales: 222.79,
      numCobros: 2,
    }]);
    expect(res.body.topProducts[0]).toMatchObject({
      codigo: 'ART001',
      nombre: 'HELADO TEST',
      unidades: 12,
      importe: 240.5,
    });

    const sqlText = mockQueryWithParams.mock.calls.map(([sql]) => sql).join('\n');
    // Isolated test mode must use its explicit TEST_ table mapping, never a
    // production-named table selected implicitly by the route.
    expect(sqlText).toContain('FROM JAVIER.TEST_REPARTIDOR_COBROS');
    expect(sqlText).toContain('FROM DSEDAC.CPC CPC');
    expect(sqlText).toContain('INNER JOIN DSEDAC.LAC LAC');
    expect(sqlText).not.toContain('INNER JOIN JAVIER.LPC LPC');
    expect(sqlText).toContain('YEAR(CURRENT DATE) - 1');
  });

  test('GET /vencimientos builds due dates from CLCL1 credit-day rules', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{
      TIPODOCUMENTO: 'CAC',
      ORIGENDOCUMENTO: 'B',
      SUBEMPRESADOCUMENTO: 'GMP',
      EJERCICIODOCUMENTO: 2026,
      SERIEDOCUMENTO: 'I',
      TERMINALDOCUMENTO: 10,
      NUMERODOCUMENTO: 2730,
      XDEDOCUMENTO: 1,
      DEXDOCUMENTO: 1,
      CODIGOCLIENTEALBARAN: '4300001119',
      NOMBRE_CLIENTE: 'CARNICERIA MECA',
      NOMBREALTERNATIVO: 'MECA MONTALBAN RAMON',
      POBLACION: 'LORCA',
      DIAVENCIMIENTO: 23,
      MESVENCIMIENTO: 4,
      ANOVENCIMIENTO: 2026,
      FACTURA_BASE_DIA: 20,
      FACTURA_BASE_MES: 4,
      FACTURA_BASE_ANO: 2026,
      ALBARAN_BASE_DIA: 23,
      ALBARAN_BASE_MES: 4,
      ALBARAN_BASE_ANO: 2026,
      DIASLIMITECREDITO: 0,
      DIASLIMITECREDITOCONFECHAALB: 'S',
      IMPORTEVENCIMIENTO: '73.19',
      IMPORTEPENDIENTE: '40.00',
      TOTAL_COUNT: 1,
    }]);

    const res = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({ from: '2026-04-01', to: '2026-04-30', limit: 25, search: 'MECA' });

    expect(res.status).toBe(200);
    expect(res.body.vencimientos[0]).toMatchObject({
      codigoCliente: '4300001119',
      nombreCliente: 'CARNICERIA MECA',
      nombreAlternativo: 'MECA MONTALBAN RAMON',
      poblacion: 'LORCA',
      fechaVencimiento: '2026-04-23',
      documento: 'E 2026-B-I-010-002730-01',
      tipoDocumento: 'CAC',
      importePendiente: 40,
    });

    const [sql, params] = mockQueryWithParams.mock.calls[1];
    expect(sql).not.toContain('FECHAVENCIMIENTO');
    expect(sql).toContain('CLCL1.DIASLIMITECREDITO');
    expect(sql).toContain('CLCL1.DIASLIMITECREDITOCONFECHAALB');
    expect(sql).toContain('CLI.NOMBRECLIENTE');
    expect(params).toEqual(['94', 20260401, 20260430, '%MECA%', '%MECA%', '%MECA%', '%MECA%', '%MECA%', '%MECA%', 0, 25]);
    expect(res.body.pagination).toEqual({
      total: 1,
      limit: 25,
      hasMore: false,
      nextCursor: null,
    });
  });

  test('GET /vencimientos uses the calculated due date for mapping and SQL filters', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([
        {
          TIPODOCUMENTO: 'CAC',
          EJERCICIODOCUMENTO: 2026,
          NUMERODOCUMENTO: 1,
          CODIGOCLIENTEALBARAN: '4300001119',
          DIAVENCIMIENTO: 1,
          MESVENCIMIENTO: 1,
          ANOVENCIMIENTO: 2020,
          ALBARAN_BASE_DIA: 1,
          ALBARAN_BASE_MES: 8,
          ALBARAN_BASE_ANO: 2026,
          DIASLIMITECREDITO: 10,
          DIASLIMITECREDITOCONFECHAALB: 'S',
          IMPORTEPENDIENTE: '10.00',
          TOTAL_COUNT: 2,
        },
        {
          TIPODOCUMENTO: 'CAC',
          EJERCICIODOCUMENTO: 2026,
          NUMERODOCUMENTO: 2,
          CODIGOCLIENTEALBARAN: '4300001119',
          DIAVENCIMIENTO: 31,
          MESVENCIMIENTO: 12,
          ANOVENCIMIENTO: 2026,
          FACTURA_BASE_DIA: 1,
          FACTURA_BASE_MES: 7,
          FACTURA_BASE_ANO: 2026,
          DIASLIMITECREDITO: 0,
          DIASLIMITECREDITOCONFECHAALB: 'N',
          IMPORTEPENDIENTE: '10.00',
          TOTAL_COUNT: 2,
        },
      ]);

    const res = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({ from: '2020-01-01', to: '2030-12-31', estado: 'pendiente' });

    expect(res.status).toBe(200);
    expect(res.body.vencimientos.map((item) => item.fechaVencimiento)).toEqual([
      '2026-08-11',
      '2026-07-01',
    ]);
    const [sql] = mockQueryWithParams.mock.calls[1];
    expect((sql.match(/CLCL1\.DIASLIMITECREDITO IS NOT NULL/g) || []).length)
      .toBeGreaterThanOrEqual(2);
    expect(sql).toContain('AS DUE_YMD');
    expect(sql).toContain('BASE.DUE_YMD >= ?');
  });

  test('GET /vencimientos/:repartidorId/:docId/detalle binds the authorized repartidor to the service query', async () => {
    const serviceSpy = jest.spyOn(financeService, 'getDetalleVencimiento').mockResolvedValue({
      docKey: { tipo: 'CAC', numero: 2730 },
    });

    const res = await request(app)
      .get('/finanzas/vencimientos/94/CAC-2026-I-10-2730-1/detalle');

    expect(res.status).toBe(200);
    expect(serviceSpy).toHaveBeenCalledWith({
      repartidorId: '94',
      tipo: 'CAC',
      ejercicio: 2026,
      serie: 'I',
      terminal: 10,
      numero: 2730,
      xde: 1,
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    serviceSpy.mockRestore();
  });

  test('GET /vencimientos/:repartidorId/:docId/detalle rejects another repartidor before service or DB access', async () => {
    const serviceSpy = jest.spyOn(financeService, 'getDetalleVencimiento');

    const res = await request(app)
      .get('/finanzas/vencimientos/95/CAC-2026-I-10-2730-1/detalle');

    expect(res.status).toBe(403);
    expect(serviceSpy).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
    serviceSpy.mockRestore();
  });
  test('GET /vencimientos paginates at the database with a filter-bound cursor', async () => {
    const row = (numero, total) => ({
      TIPODOCUMENTO: 'CAC',
      ORIGENDOCUMENTO: 'B',
      SUBEMPRESADOCUMENTO: 'GMP',
      EJERCICIODOCUMENTO: 2026,
      SERIEDOCUMENTO: 'I',
      TERMINALDOCUMENTO: 10,
      NUMERODOCUMENTO: numero,
      XDEDOCUMENTO: 1,
      DEXDOCUMENTO: 1,
      CODIGOCLIENTEALBARAN: '4300001119',
      DIAVENCIMIENTO: 23,
      MESVENCIMIENTO: 4,
      ANOVENCIMIENTO: 2026,
      IMPORTEVENCIMIENTO: '40.00',
      IMPORTEPENDIENTE: '40.00',
      TOTAL_COUNT: total,
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 3, 23, 59));
    const todayYmd = 20260803;
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, index) => row(2730 + index, 101)),
      );

    const first = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({
        from: '2026-04-01',
        to: '2026-04-30',
        limit: 100,
        clientCode: '4300001119',
        estado: 'pendiente',
      });

    expect(first.status).toBe(200);
    expect(first.body.pagination).toMatchObject({ total: 101, hasMore: true });
    expect(first.body.pagination.nextCursor).toEqual(expect.any(String));
    const firstSql = mockQueryWithParams.mock.calls[1];
    expect(firstSql[0]).toContain('COUNT(*) OVER() AS TOTAL_COUNT');
    expect(firstSql[0]).toContain('WHERE PAGED.RN > ? AND PAGED.RN <= ?');
    expect(firstSql[0]).toContain('BASE.DUE_YMD >= ?');
    expect(firstSql[0]).not.toContain('BASE.DUE_YMD < ?');
    expect(firstSql[1]).toEqual([
      '94', 20260401, 20260430, '4300001119', todayYmd, 0, 100,
    ]);

    jest.setSystemTime(new Date(2026, 7, 4, 0, 1));
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([row(2830, 101)]);
    const second = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({
        from: '2026-04-01',
        to: '2026-04-30',
        limit: 100,
        clientCode: '4300001119',
        estado: 'pendiente',
        cursor: first.body.pagination.nextCursor,
      });

    expect(second.status).toBe(200);
    expect(second.body.pagination).toMatchObject({ total: 101, hasMore: false });
    expect(mockQueryWithParams.mock.calls[3][1]).toEqual([
      '94', 20260401, 20260430, '4300001119', todayYmd, 100, 200,
    ]);
  });

  test('GET /vencimientos rejects a signed oversized offset before DB access', async () => {
    const payload = {
      version: 1,
      offset: 100001,
      fingerprint: '94|2026-04-01|2026-04-30||pendiente|20260803',
      todayYmd: 20260803,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', process.env.JWT_ACCESS_SECRET)
      .update(encoded)
      .digest('hex');

    const res = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({
        from: '2026-04-01',
        to: '2026-04-30',
        estado: 'pendiente',
        cursor: `${encoded}.${signature}`,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FINANCE_CURSOR');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
  test('GET /vencimientos marks impossible calendar dates and never exposes an ambiguous date', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{
        TIPODOCUMENTO: 'CAC',
        EJERCICIODOCUMENTO: 2026,
        NUMERODOCUMENTO: 9,
        CODIGOCLIENTEALBARAN: '4300001119',
        DIAVENCIMIENTO: 30,
        MESVENCIMIENTO: 2,
        ANOVENCIMIENTO: 2026,
        IMPORTEPENDIENTE: '10.00',
        TOTAL_COUNT: 1,
      }]);

    const res = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({ from: '2026-02-01', to: '2026-03-31', limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.vencimientos[0]).toMatchObject({
      fechaVencimiento: null,
      fechaValida: false,
    });
  });

  test.each([
    ['/finanzas/vencimientos/ALL?from=2026-04-01&to=2026-04-30', 'GET'],
    ['/finanzas/evolution/ALL', 'GET'],
    ['/finanzas/commissions/summary/ALL?from=2026-04-01&to=2026-04-30', 'GET'],
  ])('%s rejects ALL instead of returning partial data', async (url) => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', isJefeVentas: true };
    const res = await request(app).get(url);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNSUPPORTED_REPARTIDOR_SELECTOR');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /vencimientos validates range and clamps oversized page size', async () => {
    const reversed = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({ from: '2026-05-01', to: '2026-04-01' });
    expect(reversed.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();

    // APK legacy sends limit=200 without from/to — clamp + defaults, then query.
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([]);
    const legacyApk = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({ limit: 200 });
    expect(legacyApk.status).toBe(200);
    expect(legacyApk.body.pagination.limit).toBe(100);
    expect(mockQueryWithParams).toHaveBeenCalled();
  });

  test('GET /evolution propagates DB failures instead of returning a 200 empty state', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce([]);

    const res = await request(app).get('/finanzas/evolution/94');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, code: 'INTERNAL_SERVER_ERROR' });
  });
  test('GET /commissions/summary uses ERP collected amount and accepts jefe multi-repartidor view', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', isJefeVentas: true, repartidorCodes: ['94', '95'] };
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{ TOTAL_REPARTIDO: '1000' }])
      .mockResolvedValueOnce([{ TOTAL_COBRADO: '375' }])
      .mockResolvedValueOnce([{
        ID: 1,
        THRESHOLD_PCT: '30',
        COMMISSION_PCT: '1',
        SORT_ORDER: 1,
      }]);

    const res = await request(app)
      .get('/finanzas/commissions/summary/94,95')
      .query({ from: '2026-04-01', to: '2026-04-30' });

    expect(res.status).toBe(200);
    expect(res.body.deliveredAmount).toBe(1000);
    expect(res.body.collectedAmount).toBe(375);
    expect(res.body.collectedPct).toBe(37.5);
    expect(res.body.commission).toBe(0.75);
    expect(res.body.reached).toEqual([{
      thresholdPct: 30,
      commissionPct: 1,
      thresholdAmount: 300,
      excess: 75,
      commission: 0.75,
    }]);

    const collectedCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /CVC\.IMPORTEPENDIENTE/i.test(sql)
    );
    expect(collectedCall[0]).toContain('TRIM(OPP.CODIGOREPARTIDOR) IN (?, ?)');
    expect(collectedCall[1]).toEqual(['94', '95', 20260401, 20260430]);
  });

  test('calculateCommission applies only the highest reached repartidor tier', () => {
    const tiers = [
      { thresholdPct: 30, commissionPct: 0.7, sortOrder: 2 },
      { thresholdPct: 50, commissionPct: 0.8, sortOrder: 3 },
      { thresholdPct: 70, commissionPct: 1, sortOrder: 4 },
    ];

    expect(financeService.calculateCommission({
      deliveredAmount: 100000,
      collectedAmount: 21000,
      tiers,
    })).toMatchObject({
      collectedPct: 21,
      commission: 0,
      reached: [],
    });

    expect(financeService.calculateCommission({
      deliveredAmount: 100000,
      collectedAmount: 71000,
      tiers,
    })).toMatchObject({
      collectedPct: 71,
      commission: 10,
      reached: [{
        thresholdPct: 70,
        commissionPct: 1,
        thresholdAmount: 70000,
        excess: 1000,
        commission: 10,
      }],
    });
  });

  test('POST /liquidaciones closes in the canonical ledger once and replays by idempotency token', async () => {
    const existingRow = {
      ID: '501',
      IDEMPOTENCY_TOKEN: 'liq-20260423-94',
      CODIGOVENDEDOR: '94',
      SUBEMPRESALIQUIDACION: 'GMP',
      EJERCICIOLIQUIDACION: 2026,
      SERIELIQUIDACION: 'A',
      TERMINALLIQUIDACION: 94,
      NUMEROLIQUIDACION: 2,
      IMPORTEEFECTIVO: '222.79',
      IMPORTECHEQUES: '0',
      IMPORTETARJETA: '0',
      IMPORTEPOSTDATADOS: '0',
      IMPORTESALDOACTUAL: '0',
      TOTAL_COBROS_DIA: '222.79',
      IMPORTETOTALAINGRESAR: '222.79',
      IMPORTEINGRESOENBANCO: '222.79',
      IMPORTEGASTOS: '12.34',
      SALDO_RESULTANTE: '0',
      REVISADOSN: 'S',
    };

    // closeLiquidacion flow:
    // Query #1: findLiquidacionRowByToken — no existing row
    // Query #2: getFinanceSchemaInfo() calls QSYS2.SYSCOLUMNS
    // Query #3: after transaction — SELECT from OPS to confirm insert
    // Query #4: REPLAY — findLiquidacionRowByToken returns existing row
    mockQueryWithParams
      .mockResolvedValueOnce([])              // #1: findLiquidacionRowByToken
      .mockResolvedValueOnce(alignedSchemaRows) // #2: getFinanceSchemaInfo
      .mockResolvedValueOnce([existingRow])   // #3: confirm insert
      .mockResolvedValueOnce([existingRow]);  // #4: replay findLiquidacionRowByToken

    const payload = {
      repartidorId: '94',
      date: '2026-04-23',
      idempotencyToken: 'liq-20260423-94',
      totals: {
        totalEfectivo: 222.79,
        totalCheques: 0,
        totalTarjeta: 0,
        totalPostdatados: 0,
        saldoActual: 0,
        totalCobrosDia: 222.79,
        totalAIngresar: 222.79,
        ingresoBanco: 222.79,
        gastos: 12.34,
        efectivo2: 0,
        entregado2: 0,
      },
    };

    const first = await request(app).post('/finanzas/liquidaciones').send(payload);
    const replay = await request(app).post('/finanzas/liquidaciones').send(payload);

    expect(first.status).toBe(422);
    expect(first.body.code).toBe('LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN');
    expect(replay.status).toBe(422);
    expect(replay.body.code).toBe('LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

   test('POST /liquidaciones rejects idempotency token replay with different payload', async () => {
    // closeLiquidacion flow:
    // Query #1: findLiquidacionRowByToken returns existing row (for replay detection)
    // Query #2: getFinanceSchemaInfo (not reached if replay is detected)
    mockQueryWithParams
      // #1: findLiquidacionRowByToken returns existing → immediate replay path
      .mockResolvedValueOnce([{
      ID: '501',
      IDEMPOTENCY_TOKEN: 'liq-20260423-94',
      CODIGOVENDEDOR: '94',
      SUBEMPRESALIQUIDACION: 'GMP',
      EJERCICIOLIQUIDACION: 2026,
      SERIELIQUIDACION: 'A',
      TERMINALLIQUIDACION: 94,
      NUMEROLIQUIDACION: 2,
      IMPORTEEFECTIVO: '222.79',
      IMPORTECHEQUES: '0',
      IMPORTETARJETA: '0',
      IMPORTEPOSTDATADOS: '0',
      IMPORTESALDOACTUAL: '0',
      TOTAL_COBROS_DIA: '222.79',
      IMPORTETOTALAINGRESAR: '222.79',
      IMPORTEINGRESOENBANCO: '222.79',
      SALDO_RESULTANTE: '0',
      REVISADOSN: 'S',
    }]);

    const res = await request(app).post('/finanzas/liquidaciones').send({
      repartidorId: '94',
      date: '2026-04-23',
      idempotencyToken: 'liq-20260423-94',
      totals: {
        totalEfectivo: 222.79,
        totalCheques: 0,
        totalTarjeta: 0,
        totalPostdatados: 0,
        saldoActual: 0,
        totalCobrosDia: 222.79,
        totalAIngresar: 222.79,
        ingresoBanco: 100,
        gastos: 0,
        efectivo2: 0,
        entregado2: 0,
      },
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones blocks a legacy same-day token without a second write', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(alignedSchemaRows);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/WHERE OPS\.IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [];
      if (/DIALIQUIDACION = \?/i.test(sql)) {
        return [{ IDMARCALIQUIDACION: 'liq_94_20260423_legacy_123' }];
      }
      if (/WHERE IDMARCALIQUIDACION = \?/i.test(sql)) return [];
      return [];
    });

    const res = await request(app).post('/finanzas/liquidaciones').send({
      repartidorId: '94',
      date: '2026-04-23',
      idempotencyToken: 'liq_94_20260423',
      totals: {
        totalEfectivo: 222.79,
        totalCheques: 0,
        totalTarjeta: 0,
        totalPostdatados: 0,
        saldoActual: 0,
        totalCobrosDia: 222.79,
        totalAIngresar: 210.45,
        ingresoBanco: 210.45,
        gastos: 12.34,
        efectivo2: 0,
        entregado2: 0,
      },
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      code: 'LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /liquidaciones/:token/reopen stays fail-closed without an approved rule', async () => {
    const res = await request(app)
      .post('/finanzas/liquidaciones/liq_94_20260423/reopen');

    expect(res.status).toBe(501);
    expect(res.body).toEqual({
      success: false,
      code: 'LIQUIDACION_REOPEN_RULE_UNDEFINED',
      error: 'La reapertura de liquidaciones esta bloqueada hasta disponer de una regla de negocio aprobada y auditada.',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /cobros rejects idempotency token replay with different payload', async () => {
    mockQueryWithParams.mockResolvedValue(alignedSchemaRows);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM JAVIER\.CPC/i.test(sql)) {
        return [{ OK: 1 }];
      }
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) {
        return [{
        ID: 901,
        ENTREGA_APP_ID: '2026-S-10-404-4300009479',
        CODIGO_REPARTIDOR: '94',
        CODIGO_CLIENTE: '4300009479',
        TIPO_DOCUMENTO: 'CAC',
        ORIGEN_DOCUMENTO: 'B',
        SUBEMPRESA_DOCUMENTO: 'GMP',
        SERIE_DOCUMENTO: 'S',
        EJERCICIO_DOCUMENTO: 2026,
        TERMINAL_DOCUMENTO: 10,
        NUMERO_DOCUMENTO: 404,
        XDE_DOCUMENTO: 1,
        DEX_DOCUMENTO: 1,
        IMPORTE_COBRADO: 189.60,
        IMPORTE_PENDIENTE: 0,
        FORMA_PAGO: 'EFECTIVO',
        PANTALLA_ORIGEN: 'RUTERO',
        }];
      }
      return [];
    });

    const res = await request(app).post('/finanzas/cobros').send({
      entregaId: '2026-S-10-404-4300009479',
      codigoCliente: '4300009479',
      nombreCliente: 'PEREZ DIAZ ALFONSO',
      codigoRepartidor: '94',
      tipoDocumento: 'CAC',
      origenDocumento: 'B',
      subempresaDocumento: 'GMP',
      ejercicioDocumento: 2026,
      serieDocumento: 'S',
      terminalDocumento: 10,
      numeroDocumento: 404,
      xdeDocumento: 1,
      importeCobrado: 180,
      importePendiente: 0,
      formaPago: 'EFECTIVO',
      pantallaOrigen: 'RUTERO',
      idempotencyToken: 'rutero-token-404',
    });

    // Cobros remain unavailable until the separately approved DB2 finance
    // capability is enabled.  The route must fail closed before any DB work.
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'REPARTO_SCHEMA_UNAVAILABLE',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
    expect(mockConnQuery.mock.calls.some(([sql]) =>
      /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)
    )).toBe(false);
  });

  test('POST /cobros accepts a second partial payment with a different token while balance remains', async () => {
    mockQueryWithParams.mockResolvedValue(alignedSchemaRows);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM JAVIER\.CVC/i.test(sql)) return [{ ERP_IMPORTEPENDIENTE: 189.60 }];
      if (/WHERE IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [];
      if (/SUM\(IMPORTEVENCIMIENTO\)/i.test(sql)) {
        return [{ APP_COLLECTED: 100 }];
      }
      if (/FROM JAVIER\.COBROS/i.test(sql)) return [];
      return [];
    });

    const res = await request(app).post('/finanzas/cobros').send({
      entregaId: '2026-S-10-404-4300009479',
      codigoCliente: '4300009479',
      nombreCliente: 'PEREZ DIAZ ALFONSO',
      codigoRepartidor: '94',
      tipoDocumento: 'CAC',
      origenDocumento: 'B',
      subempresaDocumento: 'GMP',
      ejercicioDocumento: 2026,
      serieDocumento: 'S',
      terminalDocumento: 10,
      numeroDocumento: 404,
      xdeDocumento: 1,
      importeCobrado: 89.60,
      importePendiente: 0,
      formaPago: 'EFECTIVO',
      pantallaOrigen: 'RUTERO',
      idempotencyToken: 'second-token-404',
    });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'REPARTO_SCHEMA_UNAVAILABLE',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /cobros rejects altered document discriminator fields for the same ERP document', async () => {
    mockQueryWithParams.mockResolvedValue(alignedSchemaRows);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM JAVIER\.CVC/i.test(sql)) return [];
      if (/FROM JAVIER\.CPC/i.test(sql)) return [{ OK: 1 }];
      if (/WHERE IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [];
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql) && /NUMERODOCUMENTO/i.test(sql)) {
        return [];
      }
      return [];
    });

    const res = await request(app).post('/finanzas/cobros').send({
      entregaId: '2026-S-10-404-4300009479',
      codigoCliente: '4300009479',
      nombreCliente: 'PEREZ DIAZ ALFONSO',
      codigoRepartidor: '94',
      tipoDocumento: 'COC',
      origenDocumento: 'C',
      subempresaDocumento: 'XXX',
      ejercicioDocumento: 2026,
      serieDocumento: 'S',
      terminalDocumento: 10,
      numeroDocumento: 404,
      xdeDocumento: 2,
      dexDocumento: 9,
      importeCobrado: 189.60,
      importePendiente: 0,
      formaPago: 'EFECTIVO',
      pantallaOrigen: 'RUTERO',
      idempotencyToken: 'altered-token-404',
    });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'REPARTO_SCHEMA_UNAVAILABLE',
    });
    expect(
      mockConnQuery.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)),
    ).toBe(false);
  });

  test('POST /rutero/confirm-delivery-cobro delegates to canonical injected ports', async () => {

    const payload = {
      delivery: {
        itemId: '2026-S-10-404-4300009479',
        status: 'ENTREGADO',
        repartidorId: '94',
        ...validDeliveryDetails('404'),
        observaciones: 'Cobrado: EFECTIVO',
        latitud: 37.6,
        longitud: -1.7,
      },
      cobro: {
        entregaId: '2026-S-10-404-4300009479',
        codigoCliente: '4300009479',
        nombreCliente: 'PEREZ DIAZ ALFONSO',
        codigoRepartidor: '94',
        tipoDocumento: 'ALBARAN',
        origenDocumento: 'B',
        subempresaDocumento: 'GMP',
        ejercicioDocumento: 2026,
        serieDocumento: 'S',
        terminalDocumento: 10,
        numeroDocumento: 404,
        xdeDocumento: 1,
        importeCobrado: 189.60,
        importePendiente: 0,
        formaPago: 'EFECTIVO',
        pantallaOrigen: 'RUTERO',
        idempotencyToken: 'rutero-token-404',
      },
    };
    payload.cobro = validCanonicalConfirmation('404').cobro;
    const validateConfirmation = jest.fn().mockResolvedValue(undefined);
    const confirm = jest.fn().mockResolvedValue({
      created: true,
      idempotent: false,
      idempotencyKey: 'rutero-token-404',
    });
    finanzasRoutes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation },
      confirmationService: { confirm },
    });

    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'rutero-token-404')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      created: true,
      idempotent: false,
    });

    expect(validateConfirmation).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(validateConfirmation.mock.calls[0][0]);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /rutero/confirm-delivery-cobro rejects the obsolete legacy payment shape', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM DSEDAC\.CVC/i.test(sql)) {
        return [{ OK: 1 }];
      }
      if (/INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)) {
        throw new Error('CVC insert failed');
      }
      return [];
    });

    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'rutero-token-fails')
      .send({
        delivery: {
          itemId: '2026-S-10-404-4300009479',
          status: 'ENTREGADO',
          repartidorId: '94',
          ...validDeliveryDetails('fails'),
        },
        cobro: {
          codigoCliente: '4300009479',
          codigoRepartidor: '94',
          tipoDocumento: 'ALBARAN',
          ejercicioDocumento: 2026,
          serieDocumento: 'S',
          terminalDocumento: 10,
          numeroDocumento: 404,
          importeCobrado: 189.60,
          formaPago: 'EFECTIVO',
          pantallaOrigen: 'RUTERO',
          idempotencyToken: 'rutero-token-fails',
        },
      });

    expect(res.status).toBe(422);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /rutero/confirm-delivery-cobro rejects mismatched delivery and cobro repartidor', async () => {
    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'rutero-token-mismatch')
      .send({
        delivery: {
          itemId: '2026-S-10-404-4300009479',
          status: 'ENTREGADO',
          repartidorId: '95',
          ...validDeliveryDetails('mismatch'),
        },
        cobro: {
          entregaId: '2026-S-10-404-4300009479',
          codigoCliente: '4300009479',
          codigoRepartidor: '94',
          tipoDocumento: 'ALBARAN',
          ejercicioDocumento: 2026,
          serieDocumento: 'S',
          terminalDocumento: 10,
          numeroDocumento: 404,
          importeCobrado: 189.60,
          formaPago: 'EFECTIVO',
          pantallaOrigen: 'RUTERO',
          idempotencyToken: 'rutero-token-mismatch',
        },
      });

    expect(res.status).toBe(422);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

   test('POST /rutero/confirm-delivery-cobro rejects legacy replay payload metadata', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) {
        return [{
          ID: 15,
          ENTREGA_APP_ID: '2026-S-10-404-4300009479',
          CODIGOVENDEDOR: '94',
          CODIGOCLIENTEALBARAN: '4300009479',
          TIPODOCUMENTO: 'ALBARAN',
          ORIGENDOCUMENTO: 'B',
          SUBEMPRESADOCUMENTO: 'GMP',
          SERIEDOCUMENTO: 'S',
          EJERCICIODOCUMENTO: 2026,
          TERMINALDOCUMENTO: 10,
          NUMERODOCUMENTO: 404,
          XDEDOCUMENTO: 1,
          DEXDOCUMENTO: 1,
          IMPORTEVENCIMIENTO: 189.60,
          IMPORTEPENDIENTE: 0,
          CODIGOFORMAPAGO: 'EFECTIVO',
          PANTALLA_ORIGEN: 'RUTERO',
        }];
      }
      if (/FROM JAVIER\.DELIVERY_STATUS/i.test(sql)) {
        return [{ CONFORMADOSN: 'ENTREGADO', FECHAACTUALIZACION: '2026-04-23 11:30:00', REPARTIDOR_ID: '94' }];
      }
      return [];
    });

    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'rutero-token-replay')
      .send({
        delivery: {
          itemId: '2026-S-10-404-4300009479',
          status: 'ENTREGADO',
          repartidorId: '94',
          ...validDeliveryDetails('replay'),
        },
        cobro: {
          codigoCliente: '4300009479',
          codigoRepartidor: '94',
          tipoDocumento: 'ALBARAN',
          ejercicioDocumento: 2026,
          serieDocumento: 'S',
          terminalDocumento: 10,
          numeroDocumento: 404,
          importeCobrado: 189.60,
          formaPago: 'EFECTIVO',
          pantallaOrigen: 'RUTERO',
          idempotencyToken: 'rutero-token-replay',
        },
      });

    expect(res.status).toBe(422);
    expect(
      mockConnQuery.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)),
    ).toBe(false);
  });

  test('POST /rutero/confirm-delivery-cobro replays through canonical injected ports', async () => {
    const validateConfirmation = jest.fn().mockResolvedValue(undefined);
    const confirm = jest.fn().mockResolvedValue({
      created: false,
      idempotent: true,
      idempotencyKey: 'rutero-token-replay',
    });
    finanzasRoutes.setCanonicalConfirmationRuntime({
      catalogService: { validateConfirmation },
      confirmationService: { confirm },
    });

    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .set('Idempotency-Key', 'rutero-token-replay')
      .send(validCanonicalConfirmation('replay'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      created: false,
      idempotent: true,
    });
    expect(validateConfirmation).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('DELETE /test-cleanup/:idempotencyToken is blocked unless explicitly enabled for tests', async () => {
    mockAuthUser = { id: 'A1', code: 'A1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['94'] };
    const res = await request(app).delete('/finanzas/test-cleanup/liq-20260424-05');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Test cleanup disabled',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('DELETE /test-cleanup remains fail-closed when the retired flag is enabled', async () => {
    process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP = 'true';
    mockAuthUser = { id: 'A1', code: 'A1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['94'] };

    const res = await request(app).delete('/finanzas/test-cleanup/cleanup-must-never-run');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'REPARTO_SCHEMA_UNAVAILABLE',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockConnQuery).not.toHaveBeenCalled();
    expect(mockConnClose).not.toHaveBeenCalled();
  });

  test('Sentry receives only strict primitive allowlist context for hostile nested payloads', async () => {
    finanzasRoutes.setCanonicalLiquidacionService({
      closeDay: jest.fn().mockRejectedValue(Object.assign(new Error('db password=never-send'), {
        code: 'LIQUIDACION_WRITE_REJECTED', statusCode: 409,
      })),
    });

    const sentinel = 'nested-value-should-never-reach-sentry';
    const res = await request(app).post('/finanzas/liquidaciones').send({
      repartidorId: '94', date: '2026-08-10', idempotencyToken: 'safe-token-1234',
      nested: { TOKEN: sentinel, authToken: sentinel, payload: { password: sentinel } },
    });

    expect(res.status).toBe(422);
    const [, rejectedOptions] = mockSentryCaptureException.mock.calls[0];
    expect(rejectedOptions.extra).toEqual({ action: 'POST /liquidaciones' });
    expect(JSON.stringify(rejectedOptions)).not.toContain(sentinel);
    expect(JSON.stringify(rejectedOptions)).not.toMatch(/token|password|body|query|params/i);
    mockSentryCaptureException.mockReset();

    const service = { closeDay: jest.fn().mockRejectedValue(Object.assign(new Error('db password=never-send'), {
      code: 'LIQUIDACION_WRITE_REJECTED', statusCode: 409,
    })) };
    finanzasRoutes.setCanonicalLiquidacionService(service);
    const allowed = await request(app).post('/finanzas/liquidaciones').send({
      repartidorId: '94', date: '2026-08-10', idempotencyToken: 'safe-token-1234',
    });
    expect(allowed.status).toBe(409);
    const [, options] = mockSentryCaptureException.mock.calls[0];
    expect(options.extra).toEqual({ action: 'POST /liquidaciones' });
    expect(JSON.stringify(options)).not.toContain(sentinel);
    expect(JSON.stringify(options)).not.toMatch(/token|password|body|query|params/i);
  });

  test('cache invalidation failure logs only a constant code, never the cache key or driver message', async () => {
    const sentinel = 'cache-driver-value-should-never-be-logged';
    mockDeleteCachePattern.mockRejectedValue(new Error(sentinel));
    finanzasRoutes.setCanonicalLiquidacionService({
      closeDay: jest.fn().mockResolvedValue({ created: true, repartidorId: '94' }),
    });

    const res = await request(app).post('/finanzas/liquidaciones').send({
      repartidorId: '94', date: '2026-08-10', idempotencyToken: 'cache-token-1234',
    });

    expect(res.status).toBe(201);
    const logs = logger.warn.mock.calls;
    expect(logs).toHaveLength(3);
    logs.forEach(([message, extra]) => {
      expect(message).toBe('[REPARTIDOR_FINANZAS] Cache invalidation failed');
      expect(extra).toEqual({ code: 'FINANCE_CACHE_INVALIDATION_FAILED' });
      expect(JSON.stringify([message, extra])).not.toContain(sentinel);
      expect(JSON.stringify([message, extra])).not.toContain('query:repartidor:finance:94');
    });
  });

  test.each([
    ['/daily-summary/ALL', 'getDailySummary'],
    ['/summary/ALL', 'getSummary'],
    ['/cuentas/ALL', 'getSaldoActual'],
  ])('rejects ALL with 422 before %s reaches finance service', async (path, method) => {
    const serviceSpy = jest.spyOn(financeService, method);

    const res = await request(app).get(`/finanzas${path}`);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNSUPPORTED_REPARTIDOR_SELECTOR');
    expect(serviceSpy).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    serviceSpy.mockRestore();
  });

  test('rejects a multi-repartidor daily selector for a repartidor before service access', async () => {
    const serviceSpy = jest.spyOn(financeService, 'getDailySummary');

    const res = await request(app).get('/finanzas/daily-summary/94,95');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MULTIPLE_REPARTIDOR_SELECTOR_FORBIDDEN');
    expect(serviceSpy).not.toHaveBeenCalled();
    serviceSpy.mockRestore();
  });

  test('allows an explicit multi-repartidor daily selector for JEFE_VENTAS', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['94', '95'] };
    const serviceSpy = jest.spyOn(financeService, 'getDailySummary').mockResolvedValue({
      repartidorId: '94,95',
      date: '2026-04-23',
      summary: {},
      cobros: [],
    });

    const res = await request(app)
      .get('/finanzas/daily-summary/94,95')
      .query({ date: '2026-04-23' });

    expect(res.status).toBe(200);
    expect(serviceSpy).toHaveBeenCalledWith({ repartidorId: '94,95', date: '2026-04-23' });
    serviceSpy.mockRestore();
  });
});
