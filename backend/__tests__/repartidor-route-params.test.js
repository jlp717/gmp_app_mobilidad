'use strict';

const request = require('supertest');
const express = require('express');

const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../app/services/pdfService', () => ({
  generateInvoicePDF: jest.fn(),
}));

jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: jest.fn(() => false),
  isDeliveryStatusNewSchema: jest.fn(() => false),
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => "CAST(NULL AS VARCHAR(20)) as DS_STATUS"),
}));

jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(),
  generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['02', '05', '08'] };
    next();
  },
}));

jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker {
    constructor(options) {
      this.options = options;
    }
  },
}));

jest.mock('../app/services/deliveryReceiptService', () => ({
  generateDeliveryReceipt: jest.fn(),
}));

jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));

const repartidorRoutes = require('../routes/repartidor');
const entregasRoutes = require('../routes/entregas');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', repartidorRoutes);
  return app;
}

function makeEntregasApp() {
  const app = express();
  app.use(express.json());
  app.use('/', entregasRoutes);
  return app;
}

describe('Repartidor route parameter binding', () => {
  let app;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockResolvedValue([]);
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
  });

  test('GET /history/delivery-summary binds repartidor codes without embedded quotes', async () => {
    const res = await request(app)
      .get('/history/delivery-summary/05,08')
      .query({ year: 2025, month: 4 });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual([2025, 4, '05', '08', 'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO', '05', '08']);
    const [sql] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('OR EXISTS');
    expect(sql).toContain('C_SCOPE.REPARTIDOR_ID');
    expect(params).not.toContain("'05'");
    expect(params).not.toContain("'08'");
  });

  test('GET /collections/summary binds repartidor codes without embedded quotes', async () => {
    const res = await request(app)
      .get('/collections/summary/05,08')
      .query({ year: 2025, month: 4 });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual([4, 2025, '05', '08']);
    expect(params).not.toContain("'05'");
    expect(params).not.toContain("'08'");
  });

  test('GET /collections/daily binds repartidor codes without embedded quotes', async () => {
    const res = await request(app)
      .get('/collections/daily/05,08')
      .query({ year: 2025, month: 4 });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual([2025, 4, '05', '08']);
    expect(params).not.toContain("'05'");
    expect(params).not.toContain("'08'");
  });

  test('GET /history/documents binds repartidor codes before client code', async () => {
    const res = await request(app)
      .get('/history/documents/4300030041')
      .query({ repartidorId: '05,08', year: 2026 });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual(['05', '08', '4300030041', '05', '08', 'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO', '05', '08', 2026, 0, 50]);
    expect(sql).toContain('OR EXISTS');
    expect(sql).toContain('C_SCOPE.REPARTIDOR_ID');
  });

  test('GET /history/delivery-summary rejects invalid repartidor ids before querying', async () => {
    const res = await request(app)
      .get('/history/delivery-summary/%27bad%27')
      .query({ year: 2025, month: 4 });

    expect(res.status).toBe(422);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /history/clients uses normalized multivalue search safely', async () => {
    const res = await request(app)
      .get('/history/clients/05')
      .query({ search: 'Heladería Cachmba C/ Mayor', limit: 10, offset: 0 });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('WITH MATCHED_DELIVERIES');
    expect(sql).toContain('FROM DSEDAC.OPP OPP');
    expect(sql).toContain('FROM MATCHED_DELIVERIES DELIVERIES');
    expect(sql).toContain('WHERE (TRIM(OPP.CODIGOREPARTIDOR) IN (?)');
    expect(sql).toContain('C_EFFECTIVE.REPARTIDOR_ID IS NOT NULL');
    expect(sql).toContain('CLI.DIRECCION');
    expect(sql).toContain('CLI.CODIGOPOSTAL');
    expect(sql).toContain('CLI.NIF');
    expect(sql).toContain('CLI.TELEFONO1');
    expect(sql).toContain('CLI.TELEFONO2');
    expect(sql).toContain("''''");
    expect(sql).toContain("'&'");
    expect(params).toEqual(expect.arrayContaining([
      '%HELADERIA%',
      '%CACHMBA%',
      '%C%A%C%H%M%B%A%',
      '%MAYOR%',
    ]));
    expect(params[0]).toBe('05');
    expect(params[1]).toBe('05');
    expect(params.slice(-2)).toEqual([0, 11]);
  });
  test('GET /pendientes binds a single repartidor id as parameter array', async () => {
    const entregasApp = makeEntregasApp();
    mockCachedQuery.mockResolvedValueOnce([
      { CODIGO: 'CTR', DESCRIPCION: 'Contado', TIPO: 'CONTADO', DEBE_COBRAR: 'S', PUEDE_COBRAR: 'S' },
    ]);


    const res = await request(entregasApp)
      .get('/pendientes/02')
      .query({ date: '2026-04-21' });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual(['02', 21, 4, 2026, 0, 101]);
  });
});
