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
    delete process.env.PEDIDOS_CONFIRMATION_SCHEMA;
    delete process.env.PEDIDOS_EXPORT_TO_SYSTEM;
    delete process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED;
    delete process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED;
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

  test('approval gate allows export path to reach DSEDAC idempotency check', async () => {
    mockQueryWithParams.mockResolvedValueOnce([{ OK: 1 }]);
    const service = loadServiceWithEnv({
      PEDIDOS_CONFIRMATION_SCHEMA: 'DSEDAC',
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
  });
});
