'use strict';

const mockQueryWithParams = jest.fn();
const mockConfirmOrder = jest.fn();

jest.mock('../config/db', () => ({
  query: jest.fn(),
  queryWithParams: (...args) => mockQueryWithParams(...args),
  getPool: jest.fn(),
  initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/query-optimizer', () => ({
  cachedQuery: jest.fn(async (fn, sql, _k, _t, params) => fn(sql, params)),
  invalidateOnMutation: jest.fn(),
  patternFor: () => 'query:query:rutero:orders:*',
}));

jest.mock('../services/redis-cache', () => ({
  TTL: { SHORT: 60, REALTIME: 30 },
  deleteCachePattern: jest.fn().mockResolvedValue(0),
  redisCache: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('../services/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    fire: (fn) => fn(),
  })),
}));

jest.mock('../services/laclae', () => ({
  getClientDays: jest.fn(),
}));

describe('checkDraftAccumulation VDDX threshold', () => {
  let pedidosService;

  beforeEach(() => {
    jest.resetModules();
    process.env.REPARTO_TABLE_SET = 'isolated_test';
    mockQueryWithParams.mockReset();
    mockConfirmOrder.mockReset();
    pedidosService = require('../services/pedidos');
  });

  test('reads PEDIDOSPENDIENTESSINCRONIZAR from TEST_VDDX and warns at threshold', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/TEST_VDDX/i.test(sql) && /PEDIDOSPENDIENTESSINCRONIZAR/i.test(sql)) {
        return [{ THRESHOLD: 3 }];
      }
      if (/PEDIDOS_CAB/i.test(sql) && /BORRADOR/i.test(sql)) {
        return [
          { ID: 1, NUMEROPEDIDO: 10, CODIGOCLIENTE: 'C1', NOMBRECLIENTE: 'A', IMPORTETOTAL: 1, CREATED_AT: '2026-09-22' },
          { ID: 2, NUMEROPEDIDO: 11, CODIGOCLIENTE: 'C2', NOMBRECLIENTE: 'B', IMPORTETOTAL: 2, CREATED_AT: '2026-09-22' },
          { ID: 3, NUMEROPEDIDO: 12, CODIGOCLIENTE: 'C3', NOMBRECLIENTE: 'C', IMPORTETOTAL: 3, CREATED_AT: '2026-09-22' },
        ];
      }
      return [];
    });

    const result = await pedidosService.checkDraftAccumulation('15');
    expect(result.threshold).toBe(3);
    expect(result.warning).toBe(true);
    expect(result.count).toBe(3);
    expect(result.message).toMatch(/umbral 3/i);
    expect(mockQueryWithParams.mock.calls.some(([sql]) => /TEST_VDDX/i.test(sql))).toBe(true);
  });

  test('threshold 0 disables auto-send warning', async () => {
    mockQueryWithParams.mockImplementation(async (sql) => {
      if (/PEDIDOSPENDIENTESSINCRONIZAR/i.test(sql)) return [{ THRESHOLD: 0 }];
      if (/BORRADOR/i.test(sql)) {
        return Array.from({ length: 5 }, (_, i) => ({
          ID: i + 1,
          NUMEROPEDIDO: i + 1,
          CODIGOCLIENTE: 'C',
          NOMBRECLIENTE: 'N',
          IMPORTETOTAL: 1,
          CREATED_AT: '2026-09-22',
        }));
      }
      return [];
    });

    const result = await pedidosService.checkDraftAccumulation('AL');
    expect(result.threshold).toBe(0);
    expect(result.warning).toBe(false);
    expect(result.autoSendEnabled).toBe(false);
    expect(result.count).toBe(5);
  });
});
