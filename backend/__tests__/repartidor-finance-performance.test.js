'use strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
});

const mockCacheValues = new Map();
let mockRemoteGeneration = '0';
const mockRedisCache = {
  get: jest.fn(async (_namespace, key) => mockCacheValues.get(key) ?? null),
  getRemote: jest.fn(async () => mockRemoteGeneration),
  getIfVersion: jest.fn(async (_namespace, key, _versionNamespace, _versionKey, expectedVersion) => {
    if (expectedVersion !== mockRemoteGeneration) {
      return { matched: false, version: mockRemoteGeneration };
    }
    return { matched: true, value: mockCacheValues.get(key) ?? null };
  }),
  set: jest.fn(async (_namespace, key, value) => {
    mockCacheValues.set(key, value);
    return true;
  }),
  setIfVersion: jest.fn(async (_namespace, key, value, _ttl, _versionNamespace, _versionKey, expectedVersion) => {
    if (expectedVersion !== mockRemoteGeneration) return false;
    mockCacheValues.set(key, value);
    return true;
  }),
  incrementVersion: jest.fn(async () => {
    mockRemoteGeneration = String(Number(mockRemoteGeneration) + 1);
    return mockRemoteGeneration;
  }),
  delete: jest.fn(async (_namespace, key) => mockCacheValues.delete(key)),
  onInvalidationPattern: jest.fn(),
};
const mockRepository = {
  tables: {
    cobros: 'JAVIER.TEST_REPARTIDOR_COBROS',
    balances: 'JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES',
    liquidationOps: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS',
  },
  selectSysColumns: jest.fn(async () => [
    { TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_COBROS', COLUMN_NAME: 'CODIGOVENDEDOR' },
    { TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_COBROS', COLUMN_NAME: 'IMPORTEVENCIMIENTO' },
    { TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_COBROS', COLUMN_NAME: 'ANOCOBRO' },
    { TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_COBROS', COLUMN_NAME: 'MESCOBRO' },
    { TABLE_SCHEMA: 'JAVIER', TABLE_NAME: 'TEST_REPARTIDOR_COBROS', COLUMN_NAME: 'DIACOBRO' },
  ]),
  selectEvolution: jest.fn(async () => [
    { ANO: 2026, MES: 9, TOTAL: '125.50', NUM_COBROS: 2 },
  ]),
  selectTopProducts: jest.fn(async () => [
    { CODIGO: 'ART-1', NOMBRE: 'Producto', UNIDADES: '4', IMPORTE: '80.00' },
  ]),
  selectDailyTotals: jest.fn(async () => [{
    TOTAL_EFECTIVO: '10', TOTAL_CHEQUES: '0', TOTAL_TARJETA: '0',
    TOTAL_POSTDATADOS: '0', TOTAL_COBROS_DIA: '10', COBROS_COUNT: '1',
  }]),
  selectBalanceSum: jest.fn(async () => [{ SALDO_PENDIENTE: '5' }]),
  selectDailyCobros: jest.fn(async () => []),
  selectDailyStructuredSums: jest.fn(async () => ({ gastos: 0, ingresoBanco: 0, ajustes: 0 })),
  selectConfirmedDeliveredAmount: jest.fn(async () => [{ TOTAL_REPARTIDO: '0' }]),
  selectDailyErpDebt: jest.fn(async () => [{ DEUDA_PENDIENTE: '0' }]),
  selectClosedLiquidacion: jest.fn(async () => []),
};

jest.mock('../repositories/reparto-finance-db2-repository', () => ({
  getRepartoFinanceDb2Repository: () => mockRepository,
}));
jest.mock('../services/redis-cache', () => ({
  redisCache: mockRedisCache,
  TTL: { REALTIME: 60, SHORT: 300 },
}));
jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const financeService = require('../services/repartidor-finance-service');

describe('repartidor finance read performance', () => {
  beforeEach(() => {
    mockCacheValues.clear();
    mockRemoteGeneration = '0';
    mockRedisCache.get.mockClear();
    mockRedisCache.set.mockClear();
    mockRedisCache.getRemote.mockClear();
    mockRedisCache.getIfVersion.mockClear();
    mockRedisCache.setIfVersion.mockClear();
    mockRedisCache.incrementVersion.mockClear();
    mockRedisCache.delete.mockClear();
    mockRepository.selectSysColumns.mockClear();
    mockRepository.selectEvolution.mockClear();
    mockRepository.selectTopProducts.mockClear();
    mockRepository.selectDailyTotals.mockClear();
    mockRepository.selectBalanceSum.mockClear();
    mockRepository.selectDailyCobros.mockClear();
    mockRepository.selectDailyStructuredSums.mockClear();
    mockRepository.selectConfirmedDeliveredAmount.mockClear();
    mockRepository.selectDailyErpDebt.mockClear();
    mockRepository.selectClosedLiquidacion.mockClear();
  });

  test('coalesces concurrent evolution reads and reuses the cached result', async () => {
    const [first, second] = await Promise.all([
      financeService.getEvolution('57'),
      financeService.getEvolution('57'),
    ]);

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ period: '2026-09', totalSales: 125.5, numCobros: 2 });
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(1);
    expect(mockRedisCache.setIfVersion).toHaveBeenCalledTimes(1);

    await expect(financeService.getEvolution('57')).resolves.toEqual(first);
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(1);
    expect([...mockCacheValues.keys()]).toEqual([
      'query:repartidor:finance:57:evolution:v2:g0',
    ]);
  });

  test('coalesces concurrent top-product reads without changing the response contract', async () => {
    const [first, second] = await Promise.all([
      financeService.getTopProducts('57'),
      financeService.getTopProducts('57'),
    ]);

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ code: 'ART-1', totalUnits: 4, totalSales: 80 });
    expect(mockRepository.selectTopProducts).toHaveBeenCalledTimes(1);
    expect(mockRedisCache.setIfVersion).toHaveBeenCalledTimes(1);
    expect([...mockCacheValues.keys()]).toEqual([
      'query:repartidor:finance:57:top-products:v2:10:g0',
    ]);
  });

  test('does not repopulate an old snapshot after a payment invalidates a read in flight', async () => {
    let releaseOldRead;
    const oldRead = new Promise((resolve) => { releaseOldRead = resolve; });
    mockRepository.selectEvolution
      .mockImplementationOnce(async () => {
        await oldRead;
        return [{ ANO: 2026, MES: 9, TOTAL: '10.00', NUM_COBROS: 1 }];
      })
      .mockResolvedValueOnce([{ ANO: 2026, MES: 9, TOTAL: '20.00', NUM_COBROS: 2 }]);

    const pending = financeService.getEvolution('57');
    await new Promise((resolve) => setImmediate(resolve));
    await financeService.invalidateFinanceReadCache('57');
    releaseOldRead();

    await expect(pending).resolves.toEqual([expect.objectContaining({ total: 20, numCobros: 2 })]);
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(2);
    expect(mockCacheValues.has('query:repartidor:finance:57:evolution:v2:g0')).toBe(false);
    await financeService.getEvolution('57');
    expect(mockCacheValues.get('query:repartidor:finance:57:evolution:v2:g1'))
      .toEqual([expect.objectContaining({ total: 20, numCobros: 2 })]);
  });

  test('does not serve a stale cache hit when the shared marker changes first', async () => {
    const oldKey = 'query:repartidor:finance:57:evolution:v2:g0';
    mockCacheValues.set(oldKey, [{ period: '2026-09', total: 10, totalSales: 10, numCobros: 1 }]);
    mockRedisCache.getIfVersion.mockImplementationOnce(async () => {
      mockRemoteGeneration = '1';
      return { matched: false, version: '1' };
    });

    await expect(financeService.getEvolution('57')).resolves.toEqual([
      expect.objectContaining({ total: 125.5, numCobros: 2 }),
    ]);
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(1);
    expect(mockCacheValues.has(oldKey)).toBe(true);
    expect(mockCacheValues.get('query:repartidor:finance:57:evolution:v2:g1'))
      .toEqual([expect.objectContaining({ total: 125.5, numCobros: 2 })]);
  });

  test('retries against the new version after a conditional cache write conflict', async () => {
    mockRedisCache.setIfVersion.mockImplementationOnce(async () => {
      mockRemoteGeneration = '1';
      return false;
    });

    await expect(financeService.getEvolution('57')).resolves.toEqual([
      expect.objectContaining({ total: 125.5, numCobros: 2 }),
    ]);
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(2);
    expect(mockCacheValues.get('query:repartidor:finance:57:evolution:v2:g1'))
      .toEqual([expect.objectContaining({ total: 125.5, numCobros: 2 })]);
  });

  test('retries daily summary only after a transient DB queue timeout', async () => {
    const queueError = new Error('DB query queue timeout after 12000ms');
    queueError.code = 'DB_QUERY_QUEUE_TIMEOUT';
    mockRepository.selectDailyTotals
      .mockRejectedValueOnce(queueError)
      .mockResolvedValueOnce([{
        TOTAL_EFECTIVO: '10', TOTAL_CHEQUES: '0', TOTAL_TARJETA: '0',
        TOTAL_POSTDATADOS: '0', TOTAL_COBROS_DIA: '10', COBROS_COUNT: '1',
      }]);

    await expect(financeService.getDailySummary({
      repartidorId: '57',
      date: '2026-09-02',
    })).resolves.toEqual(expect.objectContaining({
      repartidorId: '57',
      summary: expect.objectContaining({ totalCobrosDia: 10 }),
    }));
    expect(mockRepository.selectDailyTotals).toHaveBeenCalledTimes(2);
  });

  test('fails explicitly when daily-summary queue contention exhausts retries', async () => {
    const queueError = new Error('DB query queue timeout after 12000ms');
    queueError.code = 'DB_QUERY_QUEUE_TIMEOUT';
    mockRepository.selectDailyTotals.mockRejectedValue(queueError);

    await expect(financeService.getDailySummary({
      repartidorId: '57',
      date: '2026-09-02',
    })).rejects.toMatchObject({ code: 'DB_QUERY_QUEUE_TIMEOUT' });
    expect(mockRepository.selectDailyTotals).toHaveBeenCalledTimes(3);
  });
});
