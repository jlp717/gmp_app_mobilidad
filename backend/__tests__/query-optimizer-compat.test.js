'use strict';

const mockGet = jest.fn();
const mockSet = jest.fn();

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/redis-cache', () => ({
  redisCache: {
    get: (...args) => mockGet(...args),
    set: (...args) => mockSet(...args),
    getStats: jest.fn(() => ({})),
    invalidatePattern: jest.fn(),
    delete: jest.fn(),
  },
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, REALTIME: 60 },
}));

describe('cachedQuery backward compatibility', () => {
  let cachedQuery;

  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    ({ cachedQuery } = require('../services/query-optimizer'));
  });

  test('supports legacy positional signature with query()', async () => {
    const query = jest.fn().mockResolvedValue([{ CODE: '02' }]);

    const result = await cachedQuery(
      query,
      'SELECT * FROM CLI',
      'clients:list:v5:02:none:1000:0',
      300,
    );

    expect(result).toEqual([{ CODE: '02' }]);
    expect(query).toHaveBeenCalledWith('SELECT * FROM CLI');
    expect(mockGet).toHaveBeenCalledWith(
      'query',
      expect.stringContaining('clients:list:v5:02:none:1000:0'),
    );
    expect(mockSet).toHaveBeenCalledWith(
      'query',
      expect.stringContaining('clients:list:v5:02:none:1000:0'),
      [{ CODE: '02' }],
      300,
    );
  });

  test('supports legacy positional signature with queryWithParams()', async () => {
    const queryWithParams = jest.fn().mockResolvedValue([{ SALES: 123 }]);
    const params = [2026, 4, '02'];

    const result = await cachedQuery(
      queryWithParams,
      'SELECT * FROM LACLAE WHERE YEAR = ? AND MONTH = ? AND VENDOR = ?',
      'dashboard:metrics:2026:4:02:curr',
      300,
      params,
    );

    expect(result).toEqual([{ SALES: 123 }]);
    expect(queryWithParams).toHaveBeenCalledWith(
      'SELECT * FROM LACLAE WHERE YEAR = ? AND MONTH = ? AND VENDOR = ?',
      params,
    );
    expect(mockGet).toHaveBeenCalledWith(
      'query',
      expect.stringContaining('dashboard:metrics:2026:4:02:curr'),
    );
    expect(mockSet).toHaveBeenCalledWith(
      'query',
      expect.stringContaining('dashboard:metrics:2026:4:02:curr'),
      [{ SALES: 123 }],
      300,
    );
  });

  test('keeps object-based signature working', async () => {
    const queryWithParams = jest.fn().mockResolvedValue([{ TOTAL: 5 }]);
    const params = ['95', '02'];

    const result = await cachedQuery(
      queryWithParams,
      'SELECT * FROM VDD WHERE CODIGOVENDEDOR IN (?, ?)',
      {
        cacheKey: 'vendedores:active:2026:comercial',
        ttl: 1800,
        params,
      },
      params,
    );

    expect(result).toEqual([{ TOTAL: 5 }]);
    expect(queryWithParams).toHaveBeenCalledWith(
      'SELECT * FROM VDD WHERE CODIGOVENDEDOR IN (?, ?)',
      params,
    );
    expect(mockGet).toHaveBeenCalledWith(
      'query',
      expect.stringContaining('vendedores:active:2026:comercial'),
    );
  });
});
