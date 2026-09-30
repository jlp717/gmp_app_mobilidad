'use strict';

/**
 * P0 latency: invalidateRuteroCachesAfterPedido must not fan out multi-pattern SCAN.
 * Stock/catalog invalidation bumps a shared version marker (+ one pedidos SCAN).
 */

const mockDeleteCachePattern = jest.fn().mockResolvedValue(0);
const mockInvalidatePattern = jest.fn().mockResolvedValue(undefined);
const mockIncrementVersion = jest.fn().mockResolvedValue('2');
const mockGetRemote = jest.fn().mockResolvedValue('1');
const mockGet = jest.fn().mockResolvedValue(null);
const mockSet = jest.fn().mockResolvedValue(true);

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
  getPool: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn(),
  invalidateOnMutation: jest.fn(),
  patternFor: jest.requireActual('../services/query-optimizer').patternFor,
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, REALTIME: 60 },
  deleteCachePattern: (...args) => mockDeleteCachePattern(...args),
  redisCache: {
    invalidatePattern: (...args) => mockInvalidatePattern(...args),
    incrementVersion: (...args) => mockIncrementVersion(...args),
    getRemote: (...args) => mockGetRemote(...args),
    get: (...args) => mockGet(...args),
    set: (...args) => mockSet(...args),
  },
}));

describe('pedidos cache invalidation P0', () => {
  let pedidos;

  beforeAll(() => {
    pedidos = require('../services/pedidos/index');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('invalidateRuteroCachesAfterPedido uses one orders family + scoped day payload', async () => {
    await pedidos.invalidateRuteroCachesAfterPedido('02');

    expect(mockDeleteCachePattern).toHaveBeenCalled();
    const patterns = mockDeleteCachePattern.mock.calls.map((c) => c[0]);
    expect(patterns).toContain('query:query:rutero:orders:*');
    expect(patterns.some((p) => p.includes('rutero:day:payload:v4:scope:'))).toBe(true);
    expect(patterns.some((p) => /orders:app:v[12]/.test(String(p)))).toBe(false);
    expect(patterns.filter((p) => String(p).includes('rutero:orders')).length).toBe(1);
    expect(patterns.length).toBeLessThanOrEqual(3);
  });

  test('invalidatePedidosStockCache bumps version and issues a single pedidos SCAN', async () => {
    await pedidos.invalidatePedidosStockCache('draft_line_add');

    expect(mockIncrementVersion).toHaveBeenCalledWith('meta', 'pedidos:route:ver', expect.any(Number));
    expect(mockInvalidatePattern).toHaveBeenCalledTimes(1);
    expect(mockInvalidatePattern).toHaveBeenCalledWith('query:query:pedidos:*');
  });
});
