'use strict';

describe('db2-schemas', () => {
  const envKeys = [
    'DB2_WRITE_SCHEMA',
    'DB2_READ_SCHEMA',
    'PEDIDOS_CONFIRMATION_SCHEMA',
    'PEDIDOS_DSEDAC_STORAGE_APPROVED',
  ];

  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
    jest.resetModules();
  });

  test('read schema defaults to DSEDAC', () => {
    const { getDb2ReadSchema } = require('../utils/db2-schemas');
    expect(getDb2ReadSchema()).toBe('DSEDAC');
  });

  test('write schema defaults to JAVIER', () => {
    const { getDb2WriteSchema } = require('../utils/db2-schemas');
    expect(getDb2WriteSchema()).toBe('JAVIER');
  });

  test('DB2_WRITE_SCHEMA=DSEDAC without approval falls back to JAVIER', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    const { getDb2WriteSchema, getDb2WriteSchemaRequested } = require('../utils/db2-schemas');
    expect(getDb2WriteSchemaRequested()).toBe('DSEDAC');
    expect(getDb2WriteSchema()).toBe('JAVIER');
  });

  test('DB2_WRITE_SCHEMA=DSEDAC with approval uses DSEDAC', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = 'true';
    const { getDb2WriteSchema } = require('../utils/db2-schemas');
    expect(getDb2WriteSchema()).toBe('DSEDAC');
  });

  test('assertMoneyFitsErpNumeric10_2 rejects amounts above ERP limit', () => {
    const { assertMoneyFitsErpNumeric10_2 } = require('../utils/db2-schemas');
    expect(() => assertMoneyFitsErpNumeric10_2(100000000, 'IMPORTETOTAL', 'pedido-1')).toThrow(
      /NUMERIC\(10,2\)/,
    );
    expect(() => assertMoneyFitsErpNumeric10_2(31.5, 'IMPORTETOTAL', 'pedido-1')).not.toThrow();
  });

  test('legacy PEDIDOS_CONFIRMATION_SCHEMA is fallback when DB2_WRITE_SCHEMA unset', () => {
    process.env.PEDIDOS_CONFIRMATION_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = 'true';
    const { getDb2WriteSchema } = require('../utils/db2-schemas');
    expect(getDb2WriteSchema()).toBe('DSEDAC');
  });
});
