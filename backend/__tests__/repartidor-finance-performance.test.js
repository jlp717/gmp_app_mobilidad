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
const mockRedisCache = {
  get: jest.fn(async (_namespace, key) => mockCacheValues.get(key) ?? null),
  set: jest.fn(async (_namespace, key, value) => {
    mockCacheValues.set(key, value);
    return true;
  }),
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
    mockRedisCache.get.mockClear();
    mockRedisCache.set.mockClear();
    mockRepository.selectSysColumns.mockClear();
    mockRepository.selectEvolution.mockClear();
    mockRepository.selectTopProducts.mockClear();
  });

  test('coalesces concurrent evolution reads and reuses the cached result', async () => {
    const [first, second] = await Promise.all([
      financeService.getEvolution('57'),
      financeService.getEvolution('57'),
    ]);

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ period: '2026-09', totalSales: 125.5, numCobros: 2 });
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(1);
    expect(mockRedisCache.set).toHaveBeenCalledTimes(1);

    await expect(financeService.getEvolution('57')).resolves.toEqual(first);
    expect(mockRepository.selectEvolution).toHaveBeenCalledTimes(1);
    expect([...mockCacheValues.keys()]).toEqual([
      'query:repartidor:finance:57:evolution:v2',
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
    expect(mockRedisCache.set).toHaveBeenCalledTimes(1);
    expect([...mockCacheValues.keys()]).toEqual([
      'query:repartidor:finance:57:top-products:v2:10',
    ]);
  });
});
