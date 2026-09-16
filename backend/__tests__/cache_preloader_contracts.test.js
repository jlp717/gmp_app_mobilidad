'use strict';

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((fn, sql, options, ...args) => fn(sql, ...args));
const mockRedisCache = {
  isConnected: false,
  get: jest.fn(),
  set: jest.fn(),
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
};

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: mockCachedQuery,
}));

jest.mock('../services/laclae', () => ({
  loadLaclaeCache: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../utils/common', () => ({
  getCurrentDate: () => new Date('2026-06-07T10:00:00Z'),
  LACLAE_SALES_FILTER: "L.TPDC = 'LAC'",
  MIN_YEAR: 2024,
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: mockRedisCache,
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 86400, STATIC: 3600 },
}));

const mockFillEvolution = jest.fn(async () => ({
  skipped: false,
  cacheKey: 'obj:evolution:v20260914-hist-ttl:ALL:2026:open',
  assembled: true,
}));
jest.mock('../routes/objectives', () => ({
  fillEvolutionRouteCacheForAll: (...args) => mockFillEvolution(...args),
  buildEvolutionRouteCacheKey: () => ({
    key: 'obj:evolution:v20260914-hist-ttl:ALL:2026:open',
  }),
}));

const cachePreloader = require('../services/cache-preloader');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockCachedQuery.mockClear();
  Object.values(mockRedisCache).forEach((mockFn) => {
    if (typeof mockFn?.mockReset === 'function') mockFn.mockReset();
  });
  mockRedisCache.isConnected = false;
});

describe('cache preloader DB2 contracts', () => {
  test('warmUpEvolutionAll fills the HTTP obj:evolution key', async () => {
    const result = await cachePreloader._internal.warmUpEvolutionAll();

    expect(mockFillEvolution).toHaveBeenCalledTimes(1);
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(result.cacheKey).toContain('obj:evolution:');
    expect(result.cacheKey).not.toContain('evolution:monthly');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('warmUpClientsAll no longer writes unused clients:list:v6 keys', async () => {
    await cachePreloader._internal.warmUpClientsAll();

    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
