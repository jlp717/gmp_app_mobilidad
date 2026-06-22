'use strict';

const request = require('supertest');
const express = require('express');

function expectDb2SafeBind(sql, bind, maxLen) {
  const text = bind == null ? '' : String(bind);
  const normalized = text.length <= maxLen;
  const casted = new RegExp(`CAST\\(\\?\\s+AS\\s+VARCHAR\\(${maxLen}\\)\\)`, 'i').test(String(sql || ''));
  expect(normalized || casted).toBe(true);
}

const mockGetStockBatch = jest.fn();
const mockSearchProducts = jest.fn();
const mockGetProductDetail = jest.fn();

jest.mock('../services/pedidos.service', () => ({
  getStockBatch: mockGetStockBatch,
  searchProducts: mockSearchProducts,
  getProductDetail: (...args) => mockGetProductDetail(...args),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => next(),
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

function makeApp(user = { code: '01', role: 'COMERCIAL' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
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

  test('POST /products/stock-batch truncates long article codes before getStockBatch', async () => {
    mockGetStockBatch.mockResolvedValueOnce(new Map());
    const longCode = 'ART00123456_EXTRA';

    const res = await request(makeApp())
      .post('/products/stock-batch')
      .send({ codes: [longCode] });

    expect(res.status).toBe(200);
    expect(mockGetStockBatch).toHaveBeenCalledWith(['ART0012345'], 1);
  });
});

describe('pedidos products route contract', () => {
  test('GET /products truncates long clientCode before scope SQL and searchProducts', async () => {
    mockSearchProducts.mockResolvedValueOnce({ products: [], count: 0 });
    mockQueryWithParams.mockResolvedValue([{ OK: 1 }]);
    const longClient = '4300001091_OVERFLOW_EXTRA_CHARS';

    const res = await request(makeApp())
      .get('/products')
      .query({ vendedorCodes: '01', clientCode: longClient });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeParams[0]).toBe('4300001091');
    expectDb2SafeBind(scopeSql, scopeParams[0], 10);
    expect(mockSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ clientCode: '4300001091' }),
    );
  });

  test('GET /products truncates long vendedorCodes in scope SQL binds', async () => {
    mockSearchProducts.mockResolvedValueOnce({ products: [], count: 0 });
    mockQueryWithParams.mockResolvedValue([{ OK: 1 }]);

    const res = await request(makeApp({ code: '80', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/products')
      .query({ vendedorCodes: '0199', clientCode: '4300001091' });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    scopeParams.slice(1).forEach((code) => {
      if (typeof code === 'string' && /^[A-Za-z0-9]+$/.test(code)) {
        expectDb2SafeBind(scopeSql, code, 2);
      }
    });
  });

  test('GET /products/:code truncates long article path before getProductDetail', async () => {
    mockGetProductDetail.mockResolvedValueOnce({ code: 'ART0012345', name: 'Prod' });
    mockQueryWithParams.mockResolvedValue([{ OK: 1 }]);
    const longArticle = 'ART0012345_EXTRA_LONG_SUFFIX';

    const res = await request(makeApp())
      .get(`/products/${encodeURIComponent(longArticle)}`)
      .query({ vendedorCodes: '01', clientCode: 'C001' });

    expect(res.status).toBe(200);
    expect(mockGetProductDetail).toHaveBeenCalledWith('ART0012345', 'C001');
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
    expect(clientScopeCall[0]).toContain('DSEDAC.CLI');
    expect(clientScopeCall[1]).toEqual(['C001', '01', '01']);

    const monthlyCall = mockQueryWithParams.mock.calls[1];
    expect(monthlyCall[0]).toContain('DSED.LACLAE');
    const startYear = new Date().getFullYear() - 2;
    expect(monthlyCall[1]).toEqual(
      expect.arrayContaining(['C001', startYear, 'CC', 'VC', 'AB', 'VT', '01']),
    );
  });

  test('GET /client-evolution/:clientCode truncates long path client in all DB binds', async () => {
    const longClient = '4300001091_OVERFLOW_EXTRA_CHARS';
    mockQueryWithParams
      .mockResolvedValueOnce([{ OK: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(makeApp())
      .get(`/client-evolution/${encodeURIComponent(longClient)}`)
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(200);
    for (const [sql, params] of mockQueryWithParams.mock.calls) {
      expect(params[0]).toBe('4300001091');
      expectDb2SafeBind(sql, params[0], 10);
    }
  });

  test('GET /client-evolution/:clientCode truncates long vendor codes in scope binds', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([{ OK: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await request(makeApp({ code: '80', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/client-evolution/C001')
      .query({ vendedorCodes: '0199' });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    scopeParams.slice(1).forEach((code) => {
      if (typeof code === 'string' && /^[A-Za-z0-9]+$/.test(code)) {
        expectDb2SafeBind(scopeSql, code, 2);
      }
    });
  });
});
