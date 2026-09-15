'use strict';

const mockQueryWithParams = jest.fn();
const mockCachedQuery = jest.fn((queryFn, sql, cacheKey, ttl, params) => queryFn(sql, params));

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (...args) => mockCachedQuery(...args),
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusNewSchema: () => true,
  getDeliveryStatusTable: () => 'JAVIER.TEST_DELIVERY_STATUS',
}));
jest.mock('../config/reparto-runtime', () => ({
  resolveRepartoRuntime: () => ({
    valid: true,
    tables: { notifications: { deliveryStatus: 'JAVIER.TEST_DELIVERY_STATUS' } },
  }),
}));

const { RuteroRepository, WEEK_COUNT_CACHE_TTL_SECONDS } = require('../src/repositories/rutero.repository');

describe('RuteroRepository week counts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockResolvedValue([{ DELIVERED: 4 }]);
  });

  test('ERP count is cached 60s without TRIM on CODIGOREPARTIDOR', async () => {
    const repo = new RuteroRepository({
      queryWithParams: mockQueryWithParams,
      cachedQuery: mockCachedQuery,
    });
    const count = await repo.fetchErpDeliveredCount(['05', '10'], { dia: 14, mes: 9, ano: 2026 });
    expect(count).toBe(4);
    expect(mockCachedQuery).toHaveBeenCalledTimes(1);
    const [queryFn, sql, cacheKey, ttl, params] = mockCachedQuery.mock.calls[0];
    expect(typeof queryFn).toBe('function');
    expect(sql).toContain('OPP.CODIGOREPARTIDOR IN (?,?)');
    expect(sql).not.toContain('TRIM(OPP.CODIGOREPARTIDOR)');
    expect(cacheKey).toBe('rutero:week:erp:05,10:2026-9-14');
    expect(ttl).toBe(WEEK_COUNT_CACHE_TTL_SECONDS);
    expect(ttl).toBe(60);
    expect(params).toEqual(['05', '10', 14, 9, 2026]);
  });

  test('app count uses sargable day range instead of DATE()', async () => {
    const repo = new RuteroRepository({
      queryWithParams: mockQueryWithParams,
      cachedQuery: mockCachedQuery,
    });
    await repo.fetchAppDeliveredCount(['05']);
    const [, sql, cacheKey, ttl] = mockCachedQuery.mock.calls[0];
    expect(sql).toContain('DS.UPDATED_AT >= CURRENT DATE');
    expect(sql).toContain('DS.UPDATED_AT < CURRENT DATE + 1 DAY');
    expect(sql).not.toMatch(/DATE\(\s*DS\.UPDATED_AT\s*\)/);
    expect(cacheKey).toMatch(/^rutero:week:app:05:new:\d{4}-\d{2}-\d{2}$/);
    expect(ttl).toBe(60);
  });

  test('CDVI fallback matches CHAR keys without TRIM', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ LUNES: 1 }]);
    const repo = new RuteroRepository({ queryWithParams: mockQueryWithParams });
    await repo.fetchWeeklyVisitCounts(['80', '15']);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('WHERE CODIGOVENDEDOR IN (?,?)');
    expect(sql).not.toContain('TRIM(CODIGOVENDEDOR)');
    expect(params).toEqual(['80', '15']);
  });
});
