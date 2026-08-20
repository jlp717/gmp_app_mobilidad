'use strict';

const express = require('express');
const request = require('supertest');

const mockListOrder = jest.fn();
const mockReplaceOrder = jest.fn();

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: jest.fn(),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn((fn, sql, _k, _t, params) => fn(sql, params)),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../app/services/pdfService', () => ({ generateInvoicePDF: jest.fn() }));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: jest.fn(() => false),
  isDeliveryStatusNewSchema: jest.fn(() => false),
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => "CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS"),
}));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(),
  generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  verifyToken: (req, res, next) => {
    if (!req.headers.authorization || !global.__RUTERO_ORDEN_USER__) {
      return res.status(401).json({ success: false, code: 'MISSING_TOKEN' });
    }
    req.user = { ...global.__RUTERO_ORDEN_USER__ };
    return next();
  },
  requireJefeVentas: (_req, _res, next) => next(),
}));
jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker {
    constructor(options) { this.options = options; }
  },
}));
jest.mock('../app/services/deliveryReceiptService', () => ({
  generateDeliveryReceipt: jest.fn(),
}));
jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));
jest.mock('../repositories/repartidor-route-db2-repository', () => ({
  getRuteroWeek: jest.fn(),
  resolveAlbaranOwners: jest.fn(),
  resolveInvoiceOwners: jest.fn(),
  resolveDeliveryOwners: jest.fn(),
}));
jest.mock('../repositories/repartidor-rutero-orden-db2-repository', () => ({
  listOrder: (...args) => mockListOrder(...args),
  replaceOrder: (...args) => mockReplaceOrder(...args),
  fetchClientWindows: jest.fn(async () => new Map()),
  fetchClientGeo: jest.fn(async () => new Map()),
  uniqueClientCodes: (codes) => [...new Set((codes || []).filter(Boolean))],
  RuteroOrdenSchemaError: class extends Error {},
}));

const { applySavedOrder, normalizeOrdenPayload } = require('../services/repartidor-rutero-orden-service');
const routes = require('../routes/repartidor');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/repartidor', routes);
  return app;
}

describe('repartidor day-scoped rutero order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.__RUTERO_ORDEN_USER__ = { id: '05', code: '05', role: 'REPARTIDOR', repartidorCodes: ['05'] };
    mockListOrder.mockResolvedValue([]);
    mockReplaceOrder.mockImplementation(async (_id, _date, orden) => ({ orden, revision: 'next' }));
  });

  test('PUT denies foreign repartidor id for REPARTIDOR role', async () => {
    const res = await request(makeApp())
      .put('/repartidor/rutero/order/94')
      .set('Authorization', 'Bearer t')
      .send({
        date: '2026-08-11',
        orden: [{ documentId: '2026-A-1-100-CLI1', posicion: 0 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REPARTIDOR_ACCESS_DENIED');
    expect(mockReplaceOrder).not.toHaveBeenCalled();
  });

  test('PUT rejects multi-id selector with 422', async () => {
    global.__RUTERO_ORDEN_USER__ = { id: 'jefe', code: '00', role: 'JEFE_VENTAS' };
    const res = await request(makeApp())
      .put('/repartidor/rutero/order/05,94')
      .set('Authorization', 'Bearer t')
      .send({
        date: '2026-08-11',
        orden: [{ documentId: '2026-A-1-100-CLI1', posicion: 0 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('REPARTIDOR_ID_MULTI_NOT_ALLOWED');
  });

  test('PUT validates missing date', async () => {
    const res = await request(makeApp())
      .put('/repartidor/rutero/order/05')
      .set('Authorization', 'Bearer t')
      .send({ orden: [{ documentId: '2026-A-1-100-CLI1', posicion: 0 }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DATE_INVALID');
  });

  test('PUT persists own order for REPARTIDOR', async () => {
    const orden = [
      { documentId: '2026-A-1-200-CLI2', cliente: 'CLI2', posicion: 0 },
      { documentId: '2026-A-1-100-CLI1', cliente: 'CLI1', posicion: 1 },
    ];
    const res = await request(makeApp())
      .put('/repartidor/rutero/order/05')
      .set('Authorization', 'Bearer t')
      .send({ date: '2026-08-11', orden, baseRevision: 'current' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockReplaceOrder).toHaveBeenCalledWith('05', '2026-08-11', orden, '05', 'current');
  });

  test('normalizeOrdenPayload rejects duplicate documentId', () => {
    const parsed = normalizeOrdenPayload([
      { documentId: 'doc-1', posicion: 0 },
      { documentId: 'doc-1', posicion: 1 },
    ]);
    expect(parsed.error).toBe('ORDEN_DUPLICATE');
  });

  test('applySavedOrder sorts known docs first and keeps unordered after', () => {
    const items = [
      { id: 'c', name: 'C' },
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'd', name: 'D' },
    ];
    const ordered = applySavedOrder(items, [
      { documentId: 'b', posicion: 0 },
      { documentId: 'a', posicion: 1 },
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  test('optimize validates malformed strategy and origin with 422', async () => {
    const body = { date: '2026-08-11', stops: [{ documentId: 'doc-1', cliente: 'C1' }] };
    const strategy = await request(makeApp()).post('/repartidor/rutero/order/05/optimize').set('Authorization', 'Bearer t').send({ ...body, strategy: 'unknown' });
    const origin = await request(makeApp()).post('/repartidor/rutero/order/05/optimize').set('Authorization', 'Bearer t').send({ ...body, origin: { lat: 200, lng: 0 } });
    expect(strategy.status).toBe(422);
    expect(strategy.body.code).toBe('RUTERO_STRATEGY_INVALID');
    expect(origin.status).toBe(422);
    expect(origin.body.code).toBe('RUTERO_ORIGIN_INVALID');
  });

  test('optimize returns all stops and diagnostics when optional DB data fails', async () => {
    const repo = require('../repositories/repartidor-rutero-orden-db2-repository');
    repo.fetchClientWindows.mockRejectedValueOnce(new Error('CRUT unavailable'));
    repo.fetchClientGeo.mockRejectedValueOnce(new Error('GEO unavailable'));
    const res = await request(makeApp()).post('/repartidor/rutero/order/05/optimize').set('Authorization', 'Bearer t').send({
      date: '2026-08-11', strategy: 'balanced', stops: [{ documentId: 'doc-1', cliente: 'C1' }, { documentId: 'doc-2', cliente: 'C2' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.orden).toHaveLength(2);
    expect(res.body.summary).toMatchObject({ total: 2, missingGps: 2 });
    expect(res.body.diagnostics).toEqual(expect.arrayContaining(['client_windows_unavailable', 'client_geo_unavailable']));
  });});
