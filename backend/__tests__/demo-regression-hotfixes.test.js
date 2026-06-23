'use strict';

/**
 * Demo regression suite — hotfixes from 2026-06-12 pre-demo failures.
 * Each describe block maps 1:1 to a production incident.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

function expectDb2SafeBind(sql, bind, maxLen) {
  const text = bind == null ? '' : String(bind);
  const normalized = text.length <= maxLen;
  const casted = new RegExp(`CAST\\(\\?\\s+AS\\s+VARCHAR\\(${maxLen}\\)\\)`, 'i').test(String(sql || ''));
  expect(normalized || casted).toBe(true);
}

// ---------------------------------------------------------------------------
// BUG: Products 403 — user 98 + client 4300001091 + vendor mismatch
// ---------------------------------------------------------------------------

const mockPedidosRepoProducts = { searchProducts: jest.fn(), getProductDetail: jest.fn() };
const mockCacheProducts = { get: jest.fn(), set: jest.fn(), invalidatePattern: jest.fn() };

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../services/query-optimizer', () => ({ cachedQuery: jest.fn() }));
jest.mock('../services/redis-cache', () => ({ TTL: { SHORT: 60, MEDIUM: 300, LONG: 3600 } }));
jest.mock('../services/laclae', () => ({ getClientCodesFromCache: jest.fn() }));
jest.mock('../config/db', () => ({ query: jest.fn(), queryWithParams: jest.fn() }));
jest.mock('../src/modules/pedidos', () => ({
  Db2PedidosRepository: jest.fn(() => mockPedidosRepoProducts),
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
  ResponseCache: jest.fn(() => mockCacheProducts),
}));
jest.mock('../src/core/infrastructure/cache/performance-cache', () => ({
  performanceCache: {
    getTTL: jest.fn(() => 60),
    getOrFetch: jest.fn(async (_key, fn) => ({ source: 'test', cached: false, data: await fn() })),
  },
}));
jest.mock('../routes/entregas', () => {
  const mockExpress = require('express');
  return mockExpress.Router();
});

const { createPedidosRoutes } = require('../src/shared/routes/ddd-adapters');

function makePedidosApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(createPedidosRoutes());
  return app;
}

describe('demo regression: products 403 user 98 + client 4300001091', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheProducts.get.mockResolvedValue(null);
    mockPedidosRepoProducts.searchProducts.mockResolvedValue({ products: [], count: 0 });
    const db = require('../config/db');
    db.queryWithParams.mockResolvedValue([{ OK: 1 }]);
  });

  test('auth SQL checks CLP.VENDEDORCOMERCIAL OR LACLAE for commercial user 98', async () => {
    const db = require('../config/db');
    const res = await request(makePedidosApp({ id: '98', code: '98', role: 'COMERCIAL' }))
      .get('/products')
      .query({ vendedorCodes: '98', clientCode: '4300001091' });

    expect(res.status).toBe(200);
    const scopeSql = db.queryWithParams.mock.calls[0][0];
    expect(scopeSql).toMatch(/DSEDAC\.CLP/);
    expect(scopeSql).toMatch(/VENDEDORCOMERCIAL/);
    expect(scopeSql).toMatch(/DSED\.LACLAE/);
    expect(scopeSql).not.toMatch(/CLI\.CODIGOVENDEDOR/);
    expect(scopeSql).not.toMatch(/CODIGOVENDEDOR/);
    expect(db.queryWithParams.mock.calls[0][1]).toEqual(['4300001091', '98', '98']);
  });

  test('JEFE_VENTAS retries with assigned client vendor 02 when login vendor 98 mismatches', async () => {
    const db = require('../config/db');
    db.queryWithParams
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ VENDOR_CODE: '02' }])
      .mockResolvedValueOnce([{ OK: 1 }]);

    const res = await request(makePedidosApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    }))
      .get('/products')
      .query({ vendedorCodes: '98', clientCode: '4300001091' });

    expect(res.status).toBe(200);
    expect(mockPedidosRepoProducts.searchProducts).toHaveBeenCalledWith(expect.objectContaining({
      vendedorCodes: '02',
      clientCode: '4300001091',
    }));
  });
});

// DB2 22001 route guards (/products, /client-evolution): pedidos-db2-22001-param-length.test.js

// ---------------------------------------------------------------------------
// Remaining bugs — isolated module mocks
// ---------------------------------------------------------------------------

describe('demo regression: recommendations ODBC 22001', () => {
  const mockQueryWithParamsRec = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/db', () => ({
      query: jest.fn(),
      queryWithParams: (...args) => mockQueryWithParamsRec(...args),
      getPool: () => ({ connect: jest.fn() }),
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql) => fn(sql)),
      invalidateOnMutation: jest.fn(),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn() },
      TTL: { SHORT: 60 },
    }));
    mockQueryWithParamsRec.mockReset();
    mockQueryWithParamsRec.mockResolvedValue([]);
  });

  test('getRecommendations truncates long client/vendor params and does not throw', async () => {
    const pedidosService = require('../services/pedidos.service');
    const longClient = '4300001091_OVERFLOW_EXTRA_CHARS';
    const longVendor = '02,99,EXTRA_LONG_VENDOR_LIST';

    await expect(
      pedidosService.getRecommendations(longClient, longVendor),
    ).resolves.toMatchObject({
      clientHistory: expect.any(Array),
      similarClients: expect.any(Array),
    });

    const historyCall = mockQueryWithParamsRec.mock.calls.find(([sql]) =>
      /FROM DSEDAC\.LINDTO L/i.test(sql) && /CODIGOCLIENTEALBARAN/i.test(sql),
    );
    expect(historyCall).toBeDefined();
    expect(historyCall[0]).toMatch(/CAST\(\?\s+AS\s+VARCHAR\(10\)\)/i);
    expect(historyCall[1][0]).toBe('4300001091');

    const similarCall = mockQueryWithParamsRec.mock.calls.find(([sql]) =>
      /CODIGOVENDEDOR/i.test(sql) && /NOT EXISTS/i.test(sql),
    );
    if (similarCall) {
      expect(similarCall[0]).toMatch(/CAST\(\?\s+AS\s+VARCHAR\(2\)\)/i);
      expect(similarCall[1][0]).toBe('02');
      expect(similarCall[1][0].length).toBeLessThanOrEqual(2);
    }
  });
});

describe('demo regression: getProducts ODBC 22001 client binds', () => {
  const mockQueryWithParamsProducts = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/db', () => ({
      query: jest.fn(),
      queryWithParams: (...args) => mockQueryWithParamsProducts(...args),
      getPool: () => ({ connect: jest.fn() }),
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql) => fn(sql)),
      invalidateOnMutation: jest.fn(),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn() },
      TTL: { SHORT: 60 },
    }));
    mockQueryWithParamsProducts.mockReset();
    mockQueryWithParamsProducts.mockResolvedValue([]);
  });

  test('getProducts truncates clientCode and uses CAST for LACLAE/CLC binds', async () => {
    const pedidosService = require('../services/pedidos.service');
    const longClient = '4300001091_OVERFLOW';

    await pedidosService.getProducts({ clientCode: longClient, limit: 5, offset: 0 });

    expect(mockQueryWithParamsProducts).toHaveBeenCalled();
    const [sql, params] = mockQueryWithParamsProducts.mock.calls[0];
    expect(sql).toMatch(/TRIM\(L\.LCCDCL\)\s*=\s*CAST\(\?\s+AS\s+VARCHAR\(10\)\)/i);
    expect(sql).toMatch(/TRIM\(CLC\.CODIGOCLIENTE\)\s*=\s*CAST\(\?\s+AS\s+VARCHAR\(10\)\)/i);
    const clientBinds = params.filter((p) => p === '4300001091');
    expect(clientBinds.length).toBeGreaterThan(0);
    expect(params).not.toContain(longClient);
  });
});

describe('demo regression: clients list query shape', () => {
  function readClientListSql(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    const match = src.match(/const clients = await cachedQuery\([\s\S]*?, `([\s\S]*?)`,\s*(?:cacheKey|\{)/);
    if (!match) throw new Error(`Client list SQL template not found in ${filePath}`);
    return match[1];
  }

  function sqlWithoutComments(sql) {
    return sql.replace(/--[^\n]*/g, '');
  }

  test('legacy clients route uses ROW_NUMBER bounded join, not LATERAL', () => {
    const sql = sqlWithoutComments(readClientListSql(path.join(__dirname, '..', 'routes', 'clients.js')));
    expect(sql).not.toMatch(/\bLATERAL\b/i);
    expect(sql).toMatch(/ROW_NUMBER\s*\(\s*\)\s*OVER\s*\(/i);
    expect(sql).toMatch(/PARTITION BY LCCDCL/i);
    expect(sql).toMatch(/WHERE RN = 1/i);
  });

  test('DDD clients adapter uses ROW_NUMBER bounded join, not LATERAL', () => {
    const sql = sqlWithoutComments(readClientListSql(path.join(__dirname, '..', 'src', 'shared', 'routes', 'ddd-adapters.js')));
    expect(sql).not.toMatch(/\bLATERAL\b/i);
    expect(sql).toMatch(/ROW_NUMBER\s*\(\s*\)\s*OVER\s*\(/i);
    expect(sql).toMatch(/PARTITION BY LCCDCL/i);
    expect(sql).toMatch(/WHERE RN = 1/i);
  });
});

