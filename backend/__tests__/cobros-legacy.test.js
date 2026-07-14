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

function mockVendorClientScopeHit(sql) {
  return /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql);
}

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

function mockLegacyPendingSummaryDb({
  pageRows = [],
  portfolioRows = null,
  pageCobros = [],
  pageRepartidor = [],
  portfolioCobros = [],
  portfolioRepartidor = [],
  portfolioQueryError = null,
} = {}) {
  const portfolio = portfolioRows == null ? pageRows : portfolioRows;
  const toNumber = (value) => parseFloat(value) || 0;
  const makeAggregateRows = () => {
    const grandTotal = portfolio.reduce((sum, row) => sum + toNumber(row.TOTAL_PENDIENTE), 0);
    const grandTotalVencido = portfolio.reduce((sum, row) => sum + toNumber(row.TOTAL_VENCIDO), 0);
    const clientCount = new Set(portfolio.map((row) => String(row.CLIENTE || '').trim()).filter(Boolean)).size;
    return (pageRows || []).map((row) => ({
      CLIENTE: row.CLIENTE,
      NOMBRE: row.NOMBRE || row.NOMBRE_ALT || row.NOMBRE_CLI || row.CLIENTE,
      DOC_COUNT: row.DOC_COUNT || 1,
      TOTAL_PENDIENTE: row.TOTAL_PENDIENTE,
      TOTAL_VENCIDO: row.TOTAL_VENCIDO,
      GRAND_TOTAL: grandTotal,
      GRAND_TOTAL_VENCIDO: grandTotalVencido,
      CVC_GRAND_TOTAL: grandTotal,
      CVC_GRAND_TOTAL_VENCIDO: grandTotalVencido,
      CLIENT_COUNT: clientCount,
      VENCIDO_CLIENT_COUNT: portfolio.filter((row) => toNumber(row.TOTAL_VENCIDO) > 0).length,
    }));
  };
  const routeSql = async (sql) => {
    if (/CLIENT_RANKED/i.test(sql)) return makeAggregateRows();
    if (portfolioQueryError && /FROM\s+DSEDAC\.CVC\s+CVC/i.test(sql) && !/OFFSET\s+\d+\s+ROWS/i.test(sql)) {
      throw portfolioQueryError;
    }
    if (/WITH\s+PAGE_DOCS/i.test(sql)) {
      if (/\.COBROS/i.test(sql)) return pageCobros;
      if (/REPARTIDOR_COBROS/i.test(sql)) return pageRepartidor;
      return [];
    }
    if (/FROM\s+JAVIER\.COBROS\s+C/i.test(sql) && /EXISTS/i.test(sql)) return portfolioCobros;
    if (/REPARTIDOR_COBROS\s+R/i.test(sql) && /EXISTS/i.test(sql)) return portfolioRepartidor;
    if (/OFFSET\s+\d+\s+ROWS/i.test(sql)) return pageRows;
    if (/FROM\s+DSEDAC\.CVC\s+CVC/i.test(sql)) return portfolio;
    return [];
  };
  mockQuery.mockImplementation(routeSql);
  mockQueryWithParams.mockImplementation(routeSql);
}

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
    mockLegacyPendingSummaryDb();

    const res = await request(makeApp({
      id: '98',
      code: '98',
      role: 'JEFE_VENTAS',
      isJefeVentas: true,
      vendorCodes: ['01', '02'],
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const sql = mockCachedQuery.mock.calls[0][1];
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s+\('01','1','02','2'\)/i);
    expect(sql).toMatch(/TRIM\(.*LCCDVD.*\)\s+IN\s+\('01','1','02','2'\)/i);
    expect(mockQuery.mock.calls[0][0]).toBe(sql);
  });

  test('pending-summary uses semi-join vendor filter and due-today vencido rule', async () => {
    mockLegacyPendingSummaryDb();

    const res = await request(makeApp({ id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true }))
      .get('/pending-summary/01,02');

    expect(res.status).toBe(200);
    const sql = mockCachedQuery.mock.calls[0][1];
    expect(sql).toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s+IN\s*\(/i);
    expect(sql).toMatch(/SELECT\s+TRIM\(CLP\.CODIGOCLIENTE\)\s+FROM\s+DSEDAC\.CLP\s+CLP/i);
    expect(sql).toMatch(/UNION\s+SELECT\s+DISTINCT\s+TRIM\(LAC\.LCCDCL\)/i);
    expect(sql).toMatch(/FROM\s+DSED\.LACLAE\s+LAC/i);
    expect(sql).not.toMatch(/LEFT\s+JOIN\s+DSEDAC\.CLP/i);
    expect(sql).not.toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s*<>\s*''/i);
    expect(sql).toMatch(/<=\s*\(YEAR\(CURRENT_DATE\) \* 10000 \+ MONTH\(CURRENT_DATE\) \* 100 \+ DAY\(CURRENT_DATE\)\)/i);
    expect(sql).toMatch(/TRIM\(CLP\.VENDEDORCOMERCIAL\)\s+IN\s+\('01','1','02','2'\)/i);
    expect(mockQuery.mock.calls[0][0]).toBe(sql);
  });

  test('pending-summary SQL is bounded and deterministically ordered for production-sized CVC', async () => {
    mockLegacyPendingSummaryDb();

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL?limit=50&page=1');

    expect(res.status).toBe(200);
    const sql = mockCachedQuery.mock.calls[0][1];
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    expect(normalizedSql).toMatch(/ROW_NUMBER\(\) OVER \(ORDER BY C\.TOTAL_PENDIENTE DESC, C\.CLIENTE ASC\) AS RN/i);
    expect(normalizedSql).toMatch(/R\.RN > 0 AND R\.RN <= 50/i);
    expect(normalizedSql).toMatch(/SCOPE_TOTALS/i);
  });

  test('pending-summary ALL without vendor scope excludes empty client CVC rows (B7)', async () => {
    mockLegacyPendingSummaryDb();

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const sql = mockCachedQuery.mock.calls[0][1];
    expect(sql).toMatch(/TRIM\(CVC\.CODIGOCLIENTEALBARAN\)\s*<>\s*''/i);
  });

  test('registrar does not fall back to legacy JAVIER.COBROS writes when runtime order auth fails', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (mockVendorClientScopeHit(sql)) return [{ OK: 1 }];
      return [];
    });

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/C001/registrar')
      .send({
        referencia: 'M-1',
        importe: 10,
        formaPago: 'CONTADO',
        codigoUsuario: '99',
        idempotencyToken: 'legacy-token-001',
      });

    expect(res.status).toBe(403);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT INTO JAVIER\.COBROS\b/i.test(sql))).toBe(false);
  });

  test('pending-summary uses COBROS_LIN cutover aggregate totals from DB2', async () => {
    mockLegacyPendingSummaryDb({
      pageRows: [{
        CLIENTE: 'C001',
        SERIE_DOCUMENTO: 'M',
        NUMERO_DOCUMENTO: 1,
        TOTAL_PENDIENTE: '90.00',
        TOTAL_VENCIDO: '0.00',
        NOMBRE_ALT: 'Cliente Uno',
        NOMBRE_CLI: 'Cliente Uno SL',
      }],
      pageCobros: [{ CLIENTE: 'C001', REF: 'CVC:M-1', TOTAL_APP: '80.00' }],
      pageRepartidor: [{ CLIENTE: 'C001', DOC_KEY: 'M-1', TOTAL_REP: '30.00' }],
      portfolioCobros: [{ CLIENTE: 'C001', REF: 'CVC:M-1', TOTAL_APP: '80.00' }],
      portfolioRepartidor: [{ CLIENTE: 'C001', SERIE: 'M', NUMERO: '1', TOTAL_REP: '30.00' }],
    });

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const entry = res.body.summary['C001'];
    expect(entry).toBeDefined();
    expect(entry.total).toBeCloseTo(90, 1);
    expect(entry.vencido).toBe(0);
    expect(res.body.grandTotal).toBeCloseTo(90, 1);
    expect(mockCachedQuery.mock.calls[0][1]).toMatch(/COBROS_LIN/i);
  });

  test('pending-summary returns empty portfolio when DB2 cutover aggregate has no net pending rows', async () => {
    mockLegacyPendingSummaryDb({
      pageRows: [],
      portfolioRows: [],
      pageCobros: [{ CLIENTE: 'C002', REF: 'CVC:M-2', TOTAL_APP: '70.00' }],
      pageRepartidor: [{ CLIENTE: 'C002', DOC_KEY: 'M-2', TOTAL_REP: '30.00' }],
      portfolioCobros: [{ CLIENTE: 'C002', REF: 'CVC:M-2', TOTAL_APP: '70.00' }],
      portfolioRepartidor: [{ CLIENTE: 'C002', SERIE: 'M', NUMERO: '2', TOTAL_REP: '30.00' }],
    });

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const entry = res.body.summary['C002'];
    expect(entry).toBeUndefined();
    expect(res.body.grandTotal).toBe(0);
    expect(res.body.clientCount).toBe(0);
  });

  test('pending-summary handles app-side query failures gracefully', async () => {
    mockLegacyPendingSummaryDb({
      pageRows: [{
        CLIENTE: 'C003',
        SERIE_DOCUMENTO: 'M',
        NUMERO_DOCUMENTO: 3,
        TOTAL_PENDIENTE: '100.00',
        TOTAL_VENCIDO: '0.00',
        NOMBRE_ALT: '',
        NOMBRE_CLI: 'Cliente Tres',
      }],
      portfolioRows: [{
        CLIENTE: 'C003',
        SERIE_DOCUMENTO: 'M',
        NUMERO_DOCUMENTO: 3,
        TOTAL_PENDIENTE: '100.00',
        TOTAL_VENCIDO: '0.00',
      }],
    });
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/WITH\s+PAGE_DOCS/i.test(sql) && /\.COBROS/i.test(sql)) {
        throw new Error('Table not found');
      }
      if (/WITH\s+PAGE_DOCS/i.test(sql) && /REPARTIDOR_COBROS/i.test(sql)) return [];
      if (/OFFSET\s+\d+\s+ROWS/i.test(sql)) {
        return [{
          CLIENTE: 'C003',
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 3,
          TOTAL_PENDIENTE: '100.00',
          TOTAL_VENCIDO: '0.00',
          NOMBRE_ALT: '',
          NOMBRE_CLI: 'Cliente Tres',
        }];
      }
      if (/FROM\s+DSEDAC\.CVC\s+CVC/i.test(sql)) {
        return [{
          CLIENTE: 'C003',
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 3,
          TOTAL_PENDIENTE: '100.00',
          TOTAL_VENCIDO: '0.00',
        }];
      }
      return [];
    });

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL');

    expect(res.status).toBe(200);
    const entry = res.body.summary['C003'];
    expect(entry).toBeDefined();
    // Should still work with raw CVC data when app-side query fails
    expect(entry.total).toBeCloseTo(100, 1);
  });

  test('pending-summary grandTotal uses full portfolio, not paginated page only', async () => {
    mockLegacyPendingSummaryDb({
      pageRows: [{
        CLIENTE: 'C001',
        SERIE_DOCUMENTO: 'M',
        NUMERO_DOCUMENTO: 1,
        TOTAL_PENDIENTE: '100.00',
        TOTAL_VENCIDO: '0.00',
        NOMBRE_ALT: 'Cliente Uno',
        NOMBRE_CLI: 'Cliente Uno',
      }],
      portfolioRows: [
        {
          CLIENTE: 'C001',
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 1,
          TOTAL_PENDIENTE: '100.00',
          TOTAL_VENCIDO: '0.00',
        },
        {
          CLIENTE: 'C002',
          SERIE_DOCUMENTO: 'M',
          NUMERO_DOCUMENTO: 2,
          TOTAL_PENDIENTE: '200.00',
          TOTAL_VENCIDO: '50.00',
        },
      ],
    });

    const res = await request(makeApp({
      id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true,
    })).get('/pending-summary/ALL?limit=1&page=1');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.summary).sort()).toEqual(['C001']);
    expect(res.body.summary.C001.total).toBeCloseTo(100, 1);
    expect(res.body.summary.C002).toBeUndefined();
    expect(res.body.grandTotal).toBeCloseTo(300, 1);
    expect(res.body.grandTotalVencido).toBeCloseTo(50, 1);
    expect(res.body.clientCount).toBe(2);
    expect(mockCachedQuery.mock.calls[0][1]).toMatch(/SCOPE_TOTALS/i);
  });
});

