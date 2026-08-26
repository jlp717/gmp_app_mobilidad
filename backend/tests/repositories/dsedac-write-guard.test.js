'use strict';

const {
  DsedacWriteError,
  assertNoDsedacWrite,
} = require('../../utils/dsedac-write-guard');

describe('DSEDAC write guard', () => {
  test.each([
    'INSERT INTO DSEDAC.TEST_TABLE (ID) VALUES (?)',
    'update dsedac.test_table set value = ?',
    'DELETE FROM "DSEDAC".TEST_TABLE WHERE ID = ?',
    'MERGE INTO DSEDAC.TEST_TABLE T USING SYSIBM.SYSDUMMY1 S ON 1 = 0 WHEN NOT MATCHED THEN INSERT (ID) VALUES (1)',
    'TRUNCATE TABLE DSEDAC.TEST_TABLE IMMEDIATE',
    'ALTER TABLE DSEDAC.TEST_TABLE ADD COLUMN X INTEGER',
    'DROP TABLE DSEDAC.TEST_TABLE',
    'CREATE TABLE DSEDAC.TEST_TABLE (ID INTEGER)',
    'REPLACE INTO DSEDAC.TEST_TABLE (ID) VALUES (?)',
    'SET SCHEMA DSEDAC',
    'SET CURRENT SCHEMA = "DSEDAC"',
    "SET SCHEMA 'DSEDAC'",
    'SET CURRENT SCHEMA = ?',
    'DROP ALIAS DSEDAC.CLIENT_ALIAS',
    'CREATE ALIAS DSEDAC.CLIENT_ALIAS FOR JAVIER.CLIENTS',
  ])('blocks DSEDAC mutation: %s', (sql) => {
    expect(() => assertNoDsedacWrite(sql)).toThrow(DsedacWriteError);
  });

  test('allows DSEDAC reads and JAVIER writes', () => {
    expect(() => assertNoDsedacWrite('SELECT CODIGOCLIENTE FROM DSEDAC.CLI')).not.toThrow();
    expect(() => assertNoDsedacWrite('INSERT INTO JAVIER.TEST_TABLE (ID) VALUES (?)')).not.toThrow();
  });
});

describe('DB executor guard wiring', () => {
  const envNames = [
    'NODE_ENV',
    'ODBC_UID',
    'ODBC_PWD',
    'DB_POOL_MIN',
    'DB_POOL_MAX',
    'DB_POOL_METRICS_INTERVAL_MS',
  ];

  function setTestEnv() {
    process.env.NODE_ENV = 'test';
    process.env.ODBC_UID = 'test';
    process.env.ODBC_PWD = 'test';
    process.env.DB_POOL_MIN = '0';
    process.env.DB_POOL_MAX = '1';
    process.env.DB_POOL_METRICS_INTERVAL_MS = '0';
  }

  function mockDbDependencies(connection, driverPool) {
    jest.doMock('odbc', () => ({ pool: jest.fn(async () => driverPool) }));
    jest.doMock('../../middleware/logger', () => ({
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }));
    jest.doMock('../../config/load-env', () => ({ loadEnv: jest.fn() }));
    jest.doMock('../../telemetry/otel', () => ({ withDbSpan: (_sql, fn) => fn() }));
  }

  async function cleanup(db) {
    if (db) await db.closePool();
    jest.dontMock('../../utils/dsedac-write-guard');
    jest.dontMock('odbc');
    jest.dontMock('../../middleware/logger');
    jest.dontMock('../../config/load-env');
    jest.dontMock('../../telemetry/otel');
    envNames.forEach(name => delete process.env[name]);
    jest.resetModules();
  }

  test('queryWithParams blocks DSEDAC mutation before pool acquisition', async () => {
    jest.resetModules();
    setTestEnv();
    const connection = {
      query: jest.fn(async () => []),
      close: jest.fn(async () => {}),
      cancel: jest.fn(async () => {}),
    };
    const driverPool = { connect: jest.fn(async () => connection), close: jest.fn(async () => {}) };
    mockDbDependencies(connection, driverPool);
    const db = require('../../config/db');

    try {
      await expect(db.queryWithParams('UPDATE DSEDAC.T SET X = ?', ['Y'], false, false))
        .rejects.toMatchObject({ code: 'DSEDAC_WRITE_BLOCKED' });
      expect(driverPool.connect).not.toHaveBeenCalled();
      expect(connection.query).not.toHaveBeenCalled();
    } finally {
      await cleanup(db);
    }
  });

  test('query reaches mocked pool when guard consumer is replaced by no-op', async () => {
    jest.resetModules();
    setTestEnv();
    const sql = 'UPDATE DSEDAC.T SET X = ?';
    const connection = {
      query: jest.fn(async () => []),
      close: jest.fn(async () => {}),
      cancel: jest.fn(async () => {}),
    };
    const driverPool = { connect: jest.fn(async () => connection), close: jest.fn(async () => {}) };
    jest.doMock('../../utils/dsedac-write-guard', () => ({ assertNoDsedacWrite: jest.fn() }));
    mockDbDependencies(connection, driverPool);
    const db = require('../../config/db');

    try {
      await db.queryWithParams(sql, ['Y'], false, false);
      expect(connection.query).toHaveBeenCalledWith(sql, ['Y']);
    } finally {
      await cleanup(db);
    }
  });
});
