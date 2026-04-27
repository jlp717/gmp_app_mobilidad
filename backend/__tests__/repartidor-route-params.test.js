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
    req.user = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
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
    expect(params).toEqual([2025, 4, '05', '08']);
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

  test('GET /history/documents binds repartidor codes before client code', async () => {
    const res = await request(app)
      .get('/history/documents/4300030041')
      .query({ repartidorId: '05,08', year: 2026 });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual(['05', '08', '4300030041', 2026]);
  });

  test('GET /history/delivery-summary rejects invalid repartidor ids before querying', async () => {
    const res = await request(app)
      .get('/history/delivery-summary/%27bad%27')
      .query({ year: 2025, month: 4 });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /pendientes binds a single repartidor id as parameter array', async () => {
    const entregasApp = makeEntregasApp();

    const res = await request(entregasApp)
      .get('/pendientes/02')
      .query({ date: '2026-04-21' });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);

    const [, params] = mockQueryWithParams.mock.calls[0];
    expect(params).toEqual(['02', 21, 4, 2026]);
  });
});
