'use strict';

const express = require('express');
const request = require('supertest');

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
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: 'V94', code: '94', role: 'REPARTIDOR' };
    next();
  },
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

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REPARTIDOR_FINANCE_ENABLE_TEST_CLEANUP;
    mockConnQuery.mockResolvedValue([]);
    mockConnClose.mockResolvedValue();
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
          FECHA_COBRO: '2026-04-23 11:28:57',
          CODIGO_CLIENTE: '4300009479',
          NOMBRE_CLIENTE: 'PEREZ DIAZ ALFONSO',
          FORMA_PAGO: 'EFECTIVO',
          TIPO_DOCUMENTO: 'CAC',
          SERIE_DOCUMENTO: 'S',
          TERMINAL_DOCUMENTO: 10,
          NUMERO_DOCUMENTO: 404,
          EJERCICIO_DOCUMENTO: 2026,
          XDE_DOCUMENTO: 1,
          IMPORTE_COBRADO: '189.60',
          IMPORTE_PENDIENTE: '0',
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
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(['94', '2026-04-23']);
  });

  test('GET /vencimientos builds due dates from split CVC fields, never from FECHAVENCIMIENTO', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{
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

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).not.toContain('FECHAVENCIMIENTO');
    expect(sql).toContain('ANOVENCIMIENTO');
    expect(params).toEqual(['94', 20260401, 20260430, 25]);
  });

  test('POST /liquidaciones closes in DSEDAC.LQD once and replays by idempotency token', async () => {
    const existingRow = {
      ID: '501',
      IDEMPOTENCY_TOKEN: 'liq-20260423-94',
      CODIGO_REPARTIDOR: '94',
      SUBEMPRESA_LIQ: 'GMP',
      EJERCICIO_LIQ: 2026,
      SERIE_LIQ: 'A',
      TERMINAL_LIQ: 94,
      NUMERO_LIQ: 2,
      TOTAL_EFECTIVO: '222.79',
      TOTAL_CHEQUES: '0',
      TOTAL_TARJETA: '0',
      TOTAL_POSTDATADOS: '0',
      SALDO_ANTERIOR: '0',
      TOTAL_COBROS_DIA: '222.79',
      TOTAL_A_INGRESAR: '222.79',
      INGRESO_BANCO: '222.79',
      SALDO_RESULTANTE: '0',
      STATUS: 'CLOSED',
    };

    mockQueryWithParams
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        NEXT_NUMERO: 2,
      }])
      .mockResolvedValueOnce([existingRow])
      .mockResolvedValueOnce([existingRow]);

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

    const dsedacInsert = mockConnQuery.mock.calls.find(([sql]) =>
      /INSERT INTO DSEDAC\.LQD/i.test(sql)
    );
    expect(dsedacInsert).toBeDefined();
    expect(dsedacInsert[0]).toContain('IDMARCALIQUIDACION');
    expect(dsedacInsert[1]).toContain('liq-20260423-94');

    const lqdInserts = mockConnQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO DSEDAC\.LQD/i.test(sql)
    );
    expect(lqdInserts).toHaveLength(1);
  });

  test('POST /rutero/confirm-delivery-cobro inserts delivery status and cobro in one transaction', async () => {
    mockConnQuery.mockResolvedValue([]);

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

  test('POST /rutero/confirm-delivery-cobro replays an already completed token without duplicate inserts', async () => {
    mockConnQuery.mockImplementation(async (sql) => {
      if (/FROM JAVIER\.REPARTIDOR_COBROS/i.test(sql)) {
        return [{ ID: 15 }];
      }
      if (/FROM JAVIER\.DELIVERY_STATUS/i.test(sql)) {
        return [{ STATUS: 'ENTREGADO', UPDATED_AT: '2026-04-23 11:30:00', REPARTIDOR_ID: '94' }];
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
