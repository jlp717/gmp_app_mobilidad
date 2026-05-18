'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/db', () => ({
  getPool: jest.fn(),
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (queryFn, sql, _cacheKeyOrOptions, _ttl, params) =>
    queryFn(sql, params),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, REALTIME: 60 },
  deleteCachePattern: jest.fn(),
}));

jest.mock('../services/laclae', () => ({
  getWeekCountsFromCache: jest.fn(() => ({
    lunes: 0,
    martes: 2,
    miercoles: 0,
    jueves: 0,
    viernes: 0,
    sabado: 0,
    domingo: 0,
  })),
  getTotalClientsFromCache: jest.fn(() => 2),
  getClientsForDay: jest.fn(() => ['4300000001', '4300000002']),
  reloadRuteroConfig: jest.fn(),
  loadLaclaeCache: jest.fn(),
  getClientCurrentDay: jest.fn(),
  getNaturalOrder: jest.fn(() => 0),
  laclaeCacheLastLoadTime: jest.fn(() => Date.now()),
}));

jest.mock('../services/emailService', () => ({
  sendAuditEmail: jest.fn(),
  sendAuditEmailNow: jest.fn(),
}));

const plannerRoutes = require('../routes/planner');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { codigovendedor: '98', role: 'JEFE_VENTAS', isJefeVentas: true };
    next();
  });
  app.use('/', plannerRoutes);
  return app;
}

describe('Planner rutero/day route', () => {
  let app;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery.mockResolvedValue([]);
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (sql.includes('FROM DSEDAC.CLI')) {
        return [
          {
            CODE: '4300000001',
            NAME: 'Cliente Uno',
            ADDRESS: 'Calle 1',
            CITY: 'Madrid',
            PHONE: '600111111',
            PHONE2: '',
          },
          {
            CODE: '4300000002',
            NAME: 'Cliente Dos',
            ADDRESS: 'Calle 2',
            CITY: 'Madrid',
            PHONE: '600222222',
            PHONE2: '',
          },
        ];
      }

      if (sql.includes('FROM JAVIER.RUTERO_CONFIG')) {
        return [];
      }

      return [];
    });
  });

  test('GET /rutero/day/:day uses TELEFONO1 column and returns clients', async () => {
    const res = await request(app)
      .get('/rutero/day/martes')
      .query({
        vendedorCodes: '02',
        role: 'comercial',
        year: '2026',
        month: '4',
        week: '4',
      });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const executedSql = mockQueryWithParams.mock.calls.map(call => call[0]);
    const detailsSql = executedSql.find(sql => sql.includes('FROM DSEDAC.CLI'));

    expect(detailsSql).toContain('TELEFONO1 as PHONE');
    expect(detailsSql).not.toContain('TELEFON1 as PHONE');
  });
});
