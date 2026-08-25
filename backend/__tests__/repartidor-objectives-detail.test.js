'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));

jest.mock('../config/db', () => ({
  query: (...args) => mockQuery(...args),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', repartidorCodes: ['05', '08'] };
    next();
  },
}));

jest.mock('../services/metadataCache', () => ({
  isCacheReady: jest.fn(() => true),
  getCachedFi1Names: jest.fn(() => ({})),
  getCachedFi2Names: jest.fn(() => ({})),
  getCachedFi3Names: jest.fn(() => ({})),
  getCachedFi4Names: jest.fn(() => ({})),
}));

jest.mock('../app/services/pdfService', () => ({ generateInvoicePDF: jest.fn() }));
jest.mock('../services/emailPdfService', () => ({
  sendEmailWithPdf: jest.fn(),
  generateInvoiceEmailHtml: jest.fn(),
  generateDeliveryEmailHtml: jest.fn(),
  cachePdf: jest.fn(),
  getCachedPdf: jest.fn(),
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: jest.fn(() => false),
  isDeliveryStatusNewSchema: jest.fn(() => false),
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => "CAST(NULL AS VARCHAR(20)) as DELIVERY_STATUS"),
  getDeliveryStatusTable: jest.fn(() => null),
}));
jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: class CircuitBreaker {},
}));
jest.mock('../app/services/deliveryReceiptService', () => ({ generateDeliveryReceipt: jest.fn() }));
jest.mock('../services/facturas.service', () => ({}));
jest.mock('../services/pdf.service', () => ({}));

const previousTableSet = process.env.REPARTO_TABLE_SET;
process.env.REPARTO_TABLE_SET = 'isolated_test';

const repartidorRepository = require('../repositories/repartidor-route-db2-repository');
const repartidorRoutes = require('../routes/repartidor');

afterAll(() => {
  if (previousTableSet === undefined) delete process.env.REPARTO_TABLE_SET;
  else process.env.REPARTO_TABLE_SET = previousTableSet;
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/repartidor', repartidorRoutes);
  return app;
}

function getDetail(query = {}) {
  return request(makeApp())
    .get('/repartidor/history/objectives-detail/05,08')
    .set('Authorization', 'Bearer test-token')
    .query({ year: 2026, ...query });
}

function clientRow(code, name, total) {
  return { CLIENT_CODE: code, CLIENT_NAME: name, TOTAL_COUNT: total };
}

function laclaeRow({
  client = 'C1', product = 'P1', sales = 10, cost = 5, units = 1,
  fi1 = 'F1', fi2 = 'S1', fi3 = 'T1', fi4 = 'U1', name = product,
} = {}) {
  return {
    CLIENT_CODE: client,
    PRODUCT_CODE: product,
    PRODUCT_NAME: name,
    UNIT_TYPE: 'UDS',
    MONTH: 1,
    SALES: sales,
    COST: cost,
    UNITS: units,
    FI1_CODE: fi1,
    FI2_CODE: fi2,
    FI3_CODE: fi3,
    FI4_CODE: fi4,
  };
}

describe('objectives-detail repository pagination contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
  });

  test('uses one grouped scope query and retains total when the requested page is empty', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ CLIENT_CODE: null, CLIENT_NAME: null, TOTAL_COUNT: 7 }]);

    const result = await repartidorRepository.getObjectivesDetailClients(
      ['05', '08'], 2026, null, { limit: 100, offset: 200 },
    );

    expect(result).toEqual({ total: 7, rows: [] });
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toMatch(/WITH CLIENT_SCOPE AS[\s\S]*NUMBERED AS[\s\S]*PAGE_ROWS AS[\s\S]*SCOPE_TOTAL AS/i);
    expect(sql).toContain('GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN)');
    expect(sql).toContain('MAX(TRIM(COALESCE');
    expect(sql).toContain('LEFT JOIN PAGE_ROWS ON 1 = 1');
    expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY CLIENT_CODE, CLIENT_NAME)');
    expect(params).toEqual(['05', '08', 2026, 200, 300]);
  });

  test('enforces the repository page ceiling before DB2', async () => {
    await expect(repartidorRepository.getObjectivesDetailClients(
      ['05'], 2026, null, { limit: 101, offset: 0 },
    )).rejects.toMatchObject({ code: 'OBJECTIVES_DETAIL_LIMIT_INVALID' });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});

