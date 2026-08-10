'use strict';

const request = require('supertest');
const express = require('express');

const mockGetPool = jest.fn();
const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn();
const mockLookupClientAssignedVendorCodes = jest.fn();
const mockDeleteCachePattern = jest.fn();
const mockGetClientsForDay = jest.fn();
const mockReloadRuteroConfig = jest.fn();

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
  getWeekCountsFromCache: jest.fn(() => ({ lunes: 0 })),
  getTotalClientsFromCache: jest.fn(() => 0),
  getClientsForDay: (...args) => mockGetClientsForDay(...args),
  reloadRuteroConfig: (...args) => mockReloadRuteroConfig(...args),
  loadLaclaeCache: jest.fn(),
  getClientCurrentDay: jest.fn(),
  getNaturalOrder: jest.fn(() => 0),
  laclaeCacheLastLoadTime: jest.fn(() => Date.now()),
  getCachedVendorCodes: jest.fn(() => []),
}));
jest.mock('../services/emailService', () => ({
  sendAuditEmail: jest.fn(), sendAuditEmailNow: jest.fn(),
}));
jest.mock('../utils/db2-schemas', () => ({
  db2WriteTable: (table) => `JAVIER.${table}`,
}));
jest.mock('../utils/common', () => {
  const actual = jest.requireActual('../utils/common');
  return {
    ...actual,
    lookupClientAssignedVendorCodes: (...args) => mockLookupClientAssignedVendorCodes(...args),
  };
});

const plannerRoutes = require('../routes/planner');

const COMMERCIAL = { code: '01', role: 'COMERCIAL', isJefeVentas: false };
const REPARTIDOR = { code: '01', role: 'REPARTIDOR', isJefeVentas: false };
const JEFE = {
  code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
  vendorCodes: ['01', '02'], vendedorCodes: ['01', '02'],
};

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/', plannerRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([]);
  mockQueryWithParams.mockResolvedValue([]);
  mockCachedQuery.mockImplementation(async (queryFn, sql, optionsOrKey, _ttl, params) => {
    const effectiveParams = Array.isArray(params)
      ? params
      : (Array.isArray(optionsOrKey?.params) ? optionsOrKey.params : []);
    return queryFn(sql, effectiveParams);
  });
  mockLookupClientAssignedVendorCodes.mockResolvedValue([]);
  mockGetClientsForDay.mockReturnValue([]);
  mockReloadRuteroConfig.mockResolvedValue(undefined);
  mockDeleteCachePattern.mockResolvedValue(undefined);
});

test.each([
  '/router/calendar?vendedorCodes=02',
  '/rutero/week?vendedorCodes=02',
  '/rutero/config?vendedor=02&dia=lunes',
  '/rutero/counts?vendedorCodes=02',
  '/rutero/positions/lunes?vendedorCodes=02',
  '/rutero/day-direct/lunes?vendedorCodes=02',
  '/rutero/day/lunes?vendedorCodes=02',
])('COMERCIAL cannot read another vendor and denial executes no handler DB: %s', async (url) => {
  const res = await request(makeApp(COMMERCIAL)).get(url);
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('INSUFFICIENT_ROLE');
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockQueryWithParams).not.toHaveBeenCalled();
  expect(mockCachedQuery).not.toHaveBeenCalled();
  expect(mockGetClientsForDay).not.toHaveBeenCalled();
});

test.each([
  ['/rutero/move_clients', { vendedor: '01', moves: [] }],
  ['/rutero/config', { vendedor: '01', dia: 'lunes', orden: [] }],
])('REPARTIDOR cannot mutate commercial rutero and opens no DB pool: %s', async (url, body) => {
  const res = await request(makeApp(REPARTIDOR)).post(url).send(body);
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('INSUFFICIENT_ROLE');
  expect(mockGetPool).not.toHaveBeenCalled();
  expect(mockQueryWithParams).not.toHaveBeenCalled();
  expect(mockDeleteCachePattern).not.toHaveBeenCalled();
});

test('COMERCIAL keeps authorized behavior for its own vendor mutation', async () => {
  const connection = {
    query: jest.fn().mockResolvedValue([]),
    rollback: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(connection) });

  const res = await request(makeApp(COMMERCIAL))
    .post('/rutero/move_clients')
    .send({ vendedor: '01', moves: [] });

  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.objectContaining({ success: true, movedClients: [] }));
  expect(mockGetPool).toHaveBeenCalledTimes(1);
  expect(connection.close).toHaveBeenCalledTimes(1);
});

