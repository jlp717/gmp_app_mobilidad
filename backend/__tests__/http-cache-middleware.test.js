'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { cacheMiddleware, invalidateAll } = require('../middleware/http-cache');
const {
  networkOptimizer,
  responseCoalescing,
  requestDeduplication,
  isJsonCoalescibleRequest,
  isSensitiveRepartoArtifactPath,
} = require('../middleware/network-optimizer');

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
  test.each([
    '/api/repartidor-finanzas/rutero/evidence/ev-1',
    '/api/repartidor-finanzas/rutero/confirmations/91/receipt',
    '/api/repartidor-finanzas/rutero/confirmations/receipt',
  ])('never caches sensitive reparto payloads: %s', (path) => {
    const req = {
      method: 'GET',
      path,
      originalUrl: path,
      baseUrl: '/api',
      query: {},
      headers: {},
      user: { id: '94', role: 'REPARTIDOR' },
    };
    const firstRes = makeRes();
    const firstNext = jest.fn();

    cacheMiddleware(req, firstRes, firstNext);
    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(firstRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    firstRes.json({ success: true, dataBase64: 'sensitive-test-payload' });

    const secondRes = makeRes();
    const secondNext = jest.fn();
    cacheMiddleware(req, secondRes, secondNext);

    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(secondRes.setHeader).not.toHaveBeenCalledWith('X-Cache-Status', 'HIT');
  });

  test('respects a downstream no-store response and does not overwrite it', () => {
    const req = {
      method: 'GET',
      path: '/rutero/day/lunes',
      originalUrl: '/api/rutero/day/lunes',
      baseUrl: '/api',
      query: {},
      headers: {},
      user: { id: '94', role: 'REPARTIDOR' },
    };
    const firstRes = makeRes();
    cacheMiddleware(req, firstRes, jest.fn());
    firstRes.setHeader('Cache-Control', 'private, no-store');
    firstRes.json({ success: true, privateValue: 'test-only' });

    const secondRes = makeRes();
    const secondNext = jest.fn();
    cacheMiddleware(req, secondRes, secondNext);

    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(secondRes.setHeader).not.toHaveBeenCalledWith('X-Cache-Status', 'HIT');
    expect(firstRes.headers['cache-control']).toBe('private, no-store');
  });

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

  test('separates repartidor cache by active mode and authorized drivers', () => {
    const base = {
      method: 'GET',
      path: '/dashboard/metrics',
      originalUrl: '/api/dashboard/metrics?date=2026-08-27',
      baseUrl: '/api',
      query: { date: '2026-08-27' },
      headers: {},
    };
    const repartoReq = {
      ...base,
      user: {
        id: '01',
        code: '01',
        role: 'JEFE_VENTAS',
        activeMode: 'REPARTIDOR',
        repartidorCodes: ['05'],
      },
    };
    const commercialReq = {
      ...base,
      user: {
        ...repartoReq.user,
        activeMode: 'COMERCIAL',
        repartidorCodes: [],
      },
    };
    const repartoRes = makeRes();
    cacheMiddleware(repartoReq, repartoRes, jest.fn());
    repartoRes.json({ success: true, owner: '05' });

    const commercialRes = makeRes();
    const commercialNext = jest.fn();
    cacheMiddleware(commercialReq, commercialRes, commercialNext);

    expect(commercialNext).toHaveBeenCalledTimes(1);
    expect(commercialRes.setHeader).toHaveBeenCalledWith('X-Cache-Status', 'MISS');
  });
});

describe('network optimizer cache headers', () => {
  test.each([
    '/api/repartidor-finanzas/rutero/evidence/ev-1',
    '/api/repartidor-finanzas/rutero/confirmations/91/receipt',
    '/api/repartidor-finanzas/rutero/confirmations/receipt?idempotencyKey=receipt-key-7',
  ])('marks canonical receipt/evidence private no-store before auth and bypasses coalescing: %s', (originalUrl) => {
    const req = makeGetReq({ path: originalUrl.split('?')[0], originalUrl });
    const res = makeRes();
    const next = jest.fn();

    networkOptimizer(req, res, next);

    expect(isSensitiveRepartoArtifactPath(req)).toBe(true);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.setHeader).not.toHaveBeenCalledWith('ETag', expect.any(String));
    expect(isJsonCoalescibleRequest(req)).toBe(false);
    const coalescingNext = jest.fn();
    responseCoalescing(req, makeEventedRes(), coalescingNext);
    expect(coalescingNext).toHaveBeenCalledTimes(1);
  });

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

  test('does not leave an unhandled rejection when the first response is not JSON', async () => {
    const req = makeGetReq({ headers: { authorization: 'Bearer first-only-token' } });
    const firstRes = makeEventedRes();
    const unhandled = jest.fn();
    const onUnhandled = () => unhandled();
    process.on('unhandledRejection', onUnhandled);

    try {
      responseCoalescing(req, firstRes, jest.fn());
      firstRes.status(204);
      firstRes.emit('finish');
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
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

  test('PDF downloads bypass JSON response coalescing', () => {
    const req = makeGetReq({
      path: '/api/commissions/pdf',
      headers: { accept: 'application/pdf' },
    });
    const firstNext = jest.fn();
    const secondNext = jest.fn();

    expect(isJsonCoalescibleRequest(req)).toBe(false);

    responseCoalescing(req, makeEventedRes(), firstNext);
    responseCoalescing(req, makeEventedRes(), secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
  });

  test('PDF downloads bypass request deduplication', () => {
    const req = makeGetReq({
      path: '/api/commissions/pdf',
      headers: { accept: 'application/pdf' },
    });
    const firstNext = jest.fn();
    const secondNext = jest.fn();

    requestDeduplication(req, makeEventedRes(), firstNext);
    requestDeduplication(req, makeEventedRes(), secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
  });
});
