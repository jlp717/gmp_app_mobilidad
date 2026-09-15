'use strict';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));
jest.mock('../services/query-optimizer', () => ({
  cachedQuery: (queryFn, sql, _key, _ttl, params) => queryFn(sql, params),
}));
jest.mock('../services/redis-cache', () => ({
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600 },
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../utils/delivery-status-check', () => ({
  isDeliveryStatusAvailable: () => false,
  isDeliveryStatusNewSchema: () => false,
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => ''),
  getDeliveryStatusTable: () => '',
}));
jest.mock('../repositories/repartidor-rutero-day-move-db2-repository', () => ({
  tryResolveDayOverrideTable: () => null,
  documentIdExpression: () => "TRIM(CPC.SERIEALBARAN) || '-' || CHAR(CPC.NUMEROALBARAN)",
}));

const {
  getRuteroWeek,
  getCollectionsSummary,
  sargableAnoMesDiaRange,
  COLLECTION_BATCH_CONCURRENCY,
} = require('../repositories/repartidor-route-db2-repository');

describe('repartidor route week sargable + collections concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryWithParams.mockResolvedValue([]);
  });

  test('sargable helper expands YYYYMMDD into column predicates', () => {
    const range = sargableAnoMesDiaRange('OPP', 20260803, 20260809);
    expect(range.params).toEqual([2026, 2026, 8, 2026, 8, 3, 2026, 2026, 8, 2026, 8, 9]);
    expect(range.sql).toContain('OPP.ANOREPARTO > ?');
    expect(range.sql).toContain('OPP.DIAREPARTO >= ?');
    expect(range.sql).toContain('OPP.DIAREPARTO <= ?');
    expect(range.sql).not.toContain('* 10000');
  });

  test('getRuteroWeek uses sargable ANO/MES/DIA binds', async () => {
    await getRuteroWeek(20260803, 20260809, ['05']);
    const [sql, params] = mockQueryWithParams.mock.calls[0];
    expect(sql).toContain('OPP.ANOREPARTO > ?');
    expect(sql).not.toContain('ANOREPARTO * 10000');
    expect(sql).not.toMatch(/BETWEEN \? AND \?/);
    expect(params.slice(0, 12)).toEqual([2026, 2026, 8, 2026, 8, 3, 2026, 2026, 8, 2026, 8, 9]);
    expect(params).toContain('05');
  });

  test('collections batches keep max inflight at 2', async () => {
    expect(COLLECTION_BATCH_CONCURRENCY).toBe(2);
    let inflight = 0;
    let maxInflight = 0;
    mockQueryWithParams.mockImplementation(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inflight -= 1;
      return [];
    });
    const ids = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
    const rows = await getCollectionsSummary(9, 2026, ids);
    expect(Array.isArray(rows)).toBe(true);
    expect(mockQueryWithParams).toHaveBeenCalledTimes(3);
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBe(2);
  });
});
