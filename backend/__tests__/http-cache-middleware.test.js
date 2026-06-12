'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { cacheMiddleware, invalidateAll } = require('../middleware/http-cache');
const { networkOptimizer } = require('../middleware/network-optimizer');

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
});
