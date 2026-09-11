'use strict';

function isolatedEnv() {
  return {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'true',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  };
}

describe('commercial isolated_test table mapping', () => {
  const previous = {};

  beforeEach(() => {
    jest.resetModules();
    const env = isolatedEnv();
    for (const [key, value] of Object.entries(env)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('maps cobros and pedidos to JAVIER.TEST_* isomorphic tables', () => {
    const { resolveRepartoRuntime } = require('../config/reparto-runtime');
    const { db2AppTable } = require('../utils/db2-schemas');
    const runtime = resolveRepartoRuntime(process.env);
    expect(runtime.valid).toBe(true);
    expect(runtime.tables.finance.commercialCobros).toBe('JAVIER.TEST_COBROS');
    expect(runtime.tables.commercial.pedidosCab).toBe('JAVIER.TEST_PEDIDOS_CAB');
    expect(runtime.tables.commercial.pedidosLin).toBe('JAVIER.TEST_PEDIDOS_LIN');
    expect(db2AppTable('COBROS')).toBe('JAVIER.TEST_COBROS');
    expect(db2AppTable('PEDIDOS_CAB')).toBe('JAVIER.TEST_PEDIDOS_CAB');
    expect(db2AppTable('PEDIDOS_LIN')).toBe('JAVIER.TEST_PEDIDOS_LIN');
  });

  test('cobros repository SQL targets TEST_COBROS and never VISTA_DEUDA_BASE', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../src/modules/cobros/infrastructure/db2-cobros-repository.js'),
      'utf8',
    );
    expect(src).toMatch(/db2AppTable\('COBROS'\)/);
    expect(src).toMatch(/db2AppTable\('PEDIDOS_CAB'\)/);
    expect(src).not.toMatch(/VISTA_DEUDA_BASE/);
    const migration = fs.readFileSync(
      require.resolve('../migrations/043_comercial_isolated_test_tables.sql'),
      'utf8',
    );
    expect(migration).toMatch(/CREATE TABLE JAVIER\.TEST_COBROS LIKE JAVIER\.COBROS/);
    expect(migration).toMatch(/CREATE TABLE JAVIER\.TEST_PEDIDOS_CAB LIKE JAVIER\.PEDIDOS_CAB/);
    expect(migration).toMatch(/CREATE TABLE JAVIER\.TEST_PEDIDOS_LIN LIKE JAVIER\.PEDIDOS_LIN/);
    const overlayMigration = fs.readFileSync(
      require.resolve('../migrations/046_comercial_liquidacion_test_overlay.sql'),
      'utf8',
    );
    expect(overlayMigration).toMatch(/CREATE TABLE JAVIER\.TEST_LIQUIDACION_COMERCIAL/);
    expect(overlayMigration).toMatch(/CREATE TABLE JAVIER\.TEST_DEVOLUCIONES_COMERCIAL/);
    expect(overlayMigration).not.toMatch(/ALTER TABLE DSEDAC|CREATE TABLE DSEDAC|INSERT INTO DSEDAC/);
    expect(migration).not.toMatch(/ALTER TABLE DSEDAC|CREATE TABLE DSEDAC|INSERT INTO DSEDAC/);
  });
});
