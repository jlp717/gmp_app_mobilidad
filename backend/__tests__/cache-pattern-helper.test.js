'use strict';

/**
 * Contract test for patternFor() — the central helper that derives Redis
 * invalidation patterns for cachedQuery() keys.
 *
 * Background: cachedQuery() stores results under
 *   gmp:query:query:<cacheKey>:vendor:<code>[:role:...][:params:<hash>]
 * (redisCache namespace "query" + the CacheKeyGenerator "query" prefix — see
 * query-optimizer.js invalidateByPrefix docs). Hand-written patterns missing
 * the double "query:" match no key at all, so the invalidation silently
 * becomes a no-op. This file pins the helper contract against the REAL key
 * that cachedQuery writes.
 */

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

// Mirrors redisCache._generateKey(namespace, key) → `gmp:${namespace}:${key}`
function realRedisKeyFor(namespace, key) {
  return `gmp:${namespace}:${key}`;
}

// Mirrors invalidatePattern() usage: the caller passes the bare pattern and
// the service prepends the `gmp:` application prefix before globbing.
function globMatches(pattern, redisKey) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(redisKey);
}

describe('patternFor cachedQuery invalidation patterns', () => {
  let cachedQuery;
  let patternFor;

  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    ({ cachedQuery, patternFor } = require('../services/query-optimizer'));
  });

  test('derives the family pattern for a full cachedQuery key (default 2 levels)', () => {
    expect(patternFor('repartidor:collections:summary:1:2026:8')).toBe(
      'query:query:repartidor:collections:*'
    );
  });

  test.each([
    // planner.js day-view invalidations (details keeps its version segment)
    ['rutero:details:v3', 3, 'query:query:rutero:details:v3:*'],
    ['rutero:sales:combined:v3', 2, 'query:query:rutero:sales:*'],
    ['rutero:gps:v3', 2, 'query:query:rutero:gps:*'],
    // planner.js reload-cache whole-family sweeps
    ['clients:list:v8', 1, 'query:query:clients:*'],
    ['rutero:details:v3', 1, 'query:query:rutero:*'],
    // explicit full-key pattern
    ['repartidor:history:documents:94', 0, 'query:query:repartidor:history:documents:94:*'],
  ])('patternFor(%j, %j) === %s', (cacheKey, levels, expected) => {
    expect(patternFor(cacheKey, levels)).toBe(expected);
  });

  test('keeps keys with fewer segments than familyLevels intact', () => {
    expect(patternFor('cobros:pending-summary')).toBe('query:query:cobros:pending-summary:*');
    expect(patternFor('pedidos')).toBe('query:query:pedidos:*');
  });

  test('degrades to a full query:query sweep on empty input instead of throwing', () => {
    expect(patternFor('')).toBe('query:query:*');
    expect(patternFor(null)).toBe('query:query:*');
    expect(patternFor(undefined)).toBe('query:query:*');
  });

  test('matches the real Redis key cachedQuery writes for planner rutero batches', async () => {
    const queryFn = jest.fn().mockResolvedValue([{ CODE: '1' }]);
    await cachedQuery(
      queryFn,
      'SELECT CODIGO FROM CLI WHERE CODIGO IN (?, ?)',
      'rutero:details:v3:abc123',
      1800,
      ['1', '2']
    );

    expect(mockSet).toHaveBeenCalledTimes(1);
    const [namespace, fullCacheKey] = mockSet.mock.calls[0];
    expect(namespace).toBe('query');
    const redisKey = realRedisKeyFor(namespace, fullCacheKey);

    // The corrected pattern (planner.js move_clients/config/reorder).
    expect(globMatches(`gmp:${patternFor('rutero:details:v3', 3)}`, redisKey)).toBe(true);
    // The old single-prefix pattern matched nothing — that was the silent no-op.
    expect(globMatches('gmp:query:rutero:details:v3:*', redisKey)).toBe(false);
  });

  test('matches real keys for collections/week families and the A4 family wildcard', async () => {
    const queryFn = jest.fn().mockResolvedValue([]);

    await cachedQuery(queryFn, 'SELECT 1 FROM SYSIBM.SYSDUMMY1', 'repartidor:collections:summary:94:2026:8', 60);
    let fullCacheKey = mockSet.mock.calls[0][1];
    expect(globMatches(
      `gmp:${patternFor('repartidor:collections:summary:94:2026:8')}`,
      realRedisKeyFor('query', fullCacheKey)
    )).toBe(true);

    mockSet.mockClear();
    await cachedQuery(queryFn, 'SELECT 1 FROM SYSIBM.SYSDUMMY1', 'repartidor:rutero-week:v2:base:94:20260824:20260830', 60);
    fullCacheKey = mockSet.mock.calls[0][1];
    const weekKey = realRedisKeyFor('query', fullCacheKey);
    expect(globMatches(
      `gmp:${patternFor('repartidor:rutero-week:v2:base:94:20260824:20260830')}`,
      weekKey
    )).toBe(true);
    // planner.js move_clients (A4) uses the same family wildcard the
    // confirmation workflows use — it must match the week-view keys.
    expect(globMatches('gmp:query:query:repartidor:rutero-*', weekKey)).toBe(true);
  });

  test('matches real keys regardless of the role/vendor suffix variants', async () => {
    const queryFn = jest.fn().mockResolvedValue([]);
    await cachedQuery(queryFn, 'SELECT 1 FROM SYSIBM.SYSDUMMY1', {
      cacheKey: 'clients:list:v8:02:none:100:0',
      ttl: 300,
      role: 'COMERCIAL',
      vendorCode: '02',
    });

    const fullCacheKey = mockSet.mock.calls[0][1];
    expect(fullCacheKey).toContain('role:COMERCIAL');
    expect(globMatches(
      `gmp:${patternFor('clients:list:v8:02:none:100:0')}`,
      realRedisKeyFor('query', fullCacheKey)
    )).toBe(true);
  });

  test('documented limitation: does NOT match keys written directly via redisCache.set', () => {
    // planner day payloads bypass cachedQuery and live under the single
    // "query:" namespace prefix: gmp:query:rutero:day:payload:v4:...
    // patternFor must not be used for those; the hand-built single-prefix
    // pattern is the correct one (see ruteroDayPayloadInvalidationPatterns).
    const dayPayloadKey = realRedisKeyFor('query', 'rutero:day:payload:v4:scope:ALL:primary:98:deadbeef');
    expect(globMatches(
      `gmp:${patternFor('rutero:day:payload:v4:scope:ALL:primary:98:deadbeef')}`,
      dayPayloadKey
    )).toBe(false);
    expect(globMatches('gmp:query:rutero:day:payload:v4:scope:ALL:primary:98:*', dayPayloadKey)).toBe(true);
  });
});
