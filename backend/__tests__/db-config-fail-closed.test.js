'use strict';

describe('DB2 credential configuration', () => {
  const originalUid = process.env.ODBC_UID;
  const originalPwd = process.env.ODBC_PWD;

  afterEach(() => {
    jest.resetModules();
    if (originalUid === undefined) delete process.env.ODBC_UID;
    else process.env.ODBC_UID = originalUid;
    if (originalPwd === undefined) delete process.env.ODBC_PWD;
    else process.env.ODBC_PWD = originalPwd;
  });

  test('missing credentials fail before constructing an ODBC pool', async () => {
    delete process.env.ODBC_UID;
    delete process.env.ODBC_PWD;
    const pool = jest.fn();
    jest.doMock('odbc', () => ({ pool }));
    jest.doMock('../config/load-env', () => ({ loadEnv: jest.fn() }));
    jest.doMock('../middleware/logger', () => ({
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }));

    const { initDb } = require('../config/db');
    await expect(initDb()).rejects.toMatchObject({
      code: 'DB_CREDENTIALS_REQUIRED',
      statusCode: 503,
    });
    expect(pool).not.toHaveBeenCalled();
  });
});