describe('GET /history/objectives-detail/:repartidorId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCachedQuery.mockImplementation((queryFn, sql, _cacheKey, _ttl, params) => queryFn(sql, params));
  });

  test.each([
    {
      label: 'first page', query: { limit: 2, offset: 0 },
      clients: [clientRow('C1', 'Uno', 3), clientRow('C2', 'Dos', 3)],
      expected: { total: 3, hasMore: true, nextOffset: 2 },
    },
    {
      label: 'second page', query: { limit: 1, offset: 1 },
      clients: [clientRow('C2', 'Dos', 3)],
      expected: { total: 3, hasMore: true, nextOffset: 2 },
    },
    {
      label: 'final page', query: { limit: 1, offset: 2 },
      clients: [clientRow('C3', 'Tres', 3)],
      expected: { total: 3, hasMore: false, nextOffset: null },
    },
  ])('returns exact pagination for the $label', async ({ query, clients, expected }) => {
    mockQueryWithParams
      .mockResolvedValueOnce(clients)
      .mockResolvedValueOnce(clients.map((row) => laclaeRow({ client: row.CLIENT_CODE })));

    const response = await getDetail(query);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ limit: query.limit, offset: query.offset, ...expected });
    expect(response.body.scopeTotalAvailability).toBe('PAGED');
    expect(response.body.grandTotal).toBeNull();
  });

  test('returns the real total and PAGED/null for an out-of-range page', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ CLIENT_CODE: null, TOTAL_COUNT: 3 }]);

    const response = await getDetail({ limit: 2, offset: 10 });

    expect(response.status).toBe(200);
    expect(response.body.clients).toEqual([]);
    expect(response.body.pageTotal).toEqual({ sales: 0, cost: 0, units: 0, margin: 0 });
    expect(response.body.grandTotal).toBeNull();
    expect(response.body.scopeTotalAvailability).toBe('PAGED');
    expect(response.body.pagination).toEqual({ limit: 2, offset: 10, total: 3, hasMore: false, nextOffset: null });
    expect(mockQueryWithParams).toHaveBeenCalledTimes(1);
  });

  test('returns a complete zero scope only for an empty first page', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ CLIENT_CODE: null, TOTAL_COUNT: 0 }]);

    const response = await getDetail({ limit: 25, offset: 0 });

    expect(response.status).toBe(200);
    expect(response.body.grandTotal).toEqual({ sales: 0, cost: 0, units: 0, margin: 0 });
    expect(response.body.scopeTotalAvailability).toBe('COMPLETE');
    expect(response.body.pagination).toEqual({ limit: 25, offset: 0, total: 0, hasMore: false, nextOffset: null });
  });

  test('keeps a scoped client without LACLAE rows and reports zero totals', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([clientRow('C1', 'Con ventas', 2), clientRow('C2', 'Sin ventas', 2)])
      .mockResolvedValueOnce([laclaeRow({ client: 'C1', sales: 12, cost: 6, units: 2 })]);

    const response = await getDetail({ limit: 2, offset: 0 });

    expect(response.status).toBe(200);
    expect(response.body.scopeTotalAvailability).toBe('COMPLETE');
    expect(response.body.grandTotal).toEqual(response.body.pageTotal);
    const withoutSales = response.body.clients.find((client) => client.code === 'C2');
    expect(withoutSales).toMatchObject({
      name: 'Sin ventas', totalSales: 0, totalCost: 0, totalUnits: 0,
      productCount: 0, margin: 0, families: [],
    });
  });

  test('binds clientId inside the scoped query before pagination bounds', async () => {
    mockQueryWithParams.mockResolvedValueOnce([clientRow('4300030041', 'Cliente', 1)]).mockResolvedValueOnce([]);

    const response = await getDetail({ clientId: '4300030041', limit: 10, offset: 0 });

    expect(response.status).toBe(200);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?');
    expect(params).toEqual(['05', '08', 2026, '4300030041', 0, 10]);
  });

  test.each([
    [{ limit: 101 }, 'LIMIT_INVALID'],
    [{ offset: -1 }, 'OFFSET_INVALID'],
    [{ offset: '1.5' }, 'OFFSET_INVALID'],
  ])('rejects invalid pagination before DB2: %j', async (query, code) => {
    const response = await getDetail(query);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe(code);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('orders every hierarchy level and products by sales desc then code/name', async () => {
    const rows = [
      laclaeRow({ client: 'C1', product: 'P1', sales: 0.25, fi1: 'F1', fi2: 'S1', fi3: 'T1', fi4: 'U1' }),
      laclaeRow({ client: 'C1', product: 'P2', sales: 0.25, fi1: 'F1', fi2: 'S1', fi3: 'T1', fi4: 'U1' }),
      laclaeRow({ client: 'C1', product: 'P3', sales: 0.5, fi1: 'F1', fi2: 'S1', fi3: 'T1', fi4: 'U2' }),
      laclaeRow({ client: 'C1', product: 'P4', sales: 1, fi1: 'F1', fi2: 'S1', fi3: 'T2', fi4: 'U1' }),
      laclaeRow({ client: 'C1', product: 'P5', sales: 2, fi1: 'F1', fi2: 'S2', fi3: 'T1', fi4: 'U1' }),
      laclaeRow({ client: 'C1', product: 'P6', sales: 4, fi1: 'F2', fi2: 'S1', fi3: 'T1', fi4: 'U1' }),
      laclaeRow({ client: 'C2', product: 'P9', sales: 8, fi1: 'F1', fi2: 'S1', fi3: 'T1', fi4: 'U1' }),
    ];
    mockQueryWithParams
      .mockResolvedValueOnce([clientRow('C2', 'Dos', 2), clientRow('C1', 'Uno', 2)])
      .mockResolvedValueOnce(rows);

    const response = await getDetail({ limit: 2, offset: 0 });

    expect(response.status).toBe(200);
    expect(response.body.clients.map((node) => node.code)).toEqual(['C1', 'C2']);
    const c1 = response.body.clients[0];
    expect(c1.families.map((node) => node.code)).toEqual(['F1', 'F2']);
    expect(c1.families[0].children.map((node) => node.code)).toEqual(['S1', 'S2']);
    expect(c1.families[0].children[0].children.map((node) => node.code)).toEqual(['T1', 'T2']);
    expect(c1.families[0].children[0].children[0].children.map((node) => node.code)).toEqual(['U1', 'U2']);
    expect(c1.families[0].children[0].children[0].children[0].products.map((node) => node.code)).toEqual(['P1', 'P2']);
  });
});
