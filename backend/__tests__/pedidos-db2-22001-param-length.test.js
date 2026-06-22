'use strict';

/**
 * ODBC 22001 / CWB0111 regression: oversized params on pedidos catalog routes.
 * Contract: clientCode + article <= 10 chars, vendor code <= 2 chars before DB binds.
 * Routes: GET /products, GET /products/:code, GET /client-evolution/:clientCode
 * getRecommendations: demo-regression-hotfixes.test.js (not duplicated here).
 * Task: 20260621-082006-gmp-b834
 */

const request = require('supertest');
const express = require('express');

const LONG_CLIENT = '4300001091_OVERFLOW';
const EXPECTED_CLIENT = '4300001091';
const LONG_ARTICLE = 'ART0012345_EXTRA_LONG_SUFFIX';
const EXPECTED_ARTICLE = 'ART0012345';
const LONG_VENDOR = '0199';
const EXPECTED_VENDOR = '01';

function expectDb2SafeBind(sql, bind, maxLen) {
  const text = bind == null ? '' : String(bind);
  const normalized = text.length <= maxLen;
  const casted = new RegExp(`CAST\\(\\?\\s+AS\\s+VARCHAR\\(${maxLen}\\)\\)`, 'i').test(String(sql || ''));
  expect(normalized || casted).toBe(true);
}

function collectVendorBindParams(scopeParams) {
  return scopeParams
    .slice(1)
    .filter((code) => typeof code === 'string' && /^[A-Za-z0-9]+$/.test(code));
}

function assertVendorBindsSafe(scopeSql, scopeParams) {
  const vendorBinds = collectVendorBindParams(scopeParams);
  expect(vendorBinds.length).toBeGreaterThan(0);
  vendorBinds.forEach((code) => {
    expect(code.length).toBeLessThanOrEqual(2);
    expectDb2SafeBind(scopeSql, code, 2);
    expect(code).toBe(EXPECTED_VENDOR);
  });
  expect(scopeParams).not.toContain(LONG_VENDOR);
}

function queueClientEvolutionDbMocks(mockQueryWithParams) {
  mockQueryWithParams
    .mockResolvedValueOnce([{ OK: 1 }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
}

const mockQueryWithParams = jest.fn();
const mockLegacySearch = jest.fn();
const mockLegacyDetail = jest.fn();
const mockCheckDraftAccumulation = jest.fn();
const mockDddRepo = { searchProducts: jest.fn(), getProductDetail: jest.fn() };
const mockDddCache = { get: jest.fn(), set: jest.fn(), invalidatePattern: jest.fn() };

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/query-optimizer', () => ({ cachedQuery: jest.fn() }));
jest.mock('../services/redis-cache', () => ({ TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 } }));
jest.mock('../services/laclae', () => ({ getClientCodesFromCache: jest.fn() }));
jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (_req, _res, next) => next(),
}));
jest.mock('../services/pedidos.service', () => ({
  getStockBatch: jest.fn(),
  searchProducts: (...args) => mockLegacySearch(...args),
  getProductDetail: (...args) => mockLegacyDetail(...args),
  checkDraftAccumulation: (...args) => mockCheckDraftAccumulation(...args),
}));
jest.mock('../src/modules/pedidos', () => ({
  Db2PedidosRepository: jest.fn(() => mockDddRepo),
}));
jest.mock('../src/modules/cobros', () => ({ Db2CobrosRepository: jest.fn(() => ({})) }));
jest.mock('../src/modules/entregas', () => ({ Db2EntregasRepository: jest.fn(() => ({})) }));
jest.mock('../src/modules/rutero', () => ({ Db2RuteroRepository: jest.fn(() => ({})) }));
jest.mock('../src/modules/auth', () => ({ Db2AuthRepository: jest.fn(() => ({})) }));
jest.mock('../src/modules/clients/infrastructure/db2-client-repository', () => ({
  Db2ClientRepository: jest.fn(() => ({})),
}));
jest.mock('../src/core/infrastructure/database/db2-connection-pool', () => ({
  Db2ConnectionPool: jest.fn(() => ({})),
}));
jest.mock('../src/core/infrastructure/cache/response-cache', () => ({
  ResponseCache: jest.fn(() => mockDddCache),
}));
jest.mock('../src/core/infrastructure/cache/performance-cache', () => ({
  performanceCache: {
    getTTL: jest.fn(() => 60),
    getOrFetch: jest.fn(async (_key, fn) => ({ source: 'test', cached: false, data: await fn() })),
  },
}));
jest.mock('../routes/entregas', () => require('express').Router());

const legacyRouter = require('../routes/pedidos');
const { createPedidosRoutes } = require('../src/shared/routes/ddd-adapters');

