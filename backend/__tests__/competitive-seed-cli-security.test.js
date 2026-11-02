'use strict';

const {
  main,
  safeCliError,
} = require('../scripts/seed-precio-competitivo-test');

describe('competitive-price seed CLI diagnostics', () => {
  test('emits only the fixed local code and validated ODBC diagnostics', () => {
    const result = safeCliError({
      message: 'PWD=super-secret DSN=GMP UID=ADMIN',
      stack: 'password=another-secret',
      connectionString: 'DSN=GMP;PWD=do-not-print',
      odbcErrors: [{
        state: '23505',
        code: -803,
        message: 'duplicate; PWD=hidden',
      }],
    });

    expect(result).toEqual({
      error: 'COMPETITIVE_SEED_FAILED',
      odbcState: '23505',
      odbcCode: '-803',
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|password|pwd|dsn|uid|connection/i);
  });

  test.each([
    [{ state: 'not-safe', code: 'DROP TABLE X' }],
    [{ sqlState: '123456', nativeCode: 'password=bad' }],
    [{ odbcErrors: [{ state: '42S02;PWD=x', code: 'SQL0204 PWD=x' }] }],
  ])('drops malformed external diagnostic fields %#', (error) => {
    expect(safeCliError(error)).toEqual({ error: 'COMPETITIVE_SEED_FAILED' });
  });

  test.each([
    [{ APP_ENV: 'demo', REPARTO_TABLE_SET: 'isolated_test', DB2_WRITE_SCHEMA: 'JAVIER' }],
    [{ APP_ENV: 'production', REPARTO_TABLE_SET: 'production', DB2_WRITE_SCHEMA: 'DSEDAC' }],
    [{ APP_ENV: 'test', REPARTO_TABLE_SET: 'production', DB2_WRITE_SCHEMA: 'JAVIER' }],
  ])('loads and applies the profile but refuses unsafe targets before connecting %#', async (env) => {
    const calls = [];
    await expect(main({
      env,
      argv: ['node', 'seed-precio-competitivo-test.js', '--apply'],
      loadEnvironment: () => calls.push('load'),
      applyProfile: () => calls.push('profile'),
      openConnection: () => {
        calls.push('connect');
        throw new Error('must not connect');
      },
      stdout: () => calls.push('stdout'),
    })).rejects.toThrow(/Seed refused/);
    expect(calls).toEqual(['load', 'profile']);
  });
});
