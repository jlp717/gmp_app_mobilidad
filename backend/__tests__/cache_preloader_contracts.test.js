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
  test('warmUpEvolutionAll uses real LACLAE cost column and bound params', async () => {
    mockQueryWithParams.mockResolvedValue([{ ANO: 2026, MES: 6, TOTAL_VENTAS: 10, TOTAL_COSTO: 4 }]);

    await cachePreloader._internal.warmUpEvolutionAll();

    expect(mockCachedQuery).toHaveBeenCalledTimes(1);
    const [queryFn, sql, options, params] = mockCachedQuery.mock.calls[0];

    expect(typeof queryFn).toBe('function');
    expect(sql).toContain('LCIMCT');
    expect(sql).not.toContain('LCIMCO');
    expect(options).toMatchObject({ cacheKey: 'evolution:monthly:ALL::24', queryType: 'evolution' });
    expect(params).toEqual([2024, 2024, 7]);
    expect(mockQueryWithParams).toHaveBeenCalledWith(sql, [2024, 2024, 7], false);
    expect(mockQuery).not.toHaveBeenCalledWith(expect.any(String), expect.any(Array));
  });

  test('warmUpClientsAll uses v6 CTE cache keys for JV defaults', async () => {
    mockQuery.mockResolvedValue([{ CODE: '4300001091' }]);

    await cachePreloader._internal.warmUpClientsAll();

    expect(mockCachedQuery).toHaveBeenCalledTimes(2);
    const keys = mockCachedQuery.mock.calls.map((call) => call[2]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'clients:list:v6:ALL:none:50:0',
        'clients:list:v6:ALL:none:100:0',
      ]),
    );
    const sql = mockCachedQuery.mock.calls[0][1];
    expect(sql).toContain('LACLAE_SCOPED');
    expect(sql).toContain('ROW_NUMBER()');
    expect(sql).not.toContain('LATERAL');
  });
});
