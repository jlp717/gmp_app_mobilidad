'use strict';

/**
 * F5 cache unico — contrato jest (F5-01 + F5-02).
 * F5-01: patron kpi emitido en el bus central borra claves kpi.
 * F5-02: TTL por dominio con constantes nombradas; alertas 7 dias intactas;
 *         dinero/cobros en REALTIME 60.
 */

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/redis-cache', () => {
  const hooks = [];
  return {
    TTL: { DEFAULT: 3600, SHORT: 300, MEDIUM: 1800, LONG: 86400, REALTIME: 60 },
    TTL_BY_DOMAIN: { ALERTS: 604800, MONEY: 60, COBROS: 60 },
    onInvalidationPattern: jest.fn((hook) => {
      hooks.push(hook);
      return () => {};
    }),
    invalidateCache: jest.fn(async (pattern) => {
      for (const hook of hooks) hook(pattern);
    }),
    __hooks: hooks,
  };
});

const central = require('../services/redis-cache');
const kpiCache = require('../kpi/services/redis_cache');
const httpCache = require('../middleware/http-cache');

function makeFakeKpiRedis(initialKeys) {
  const store = new Map(
    (initialKeys || []).map((k) => [k, JSON.stringify([{ alert: 1 }])]),
  );
  const client = {
    isOpen: true,
    scan: jest.fn(async (_cursor, opts = {}) => {
      const prefix = String(opts.MATCH || '').replace(/\*$/, '');
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { cursor: 0, keys };
    }),
    del: jest.fn(async (keys) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      arr.forEach((k) => store.delete(k));
      return arr.length;
    }),
    set: jest.fn(async () => 'OK'),
    get: jest.fn(async () => null),
    __store: store,
  };
  return client;
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('F5-01 invalidacion cruzada KPI via bus central', () => {
  test('patron kpi borra claves kpi:alerts y actualiza last_load', async () => {
    const fake = makeFakeKpiRedis(['kpi:alerts:001', 'kpi:alerts:002', 'other:1']);
    kpiCache.__setRedisClientForTests(fake);

    await central.invalidateCache('gmp:kpi*');
    await flush();

    expect(fake.scan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ MATCH: 'kpi:alerts:*' }),
    );
    expect(fake.del).toHaveBeenCalledWith(
      expect.arrayContaining(['kpi:alerts:001', 'kpi:alerts:002']),
    );
    expect(fake.__store.has('kpi:alerts:001')).toBe(false);
    expect(fake.__store.has('kpi:alerts:002')).toBe(false);
    expect(fake.__store.has('other:1')).toBe(true);
    expect(fake.set).toHaveBeenCalledWith(
      'kpi:last_load',
      expect.stringContaining('cache_invalidated'),
    );
  });

  test('patron no-kpi no toca claves kpi', async () => {
    const fake = makeFakeKpiRedis(['kpi:alerts:001']);
    kpiCache.__setRedisClientForTests(fake);

    await kpiCache.handleKpiInvalidationPattern('gmp:query:*');
    await flush();

    expect(fake.del).not.toHaveBeenCalled();
    expect(fake.__store.has('kpi:alerts:001')).toBe(true);
  });

  test('hook kpi registrado en bus central (fan-out funcional)', async () => {
    // tests/setup.js hace jest.clearAllMocks() en beforeEach: no afirmar
    // historial del mock, sino el fan-out real via __hooks.
    expect(central.__hooks.length).toBeGreaterThanOrEqual(1);
    const fake = makeFakeKpiRedis(['kpi:alerts:009']);
    kpiCache.__setRedisClientForTests(fake);
    await central.invalidateCache('kpi*');
    await flush();
    expect(fake.__store.has('kpi:alerts:009')).toBe(false);
  });
});

describe('F5-02 TTL por dominio', () => {
  test('alertas KPI 7 dias intactas', () => {
    expect(kpiCache.KPI_TTL_BY_DOMAIN.ALERTS).toBe(604800);
    expect(kpiCache.KPI_CACHE_TTL).toBe(604800);
    expect(central.TTL_BY_DOMAIN.ALERTS).toBe(604800);
  });

  test('dinero y cobros en REALTIME 60 con constantes nombradas', () => {
    expect(central.TTL.REALTIME).toBe(60);
    expect(central.TTL_BY_DOMAIN.MONEY).toBe(60);
    expect(central.TTL_BY_DOMAIN.COBROS).toBe(60);
    expect(kpiCache.KPI_TTL_BY_DOMAIN.MONEY).toBe(60);
    expect(kpiCache.KPI_TTL_BY_DOMAIN.COBROS).toBe(60);
  });

  test('http-cache no almacena lecturas de dinero (cobros)', () => {
    const req = {
      method: 'GET',
      path: '/api/cobros',
      originalUrl: '/api/cobros',
      baseUrl: '/api',
      query: {},
      headers: {},
      user: { id: '01', role: 'COMERCIAL' },
    };
    expect(httpCache.isMoneyNoStorePath(req)).toBe(true);

    const res = {
      statusCode: 200,
      setHeader: jest.fn(),
      json: jest.fn(),
    };
    const next = jest.fn();
    httpCache.cacheMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
});
