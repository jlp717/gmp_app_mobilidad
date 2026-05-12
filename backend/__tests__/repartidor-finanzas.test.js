'use strict';

const express = require('express');
const request = require('supertest');

const mockQueryWithParams = jest.fn();
const mockConnQuery = jest.fn();
const mockConnClose = jest.fn();
let mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };

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

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/finanzas', finanzasRoutes);
  return app;
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
  ].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    app = makeApp();
  });

  afterEach(() => {
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
      ]);

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
    // First call is schema detection, second is the totals query
    const totalsCall = mockQueryWithParams.mock.calls.find(c => c[1] && c[1][0] === '94');
    expect(totalsCall[1]).toEqual(['94', 20260423]);
  });

  test('GET /daily-summary aggregates multiple repartidores for jefe view', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
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
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/finanzas/daily-summary/94,95')
      .query({ date: '2026-04-23' });

    expect(res.status).toBe(200);
    expect(res.body.repartidorId).toBe('94,95');
    expect(res.body.summary.totalCobrosDia).toBe(350);
    expect(res.body.summary.totalAIngresar).toBe(375);

    const totalsCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /SUM\(CASE WHEN UPPER\(TRIM\(CODIGOFORMAPAGO\)\)/i.test(sql)
    );
    expect(totalsCall[0]).toContain('TRIM(CODIGOVENDEDOR) IN (?, ?)');
    expect(totalsCall[1]).toEqual(['94', '95', 20260423]);
  });

  test('GET /daily-summary blocks repartidor access to another repartidor', async () => {
    mockAuthUser = { id: 'V94', code: '94', role: 'REPARTIDOR' };
    const res = await request(app)
      .get('/finanzas/daily-summary/95')
      .query({ date: '2026-04-23' });

    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
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
    }]);

    const res = await request(app)
      .get('/finanzas/vencimientos/94')
      .query({ from: '2026-04-01', to: '2026-04-30', limit: 25 });

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
    expect(params).toEqual(['94', 20251202, 20260828, 1000]);
  });

  test('GET /commissions/summary uses ERP collected amount and accepts jefe multi-repartidor view', async () => {
    mockAuthUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
    mockQueryWithParams
      .mockResolvedValueOnce(alignedSchemaRows)
      .mockResolvedValueOnce([{ TOTAL_REPARTIDO: '1000' }])
      .mockResolvedValueOnce([{ TOTAL_COBRADO: '275' }])
      .mockResolvedValueOnce([{
        ID: 1,
        THRESHOLD_PCT: '20',
        COMMISSION_PCT: '1',
        SORT_ORDER: 1,
      }]);

    const res = await request(app)
      .get('/finanzas/commissions/summary/94,95')
      .query({ from: '2026-04-01', to: '2026-04-30' });

    expect(res.status).toBe(200);
    expect(res.body.deliveredAmount).toBe(1000);
    expect(res.body.collectedAmount).toBe(275);
    expect(res.body.collectedPct).toBe(27.5);

    const collectedCall = mockQueryWithParams.mock.calls.find(([sql]) =>
      /CVC\.IMPORTEPENDIENTE/i.test(sql)
    );
    expect(collectedCall[0]).toContain('TRIM(OPP.CODIGOREPARTIDOR) IN (?, ?)');
    expect(collectedCall[1]).toEqual(['94', '95', 20260401, 20260430]);
  });

   test('POST /liquidaciones closes in configured LQD once and replays by idempotency token', async () => {
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
        gastos: 0,
        efectivo2: 0,
        entregado2: 0,
      },
    };

    const first = await request(app).post('/finanzas/liquidaciones').send(payload);
    const replay = await request(app).post('/finanzas/liquidaciones').send(payload);

    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(replay.status).toBe(200);
    expect(replay.body.created).toBe(false);

    const lqdInsert = mockConnQuery.mock.calls.find(([sql]) =>
      /INSERT INTO (JAVIER|DSEDAC)\.LQD/i.test(sql)
    );
    expect(lqdInsert).toBeDefined();
    expect(lqdInsert[0]).toContain('IDMARCALIQUIDACION');
    expect(lqdInsert[1]).toContain('liq-20260423-94');

    const lqdInserts = mockConnQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO (JAVIER|DSEDAC)\.LQD/i.test(sql)
    );
    expect(lqdInserts).toHaveLength(1);

    expect(mockConnQuery.mock.calls.some(([sql]) =>
      /LOCK TABLE JAVIER\.REPARTIDOR_COBROS IN EXCLUSIVE MODE/i.test(sql)
    )).toBe(true);
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

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

  test('POST /cobros rejects idempotency token replay with different payload', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM DSEDAC\.CPC/i.test(sql)) {
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

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(mockConnQuery.mock.calls.some(([sql]) =>
      /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)
    )).toBe(false);
  });

  test('POST /cobros rejects a second payment for the same document with a different token', async () => {
    mockQueryWithParams.mockResolvedValue(alignedSchemaRows);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM DSEDAC\.CVC/i.test(sql)) return [{ OK: 1 }];
      if (/WHERE IDEMPOTENCY_TOKEN = \?/i.test(sql)) return [];
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql) && /NUMERODOCUMENTO/i.test(sql)) {
        return [{ ID: 901, IDEMPOTENCY_TOKEN: 'previous-token-404' }];
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
      importeCobrado: 189.60,
      importePendiente: 0,
      formaPago: 'EFECTIVO',
      pantallaOrigen: 'RUTERO',
      idempotencyToken: 'second-token-404',
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'PAYMENT_ALREADY_REGISTERED',
    });

    const statements = mockConnQuery.mock.calls.map(([sql]) => sql);
    const lockIndex = statements.findIndex((sql) => /LOCK TABLE JAVIER\.REPARTIDOR_COBROS IN EXCLUSIVE MODE/i.test(sql));
    const insertIndex = statements.findIndex((sql) => /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql));

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBe(-1);
  });

  test('POST /cobros rejects altered document discriminator fields for the same ERP document', async () => {
    mockQueryWithParams.mockResolvedValue(alignedSchemaRows);
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM DSEDAC\.CVC/i.test(sql)) return [];
      if (/FROM DSEDAC\.CPC/i.test(sql)) return [{ OK: 1 }];
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

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      code: 'DOCUMENT_NOT_ASSIGNED',
    });
    expect(
      mockConnQuery.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)),
    ).toBe(false);
  });

  test('POST /rutero/confirm-delivery-cobro inserts delivery status and cobro in one transaction', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM DSEDAC\.CVC/i.test(sql)) return [{ OK: 1 }];
      return [];
    });

    const payload = {
      delivery: {
        itemId: '2026-S-10-404-4300009479',
        status: 'ENTREGADO',
        repartidorId: '94',
        observaciones: 'Cobrado: EFECTIVO',
        firma: 'uploads/signature.png',
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

    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      created: true,
      idempotent: false,
    });

    const statements = mockConnQuery.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toMatch(/BEGIN WORK/i);
    expect(statements.some((sql) => /INSERT INTO JAVIER\.DELIVERY_STATUS/i.test(sql))).toBe(true);
    expect(statements.some((sql) => /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql))).toBe(true);
    expect(statements.at(-1)).toMatch(/COMMIT/i);
  });

  test('POST /rutero/confirm-delivery-cobro rolls back delivery if cobro insert fails', async () => {
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
      .send({
        delivery: {
          itemId: '2026-S-10-404-4300009479',
          status: 'ENTREGADO',
          repartidorId: '94',
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

    expect(res.status).toBe(500);
    expect(
      mockConnQuery.mock.calls.some(([sql]) => /ROLLBACK/i.test(sql)),
    ).toBe(true);
    expect(
      mockConnQuery.mock.calls.some(([sql]) => /COMMIT/i.test(sql)),
    ).toBe(false);
  });

  test('POST /rutero/confirm-delivery-cobro rejects mismatched delivery and cobro repartidor', async () => {
    const res = await request(app)
      .post('/finanzas/rutero/confirm-delivery-cobro')
      .send({
        delivery: {
          itemId: '2026-S-10-404-4300009479',
          status: 'ENTREGADO',
          repartidorId: '95',
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

    expect(res.status).toBe(400);
    expect(mockConnQuery).not.toHaveBeenCalled();
  });

   test('POST /rutero/confirm-delivery-cobro replays an already completed token without duplicate inserts', async () => {
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
      .send({
        delivery: {
          itemId: '2026-S-10-404-4300009479',
          status: 'ENTREGADO',
          repartidorId: '94',
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

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      created: false,
      idempotent: true,
    });
    expect(
      mockConnQuery.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.REPARTIDOR_COBROS/i.test(sql)),
    ).toBe(false);
  });

  test('DELETE /test-cleanup/:idempotencyToken is blocked unless explicitly enabled for tests', async () => {
    const res = await request(app).delete('/finanzas/test-cleanup/liq-20260424-05');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Test cleanup disabled',
    });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});
