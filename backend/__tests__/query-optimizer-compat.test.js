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
  let invalidateOnMutation;

  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    ({ cachedQuery, invalidateOnMutation } = require('../services/query-optimizer'));
  });

  test('supports legacy positional signature with query()', async () => {
    const query = jest.fn().mockResolvedValue([{ CODE: '02' }]);

    const result = await cachedQuery(
      query,
      'SELECT CODE FROM CLI',
      'clients:list:v5:02:none:1000:0',
      300,
    );

    expect(result).toEqual([{ CODE: '02' }]);
    expect(query).toHaveBeenCalledWith('SELECT CODE FROM CLI');
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
      'SELECT SALES FROM LACLAE WHERE YEAR = ? AND MONTH = ? AND VENDOR = ?',
      'dashboard:metrics:2026:4:02:curr',
      300,
      params,
    );

    expect(result).toEqual([{ SALES: 123 }]);
    expect(queryWithParams).toHaveBeenCalledWith(
      'SELECT SALES FROM LACLAE WHERE YEAR = ? AND MONTH = ? AND VENDOR = ?',
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
      'SELECT TOTAL FROM VDD WHERE CODIGOVENDEDOR IN (?, ?)',
      {
        cacheKey: 'vendedores:active:2026:comercial',
        ttl: 1800,
        params,
      },
      params,
    );

    expect(result).toEqual([{ TOTAL: 5 }]);
    expect(queryWithParams).toHaveBeenCalledWith(
      'SELECT TOTAL FROM VDD WHERE CODIGOVENDEDOR IN (?, ?)',
      params,
    );
    expect(mockGet).toHaveBeenCalledWith(
      'query',
      expect.stringContaining('vendedores:active:2026:comercial'),
    );
  });

  test('coalesces concurrent cache misses for the same key', async () => {
    let resolveQuery;
    const query = jest.fn(() => new Promise((resolve) => {
      resolveQuery = resolve;
    }));

    const first = cachedQuery(query, 'SELECT CODE FROM CLI', 'clients:coalesce', 300);
    const second = cachedQuery(query, 'SELECT CODE FROM CLI', 'clients:coalesce', 300);

    await Promise.resolve();
    resolveQuery([{ CODE: '01' }]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ CODE: '01', code: '01' }],
      [{ CODE: '01', code: '01' }],
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  test('serves stale data when a cache rebuild fails', async () => {
    const successfulQuery = jest.fn().mockResolvedValue([{ CODE: 'old' }]);
    await expect(
      cachedQuery(successfulQuery, 'SELECT CODE FROM CLI', 'clients:stale', 300),
    ).resolves.toEqual([{ CODE: 'old' }]);

    const failingQuery = jest.fn().mockRejectedValue(new Error('DB2 unavailable'));
    await expect(
      cachedQuery(failingQuery, 'SELECT CODE FROM CLI', 'clients:stale', 300),
    ).resolves.toEqual([{ CODE: 'old', code: 'old' }]);

    expect(successfulQuery).toHaveBeenCalledTimes(1);
    expect(failingQuery).toHaveBeenCalledTimes(1);
  });

  test('cached pedidos query key is covered by pedidos mutation invalidation pattern', async () => {
    const { redisCache } = require('../services/redis-cache');
    const query = jest.fn().mockResolvedValue([{ ID: 'P-1' }]);

    await cachedQuery(
      query,
      'SELECT ID FROM PEDIDOS_CAB',
      'pedidos:products_v2:C001::::0:20',
      60,
    );

    await invalidateOnMutation('PEDIDOS', 'P-1');

    const cachedKey = `gmp:query:${mockSet.mock.calls[0][1]}`;
    const invalidationPattern = `gmp:${redisCache.invalidatePattern.mock.calls[0][0]}`;

    expect(cachedKey).toBe('gmp:query:query:pedidos:products_v2:C001::::0:20:vendor:ALL');
    expect(invalidationPattern).toBe('gmp:query:query:pedidos:*');
    expect(cachedKey.startsWith(invalidationPattern.replace('*', ''))).toBe(true);
  });
});

describe('cachedQuery redis L1 invalidation (real redis-cache module)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
  });

  test('invalidatePattern clears fresh and stale L1 entries for query-domain keys', async () => {
    jest.resetModules();
    jest.unmock('../services/redis-cache');

    const { redisCache } = require('../services/redis-cache');
    const freshKey = 'query:pedidos:red:fresh';
    const staleKey = 'query:pedidos:red:stale';

    await redisCache.set('query', freshKey, [{ version: 'fresh' }], 60);
    await redisCache.set('query', staleKey, [{ version: 'stale' }], -1);

    expect(await redisCache.get('query', staleKey)).toEqual([{ version: 'stale' }]);

    await redisCache.invalidatePattern('query:query:pedidos:*');

    expect(await redisCache.get('query', freshKey)).toBeNull();
    expect(await redisCache.get('query', staleKey)).toBeNull();
  });
});

