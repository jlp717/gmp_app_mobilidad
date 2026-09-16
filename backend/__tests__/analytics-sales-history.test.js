'use strict';

const request = require('supertest');
const express = require('express');

const mockQueryWithParams = jest.fn();
let mockUser = { code: '98', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['15', '98'] };

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn(async (fn, sql, keyOrOpts, ttlOrParams, maybeParams) => {
    const params = Array.isArray(ttlOrParams) ? ttlOrParams : maybeParams;
    return fn(sql, params);
  }),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800 },
}));

const analyticsRouter = require('../routes/analytics');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', analyticsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { code: '98', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['15', '98'] };
  mockQueryWithParams.mockResolvedValue([]);
});

describe('GET /sales-history', () => {
  test('uses sargable ANO/MES/DIA bounds and never multiplies the date columns', async () => {
    const res = await request(makeApp())
      .get('/sales-history')
      .query({
        vendedorCodes: '15',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      });

    expect(res.status).toBe(200);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/FROM DSEDAC\.LAC L/i);
    expect(sql).not.toMatch(/ANODOCUMENTO \* 10000/);
    expect(sql).toMatch(/L\.ANODOCUMENTO > \?/);
    expect(sql).toMatch(/L\.CODIGOVENDEDOR IN \(\?\)/);
    expect(sql).toMatch(/L\.REFERENCIADOCUMENTO/);
    expect(sql).toMatch(/L\.CODIGOLOTE/);
    expect(sql).not.toMatch(/TRAZABILIDADALBARAN/);
    expect(sql).not.toMatch(/L\.REFERENCIA as ref/i);
    expect(params).toEqual(expect.arrayContaining(['15', 2026, 3, 1, 31]));
  });

  test('rejects COMERCIAL ALL before any sales-history query', async () => {
    mockUser = { code: '15', role: 'COMERCIAL' };
    const res = await request(makeApp())
      .get('/sales-history')
      .query({ vendedorCodes: 'ALL', startDate: '2026-03-01' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

describe('GET /sales-history/summary', () => {
  test('JEFE ALL omits vendor IN and never interpolates codes', async () => {
    mockQueryWithParams.mockResolvedValue([{ SALES: 0, MARGIN: 0, UNITS: 0, PRODUCT_COUNT: 0 }]);
    const res = await request(makeApp())
      .get('/sales-history/summary')
      .query({ vendedorCodes: 'ALL' });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams.mock.calls.length).toBeGreaterThan(0);
    for (const [sql, params] of mockQueryWithParams.mock.calls) {
      expect(sql).not.toMatch(/LCCDVD IN\s*\('/i);
      expect(sql).not.toMatch(/IN\s*\(\s*'ALL'\s*\)/i);
      expect(params).not.toContain('ALL');
    }
  });

  test('binds vendor codes instead of concatenating IN lists', async () => {
    mockQueryWithParams.mockResolvedValue([{ SALES: 0, MARGIN: 0, UNITS: 0, PRODUCT_COUNT: 0 }]);
    const res = await request(makeApp())
      .get('/sales-history/summary')
      .query({ vendedorCodes: '15' });

    expect(res.status).toBe(200);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/L\.LCCDVD IN \(\?\)/);
    expect(sql).not.toMatch(/IN \(\s*'15'\s*\)/);
    expect(params).toEqual(expect.arrayContaining(['15']));
  });
});

describe('GET /yoy-comparison', () => {
  test('binds year and vendor instead of interpolating IN lists', async () => {
    mockQueryWithParams.mockResolvedValue([{ SALES: 0, MARGIN: 0, CLIENTS: 0 }]);
    const res = await request(makeApp())
      .get('/yoy-comparison')
      .query({ vendedorCodes: '15', year: '2026' });

    expect(res.status).toBe(200);
    expect(mockQueryWithParams.mock.calls.length).toBeGreaterThan(0);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/LCAADC = \?/);
    expect(sql).toMatch(/IN \(\?\)/);
    expect(sql).not.toMatch(/IN \(\s*'15'\s*\)/);
    expect(params).toEqual(expect.arrayContaining([2026, '15']));
  });
});