describe('demo regression: REPARTIDOR_COBROS GROUP BY raw columns', () => {
  const mockQueryCobros = jest.fn();
  const mockQueryWithParamsCobros = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/db', () => ({
      query: (...args) => mockQueryCobros(...args),
      queryWithParams: (...args) => mockQueryWithParamsCobros(...args),
      getPool: () => ({ connect: jest.fn() }),
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
    }));
    mockQueryCobros.mockReset();
    mockQueryWithParamsCobros.mockReset();
  });

  test('getAppSideCobrosByDoc groups COBROS by normalized document reference', async () => {
    mockQueryWithParamsCobros.mockResolvedValueOnce([{ REF: 'CVC:M-123', TOTAL: '30.00' }]);
    const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    const repo = new Db2CobrosRepository();

    const adjustments = await repo.getAppSideCobrosByDoc('C001');

    const [sql, params] = mockQueryWithParamsCobros.mock.calls[0];
    expect(sql).toMatch(/FROM JAVIER\.COBROS/i);
    expect(sql).toMatch(/GROUP BY TRIM\(REFERENCIA\)/i);
    expect(params).toEqual(['C001']);
    expect(adjustments.get('M-123')).toBe(30);
  });
});

describe('demo regression: pending-summary B7 empty client filter', () => {
  const mockQuerySummary = jest.fn();
  const mockQueryWithParamsSummary = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/db', () => ({
      query: (...args) => mockQuerySummary(...args),
      queryWithParams: (...args) => mockQueryWithParamsSummary(...args),
      getPool: () => ({ connect: jest.fn() }),
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
    }));
    mockQuerySummary.mockReset();
    mockQueryWithParamsSummary.mockReset();
  });

  test('getPendingSummary ALL without vendor scope excludes empty CODIGOCLIENTEALBARAN', async () => {
    mockQuerySummary.mockResolvedValueOnce([]);
    const { Db2CobrosRepository } = require('../src/modules/cobros/infrastructure/db2-cobros-repository');
    const repo = new Db2CobrosRepository();

    await repo.getPendingSummary('ALL', {
      userId: '98',
      userRole: 'JEFE_VENTAS',
      isJefeVentas: true,
    });

    const sql = mockQuerySummary.mock.calls[0][0];
    expect(sql).toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s*<>\s*''/i);
  });
});

