const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((fn, sql) => fn(sql));
let mockUser = { code: '01', role: 'COMERCIAL' };

jest.mock('../config/db', () => ({
  query: mockQuery,
  queryWithParams: mockQueryWithParams,
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: mockCachedQuery,
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800 },
}));

jest.mock('../services/laclae', () => ({
  getClientDays: jest.fn(() => null),
  getClientCodesFromCache: jest.fn(() => null),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const clientsRouter = require('../routes/clients');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', clientsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockCachedQuery.mockClear();
  mockUser = { code: '01', role: 'COMERCIAL' };
});

describe('clients route access-control contracts', () => {
  test('GET /api/clients/:code rejects COMERCIAL out-of-scope before reading client PII', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp()).get('/api/clients/C002?vendedorCodes=02');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_CLIENT' });
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeSql).toMatch(/FROM\s+DSEDAC\.CLI\s+C/i);
    expect(scopeSql).toContain('DSEDAC.CLP');
    expect(scopeSql).toContain('DSED.LACLAE');
    expect(scopeParams[0]).toBe('C002');
    expect(scopeParams).toEqual(expect.arrayContaining(['01']));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('GET /api/clients/compare reaches static compare route before /:code', async () => {
    mockUser = { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true };
    mockQuery.mockImplementation(async (sql) => {
      if (/COUNT\(DISTINCT L\.CODIGOARTICULO\)/i.test(sql)) {
        return [{
          CODE: 'C001',
          NAME: 'Cliente Uno',
          CITY: 'Ciudad',
          TOTALSALES: 100,
          TOTALMARGIN: 20,
          TOTALBOXES: 3,
          ACTIVEMONTHS: 1,
          UNIQUEPRODUCTS: 2,
          AVGORDERVALUE: 50,
        }];
      }
      if (/GROUP BY CODIGOCLIENTEALBARAN, ANODOCUMENTO, MESDOCUMENTO/i.test(sql)) {
        return [{ CODE: 'C001', YEAR: 2026, MONTH: 6, SALES: 100 }];
      }
      return [];
    });

    const res = await request(makeApp()).get('/api/clients/compare?codes=C001,C002&vendedorCodes=ALL');

    expect(res.status).toBe(200);
    expect(res.body.clients[0]).toMatchObject({ code: 'C001', name: 'Cliente Uno' });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    const firstSql = mockQuery.mock.calls[0][0];
    expect(firstSql).toMatch(/FROM\s+DSEDAC\.LINDTO\s+L/i);
    expect(firstSql).toContain("L.CODIGOCLIENTEALBARAN IN('C001','C002')");
  });
});
