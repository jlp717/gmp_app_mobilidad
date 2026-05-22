'use strict';

const request = require('supertest');
const express = require('express');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn(async (fn) => fn());

jest.mock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()));
jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, MEDIUM: 300 },
  invalidateCache: jest.fn(),
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const cobrosRouter = require('../routes/cobros');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(cobrosRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockQueryWithParams.mockReset();
  mockCachedQuery.mockClear();
});

describe('legacy cobros route hardening', () => {
  test('pending-summary rejects COMERCIAL ALL requests', async () => {
    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/pending-summary/ALL');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
  });

  test('pending-summary rejects COMERCIAL requests for another vendor', async () => {
    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/pending-summary/02');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
  });

  test('pending-summary ALL for manager scopes to visible vendorCodes', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp({
      id: '98',
      code: '98',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(['01', '02']);
  });

  test('pending-summary uses semi-join vendor filter and due-today vencido rule', async () => {
    mockQueryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp({ id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/01,02');

    expect(res.status).toBe(200);
    const sql = mockCachedQuery.mock.calls[0][1];
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+DSEDAC\.CLP\s+CLP/i);
    expect(sql).not.toMatch(/LEFT\s+JOIN\s+DSEDAC\.CLP/i);
    expect(sql).toMatch(/<=\s*\(YEAR\(CURRENT_DATE\) \* 10000 \+ MONTH\(CURRENT_DATE\) \* 100 \+ DAY\(CURRENT_DATE\)\)/i);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(['01', '02']);
  });

  test('registrar derives codigoUsuario from authenticated user when present', async () => {
    mockQueryWithParams.mockResolvedValue([]);

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({
        referencia: 'M-1',
        importe: 10,
        formaPago: 'CONTADO',
        codigoUsuario: '99',
        idempotencyToken: 'legacy-token-001',
      });

    expect(res.status).toBe(200);
    const insertCall = mockQueryWithParams.mock.calls.find(([sql]) => /INSERT INTO JAVIER\.COBROS/i.test(sql));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain('01');
    expect(insertCall[1]).not.toContain('99');
  });

  test('pending-summary subtracts app-side COBROS from raw CVC totals', async () => {
    // CVC raw: client C001 has 200 pending, 50 overdue
    mockQuery.mockResolvedValueOnce([
      { CLIENTE: 'C001', TOTAL_PENDIENTE: '200.00', NUM_DOCS: '2', TOTAL_VENCIDO: '50.00', NOMBRE_ALT: 'Cliente Uno', NOMBRE_CLI: 'Cliente Uno SL' },
    ]);
    // App-side COBROS: 80 already paid via app for C001 (SQL aliases to CLIENTE)
    mockQueryWithParams.mockResolvedValueOnce([
      { CLIENTE: 'C001', TOTAL_APP: '80.00' },
    ]);
    // App-side REPARTIDOR_COBROS: 30 collected by repartidor for C001 (SQL aliases to CLIENTE)
    mockQueryWithParams.mockResolvedValueOnce([
      { CLIENTE: 'C001', TOTAL_REP: '30.00' },
    ]);

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const entry = res.body.summary['C001'];
    expect(entry).toBeDefined();
    // 200 raw - 80 COBROS - 30 REPARTIDOR = 90 adjusted
    expect(entry.total).toBeCloseTo(90, 1);
    // vencido proportionally reduced
    expect(entry.vencido).toBeGreaterThanOrEqual(0);
    expect(entry.vencido).toBeLessThanOrEqual(50);
    expect(res.body.grandTotal).toBeCloseTo(90, 1);
  });

  test('pending-summary total does not go below zero after app-side subtraction', async () => {
    // CVC raw: client C002 has 50 pending
    mockQuery.mockResolvedValueOnce([
      { CLIENTE: 'C002', TOTAL_PENDIENTE: '50.00', NUM_DOCS: '1', TOTAL_VENCIDO: '50.00', NOMBRE_ALT: '', NOMBRE_CLI: 'Cliente Dos' },
    ]);
    // App-side payments exceed CVC debt: 100 total
    mockQueryWithParams.mockResolvedValueOnce([
      { CLIENTE: 'C002', TOTAL_APP: '70.00' },
    ]);
    mockQueryWithParams.mockResolvedValueOnce([
      { CLIENTE: 'C002', TOTAL_REP: '30.00' },
    ]);

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const entry = res.body.summary['C002'];
    expect(entry).toBeDefined();
    // 50 - 70 - 30 = -50 → clamped to 0
    expect(entry.total).toBe(0);
    expect(entry.vencido).toBe(0);
    expect(res.body.grandTotal).toBe(0);
  });

  test('pending-summary handles app-side query failures gracefully', async () => {
    // CVC raw data
    mockQuery.mockResolvedValueOnce([
      { CLIENTE: 'C003', TOTAL_PENDIENTE: '100.00', NUM_DOCS: '1', TOTAL_VENCIDO: '0.00', NOMBRE_ALT: '', NOMBRE_CLI: 'Cliente Tres' },
    ]);
    // COBROS query fails
    mockQueryWithParams.mockRejectedValueOnce(new Error('Table not found'));
    // REPARTIDOR_COBROS returns empty
    mockQueryWithParams.mockResolvedValueOnce([]);

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const entry = res.body.summary['C003'];
    expect(entry).toBeDefined();
    // Should still work with raw CVC data when app-side query fails
    expect(entry.total).toBeCloseTo(100, 1);
  });
});
