'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockGetClientsForDay = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

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
  redisCache: {
    get: (...args) => mockRedisGet(...args),
    set: (...args) => mockRedisSet(...args),
  },
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
  getClientsForDay: (...args) => mockGetClientsForDay(...args),
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
    mockGetClientsForDay.mockReturnValue(['4300000001', '4300000002']);
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue(true);
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

      if (sql.includes('FROM DSEDAC.CPC')) {
        return [
          {
            CODE: '4300000001',
            TOTAL_COUNT: 2,
            LAST_ORDER_NUMBER: 1001,
          },
        ];
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

    const firstClient = res.body.clients.find(c => c.code === '4300000001');
    const secondClient = res.body.clients.find(c => c.code === '4300000002');
    expect(firstClient.orderStatus.state).toBe('CONFIRMADO');
    expect(firstClient.orderStatus.label).toBe('VENTA CONFIRMADA');
    expect(secondClient.orderStatus.state).toBe('SIN_PEDIDO');
    expect(secondClient.orderStatus.label).toBe('SIN VENTA');
    expect(res.body.orderStatusDegraded).toBe(false);

    const orderStatusQueries = executedSql.filter(sql => sql.includes('FROM DSEDAC.CPC'));
    expect(orderStatusQueries).toHaveLength(1);
    expect(orderStatusQueries[0]).toContain('GROUP BY TRIM(C.CODIGOCLIENTEALBARAN)');
    expect(executedSql.some(sql => sql.includes('PEDIDOS_CAB'))).toBe(false);
  });

  test('GET /rutero/day/:day keeps every manager client beyond the 200-row batch', async () => {
    const clientCodes = Array.from({ length: 201 }, (_, index) =>
      'C' + String(index + 1).padStart(9, '0')
    );
    mockGetClientsForDay.mockReturnValue(clientCodes);
    mockQueryWithParams.mockImplementation(async (sql, params = []) => {
      if (sql.includes('FROM DSEDAC.CLI')) {
        return params.map((code) => ({
          CODE: code,
          NAME: 'Cliente ' + code,
          ADDRESS: 'Calle de prueba',
          CITY: 'Madrid',
          PHONE: '',
          PHONE2: '',
        }));
      }
      if (sql.includes('FROM JAVIER.RUTERO_CONFIG')) return [];
      if (sql.includes('FROM DSEDAC.CPC')) return [];
      return [];
    });

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
    expect(res.body.count).toBe(201);
    expect(new Set(res.body.clients.map((client) => client.code)).size).toBe(201);
    expect(mockQueryWithParams.mock.calls.filter(([sql]) => sql.includes('FROM DSEDAC.CLI'))).toHaveLength(2);
    expect(mockQueryWithParams.mock.calls.filter(([sql]) => sql.includes('FROM DSEDAC.CPC'))).toHaveLength(2);
  });

  test('GET /rutero/day/:day serves the complete payload from shared cache', async () => {
    mockRedisGet.mockResolvedValue({
      clients: [{ code: '4300000001', name: 'Cliente cacheado' }],
      count: 1,
      day: 'martes',
      orderStatusDegraded: false,
    });

    const res = await request(app)
      .get('/rutero/day/martes')
      .query({ vendedorCodes: '02', role: 'comercial', year: '2026', month: '4', week: '4' });

    expect(res.status).toBe(200);
    expect(res.body.cacheStatus).toBe('hit');
    expect(res.body.count).toBe(1);
    expect(res.body.clients[0].name).toBe('Cliente cacheado');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockRedisGet).toHaveBeenCalledWith('query', expect.stringContaining('rutero:day:payload:v4:'));
  });

  test('GET /rutero/day/:day separates reversed manager scopes with different primary vendors', async () => {
    const cacheKeys = [];
    mockRedisGet.mockImplementation(async (_namespace, cacheKey) => {
      cacheKeys.push(cacheKey);
      return null;
    });

    for (const vendedorCodes of ['02,03', '03,02']) {
      const res = await request(app)
        .get('/rutero/day/martes')
        .query({
          vendedorCodes,
          role: 'comercial',
          year: '2026',
          month: '4',
          week: '4',
        });
      expect(res.status).toBe(200);
    }

    expect(cacheKeys).toHaveLength(2);
    expect(cacheKeys[0]).toContain('scope:2,3:primary:2:');
    expect(cacheKeys[1]).toContain('scope:2,3:primary:3:');
    expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
  });
});

test('GET /rutero/day/:day binds combined sales markers before client scope', async () => {
  const res = await request(makeApp())
    .get('/rutero/day/martes')
    .query({
      vendedorCodes: '02',
      role: 'comercial',
      year: '2026',
      month: '4',
      week: '4',
      forceRefresh: '1',
    });

  expect(res.status).toBe(200);
  const salesCall = mockQueryWithParams.mock.calls.find(([sql]) => sql.includes('AS PREV_TOTAL'));
  expect(salesCall).toBeDefined();
  const params = salesCall[1];
  expect(params[0]).toBe(2026);
  expect(params[1]).toBe(2026);
  expect(params[2]).toBe(2025);
  expect(params[6]).toBe(2025);
  expect(params[10]).toBe(2025);
  expect(params.slice(11, 13)).toEqual(['4300000001', '4300000002']);
});
