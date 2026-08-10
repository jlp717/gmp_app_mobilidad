'use strict';

// Contract coverage for the routes mounted by `app.use('/api', plannerRoutes)`.
// The planner router is shared with commercial planning; this file deliberately
// exercises it with in-memory collaborators only (no DB2, Redis or network).
const request = require('supertest');
const express = require('express');

const mockGetPool = jest.fn();
const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn();
const mockDeleteCachePattern = jest.fn();
const mockGetClientsForDay = jest.fn();
const mockLoadLaclaeCache = jest.fn();
const mockReloadRuteroConfig = jest.fn();
const mockLookupClientAssignedVendorCodes = jest.fn();

jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../config/db', () => ({
  getPool: (...args) => mockGetPool(...args),
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, REALTIME: 60 },
  deleteCachePattern: (...args) => mockDeleteCachePattern(...args),
}));
jest.mock('../services/laclae', () => ({
  getWeekCountsFromCache: jest.fn(() => ({ lunes: 1, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 })),
  getTotalClientsFromCache: jest.fn(() => 1),
  getClientsForDay: (...args) => mockGetClientsForDay(...args),
  reloadRuteroConfig: (...args) => mockReloadRuteroConfig(...args),
  loadLaclaeCache: (...args) => mockLoadLaclaeCache(...args),
  getClientCurrentDay: jest.fn(() => 'lunes'),
  getNaturalOrder: jest.fn(() => 0),
  laclaeCacheLastLoadTime: jest.fn(() => Date.now()),
  getCachedVendorCodes: jest.fn(() => []),
}));
jest.mock('../services/emailService', () => ({ sendAuditEmail: jest.fn(), sendAuditEmailNow: jest.fn() }));
jest.mock('../utils/db2-schemas', () => ({ db2WriteTable: table => `JAVIER.${table}` }));
jest.mock('../utils/common', () => {
  const actual = jest.requireActual('../utils/common');
  return {
    ...actual,
    lookupClientAssignedVendorCodes: (...args) => mockLookupClientAssignedVendorCodes(...args),
  };
});

const plannerRoutes = require('../routes/planner');

const COMMERCIAL = { code: '01', codigovendedor: '01', role: 'COMERCIAL' };
const REPARTIDOR = { code: '01', codigovendedor: '01', role: 'REPARTIDOR' };
const JEFE = { code: '98', codigovendedor: '98', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: ['01', '02'] };
const ADMIN = { code: '99', codigovendedor: '99', role: 'ADMIN', vendorCodes: ['01', '02'] };

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = user; next(); });
  // Mirrors the production namespace; authentication itself is mounted before
  // this router in server.js and is covered by auth integration tests.
  app.use('/api', plannerRoutes);
  return app;
}

function connection() {
  return {
    query: jest.fn().mockResolvedValue([]),
    rollback: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockQueryWithParams.mockResolvedValue([]);
  mockCachedQuery.mockImplementation((queryFn, sql, optionsOrKey, _ttl, params) =>
    queryFn(sql, Array.isArray(params) ? params : (optionsOrKey?.params || [])));
  mockGetClientsForDay.mockReturnValue([]);
  mockDeleteCachePattern.mockResolvedValue(undefined);
  mockLoadLaclaeCache.mockResolvedValue(undefined);
  mockReloadRuteroConfig.mockResolvedValue(undefined);
  mockLookupClientAssignedVendorCodes.mockResolvedValue(['01']);
});