describe('QueryBatcher', () => {
  let QueryBatcher;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../services/redis-cache', () => ({
      redisCache: {
        get: (...args) => mockGet(...args),
        set: (...args) => mockSet(...args),
        getStats: jest.fn(() => ({})),
        invalidatePattern: jest.fn(),
        delete: jest.fn(),
      },
      TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, REALTIME: 60 },
    }));
    mockGet.mockReset();
    mockSet.mockReset();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    ({ QueryBatcher } = require('../services/query-optimizer'));
  });

  function flushBatchTimer(batcher) {
    return new Promise((resolve) => {
      if (!batcher.timer) {
        resolve();
        return;
      }
      const original = batcher._processBatches.bind(batcher);
      batcher._processBatches = async function wrapped() {
        await original();
        resolve();
      };
      jest.advanceTimersByTime(batcher.batchDelay);
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('string ids are escaped in batched SQL and invalid ids throw', () => {
    const batcher = new QueryBatcher(jest.fn());
    expect(batcher._toSqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(batcher._toSqlLiteral(42)).toBe('42');
    expect(batcher._toSqlLiteral('plain')).toBe("'plain'");

    const sql = "SELECT CODE FROM CLI WHERE CODE = 'X'";
    const batched = batcher._createBatchedSQL(sql, ["A'", 7]);
    expect(batched).toBe("SELECT CODE FROM CLI WHERE CODE IN ('A''',7)");

    expect(() => batcher._toSqlLiteral("bad\0id")).toThrow(/Invalid batch id/);
    expect(() => batcher._toSqlLiteral({})).toThrow(/Invalid batch id/);
  });

  test('starts per-callback redis cache writes in parallel before resolving callbacks', async () => {
    const cacheWrites = [];
    mockSet.mockImplementation(() => {
      return new Promise((resolve) => {
        cacheWrites.push(resolve);
      });
    });

    const queryFn = jest.fn().mockResolvedValue([
      { id: '1', CODE: '1' },
      { id: '2', CODE: '2' },
    ]);
    const batcher = new QueryBatcher(queryFn);
    const first = batcher.queueById('SELECT CODE FROM CLI WHERE CODE = 1', '1', 'cache:1');
    const second = batcher.queueById('SELECT CODE FROM CLI WHERE CODE = 1', '2', 'cache:2');

    clearTimeout(batcher.timer);
    const processing = batcher._processBatches();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSet).toHaveBeenCalledTimes(2);

    cacheWrites.forEach((resolve) => resolve());
    await processing;

    await expect(first).resolves.toEqual([{ id: '1', CODE: '1' }]);
    await expect(second).resolves.toEqual([{ id: '2', CODE: '2' }]);
  });

  test('snapshot queue retains items queued during batch processing', async () => {
    let releaseFirst;
    const queryFn = jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = () => resolve([{ id: '1', CODE: '1' }]);
      }))
      .mockResolvedValue([{ id: '2', CODE: '2' }]);

    const batcher = new QueryBatcher(queryFn);
    const sql = 'SELECT CODE FROM CLI WHERE CODE = 1';

    const first = batcher.queueById(sql, '1', null);
    clearTimeout(batcher.timer);
    const processing = batcher._processBatches();

    const second = batcher.queueById(sql, '2', null);
    expect(batcher.queue.size).toBe(1);

    releaseFirst();
    await processing;
    expect(queryFn).toHaveBeenCalledTimes(1);

    clearTimeout(batcher.timer);
    await batcher._processBatches();

    await expect(first).resolves.toEqual([{ id: '1', CODE: '1' }]);
    await expect(second).resolves.toEqual([{ id: '2', CODE: '2' }]);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  test('rejects all callbacks when batched SQL contains invalid id', async () => {
    const queryFn = jest.fn();
    const batcher = new QueryBatcher(queryFn);
    const sql = 'SELECT CODE FROM CLI WHERE CODE = 1';

    const pending = batcher.queueById(sql, { bad: true }, 'cache:bad');
    const flushPromise = flushBatchTimer(batcher);
    jest.advanceTimersByTime(batcher.batchDelay);
    await flushPromise;

    await expect(pending).rejects.toThrow(/Invalid batch id/);
    expect(queryFn).not.toHaveBeenCalled();
  });
});