describe('legacy cobros client scope AppSec red tests', function() {
  test('GET /:codigoCliente/pendientes rejects COMERCIAL outside assigned client scope before DB reads', async function() {
    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL', clientCodes: ['C001'] }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('GET /:codigoCliente/estado rejects COMERCIAL outside assigned client scope before DB reads', async function() {
    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL', clientCodes: ['C001'] }))
      .get('/C999/estado');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('POST /:codigoCliente/registrar rejects COMERCIAL outside assigned client scope before DB writes', async function() {
    mockQueryWithParams.mockResolvedValue([]);

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL', clientCodes: ['C001'] }))
      .post('/C999/registrar')
      .send({ referencia: 'M-1', importe: 10, formaPago: 'CONTADO', idempotencyToken: 'legacy-token-scope-001' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

describe('legacy cobros vendor client scope when clientCodes absent', function() {
  function mockVendorClientScopeMiss() {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      return [];
    });
  }

  test('GET /:codigoCliente/pendientes rejects COMERCIAL outside vendor client scope before debt reads', async function() {
    mockVendorClientScopeMiss();

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM\s+DSEDAC\.CVC/i.test(sql))).toBe(false);
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/DSEDAC\.CLI|DSEDAC\.CLP|DSED\.LACLAE/i);
    expect(mockQueryWithParams.mock.calls[0][1]).toEqual(expect.arrayContaining(['C999']));
  });

  test('GET /:codigoCliente/pendientes blocks PEDIDOS_CAB fallback for out-of-scope client', async function() {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/FROM\s+DSEDAC\.CLI/i.test(sql) || /DSEDAC\.CLP/i.test(sql) || /DSED\.LACLAE/i.test(sql)) {
        return [];
      }
      if (/FROM\s+JAVIER\.PEDIDOS_CAB/i.test(sql)) {
        return [{
          ID: 99,
          NUMEROPEDIDO: 1,
          SERIEPEDIDO: 'M',
          IMPORTETOTAL: 120,
          ESTADO: 'CONFIRMADO',
        }];
      }
      return [];
    });
    mockCachedQuery.mockImplementationOnce(async () => {
      throw new Error('CVC unavailable');
    });

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/pendientes');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /PEDIDOS_CAB/i.test(sql))).toBe(false);
  });

  test('GET /:codigoCliente/estado rejects COMERCIAL outside vendor client scope before debt reads', async function() {
    mockVendorClientScopeMiss();

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .get('/C999/estado');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockCachedQuery).not.toHaveBeenCalled();
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /FROM\s+DSEDAC\.CVC/i.test(sql))).toBe(false);
  });

  test('POST /:codigoCliente/registrar rejects COMERCIAL outside vendor client scope before writes', async function() {
    mockVendorClientScopeMiss();

    const res = await request(makeApp({ id: '01', code: '01', role: 'COMERCIAL' }))
      .post('/C999/registrar')
      .send({
        referencia: 'M-1',
        importe: 10,
        formaPago: 'CONTADO',
        idempotencyToken: 'legacy-token-vendor-scope-001',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_CLIENT_VENDOR');
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /INSERT\s+INTO\s+JAVIER\.COBROS/i.test(sql))).toBe(false);
  });
});