test('COMERCIAL keeps authorized behavior for its own config mutation', async () => {
  const connection = {
    query: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  };
  mockGetPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(connection) });

  const res = await request(makeApp(COMMERCIAL))
    .post('/rutero/config')
    .send({ vendedor: '01', dia: 'lunes', orden: [] });

  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.objectContaining({ success: true }));
  expect(mockGetPool).toHaveBeenCalledTimes(1);
  expect(connection.query).toHaveBeenCalledTimes(2);
  expect(connection.close).toHaveBeenCalledTimes(2);
});

test('REPARTIDOR can read its own vendor config', async () => {
  mockQueryWithParams.mockResolvedValue([{ CLIENTE: '4300000001', ORDEN: 10 }]);

  const res = await request(makeApp(REPARTIDOR)).get('/rutero/config?vendedor=01&dia=lunes');

  expect(res.status).toBe(200);
  expect(res.body.config).toEqual([{ CLIENTE: '4300000001', ORDEN: 10 }]);
});
test('COMERCIAL reads own config and JEFE is limited to visible vendor claims', async () => {
  mockQueryWithParams.mockResolvedValue([{ CLIENTE: '4300000001', ORDEN: 10 }]);
  let res = await request(makeApp(COMMERCIAL)).get('/rutero/config?vendedor=01&dia=lunes');
  expect(res.status).toBe(200);
  expect(res.body.config).toEqual([{ CLIENTE: '4300000001', ORDEN: 10 }]);

  res = await request(makeApp(JEFE)).get('/rutero/config?vendedor=02&dia=lunes');
  expect(res.status).toBe(200);
  const callsBeforeDenied = mockQueryWithParams.mock.calls.length;
  res = await request(makeApp(JEFE)).get('/rutero/config?vendedor=03&dia=lunes');
  expect(res.status).toBe(403);
  expect(mockQueryWithParams).toHaveBeenCalledTimes(callsBeforeDenied);

  res = await request(makeApp(JEFE)).get('/rutero/config?vendedor=ALL&dia=lunes');
  expect(res.status).toBe(403);
  expect(mockQueryWithParams).toHaveBeenCalledTimes(callsBeforeDenied);
});

test.each([
  '/rutero/vendedores',
  '/diagnose/client/4300000001',
  '/diagnose/vendor/01',
])('global list/diagnose endpoint is privileged and denied before DB: %s', async (url) => {
  const res = await request(makeApp(COMMERCIAL)).get(url);
  expect(res.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockQueryWithParams).not.toHaveBeenCalled();
  expect(mockCachedQuery).not.toHaveBeenCalled();
});

test('client detail is fail-closed and only reaches detail SQL for owned clients', async () => {
  mockLookupClientAssignedVendorCodes.mockResolvedValueOnce(['02']);
  let res = await request(makeApp(COMMERCIAL)).get('/rutero/client/4300000001/detail');
  expect(res.status).toBe(403);
  expect(mockQueryWithParams).not.toHaveBeenCalled();

  mockLookupClientAssignedVendorCodes.mockResolvedValueOnce(['01']);
  res = await request(makeApp(COMMERCIAL)).get('/rutero/client/4300000001/detail');
  expect(res.status).toBe(200);
  expect(mockLookupClientAssignedVendorCodes).toHaveBeenCalledWith('4300000001');
  expect(mockQueryWithParams).toHaveBeenCalled();

  mockLookupClientAssignedVendorCodes.mockClear();
  res = await request(makeApp(REPARTIDOR)).get('/rutero/client/4300000001/detail');
  expect(res.status).toBe(403);
  expect(mockLookupClientAssignedVendorCodes).not.toHaveBeenCalled();
});

test('router source contract keeps reload guards and mounts authorization before handlers', () => {
  const routeLayers = plannerRoutes.stack.filter((layer) => layer.route);
  const byPath = (path) => routeLayers.find((layer) => layer.route.path === path);
  expect(byPath('/rutero/vendedores').route.stack[0].name).toBe('requirePlannerPrivilege');
  expect(byPath('/diagnose/client/:code').route.stack[0].name).toBe('requirePlannerPrivilege');
  expect(byPath('/rutero/client/:code/detail').route.stack[0].name).toBe('requirePlannerClientOwnership');
  expect(byPath('/rutero/reload-cache').route.stack).toHaveLength(1);
  expect(byPath('/rutero/reload-cache-old').route.stack).toHaveLength(1);
});