describe('mounted planner/rutero route matrix', () => {
  test.each([
    '/api/router/calendar?vendedorCodes=01&year=2026&month=1',
    '/api/rutero/week?vendedorCodes=01',
    '/api/rutero/positions/lunes?vendedorCodes=01',
    '/api/rutero/day-direct/lunes?vendedorCodes=01',
    '/api/rutero/day/lunes?vendedorCodes=01',
  ])('requires an authenticated planner identity: %s', async url => {
    const res = await request(makeApp()).get(url);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test.each([
    '/api/router/calendar?vendedorCodes=02',
    '/api/rutero/week?vendedorCodes=02',
    '/api/rutero/positions/lunes?vendedorCodes=02',
    '/api/rutero/day-direct/lunes?vendedorCodes=02',
    '/api/rutero/day/lunes?vendedorCodes=02',
  ])('commercial ownership rejects another vendor before work: %s', async url => {
    const res = await request(makeApp(COMMERCIAL)).get(url);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_ROLE');
    expect(mockQueryWithParams).not.toHaveBeenCalled();
    expect(mockGetClientsForDay).not.toHaveBeenCalled();
  });

  test('JEFE and ADMIN can read their explicit visible vendor scope', async () => {
    let res = await request(makeApp(JEFE)).get('/api/router/calendar?vendedorCodes=02&year=2026&month=1');
    expect(res.status).toBe(200);
    res = await request(makeApp(ADMIN)).get('/api/rutero/positions/lunes?vendedorCodes=02');
    expect(res.status).toBe(200);
  });

  test.each([
    ['/api/rutero/day-direct/not-a-day?vendedorCodes=01', 'GET', 400],
    ['/api/rutero/day/not-a-day?vendedorCodes=01', 'GET', 400],
    // Scope authorization intentionally precedes format validation, so an
    // attacker cannot use the endpoint to distinguish vendor-code formats.
    ['/api/rutero/day-direct/lunes?vendedorCodes=01;DROP', 'GET', 403],
  ])('rejects invalid day/vendor input: %s', async (url, method, expectedStatus) => {
    const res = await request(makeApp(COMMERCIAL))[method.toLowerCase()](url);
    expect(res.status).toBe(expectedStatus);
  });

  test('typed service failure is mapped to an HTTP error rather than a successful empty day', async () => {
    mockGetClientsForDay.mockImplementation(() => { throw new Error('cache unavailable'); });
    const res = await request(makeApp(COMMERCIAL)).get('/api/rutero/positions/lunes?vendedorCodes=01');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  test('PEDIDOS_CAB status failure is a typed sanitized 503, never SIN_PEDIDO/200', async () => {
    mockGetClientsForDay.mockReturnValue(['4300000001']);
    mockQueryWithParams.mockImplementation(async sql => {
      if (sql.includes('FROM JAVIER.PEDIDOS_CAB')) {
        throw new Error('SQL30081N host=internal-db2 customer=secret');
      }
      if (sql.includes('FROM DSEDAC.CLI')) {
        return [{ CODE: '4300000001', NAME: 'Cliente Uno', ADDRESS: '', CITY: '' }];
      }
      return [];
    });

    const res = await request(makeApp(COMMERCIAL))
      .get('/api/rutero/day/lunes?vendedorCodes=01&date=2026-08-10');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('RUTERO_ORDER_STATUS_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('SQL30081N');
    expect(JSON.stringify(res.body)).not.toContain('internal-db2');
    expect(res.body.clients).toBeUndefined();
  });

  test('client detail rejects foreign and malformed client identifiers before detail queries', async () => {
    mockLookupClientAssignedVendorCodes.mockResolvedValueOnce(['02']);
    let res = await request(makeApp(COMMERCIAL)).get('/api/rutero/client/4300000001/detail');
    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();

    res = await request(makeApp(COMMERCIAL)).get('/api/rutero/client/4300000001%27/detail');
    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('client detail permits a JEFE without client lookup and rejects repartidor access', async () => {
    let res = await request(makeApp(JEFE)).get('/api/rutero/client/4300000001/detail');
    expect(res.status).toBe(200);
    expect(mockLookupClientAssignedVendorCodes).not.toHaveBeenCalled();

    mockQueryWithParams.mockClear();
    res = await request(makeApp(REPARTIDOR)).get('/api/rutero/client/4300000001/detail');
    expect(res.status).toBe(403);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test.each([
    ['/api/rutero/move_clients', {}],
    ['/api/rutero/config', {}],
  ])('mutation payload must be structurally valid: %s', async (url, body) => {
    const res = await request(makeApp(COMMERCIAL)).post(url).send(body);
    expect(res.status).toBe(400);
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  test.each([
    ['/api/rutero/move_clients', { vendedor: '02', moves: [] }],
    ['/api/rutero/config', { vendedor: '02', dia: 'lunes', orden: [] }],
  ])('mutation cannot target another vendor: %s', async (url, body) => {
    const res = await request(makeApp(COMMERCIAL)).post(url).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_ROLE');
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  test('JEFE mutation succeeds with in-memory DB collaborator', async () => {
    const conn = connection();
    mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(conn) });
    const res = await request(makeApp(JEFE))
      .post('/api/rutero/move_clients')
      .send({ vendedor: '02', moves: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true, movedClients: [] }));
    expect(conn.close).toHaveBeenCalled();
  });

  test('reload is limited to JEFE, and its service failure is an error response', async () => {
    let res = await request(makeApp(COMMERCIAL)).post('/api/rutero/reload-cache').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_ROLE');

    mockLoadLaclaeCache.mockRejectedValueOnce(new Error('cache service unavailable'));
    res = await request(makeApp(JEFE)).post('/api/rutero/reload-cache').send({});
    expect(res.status).toBe(500);
  });

  test('documented gap: ADMIN is privileged elsewhere but reload-cache currently accepts only JEFE_VENTAS', async () => {
    const res = await request(makeApp(ADMIN)).post('/api/rutero/reload-cache').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_ROLE');
  });

  test('source route inventory exposes the legacy reload duplicate for follow-up, without changing it', () => {
    const routes = plannerRoutes.stack.filter(layer => layer.route).map(layer => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).sort(),
    }));
    expect(routes).toEqual(expect.arrayContaining([
      { path: '/router/calendar', methods: ['get'] },
      { path: '/rutero/week', methods: ['get'] },
      { path: '/rutero/positions/:day', methods: ['get'] },
      { path: '/rutero/day-direct/:day', methods: ['get'] },
      { path: '/rutero/day/:day', methods: ['get'] },
      { path: '/rutero/client/:code/detail', methods: ['get'] },
      { path: '/rutero/move_clients', methods: ['post'] },
      { path: '/rutero/config', methods: ['post'] },
      { path: '/rutero/reload-cache', methods: ['post'] },
      { path: '/rutero/reload-cache-old', methods: ['post'] },
    ]));
  });
});
