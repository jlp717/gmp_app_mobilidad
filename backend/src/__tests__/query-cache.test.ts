/**
 * Tests for Paso 4 - Query Cache (Two-Tier L1/L2)
 *
 * Validates:
 * 1. L1 in-memory cache hit/miss/eviction
 * 2. getOrSet cache-aside pattern
 * 3. Invalidation (single key + pattern)
 * 4. Cache stats tracking
 * 5. Graceful degradation without Redis
 * 6. Service integration (cache wrapping)
 */

// Mock Redis before imports
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockRejectedValue(new Error('Redis not available')),
    on: jest.fn(),
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
    quit: jest.fn(),
  }),
}));

jest.mock('../config/env', () => ({
  config: {
    redis: {
      url: 'redis://localhost:6379',
      password: undefined,
      ttl: { default: 3600, products: 86400, promotions: 1800 },
    },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { TTL } from '../utils/query-cache';

// ============================================
// Fresh QueryCacheService for each test
// ============================================

// We need a fresh instance per test, so we import the class indirectly
function createFreshCache() {
  // Reset module to get fresh singleton
  jest.resetModules();

  // Re-mock dependencies
  jest.mock('redis', () => ({
    createClient: jest.fn().mockReturnValue({
      connect: jest.fn().mockRejectedValue(new Error('Redis not available')),
      on: jest.fn(),
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      quit: jest.fn(),
    }),
  }));

  jest.mock('../config/env', () => ({
    config: {
      redis: {
        url: 'redis://localhost:6379',
        password: undefined,
        ttl: { default: 3600, products: 86400, promotions: 1800 },
      },
    },
  }));

  jest.mock('../utils/logger', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  const mod = require('../utils/query-cache');
  return mod.queryCache;
}

// ============================================
// TTL Constants
// ============================================
describe('TTL Constants', () => {
  test('exports correct TTL values', () => {
    expect(TTL.REALTIME).toBe(60);
    expect(TTL.SHORT).toBe(120);
    expect(TTL.MEDIUM).toBe(300);
    expect(TTL.LONG).toBe(1800);
    expect(TTL.STATIC).toBe(86400);
    expect(TTL.DEFAULT).toBe(3600);
  });
});

// ============================================
// L1 Cache Behavior (no Redis)
// ============================================
describe('L1 Cache (in-memory, no Redis)', () => {
  let cache: any;

  beforeEach(async () => {
    cache = createFreshCache();
    await cache.init(); // Will fail Redis, use L1 only
  });

  afterEach(async () => {
    await cache.close();
  });

  test('cache miss calls fetcher and stores result', async () => {
    const fetcher = jest.fn().mockResolvedValue({ data: 'hello' });

    const result = await cache.getOrSet('test:key', fetcher, 60);

    expect(result).toEqual({ data: 'hello' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
  });

  test('cache hit returns stored value without calling fetcher', async () => {
    const fetcher = jest.fn().mockResolvedValue({ data: 'hello' });

    // First call - miss
    await cache.getOrSet('test:key', fetcher, 60);
    // Second call - hit
    const result = await cache.getOrSet('test:key', fetcher, 60);

    expect(result).toEqual({ data: 'hello' });
    expect(fetcher).toHaveBeenCalledTimes(1); // Only called once!

    const stats = cache.getStats();
    expect(stats.hits.l1).toBe(1);
    expect(stats.misses).toBe(1);
  });

  test('different keys store independently', async () => {
    const fetcher1 = jest.fn().mockResolvedValue('value1');
    const fetcher2 = jest.fn().mockResolvedValue('value2');

    await cache.getOrSet('key:1', fetcher1, 60);
    await cache.getOrSet('key:2', fetcher2, 60);

    const result1 = await cache.getOrSet('key:1', jest.fn(), 60);
    const result2 = await cache.getOrSet('key:2', jest.fn(), 60);

    expect(result1).toBe('value1');
    expect(result2).toBe('value2');
  });

  test('invalidate removes specific key', async () => {
    const fetcher = jest.fn().mockResolvedValue('original');

    await cache.getOrSet('test:key', fetcher, 60);
    await cache.invalidate('test:key');

    // Should call fetcher again after invalidation
    const fetcher2 = jest.fn().mockResolvedValue('updated');
    const result = await cache.getOrSet('test:key', fetcher2, 60);

    expect(result).toBe('updated');
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });

  test('invalidatePattern removes matching keys', async () => {
    await cache.getOrSet('gmp:dashboard:02', jest.fn().mockResolvedValue('d1'), 60);
    await cache.getOrSet('gmp:dashboard:03', jest.fn().mockResolvedValue('d2'), 60);
    await cache.getOrSet('gmp:facturas:02', jest.fn().mockResolvedValue('f1'), 60);

    const count = await cache.invalidatePattern('gmp:dashboard:*');

    expect(count).toBe(2);

    // dashboard keys should be gone, facturas should remain
    const f1 = jest.fn().mockResolvedValue('f1_new');
    const d1 = jest.fn().mockResolvedValue('d1_new');

    await cache.getOrSet('gmp:facturas:02', f1, 60);
    await cache.getOrSet('gmp:dashboard:02', d1, 60);

    expect(f1).not.toHaveBeenCalled(); // still cached
    expect(d1).toHaveBeenCalledTimes(1); // re-fetched
  });

  test('getStats returns correct structure', async () => {
    const stats = cache.getStats();

    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('hitRate');
    expect(stats).toHaveProperty('sets');
    expect(stats).toHaveProperty('errors');
    expect(stats).toHaveProperty('invalidations');
    expect(stats).toHaveProperty('l1Size');
    expect(stats).toHaveProperty('redisConnected');
    expect(stats.redisConnected).toBe(false);
  });

  test('hit rate calculates correctly', async () => {
    const fetcher = jest.fn().mockResolvedValue('data');

    // 1 miss, then 3 hits = 75% hit rate
    await cache.getOrSet('key', fetcher, 60);
    await cache.getOrSet('key', fetcher, 60);
    await cache.getOrSet('key', fetcher, 60);
    await cache.getOrSet('key', fetcher, 60);

    const stats = cache.getStats();
    expect(stats.hitRate).toBe('75.0%');
    expect(stats.hits.total).toBe(3);
    expect(stats.misses).toBe(1);
  });

  test('isReady always true (L1 always available)', () => {
    expect(cache.isReady).toBe(true);
  });

  test('hasRedis false when Redis unavailable', () => {
    expect(cache.hasRedis).toBe(false);
  });

  test('close clears L1 cache', async () => {
    await cache.getOrSet('key', jest.fn().mockResolvedValue('data'), 60);
    expect(cache.getStats().l1Size).toBe(1);

    await cache.close();
    expect(cache.getStats().l1Size).toBe(0);
  });
});

// ============================================
// Cache handles complex data types
// ============================================
describe('Cache data serialization', () => {
  let cache: any;

  beforeEach(async () => {
    cache = createFreshCache();
    await cache.init();
  });

  afterEach(async () => {
    await cache.close();
  });

  test('caches arrays correctly', async () => {
    const data = [{ id: 1, name: 'item1' }, { id: 2, name: 'item2' }];
    const fetcher = jest.fn().mockResolvedValue(data);

    await cache.getOrSet('arr:key', fetcher, 60);
    const result = await cache.getOrSet('arr:key', jest.fn(), 60);

    expect(result).toEqual(data);
  });

  test('caches nested objects correctly', async () => {
    const data = {
      ventasHoy: { total: 1500.50, cantidad: 10 },
      clientesAtendidos: { hoy: 5, mes: 30 },
    };
    const fetcher = jest.fn().mockResolvedValue(data);

    await cache.getOrSet('nested:key', fetcher, 60);
    const result = await cache.getOrSet('nested:key', jest.fn(), 60);

    expect(result).toEqual(data);
    expect(result.ventasHoy.total).toBe(1500.50);
  });

  test('caches null/empty results', async () => {
    const fetcher = jest.fn().mockResolvedValue(null);

    await cache.getOrSet('null:key', fetcher, 60);
    const result = await cache.getOrSet('null:key', jest.fn(), 60);

    expect(result).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1); // cached null, not re-fetched
  });

  test('caches numbers and strings', async () => {
    await cache.getOrSet('num', jest.fn().mockResolvedValue(42), 60);
    await cache.getOrSet('str', jest.fn().mockResolvedValue('hello'), 60);

    const num = await cache.getOrSet('num', jest.fn(), 60);
    const str = await cache.getOrSet('str', jest.fn(), 60);

    expect(num).toBe(42);
    expect(str).toBe('hello');
  });
});

// ============================================
// Service Integration Tests
// ============================================
describe('Service cache integration', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    mockQuery.mockReset();

    jest.mock('../config/database', () => ({
      odbcPool: { query: (...args: unknown[]) => mockQuery(...args) },
    }));

    jest.mock('redis', () => ({
      createClient: jest.fn().mockReturnValue({
        connect: jest.fn().mockRejectedValue(new Error('No Redis')),
        on: jest.fn(),
        get: jest.fn(),
        setEx: jest.fn(),
        del: jest.fn(),
        keys: jest.fn(),
        quit: jest.fn(),
      }),
    }));

    jest.mock('../config/env', () => ({
      config: {
        redis: {
          url: 'redis://localhost:6379',
          password: undefined,
          ttl: { default: 3600, products: 86400, promotions: 1800 },
        },
      },
    }));

    jest.mock('../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    }));

    jest.mock('fs', () => ({
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
      readFileSync: jest.fn().mockReturnValue('[]'),
      writeFileSync: jest.fn(),
      renameSync: jest.fn(),
    }));
  });

  test('dashboard.getDashboardVendedor caches on second call', async () => {
    const { dashboardService } = require('../services/dashboard.service');

    // Mock all 9 parallel queries
    mockQuery.mockImplementation(async () => {
      return [{ TOTAL: 1000, CANTIDAD: 10, MARGEN: 200 }];
    });

    // First call: fetches from DB
    const result1 = await dashboardService.getDashboardVendedor('02');
    const queryCount1 = mockQuery.mock.calls.length;

    // Second call: should come from cache (0 new queries)
    const result2 = await dashboardService.getDashboardVendedor('02');
    const queryCount2 = mockQuery.mock.calls.length;

    expect(queryCount2).toBe(queryCount1); // No new queries!
    expect(result1).toEqual(result2);
  });

  test('facturas.getFacturaDetail caches on second call', async () => {
    const { facturasService } = require('../services/facturas.service');

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FETCH FIRST 1')) {
        return [{
          NUMEROFACTURA: 100, SERIEFACTURA: 'A', EJERCICIOFACTURA: 2026,
          DIAFACTURA: 14, MESFACTURA: 2, ANOFACTURA: 2026,
          CODIGOCLIENTE: 'CLI001',
          NOMBRECLIENTEFACTURA: 'TEST', DIRECCIONCLIENTEFACTURA: 'DIR',
          POBLACIONCLIENTEFACTURA: 'POB', CIFCLIENTEFACTURA: 'CIF',
          TOTALFACTURA: 1500,
          IMPORTEBASEIMPONIBLE1: 1200, PORCENTAJEIVA1: 10, IMPORTEIVA1: 120,
          IMPORTEBASEIMPONIBLE2: 0, PORCENTAJEIVA2: 0, IMPORTEIVA2: 0,
          IMPORTEBASEIMPONIBLE3: 0, PORCENTAJEIVA3: 0, IMPORTEIVA3: 0,
        }];
      }
      return [{ CODIGOARTICULO: 'A01', DESCRIPCIONARTICULO: 'Item', CANTIDAD: 5, PRECIO: 10, IMPORTE: 50, DESCUENTO: 0 }];
    });

    await facturasService.getFacturaDetail('A', 100, 2026);
    const firstCallCount = mockQuery.mock.calls.length;

    await facturasService.getFacturaDetail('A', 100, 2026);
    const secondCallCount = mockQuery.mock.calls.length;

    expect(secondCallCount).toBe(firstCallCount); // Cached!
  });

  test('different parameters create different cache entries', async () => {
    const { dashboardService } = require('../services/dashboard.service');

    mockQuery.mockResolvedValue([{ TOTAL: 100, CANTIDAD: 1, MARGEN: 10 }]);

    await dashboardService.getTopClientes('02', 10);
    const call1 = mockQuery.mock.calls.length;

    await dashboardService.getTopClientes('03', 10); // Different vendor
    const call2 = mockQuery.mock.calls.length;

    expect(call2).toBeGreaterThan(call1); // New vendor = new query
  });
});

// ============================================
// Cache key generation
// ============================================
describe('Cache key naming convention', () => {
  let cache: any;

  beforeEach(async () => {
    cache = createFreshCache();
    await cache.init();
  });

  afterEach(async () => {
    await cache.close();
  });

  test('keys follow gmp:entity:identifier pattern', async () => {
    // Simulate the actual key patterns used by services
    const keys = [
      'gmp:dashboard:02',
      'gmp:dashboard:mensuales:02:2026',
      'gmp:dashboard:top:02:10',
      'gmp:facturas:02:2026::',
      'gmp:facturas:detail:A:100:2026',
      'gmp:productos:CLI001:1:100::',
      'gmp:clientes:list:500:0::',
      'gmp:ventas:historico:CLI001:::::',
      'gmp:rutero:dia:lunes',
      'gmp:roles:conductores',
    ];

    for (const key of keys) {
      await cache.getOrSet(key, jest.fn().mockResolvedValue('data'), 60);
    }

    expect(cache.getStats().l1Size).toBe(keys.length);

    // Pattern invalidation works
    const dashboardCount = await cache.invalidatePattern('gmp:dashboard:*');
    expect(dashboardCount).toBe(3);

    expect(cache.getStats().l1Size).toBe(keys.length - 3);
  });
});
