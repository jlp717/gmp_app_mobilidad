'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { cacheMiddleware, invalidateAll } = require('../middleware/http-cache');
const { networkOptimizer, responseCoalescing } = require('../middleware/network-optimizer');

function makeRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader: jest.fn((name, value) => { headers[name.toLowerCase()] = value; }),
    getHeader: jest.fn((name) => headers[String(name).toLowerCase()]),
    on: jest.fn(),
    json: jest.fn((body) => body),
    status: jest.fn(function status(code) { this.statusCode = code; return this; }),
    end: jest.fn(),
  };
}

function makeEventedRes() {
  const res = makeRes();
  const handlers = {};
  res.on = jest.fn((event, handler) => {
    handlers[event] = handler;
    return res;
  });
  res.emit = (event) => {
    if (handlers[event]) handlers[event]();
  };
  res.json = jest.fn(function json(body) {
    res.body = body;
    res.emit('finish');
    return body;
  });
  return res;
}

function makeGetReq(overrides = {}) {
  const headers = overrides.headers || {};
  return {
    method: 'GET',
    path: '/api/dashboard/metrics',
    query: {},
    headers,
    get: jest.fn((name) => headers[String(name).toLowerCase()]),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidateAll();
});

describe('HTTP cache auth safety', () => {
  test('skips protected api cache before verifyToken populates req.user', () => {
    const req = {
      method: 'GET',
      path: '/dashboard/metrics',
      originalUrl: '/api/dashboard/metrics',
      baseUrl: '',
      query: {},
      headers: { authorization: 'Bearer stale-token' },
    };
    const res = makeRes();
    const next = jest.fn();

    cacheMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).not.toHaveBeenCalled();
  });

  test('allows protected api cache only after req.user exists', () => {
    const req = {
      method: 'GET',
      path: '/dashboard/metrics',
      originalUrl: '/api/dashboard/metrics',
      baseUrl: '/api',
      query: {},
      headers: {},
      user: { id: '01', role: 'COMERCIAL' },
    };
    const res = makeRes();
    const next = jest.fn();

    cacheMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.json({ success: true, value: 1 });

    const secondRes = makeRes();
    cacheMiddleware(req, secondRes, jest.fn());

    expect(secondRes.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'HIT');
    expect(secondRes.json).toHaveBeenCalledWith({ success: true, value: 1 });
  });

  test('bypasses and refreshes cached data on explicit no-cache requests', () => {
    const req = {
      method: 'GET',
      path: '/dashboard/metrics',
      originalUrl: '/api/dashboard/metrics',
      baseUrl: '/api',
      query: {},
      headers: {},
      user: { id: '01', role: 'COMERCIAL' },
    };

    const firstRes = makeRes();
    cacheMiddleware(req, firstRes, jest.fn());
    firstRes.json({ success: true, value: 1 });

    const refreshRes = makeRes();
    const refreshNext = jest.fn();
    cacheMiddleware(
      {
        ...req,
        headers: { 'cache-control': 'no-cache', 'x-force-refresh': 'true' },
      },
      refreshRes,
      refreshNext,
    );

    expect(refreshNext).toHaveBeenCalledTimes(1);
    expect(refreshRes.setHeader).toHaveBeenCalledWith(
      'X-Cache-Status',
      'BYPASS',
    );
    refreshRes.json({ success: true, value: 2 });

    const thirdRes = makeRes();
    cacheMiddleware(req, thirdRes, jest.fn());

    expect(thirdRes.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'HIT');
    expect(thirdRes.json).toHaveBeenCalledWith({ success: true, value: 2 });
  });

  test('does not partition cache keys by transient refresh query params', () => {
    const req = {
      method: 'GET',
      path: '/dashboard/metrics',
      originalUrl: '/api/dashboard/metrics?year=2026',
      baseUrl: '/api',
      query: { year: '2026' },
      headers: {},
      user: { id: '01', role: 'COMERCIAL' },
    };

    const firstRes = makeRes();
    cacheMiddleware(req, firstRes, jest.fn());
    firstRes.json({ success: true, value: 1 });

    const refreshRes = makeRes();
    cacheMiddleware(
      {
        ...req,
        originalUrl: '/api/dashboard/metrics?year=2026&forceRefresh=true',
        query: { year: '2026', forceRefresh: 'true' },
      },
      refreshRes,
      jest.fn(),
    );
    refreshRes.json({ success: true, value: 2 });

    const thirdRes = makeRes();
    cacheMiddleware(req, thirdRes, jest.fn());

    expect(thirdRes.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'HIT');
    expect(thirdRes.json).toHaveBeenCalledWith({ success: true, value: 2 });
  });

  test('separates cached responses by authorization role and vendor scope', () => {
    const baseReq = {
      method: 'GET',
      path: '/clients/list',
      originalUrl: '/api/clients/list?vendedorCodes=01',
      baseUrl: '/api',
      query: { vendedorCodes: '01' },
      headers: {},
    };

    const commercialReq = {
      ...baseReq,
      user: {
        id: '01',
        code: '01',
        role: 'COMERCIAL',
        vendedorCodes: ['01'],
      },
    };
    const managerReq = {
      ...baseReq,
      user: {
        id: '01',
        code: '01',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
        vendedorCodes: ['01', '02'],
      },
    };

    const commercialRes = makeRes();
    cacheMiddleware(commercialReq, commercialRes, jest.fn());
    commercialRes.json({ success: true, clients: [{ code: 'C01' }] });

    const managerRes = makeRes();
    const managerNext = jest.fn();
    cacheMiddleware(managerReq, managerRes, managerNext);

    expect(managerNext).toHaveBeenCalledTimes(1);
    expect(managerRes.setHeader).toHaveBeenCalledWith(
      'X-Cache-Status',
      'MISS',
    );
  });
});

describe('network optimizer cache headers', () => {
  test('does not mark products API as public cacheable', () => {
    const req = { method: 'GET', path: '/api/products', headers: {}, get: jest.fn(() => undefined) };
    const res = makeRes();
    const next = jest.fn();

    networkOptimizer(req, res, next);

    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).not.toContain('public');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('skips ETag hashing for large array payloads', () => {
    const req = makeGetReq();
    const res = makeRes();
    const next = jest.fn();

    networkOptimizer(req, res, next);
    res.json({ rows: Array.from({ length: 250 }, (_, index) => ({ id: index })) });

    expect(res.setHeader).not.toHaveBeenCalledWith('ETag', expect.any(String));
  });

  test('coalesced responses preserve original error status', async () => {
    const req = makeGetReq({ headers: { authorization: 'Bearer same-token' } });
    const firstRes = makeEventedRes();
    const secondRes = makeEventedRes();
    const firstNext = jest.fn();
    const secondNext = jest.fn();

    responseCoalescing(req, firstRes, firstNext);
    responseCoalescing(req, secondRes, secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).not.toHaveBeenCalled();

    firstRes.status(500).json({ error: 'boom' });
    await Promise.resolve();
    await Promise.resolve();

    expect(secondRes.status).toHaveBeenCalledWith(500);
    expect(secondRes.json).toHaveBeenCalledWith({ error: 'boom' });
  });

  test('force-refresh requests bypass response coalescing', () => {
    const req = makeGetReq({ query: { forceRefresh: 'true' } });
    const firstNext = jest.fn();
    const secondNext = jest.fn();

    responseCoalescing(req, makeEventedRes(), firstNext);
    responseCoalescing(req, makeEventedRes(), secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
  });
});
