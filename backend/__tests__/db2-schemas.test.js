'use strict';

describe('db2-schemas', () => {
  const envKeys = [
    'DB2_WRITE_SCHEMA',
    'DB2_READ_SCHEMA',
    'PEDIDOS_CONFIRMATION_SCHEMA',
    'PEDIDOS_DSEDAC_STORAGE_APPROVED',
    'ALLOW_DSEDAC_APP_BUFFERS',
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

  test('DB2_WRITE_SCHEMA=DSEDAC without app-buffer override falls back to JAVIER', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    const { getDb2WriteSchema, getDb2WriteSchemaRequested, getDb2WriteSchemaDiagnostic } = require('../utils/db2-schemas');
    expect(getDb2WriteSchemaRequested()).toBe('DSEDAC');
    expect(getDb2WriteSchema()).toBe('JAVIER');
    expect(getDb2WriteSchemaDiagnostic()).toMatch(/ALLOW_DSEDAC_APP_BUFFERS=true/);
  });

  test('DB2_WRITE_SCHEMA=DSEDAC with legacy storage approval still keeps app buffers in JAVIER', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = 'true';
    const { getDb2WriteSchema } = require('../utils/db2-schemas');
    expect(getDb2WriteSchema()).toBe('JAVIER');
  });

  test('DB2_WRITE_SCHEMA=DSEDAC with app-buffer override uses DSEDAC', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    process.env.ALLOW_DSEDAC_APP_BUFFERS = 'true';
    const { getDb2WriteSchema, db2WriteTable } = require('../utils/db2-schemas');
    expect(getDb2WriteSchema()).toBe('DSEDAC');
    expect(db2WriteTable('PEDIDOS_CAB')).toBe('DSEDAC.PEDIDOS_CAB');
  });

  test('db2WriteTable does not silently route app buffers to DSEDAC fake tables', () => {
    process.env.DB2_WRITE_SCHEMA = 'DSEDAC';
    process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED = 'true';
    const { db2WriteTable } = require('../utils/db2-schemas');
    expect(db2WriteTable('PEDIDOS_CAB')).toBe('JAVIER.PEDIDOS_CAB');
    expect(db2WriteTable('PEDIDOS_LIN')).toBe('JAVIER.PEDIDOS_LIN');
    expect(db2WriteTable('COBROS')).toBe('JAVIER.COBROS');
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
    expect(getDb2WriteSchema()).toBe('JAVIER');
  });
});
