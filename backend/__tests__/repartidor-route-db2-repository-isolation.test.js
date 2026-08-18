'use strict';

const mockQueryWithParams = jest.fn();
let mockDeliveryStatusTable = 'JAVIER.TEST_DELIVERY_STATUS';

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
  isDeliveryStatusAvailable: () => true,
  isDeliveryStatusNewSchema: () => true,
  getDeliveryStatusJoin: jest.fn(() => ''),
  getDeliveryStatusColumns: jest.fn(() => ''),
  getDeliveryStatusTable: () => mockDeliveryStatusTable,
}));

const repository = require('../repositories/repartidor-route-db2-repository');
const ENV_KEYS = [
  'NODE_ENV', 'REPARTO_ENVIRONMENT', 'REPARTO_TABLE_SET',
  'REPARTO_CONFIRMATION_TABLE_SET', 'REPARTO_EVIDENCE_PENDING_TTL_HOURS',
  'REPARTO_WRITES_ENABLED', 'REPARTO_PRODUCTION_WRITES_APPROVED',
  'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
  'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
  'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
  'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED', 'ODBC_DSN',
  'REPARTIDOR_FINANCE_READ_SCHEMA', 'REPARTIDOR_FINANCE_APP_SCHEMA',
  'REPARTIDOR_FINANCE_ERP_SCHEMA',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setRuntime(environment, tableSet, erpSchema) {
  delete process.env.REPARTO_CONFIRMATION_TABLE_SET;
  Object.assign(process.env, {
    NODE_ENV: environment,
    REPARTO_ENVIRONMENT: environment,
    REPARTO_TABLE_SET: tableSet,
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'false',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: erpSchema,
  });
}

async function exerciseAppReads() {
  await repository.getCanonicalConfirmationSignature({
    year: 2026, serie: 'A', terminal: 0, number: 7, ownerIds: ['05'],
  });
  await repository.resolveDeliveryOwners('delivery-7');
  await repository.getEntregaFirma('delivery-7');
  await repository.getRepartidorFirmasByAlbaran(7, 2026, 'A', 0);
  await repository.getDeliverySummary(2026, 8, [], ['05']);
}

describe('repartidor route app-state table isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeliveryStatusTable = 'JAVIER.TEST_DELIVERY_STATUS';
    mockQueryWithParams.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  test('isolated_test reads only TEST app state while ERP documents remain DSEDAC', async () => {
    setRuntime('test', 'isolated_test', 'JAVIER');
    await exerciseAppReads();
    const sql = mockQueryWithParams.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('JAVIER.TEST_REPARTO_CONFIRMACIONES');
    expect(sql).toContain('JAVIER.TEST_REPARTIDOR_ENTREGAS');
    expect(sql).toContain('JAVIER.TEST_REPARTIDOR_FIRMAS');
    expect(sql).toContain('JAVIER.TEST_DELIVERY_STATUS');
    expect(sql).toContain('DSEDAC.OPP');
    for (const forbidden of [
      'JAVIER.REPARTO_CONFIRMACIONES', 'JAVIER.REPARTIDOR_ENTREGAS',
      'JAVIER.REPARTIDOR_FIRMAS', 'JAVIER.DELIVERY_STATUS',
    ]) expect(sql).not.toContain(forbidden);
  });

  test('stale production delivery-status mapping fails closed in isolated_test', async () => {
    setRuntime('test', 'isolated_test', 'JAVIER');
    mockDeliveryStatusTable = 'JAVIER.DELIVERY_STATUS';
    await repository.getDeliverySummary(2026, 8, [], ['05']);
    const sql = mockQueryWithParams.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).not.toContain('JAVIER.DELIVERY_STATUS');
    expect(sql).toContain('JAVIER.TEST_REPARTO_CONFIRMACIONES');
  });

  test('legacy app reads fail closed when no table set is authorized', async () => {
    delete process.env.REPARTO_TABLE_SET;
    delete process.env.REPARTO_ENVIRONMENT;
    process.env.NODE_ENV = 'test';
    await expect(repository.resolveDeliveryOwners('delivery-7')).resolves.toEqual([]);
    await expect(repository.getEntregaFirma('delivery-7')).resolves.toEqual([]);
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });
});
