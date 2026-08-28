'use strict';

const mockQuery = jest.fn();
const mockCache = new Map();
const mockGet = jest.fn(async (_prefix, key) => {
    const entry = mockCache.get(key);
    return entry && entry.expires > Date.now() ? entry.value : null;
});
const mockSet = jest.fn(async (_prefix, key, value, ttl) => {
    mockCache.set(key, { value, expires: Date.now() + ttl * 1000 });
});

jest.mock('../config/db', () => ({ query: jest.fn(), queryWithParams: mockQuery }));
jest.mock('../middleware/auth', () => ({ verifyToken: (_req, _res, next) => next() }));
jest.mock('../services/redis-cache', () => ({
    redisCache: { get: mockGet, set: mockSet, isConnected: false },
    TTL: { SHORT: 300 },
}));

const router = require('../routes/analytics');
const handler = router.stack.find(layer => layer.route?.path === '/sales-history').route.stack.at(-1).handle;
const { stampedeLock } = require('../services/query-optimizer');
const user = { id: 'user-1', company: 'GMP', role: 'COMERCIAL', vendorCodes: ['01'] };
const filters = {
    vendedorCodes: '01', clientCode: 'C001', productSearch: 'milk',
    startDate: '2026-01-01', endDate: '2026-01-31', limit: '10', offset: '0',
};
const row = {
    YEAR: 2026, MONTH: 1, DAY: 2, CLIENTCODE: 'C001 ', PRODUCTCODE: 'P1 ',
    PRODUCTNAME: 'Milk ', PRICE: 2, TOTAL: 4, QUANTITY: 2, INVOICE: 'A1 ',
};

async function call(query = filters, identity = user) {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler({ query, user: identity }, res);
    return res;
}

beforeEach(() => {
    mockCache.clear();
    stampedeLock.locks.clear();
    stampedeLock.promises.clear();
    stampedeLock.staleData.clear();
    mockQuery.mockReset().mockResolvedValue([{ ...row }]);
});

test('warm hit preserves response and binds, using the real stampede helper', async () => {
    const cold = await call();
    const warm = await call();
    expect(warm.json.mock.calls[0][0]).toEqual(cold.json.mock.calls[0][0]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['C001', '%MILK%', '%MILK%', '%MILK%', 20260101, 20260131]);
    expect((sql.match(/\?/g) || []).length).toBe(params.length);
    expect(sql).toContain('FROM DSEDAC.LAC');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|DROP)\b/i);
    expect(mockSet).toHaveBeenCalledWith('query', expect.any(String), expect.any(Array), 300);
    expect(mockGet.mock.calls[0][1]).toMatch(/^query:analytics:sales-history:v1:[a-f0-9]{64}:vendor:ALL$/);
    expect(cold.json.mock.calls[0][0]).toMatchObject({ count: 1, limit: 10, offset: 0 });
});

test.each([
    ['vendedorCodes', '02'], ['clientCode', 'C002'], ['productSearch', 'bread'],
    ['startDate', '2026-01-02'], ['endDate', '2026-01-30'], ['limit', '20'], ['offset', '10'],
])('cache separates %s', async (field, value) => {
    await call();
    await call({ ...filters, [field]: value });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(new Set(mockGet.mock.calls.map(args => args[1])).size).toBe(2);
});

test.each([
    ['id', 'user-2'], ['role', 'ADMIN'], ['company', 'OTHER'],
    ['vendorCodes', ['01', '02']], ['vendedorCodes', ['02']],
])('cache separates authenticated %s', async (field, value) => {
    await call();
    await call(filters, { ...user, [field]: value });
    expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('empty result is cached and retried after short TTL expires', async () => {
    let clock = 100000;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
        mockQuery.mockResolvedValue([]);
        await call();
        await call();
        expect(mockQuery).toHaveBeenCalledTimes(1);
        clock += 300001;
        await call();
        expect(mockQuery).toHaveBeenCalledTimes(2);
    } finally {
        now.mockRestore();
    }
});

test('eight concurrent cold requests share one query; failures allow retry', async () => {
    let complete;
    mockQuery.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = Array.from({ length: 8 }, () => call());
    await Promise.resolve();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    complete([{ ...row }]);
    const responses = await Promise.all(pending);
    for (const res of responses) expect(res.json.mock.calls[0][0].count).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    console.info('[PERF] sales-history concurrentRequests=8 dbCalls=1 (mock DB, real cache helper)');

    const other = { ...filters, clientCode: 'ERROR' };
    mockQuery.mockRejectedValueOnce(new Error('query unavailable'));
    const failed = await call(other);
    expect(failed.status).toHaveBeenCalledWith(500);
    mockQuery.mockResolvedValue([]);
    const retry = await call(other);
    expect(retry.status).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(3);
});
