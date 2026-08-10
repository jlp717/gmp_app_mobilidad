'use strict';

const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const {
  resolveRepartoStartupMutationPolicy,
  assertRepartoStartupMutationPolicy,
} = require('../config/reparto-startup-mutation-policy');

function validTestEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'true',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'true',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    ODBC_DSN: 'GMP',
    ...overrides,
  };
}

function resolvePolicy(overrides = {}) {
  const env = validTestEnv(overrides);
  return resolveRepartoStartupMutationPolicy({
    env,
    repartoRuntime: resolveRepartoRuntime(env),
  });
}

describe('reparto startup mutation policy', () => {
  test('defaults an absent migration flag to disabled', () => {
    const policy = resolvePolicy();

    expect(policy).toMatchObject({
      valid: true,
      migrationsRequested: false,
      migrationsAllowed: false,
      errors: [],
    });
  });

  test('permits only an isolated, write-enabled test runtime with explicit capability approval', () => {
    const env = validTestEnv({ REPARTO_STARTUP_REPARTO_MIGRATIONS: 'true' });
    const policy = assertRepartoStartupMutationPolicy({
      env,
      repartoRuntime: resolveRepartoRuntime(env),
    });

    expect(policy).toMatchObject({
      valid: true,
      migrationsRequested: true,
      migrationsAllowed: true,
    });
  });

  test.each([
    ['non-test Node runtime', { NODE_ENV: 'development' }],
    ['non-test reparto environment', { REPARTO_ENVIRONMENT: 'staging' }],
    ['disabled isolated writes', { REPARTO_WRITES_ENABLED: 'false' }],
    ['missing DB2 capability approval', { REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false' }],
  ])('rejects requested migrations with %s', (_label, overrides) => {
    const env = validTestEnv({
      REPARTO_STARTUP_REPARTO_MIGRATIONS: 'true',
      ...overrides,
    });
    const input = { env, repartoRuntime: resolveRepartoRuntime(env) };

    expect(resolveRepartoStartupMutationPolicy(input)).toMatchObject({
      valid: false,
      migrationsAllowed: false,
    });
    expect(() => assertRepartoStartupMutationPolicy(input)).toThrow(expect.objectContaining({
      code: 'INVALID_REPARTO_STARTUP_MUTATION_POLICY',
    }));
  });

  test('rejects malformed flags, invalid runtimes, and env/runtime contradictions even when disabled', () => {
    const validEnv = validTestEnv();
    const validRuntime = resolveRepartoRuntime(validEnv);

    expect(resolveRepartoStartupMutationPolicy({
      env: { ...validEnv, REPARTO_STARTUP_REPARTO_MIGRATIONS: 'yes' },
      repartoRuntime: validRuntime,
    }).valid).toBe(false);
    expect(resolveRepartoStartupMutationPolicy({
      env: validEnv,
      repartoRuntime: { ...validRuntime, valid: false, errors: ['invalid runtime'] },
    }).valid).toBe(false);
    expect(resolveRepartoStartupMutationPolicy({
      env: { ...validEnv, REPARTO_ENVIRONMENT: 'staging' },
      repartoRuntime: validRuntime,
    }).valid).toBe(false);
  });
});