function makeLegacyApp(user = { code: '01', role: 'COMERCIAL' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/', legacyRouter);
  return app;
}

function makeDddApp(user = { id: '01', code: '01', role: 'COMERCIAL' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(createPedidosRoutes());
  return app;
}

describe('DB2 22001 param length: legacy pedidos routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLegacySearch.mockResolvedValue({ products: [], count: 0 });
    mockLegacyDetail.mockResolvedValue({ code: EXPECTED_ARTICLE, name: 'Prod' });
    mockQueryWithParams.mockResolvedValue([{ OK: 1 }]);
  });

  test('GET /products truncates long clientCode in scope SQL and searchProducts', async () => {
    const res = await request(makeLegacyApp())
      .get('/products')
      .query({ vendedorCodes: '01', clientCode: LONG_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeParams[0]).toBe(EXPECTED_CLIENT);
    expectDb2SafeBind(scopeSql, scopeParams[0], 10);
    expect(mockLegacySearch).toHaveBeenCalledWith(
      expect.objectContaining({ clientCode: EXPECTED_CLIENT }),
    );
  });

  test('GET /products truncates long vendedorCodes before scope SQL binds', async () => {
    const res = await request(makeLegacyApp({ code: '80', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/products')
      .query({ vendedorCodes: LONG_VENDOR, clientCode: EXPECTED_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    assertVendorBindsSafe(scopeSql, scopeParams);
  });

  test('GET /products/:code truncates long clientCode query before getProductDetail', async () => {
    mockLegacyDetail.mockResolvedValue({ code: 'ART001', name: 'Prod' });

    const res = await request(makeLegacyApp())
      .get('/products/ART001')
      .query({ vendedorCodes: '01', clientCode: LONG_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeParams[0]).toBe(EXPECTED_CLIENT);
    expectDb2SafeBind(scopeSql, scopeParams[0], 10);
    expect(mockLegacyDetail).toHaveBeenCalledWith('ART001', EXPECTED_CLIENT);
  });

  test('GET /products/:code truncates long article path before getProductDetail', async () => {
    const res = await request(makeLegacyApp())
      .get(`/products/${encodeURIComponent(LONG_ARTICLE)}`)
      .query({ vendedorCodes: '01', clientCode: 'C001' });

    expect(res.status).toBe(200);
    expect(mockLegacyDetail).toHaveBeenCalledWith(EXPECTED_ARTICLE, 'C001');
  });

  test('GET /client-evolution/:clientCode truncates long path client in all DB binds', async () => {
    queueClientEvolutionDbMocks(mockQueryWithParams);

    const res = await request(makeLegacyApp())
      .get(`/client-evolution/${encodeURIComponent(LONG_CLIENT)}`)
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(200);
    mockQueryWithParams.mock.calls.forEach(([sql, params]) => {
      expect(params[0]).toBe(EXPECTED_CLIENT);
      expectDb2SafeBind(sql, params[0], 10);
    });
  });

  test('GET /client-evolution truncates long vendedorCodes in scope binds', async () => {
    queueClientEvolutionDbMocks(mockQueryWithParams);

    const res = await request(makeLegacyApp({ code: '80', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/client-evolution/C001')
      .query({ vendedorCodes: LONG_VENDOR });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    assertVendorBindsSafe(scopeSql, scopeParams);
  });
});

describe('DB2 22001 param length: DDD pedidos routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDddCache.get.mockResolvedValue(null);
    mockDddRepo.searchProducts.mockResolvedValue({ products: [], count: 0 });
    mockDddRepo.getProductDetail.mockResolvedValue({ code: EXPECTED_ARTICLE, name: 'Prod' });
    mockQueryWithParams.mockResolvedValue([{ OK: 1 }]);
  });

  test('GET /products truncates long clientCode before scope SQL and catalog search', async () => {
    const res = await request(makeDddApp())
      .get('/products')
      .query({ vendedorCodes: '01', clientCode: LONG_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeParams[0]).toBe(EXPECTED_CLIENT);
    expectDb2SafeBind(scopeSql, scopeParams[0], 10);
    expect(mockDddRepo.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ clientCode: EXPECTED_CLIENT }),
    );
  });

  test('GET /products truncates long vendedorCodes before scope SQL binds', async () => {
    const res = await request(makeDddApp({
      id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true,
    }))
      .get('/products')
      .query({ vendedorCodes: LONG_VENDOR, clientCode: EXPECTED_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    assertVendorBindsSafe(scopeSql, scopeParams);
  });

  test('GET /products truncates each vendor in comma list to max 2 chars', async () => {
    const res = await request(makeDddApp({
      id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true,
    }))
      .get('/products')
      .query({ vendedorCodes: '01,0199', clientCode: EXPECTED_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    collectVendorBindParams(scopeParams).forEach((code) => {
      expect(code.length).toBeLessThanOrEqual(2);
      expectDb2SafeBind(scopeSql, code, 2);
    });
    expect(scopeParams).not.toContain('0199');
  });

  test('GET /products/:code truncates long clientCode query before scope SQL and detail lookup', async () => {
    mockDddRepo.getProductDetail.mockResolvedValue({ code: 'ART001', name: 'Prod' });

    const res = await request(makeDddApp())
      .get('/products/ART001')
      .query({ vendedorCodes: '01', clientCode: LONG_CLIENT });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeParams[0]).toBe(EXPECTED_CLIENT);
    expectDb2SafeBind(scopeSql, scopeParams[0], 10);
    expect(mockDddRepo.getProductDetail).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ART001', clientCode: EXPECTED_CLIENT }),
    );
  });

  test('GET /products/:code truncates long article path before product detail lookup', async () => {
    const res = await request(makeDddApp())
      .get(`/products/${encodeURIComponent(LONG_ARTICLE)}`)
      .query({ vendedorCodes: '01', clientCode: 'C001' });

    expect(res.status).toBe(200);
    expect(mockDddRepo.getProductDetail).toHaveBeenCalledWith(
      expect.objectContaining({ code: EXPECTED_ARTICLE, clientCode: 'C001' }),
    );
  });

  test('GET /client-evolution/:clientCode truncates long path client in every SQL bind', async () => {
    queueClientEvolutionDbMocks(mockQueryWithParams);

    const res = await request(makeDddApp())
      .get(`/client-evolution/${encodeURIComponent(LONG_CLIENT)}`)
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(200);
    mockQueryWithParams.mock.calls.forEach(([sql, params]) => {
      expect(params[0]).toBe(EXPECTED_CLIENT);
      expectDb2SafeBind(sql, params[0], 10);
    });
  });

  test('GET /client-evolution truncates long vendedorCodes in scope binds', async () => {
    queueClientEvolutionDbMocks(mockQueryWithParams);

    const res = await request(makeDddApp({
      id: '80', code: '80', role: 'JEFE_VENTAS', isJefeVentas: true,
    }))
      .get('/client-evolution/C001')
      .query({ vendedorCodes: LONG_VENDOR });

    expect(res.status).toBe(200);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    assertVendorBindsSafe(scopeSql, scopeParams);
  });
});

describe('AppSec: draft-status auto-confirm vendor scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckDraftAccumulation.mockResolvedValue({ warning: false, drafts: [] });
  });

  test('legacy POST auto-confirm returns 403 when COMERCIAL targets another vendor', async () => {
    const res = await request(makeLegacyApp({ code: '01', role: 'COMERCIAL' }))
      .post('/draft-status/02/auto-confirm');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockCheckDraftAccumulation).not.toHaveBeenCalled();
  });

  test('legacy POST auto-confirm allows COMERCIAL for own vendor', async () => {
    const res = await request(makeLegacyApp({ code: '01', role: 'COMERCIAL' }))
      .post('/draft-status/01/auto-confirm');

    expect(res.status).toBe(200);
    expect(mockCheckDraftAccumulation).toHaveBeenCalledWith(
      '01',
      expect.objectContaining({ autoConfirm: true }),
    );
  });

  test('DDD POST auto-confirm returns 403 when COMERCIAL targets another vendor', async () => {
    const res = await request(makeDddApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/draft-status/02/auto-confirm');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockCheckDraftAccumulation).not.toHaveBeenCalled();
  });

  test('DDD POST auto-confirm allows COMERCIAL for own vendor', async () => {
    const res = await request(makeDddApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/draft-status/01/auto-confirm');

    expect(res.status).toBe(200);
    expect(mockCheckDraftAccumulation).toHaveBeenCalledWith(
      '01',
      expect.objectContaining({ autoConfirm: true }),
    );
  });
});

describe('DB2 22001 param length: validation errors (no DB bind)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLegacySearch.mockResolvedValue({ products: [], count: 0 });
    mockQueryWithParams.mockResolvedValue([{ OK: 1 }]);
  });

  test('GET /products returns 400 when clientCode missing (legacy)', async () => {
    const res = await request(makeLegacyApp())
      .get('/products')
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockLegacySearch).not.toHaveBeenCalled();
  });

  test('GET /products returns 400 when clientCode missing (DDD)', async () => {
    const res = await request(makeDddApp())
      .get('/products')
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockDddRepo.searchProducts).not.toHaveBeenCalled();
  });

  test('GET /client-evolution returns 400 when path client empty (legacy)', async () => {
    const res = await request(makeLegacyApp())
      .get('/client-evolution/%20')
      .query({ vendedorCodes: '01' });

    expect(res.status).toBe(400);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});
