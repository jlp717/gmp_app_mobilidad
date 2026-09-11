'use strict';

const request = require('supertest');
const express = require('express');

const mockListReturns = jest.fn();
const mockGetDailySummary = jest.fn();
const mockSaveLiquidacion = jest.fn();
const mockRegisterReturn = jest.fn();

jest.mock('../services/comercial-devoluciones-service', () => {
  const actual = jest.requireActual('../services/comercial-devoluciones-service');
  return {
    ...actual,
    listReturns: (...args) => mockListReturns(...args),
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

describe('GET /devoluciones', () => {
  test('forbids a commercial from querying another vendor', async () => {
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ vendedor: '15', fecha: '2026-05-31' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockListReturns).not.toHaveBeenCalled();
  });

  test('forbids ALL for a commercial', async () => {
    const res = await request(makeApp({ code: '80', role: 'COMERCIAL' }))
      .get('/devoluciones')
      .query({ vendedor: 'ALL', fecha: '2026-05-31' });

    expect(res.status).toBe(403);
    expect(mockListReturns).not.toHaveBeenCalled();
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
      });

    expect(res.status).toBe(201);
    expect(res.body.saved.source).toBe('JAVIER.TEST_LIQUIDACION_COMERCIAL');
    expect(mockSaveLiquidacion).toHaveBeenCalledWith(expect.objectContaining({
      vendorCodes: ['80'],
      date: '2026-09-11',
      ingresoBanco: 120,
      entregado: 80,
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