describe('demo regression: pedidos offline idempotency replay', () => {
  const mockQueryWithParamsPed = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/db', () => ({
      query: jest.fn(),
      queryWithParams: (...args) => mockQueryWithParamsPed(...args),
      getPool: () => ({ connect: jest.fn() }),
    }));
    jest.doMock('../middleware/logger', () => ({
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
    }));
    jest.doMock('../services/query-optimizer', () => ({
      cachedQuery: jest.fn((fn, sql) => fn(sql)),
      invalidateOnMutation: jest.fn(),
    }));
    jest.doMock('../services/redis-cache', () => ({
      redisCache: { get: jest.fn(), set: jest.fn() },
      TTL: { SHORT: 60 },
    }));
    mockQueryWithParamsPed.mockReset();
  });

  const baseLine = {
    codigoArticulo: 'ART001',
    cantidadEnvases: 1,
    cantidadUnidades: 0,
    precioVenta: 10,
    unidadMedida: 'CAJAS',
  };

  const baseCreatePayload = {
    clientCode: 'C001',
    clientName: 'Cliente Demo',
    vendedorCode: '01',
    tipoventa: 'CC',
    observaciones: 'offline replay',
    lines: [baseLine],
  };

  test('createOrder replay same clientRequestId returns idempotent without duplicate INSERT', async () => {
    const pedidosService = require('../services/pedidos.service');
    const payloadHash = pedidosService.buildCreateOrderPayloadHash(baseCreatePayload);

    mockQueryWithParamsPed.mockImplementation(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM\s+JAVIER\.PEDIDO_IDEMPOTENCY/i.test(normalized)) {
        return [{ PEDIDO_ID: 77, PAYLOAD_HASH: payloadHash }];
      }
      if (/FROM\s+JAVIER\.PEDIDOS_CAB\s+WHERE ID = \?/i.test(normalized)) {
        return [{
          ID: 77, ESTADO: 'BORRADOR', CODIGOCLIENTE: 'C001', CODIGOVENDEDOR: '01',
          IMPORTETOTAL: 10, EJERCICIO: 2026, NUMEROPEDIDO: 100, SERIEPEDIDO: 'M',
        }];
      }
      if (/FROM\s+JAVIER\.PEDIDOS_LIN/i.test(normalized)) return [{ ID: 1, CODIGOARTICULO: 'ART001' }];
      return [];
    });

    const result = await pedidosService.createOrder({
      ...baseCreatePayload,
      clientRequestId: 'offlinesynckeydemo001',
    });

    expect(result.idempotent).toBe(true);
    expect(result.header).toMatchObject({ id: 77, estado: 'BORRADOR' });
    expect(mockQueryWithParamsPed.mock.calls.some(([sql]) => /INSERT INTO\s+JAVIER\.PEDIDOS_CAB/i.test(sql))).toBe(false);
  });
});
