'use strict';

const request = require('supertest');
const express = require('express');

const mockGetStockBatch = jest.fn();

jest.mock('../services/pedidos.service', () => ({
  getStockBatch: mockGetStockBatch,
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { code: '01', role: 'COMERCIAL' };
    next();
  },
}));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800 },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pedidosRouter = require('../routes/pedidos');
const { queryWithParams: mockQueryWithParams } = require('../config/db');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', pedidosRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pedidos stock batch route contract', () => {
  test('POST /products/stock-batch validates codes array', async () => {
    const res = await request(makeApp())
      .post('/products/stock-batch')
      .send({ codes: [] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'codes array is required',
    });
    expect(mockGetStockBatch).not.toHaveBeenCalled();
  });

  test('POST /products/stock-batch deduplicates codes and returns stock object', async () => {
    mockGetStockBatch.mockResolvedValueOnce(new Map([
      ['ART001', { envases: 12, unidades: 24 }],
      ['ART002', { envases: 3, unidades: 6 }],
    ]));

    const res = await request(makeApp())
      .post('/products/stock-batch')
      .send({ codes: [' ART001 ', 'ART002', 'ART001'], almacen: 2 });

    expect(res.status).toBe(200);
    expect(mockGetStockBatch).toHaveBeenCalledWith(['ART001', 'ART002'], 2);
    expect(res.body).toEqual({
      success: true,
      stock: {
        ART001: { envases: 12, unidades: 24 },
        ART002: { envases: 3, unidades: 6 },
      },
    });
  });
});

describe('pedidos client evolution route contract', () => {
  test('GET /client-evolution/:clientCode rejects commercial querying another vendor', async () => {
    const res = await request(makeApp())
      .get('/client-evolution/C001')
      .query({ vendedorCodes: '99' });

    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /client-evolution/:clientCode returns monthly sales and returns with bound vendor scope', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([{ OK: 1 }])
      .mockResolvedValueOnce([{ YEAR: 2026, MONTH: 1, SALES: '100.50', UNITS: '4' }])
      .mockResolvedValueOnce([{ CODE: 'ART001', NAME: 'Producto', TOTAL_SALES: '80', TOTAL_UNITS: '2' }])
      .mockResolvedValueOnce([{
        YEAR: 2026,
        MONTH: 2,
        PRODUCT_CODE: 'ART002',
        PRODUCT_NAME: 'Devuelto',
        UNITS: '1',
        AMOUNT: '-12.5',
      }]);

    const res = await request(makeApp())
      .get('/client-evolution/C001')
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.years).toHaveLength(3);
    expect(res.body.monthlySales).toEqual([
      { year: 2026, month: 1, sales: 100.5, units: 4 },
    ]);
    expect(res.body.returns).toEqual([
      {
        year: 2026,
        month: 2,
        productCode: 'ART002',
        productName: 'Devuelto',
        units: 1,
        amount: -12.5,
      },
    ]);

    const clientScopeCall = mockQueryWithParams.mock.calls[0];
    expect(clientScopeCall[0]).toContain('DSEDAC.CLP');
    expect(clientScopeCall[1]).toEqual(['C001', '01', '01', '01']);

    const monthlyCall = mockQueryWithParams.mock.calls[1];
    expect(monthlyCall[0]).toMatch(/LCCDVD|R1_T8CDVD/);
    expect(monthlyCall[1]).toEqual(
      expect.arrayContaining(['C001', '01', 'CC', 'VC', 'AB', 'VT']),
    );
  });
});
