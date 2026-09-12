const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((fn, sql, _options, ...args) => fn(sql, ...args));
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
    mockQueryWithParams.mockImplementation(async (sql) => {
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
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).toHaveBeenCalledTimes(2);
    const firstSql = mockQueryWithParams.mock.calls[0][0];
    const firstParams = mockQueryWithParams.mock.calls[0][1];
    expect(firstSql).toMatch(/FROM\s+DSEDAC\.LINDTO\s+L/i);
    expect(firstSql).toContain('L.CODIGOCLIENTEALBARAN IN(?,?)');
    expect(firstParams).toEqual(expect.arrayContaining(['C001', 'C002']));
  });
});

describe('clients route regression contracts', () => {
  test('GET /api/clients/compare returns typed 400 when client1/client2 are sent without codes', async () => {
    mockUser = { code: '80', role: 'JEFE_VENTAS', isJefeVentas: true };

    const res = await request(makeApp()).get('/api/clients/compare?client1=C001&client2=C002&vendedorCodes=ALL');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_CLIENT_COMPARE_PARAMS',
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /api/clients/:code detail does not select invalid DSEDAC.CLI.EMAIL column', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+1\s+AS\s+OK/i.test(sql)) return [{ OK: 1 }];
      if (/C\.NOMBRECLIENTE\s+as\s+name/i.test(sql)) {
        return [{
          CODE: 'C001',
          NAME: 'Cliente Uno',
          NIF: 'B00000000',
          ADDRESS: 'Calle',
          CITY: 'Ciudad',
          PROVINCE: 'Provincia',
          POSTALCODE: '00000',
          PHONE: '111',
          PHONE2: '222',
          ROUTE: 'R1',
          CONTACTPERSON: 'Contacto',
          NOTES: '',
          YEARCREATED: 2020,
        }];
      }
      return [];
    });

    const res = await request(makeApp()).get('/api/clients/C001?vendedorCodes=01');

    expect(res.status).toBe(200);
    const detailSql = mockQueryWithParams.mock.calls.find(function (call) {
      return /C\.NOMBRECLIENTE\s+as\s+name/i.test(call[0]);
    })[0];
    expect(detailSql).toMatch(/FROM\s+DSEDAC\.CLI\s+C/i);
    expect(detailSql).not.toMatch(/\bC\.EMAIL\b/i);
  });

  test('GET /api/clients/:code/sales-history/family does not query invalid DSEDAC.ART.DESCRIPCION', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+1\s+AS\s+OK/i.test(sql)) return [{ OK: 1 }];
      return [];
    });

    const res = await request(makeApp())
      .get('/api/clients/C001/sales-history/family?vendedorCodes=01&family1=01&groupLevel=1');

    expect(res.status).toBe(200);
    const familyCall = mockQueryWithParams.mock.calls.find((call) => /LEFT\s+JOIN\s+DSEDAC\.ART\s+A/i.test(call[0]));
    expect(familyCall).toBeTruthy();
    const familySql = familyCall[0];
    const familyParams = familyCall[1];
    expect(familySql).toMatch(/DESCRIPCIONARTICULO|L\.DESCRIPCION/i);
    expect(familySql).not.toMatch(/\bA\.DESCRIPCION\b/i);
    expect(familySql).toMatch(/CAST\(\?\s+AS\s+CHAR\(10\)\)/i);
    expect(familySql).not.toMatch(/CODIGOVENDEDOR\s*=/i);
    expect(familyParams[0]).toBe('C001');
    expect(familyParams[1]).toEqual(expect.any(Number));
    expect(familyParams[2]).toBe('01');
  });

  test('GET /api/clients/:code/sales-history scopes client via portfolio then reads LINDTO without seller filter', async () => {
    mockUser = { code: '80', role: 'COMERCIAL' };
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/SELECT\s+1\s+AS\s+OK/i.test(sql)) return [{ OK: 1 }];
      return [{
        YEAR: 2026,
        MONTH: 8,
        DAY: 1,
        PRODUCTCODE: 'ART1',
        PRODUCTNAME: 'Producto',
        BOXES: 1,
        UNITS: 12,
        AMOUNT: 100,
        MARGIN: 20,
        VENDEDOR: '72',
      }];
    });

    const res = await request(makeApp()).get('/api/clients/4300030056/sales-history?vendedorCodes=80&limit=20');

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].vendedor).toBe('72');
    const [scopeSql, scopeParams] = mockQueryWithParams.mock.calls[0];
    expect(scopeSql).toMatch(/SELECT\s+1\s+AS\s+OK/i);
    expect(scopeParams[0]).toBe('4300030056');
    expect(scopeParams).toEqual(expect.arrayContaining(['80']));
    const historyCall = mockQueryWithParams.mock.calls.find((call) => (
      /FROM\s+DSEDAC\.LINDTO/i.test(call[0]) && !/LEFT\s+JOIN/i.test(call[0])
    ));
    expect(historyCall).toBeTruthy();
    expect(historyCall[0]).toMatch(/CAST\(\?\s+AS\s+CHAR\(10\)\)/i);
    expect(historyCall[0]).not.toMatch(/CODIGOVENDEDOR\s*=/i);
    expect(historyCall[1][0]).toBe('4300030056');
    expect(historyCall[1]).not.toEqual(expect.arrayContaining(['80']));
  });

  test('GET /api/clients/:code/sales-history rejects COMERCIAL out-of-scope client', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);
    const res = await request(makeApp()).get('/api/clients/C999/sales-history?vendedorCodes=01');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'FORBIDDEN_CLIENT' });
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/SELECT\s+1\s+AS\s+OK/i);
  });
});
