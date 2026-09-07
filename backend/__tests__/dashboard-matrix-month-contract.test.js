'use strict';

const request = require('supertest');
const express = require('express');

const mockQueryWithParams = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
let mockUser = { code: '98', role: 'JEFE_VENTAS' };

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn(async (fn, sql, _key, _ttl, params) => fn(sql, params)),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800 },
  redisCache: {
    get: (...args) => mockRedisGet(...args),
    set: (...args) => mockRedisSet(...args),
  },
}));

jest.mock('../src/controllers/dashboard.controller', () => ({
  metricsController: (_req, res) => res.json({ ok: true }),
  salesEvolutionController: (_req, res) => res.json({ ok: true }),
}));

const dashboardRouter = require('../routes/dashboard');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', dashboardRouter);
  return app;
}

function aggregateCall() {
  return mockQueryWithParams.mock.calls.find(([sql]) => /FROM DSEDAC\.LAC L/i.test(sql)
    && /SUM\(L\.LCIMVT\)/i.test(sql));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { code: '98', role: 'JEFE_VENTAS' };
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue(undefined);
  mockQueryWithParams.mockResolvedValue([]);
});

describe('GET /matrix-data month filter contract', () => {
  test('binds valid months and drops invalid tokens without interpolating them', async () => {
    const res = await request(makeApp())
      .get('/matrix-data')
      .query({
        groupBy: 'vendor',
        year: '2026',
        months: "1,13,foo,8,1); DROP TABLE LAC;--",
      });

    expect(res.status).toBe(200);
    const call = aggregateCall();
    expect(call).toBeDefined();
    const [sql, params] = call;
    expect(sql).toMatch(/AND L\.LCMMDC IN \(\?,\?\)/);
    expect(sql).not.toMatch(/DROP TABLE|foo|13/i);
    expect(params).toEqual(expect.arrayContaining([2026, 2025, 1, 8]));
    expect(params).not.toEqual(expect.arrayContaining([13, 'foo']));
  });

  test('JEFE defaults to vendor-only FETCH FIRST 240 when groupBy is omitted', async () => {
    const res = await request(makeApp())
      .get('/matrix-data')
      .query({ year: '2026', months: '3' });

    expect(res.status).toBe(200);
    const [sql, params] = aggregateCall();
    expect(sql).toMatch(/FETCH FIRST 240 ROWS ONLY/);
    expect(sql).toMatch(/AND L\.LCMMDC IN \(\?\)/);
    expect(params).toEqual(expect.arrayContaining([3]));
  });

  test('COMERCIAL ALL never binds VENDEDOR=ALL and stays vendor-only', async () => {
    mockUser = { code: '15', role: 'COMERCIAL' };
    const res = await request(makeApp())
      .get('/matrix-data')
      .query({ vendedorCodes: 'ALL', groupBy: 'vendor', year: '2026', months: '4' });

    expect(res.status).toBe(200);
    const [sql, params] = aggregateCall();
    expect(sql).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
    expect(sql).toMatch(/L\.LCCDVD IN \(\?\)/);
    expect(params).toEqual(expect.arrayContaining(['15', 4]));
  });
});
