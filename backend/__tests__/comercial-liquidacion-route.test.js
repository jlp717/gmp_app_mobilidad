'use strict';

const request = require('supertest');
const express = require('express');

const mockListReturns = jest.fn();
const mockListPgCollectedDocuments = jest.fn();
const mockGetDailySummary = jest.fn();
const mockSaveLiquidacion = jest.fn();
const mockRegisterReturn = jest.fn();

jest.mock('../services/comercial-devoluciones-service', () => {
  const actual = jest.requireActual('../services/comercial-devoluciones-service');
  return {
    ...actual,
    listReturns: (...args) => mockListReturns(...args),
    listPgCollectedDocuments: (...args) => mockListPgCollectedDocuments(...args),
    getDailySummary: (...args) => mockGetDailySummary(...args),
    saveLiquidacion: (...args) => mockSaveLiquidacion(...args),
    registerReturn: (...args) => mockRegisterReturn(...args),
  };
});

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const router = require('../routes/comercial-liquidacion');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('commercial settlement role guard', () => {
  test.each([
    ['GET', '/devoluciones'],
    ['GET', '/devoluciones/pdf?serie=D&numero=1'],
    ['GET', '/resumen-diario'],
    ['GET', '/ya-cobrados-pg'],
    ['POST', '/guardar'],
    ['POST', '/devoluciones'],
  ])('blocks REPARTIDOR before services for %s %s', async (method, path) => {
    const agent = request(makeApp({ code: '94', role: 'REPARTIDOR' }));
    const res = method === 'GET'
      ? await agent.get(path)
      : await agent.post(path).send({ fecha: '2026-11-02' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    expect(mockListReturns).not.toHaveBeenCalled();
    expect(mockListPgCollectedDocuments).not.toHaveBeenCalled();
    expect(mockGetDailySummary).not.toHaveBeenCalled();
    expect(mockSaveLiquidacion).not.toHaveBeenCalled();
    expect(mockRegisterReturn).not.toHaveBeenCalled();
  });

  test('blocks an unknown role before resolving vendor scope', async () => {
    const res = await request(makeApp({ code: '94' })).get('/resumen-diario');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    expect(mockGetDailySummary).not.toHaveBeenCalled();
  });

  test.each(['COMERCIAL', 'JEFE_VENTAS', 'ADMIN'])(
    'allows the explicit %s role into the route',
    async (role) => {
      mockGetDailySummary.mockResolvedValueOnce({
        summary: { totalAIngresar: 0 },
        returns: [],
      });
      const user = role === 'COMERCIAL'
        ? { code: '80', role }
        : { code: '99', role, vendorCodes: ['80'] };
      const res = await request(makeApp(user))
        .get('/resumen-diario')
        .query(role === 'COMERCIAL' ? {} : { vendedor: '80' });
      expect(res.status).toBe(200);
      expect(mockGetDailySummary).toHaveBeenCalled();
    },
  );
});

describe('GET /devoluciones', () => {
  test('forbids a commercial from querying another vendor', async () => {
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ vendedor: '15', fecha: '2026-05-31' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockListReturns).not.toHaveBeenCalled();
  });

  test('forbids ALL for a commercial without team scope', async () => {
    const res = await request(makeApp({ code: '35', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ vendedor: 'ALL', fecha: '2026-05-31' });

    expect(res.status).toBe(403);
    expect(mockListReturns).not.toHaveBeenCalled();
  });

  test('maps ALL to team codes for a scoped commercial leader', async () => {
    mockListReturns.mockResolvedValueOnce([]);
    const res = await request(makeApp({
      code: '80',
      role: 'COMERCIAL',
      vendorCodes: ['80', '72', '73', '81', '83'],
    }))
      .get('/devoluciones')
      .query({ vendedor: 'ALL', fecha: '2026-05-31' });

    expect(res.status).toBe(200);
    expect(mockListReturns).toHaveBeenCalledWith({
      vendorCodes: ['80', '72', '73', '81', '83'],
      date: '2026-05-31',
      clientCode: '',
    });
  });

  test('allows a scoped commercial to query a team vendor', async () => {
    mockListReturns.mockResolvedValueOnce([]);
    const res = await request(makeApp({
      code: '80',
      role: 'COMERCIAL',
      vendorCodes: ['80', '72'],
    }))
      .get('/devoluciones')
      .query({ vendedor: '72', fecha: '2026-05-31' });

    expect(res.status).toBe(200);
    expect(mockListReturns).toHaveBeenCalledWith({
      vendorCodes: ['72'],
      date: '2026-05-31',
      clientCode: '',
    });
  });

  test('lists returns for the commercial vendor and date', async () => {
    mockListReturns.mockResolvedValueOnce([
      { documento: 'D-1', amount: -1000, cliente: 'C1' },
    ]);

    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ fecha: '2026-05-31' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      date: '2026-05-31',
      count: 1,
    });
    expect(mockListReturns).toHaveBeenCalledWith({
      vendorCodes: ['80'],
      date: '2026-05-31',
      clientCode: '',
    });
  });

  test('rejects invalid dates', async () => {
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ fecha: '31-5-26' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('rejects impossible calendar dates before services', async () => {
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ fecha: '2026-02-31' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockListReturns).not.toHaveBeenCalled();
  });
});

describe('GET /resumen-diario', () => {
  test('returns settlement summary for jefe scoped vendor', async () => {
    mockGetDailySummary.mockResolvedValueOnce({
      date: '2026-05-31',
      cobros: { totalEfectivo: 1000, totalCheques: 0, totalPostdatados: 0 },
      returns: [],
      summary: {
        totalEfectivo: 1000,
        devolucionesYaCobradas: 0,
        totalAIngresar: 1000,
      },
    });

    const res = await request(makeApp({
      code: '99',
      role: 'JEFE_VENTAS',
      vendorCodes: ['80', '72'],
    }))
      .get('/resumen-diario')
      .query({ vendedor: '80', fecha: '2026-05-31' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.totalAIngresar).toBe(1000);
    expect(mockGetDailySummary).toHaveBeenCalledWith({
      vendorCodes: ['80'],
      date: '2026-05-31',
    });
  });

  test('maps service failures to typed 500 without leaking SQL', async () => {
    mockGetDailySummary.mockRejectedValueOnce(new Error('SQL0802'));

    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/resumen-diario')
      .query({ fecha: '2026-05-31' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Error interno del servidor');
    expect(JSON.stringify(res.body)).not.toMatch(/SQL0802/);
  });
});

describe('POST /guardar', () => {
  test('persists the commercial settlement for the signed-in vendor', async () => {
    mockSaveLiquidacion.mockResolvedValueOnce({
      vendedor: '80',
      date: '2026-09-11',
      ingresoBanco: 120,
      entregado: 80,
      source: 'JAVIER.TEST_LIQUIDACION_COMERCIAL',
      idempotent: false,
    });

    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .post('/guardar')
      .send({
        fecha: '2026-09-11',
        ingresoBanco: 120,
        entregado: 80,
        expectedTotal: 200,
        totals: { totalAIngresar: 999999 },
        saldoCliente: 999999,
        expectedRevision: '2026-11-02-10.11.12.123456',
      });

    expect(res.status).toBe(201);
    expect(res.body.saved.source).toBe('JAVIER.TEST_LIQUIDACION_COMERCIAL');
    expect(mockSaveLiquidacion).toHaveBeenCalledWith(expect.objectContaining({
      vendorCodes: ['80'],
      date: '2026-09-11',
      ingresoBanco: 120,
      entregado: 80,
      expectedRevision: '2026-11-02-10.11.12.123456',
    }));
    expect(mockSaveLiquidacion.mock.calls[0][0]).not.toHaveProperty('expectedTotal');
    expect(mockSaveLiquidacion.mock.calls[0][0]).not.toHaveProperty('totals');
  });

  test('preserves typed 409 codes without leaking internal details', async () => {
    mockSaveLiquidacion.mockRejectedValueOnce(Object.assign(
      new Error('La última liquidación necesita revisión administrativa.'),
      { code: 'LIQUIDACION_ERP_AUXILIARY_UNSUPPORTED', status: 409 },
    ));
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .post('/guardar')
      .send({ fecha: '2026-11-02', ingresoBanco: 10, entregado: 0 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      code: 'LIQUIDACION_ERP_AUXILIARY_UNSUPPORTED',
    }));
  });

  test('forbids another vendor', async () => {
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .post('/guardar')
      .send({ vendedor: '15', fecha: '2026-09-11', ingresoBanco: 1, entregado: 0 });
    expect(res.status).toBe(403);
    expect(mockSaveLiquidacion).not.toHaveBeenCalled();
  });
});

describe('POST /devoluciones', () => {
  test('creates a TEST overlay return', async () => {
    mockRegisterReturn.mockResolvedValueOnce({
      documento: 'D-4',
      amount: -1000,
      yaCobrada: true,
      source: 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
      idempotent: false,
    });

    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .post('/devoluciones')
      .send({
        fecha: '2026-09-11',
        cliente: '4300000354',
        importe: 1000,
        yaCobrada: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.return.documento).toBe('D-4');
    expect(mockRegisterReturn).toHaveBeenCalledWith(expect.objectContaining({
      vendorCodes: ['80'],
      clientCode: '4300000354',
      amount: 1000,
    }));
  });
});

describe('GET /ya-cobrados-pg', () => {
  test('returns pagarés already collected for Devuelve', async () => {
    mockListPgCollectedDocuments.mockResolvedValueOnce([
      { documento: 'M-88', formaPago: 'P1', impactoLqd: 'YA_COBRADOS' },
    ]);
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/ya-cobrados-pg');
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.impactoLqd).toBe('YA_COBRADOS');
    expect(mockListPgCollectedDocuments).toHaveBeenCalled();
  });
});
