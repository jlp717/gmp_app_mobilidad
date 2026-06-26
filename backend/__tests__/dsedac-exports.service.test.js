'use strict';

const mockQueryWithParams = jest.fn();

jest.mock('../config/db', () => ({
  queryWithParams: (...args) => mockQueryWithParams(...args),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

function loadServiceWithEnv(env) {
  jest.resetModules();
  Object.assign(process.env, env);
  return require('../services/dsedac-exports.service');
}

describe('DSEDAC auxiliary export safety', () => {
  afterEach(() => {
    delete process.env.DB2_WRITE_SCHEMA;
    delete process.env.PEDIDOS_CONFIRMATION_SCHEMA;
    delete process.env.PEDIDOS_EXPORT_TO_SYSTEM;
    delete process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED;
    delete process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED;
    delete process.env.ALLOW_DSEDAC_APP_BUFFERS;
    mockQueryWithParams.mockReset();
  });

  test('does not write cobros to DSEDAC without explicit export approval', async () => {
    const service = loadServiceWithEnv({
      PEDIDOS_CONFIRMATION_SCHEMA: 'DSEDAC',
      PEDIDOS_EXPORT_TO_SYSTEM: 'true',
    });

    const result = await service.exportCobroToSystem({
      IDEMPOTENCY_TOKEN: 'demo-token-001',
      CODIGO_CLIENTE: 'C001',
      CODIGO_USUARIO: '01',
      IMPORTE: 12.34,
    });

    expect(result).toEqual({ exported: false, reason: 'disabled' });
    expect(mockQueryWithParams).not.toHaveBeenCalled();
  });

  test('exportGate enables DSEDAC export with JAVIER write schema when flags are on', () => {
    const service = loadServiceWithEnv({
      DB2_WRITE_SCHEMA: 'JAVIER',
      PEDIDOS_EXPORT_TO_SYSTEM: 'true',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'true',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'true',
    });

    expect(service.exportGate()).toMatchObject({
      enabled: true,
      effectiveSchema: 'JAVIER',
      requestedSchema: 'JAVIER',
      exportSchema: 'DSEDAC',
      storageApproved: true,
      exportEnabled: true,
      exportApproved: true,
    });
  });

  test('exportGate keeps JAVIER app buffers while exporting to DSEDAC system tables', () => {
    const service = loadServiceWithEnv({
      DB2_WRITE_SCHEMA: 'DSEDAC',
      PEDIDOS_EXPORT_TO_SYSTEM: 'true',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'true',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'true',
    });

    expect(service.exportGate()).toMatchObject({
      enabled: true,
      effectiveSchema: 'JAVIER',
      requestedSchema: 'DSEDAC',
      exportSchema: 'DSEDAC',
      appBuffersAllowed: false,
    });
    expect(service.exportGate().writeSchemaDiagnostic).toMatch(/using JAVIER/);
  });

  test('exportGate enables export when PEDIDOS_CONFIRMATION_SCHEMA is JAVIER and flags are on', () => {
    const service = loadServiceWithEnv({
      PEDIDOS_CONFIRMATION_SCHEMA: 'JAVIER',
      PEDIDOS_EXPORT_TO_SYSTEM: 'true',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'true',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'true',
    });

    expect(service.exportGate()).toMatchObject({
      enabled: true,
      effectiveSchema: 'JAVIER',
      requestedSchema: 'JAVIER',
    });
  });

  test('approval gate allows export path to reach DSEDAC idempotency check with JAVIER buffers', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ OK: 1 }]);
    const service = loadServiceWithEnv({
      DB2_WRITE_SCHEMA: 'DSEDAC',
      PEDIDOS_EXPORT_TO_SYSTEM: 'true',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'true',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'true',
    });

    const result = await service.exportCobroToSystem({
      IDEMPOTENCY_TOKEN: 'demo-token-002',
      CODIGO_CLIENTE: 'C001',
      CODIGO_USUARIO: '01',
      IMPORTE: 12.34,
    });

    expect(result).toEqual({ exported: false, reason: 'already_exists_in_erp' });
    expect(mockQueryWithParams.mock.calls[0][0]).toMatch(/FROM\s+DSEDAC\.CRC/i);
    expect(service.exportGate().effectiveSchema).toBe('JAVIER');
  });

  test('bulk inserts liquidacion concepts instead of one query per concept', async () => {
    mockQueryWithParams
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ N: 41 }])
      .mockResolvedValueOnce([]);
    const service = loadServiceWithEnv({
      DB2_WRITE_SCHEMA: 'JAVIER',
      PEDIDOS_EXPORT_TO_SYSTEM: 'true',
      PEDIDOS_DSEDAC_EXPORT_APPROVED: 'true',
      PEDIDOS_DSEDAC_STORAGE_APPROVED: 'true',
    });

    const result = await service.exportLiquidacionToSystem({
      IDEMPOTENCY_TOKEN: 'liq-token-001',
      CODIGOVENDEDOR: '93',
      IMPORTEEFECTIVO: 10,
      IMPORTETARJETA: 20,
    });

    expect(result).toEqual({ exported: true, rowsInserted: 2 });
    expect(mockQueryWithParams).toHaveBeenCalledTimes(3);
    const [sql, params] = mockQueryWithParams.mock.calls[2];
    expect(sql).toMatch(/INSERT\s+INTO\s+DSEDAC\.CLV/i);
    expect(sql.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/g)).toHaveLength(2);
    expect(params).toHaveLength(22);
  });
});
