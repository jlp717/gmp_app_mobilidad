'use strict';

function loadResolver() {
  return require('../config/reparto-runtime');
}

function validTestEnv(overrides = {}) {
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
    ...overrides,
  };
}


function validProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    REPARTO_ENVIRONMENT: 'production',
    REPARTO_TABLE_SET: 'production',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'false',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    ...overrides,
  };
}

function runtimeWithFinanceMapping(runtime, finance) {
  return {
    ...runtime,
    tables: {
      ...runtime.tables,
      finance,
    },
  };
}
describe('central reparto runtime configuration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('accepts an explicit test profile and permits writes only in JAVIER', () => {
    const { resolveRepartoRuntime } = loadResolver();
    const runtime = resolveRepartoRuntime(validTestEnv());

    expect(runtime).toMatchObject({
      valid: true,
      environment: 'test',
      dsn: 'GMP',
      writesEnabled: true,
      productionWritesEnabled: false,
      productionErpWritesApproved: false,
      tableSet: 'isolated_test',
      tables: { finance: { liquidationOps: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS' } },
      schemas: {
        read: 'DSEDAC',
        app: 'JAVIER',
        erp: 'JAVIER',
      },
    });
    expect(runtime.errors).toEqual([]);
    expect(Object.isFrozen(runtime.tables)).toBe(true);
    expect(Object.isFrozen(runtime.tables.finance)).toBe(true);
    expect(runtime.tables.confirmation).not.toHaveProperty('payments');
    expect(runtime.tables.finance.cobros).toBe('JAVIER.TEST_REPARTIDOR_COBROS');
  });

  test('defaults finance capability to false when the flag is absent', () => {
    const { resolveRepartoRuntime } = loadResolver();
    const runtime = resolveRepartoRuntime(validTestEnv());
    expect(runtime.valid).toBe(true);
    expect(runtime.financeCapabilityApproved).toBe(false);
  });

  test.each([
    ['NODE test with staging reparto', { NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'staging' }, 'NODE_ENV=test'],
    ['NODE production with test reparto', { NODE_ENV: 'production' }, 'REPARTO_ENVIRONMENT=test'],
    ['NODE development with production reparto', { NODE_ENV: 'development', REPARTO_ENVIRONMENT: 'production' }, 'NODE_ENV=production'],
    ['NODE test with production reparto', { NODE_ENV: 'test', REPARTO_ENVIRONMENT: 'production' }, 'NODE_ENV=test'],
    ['missing mode', { REPARTO_ENVIRONMENT: undefined }, 'REPARTO_ENVIRONMENT'],
    ['unknown mode', { REPARTO_ENVIRONMENT: 'preview' }, 'REPARTO_ENVIRONMENT'],
    ['missing table set', { REPARTO_TABLE_SET: undefined }, 'REPARTO_TABLE_SET'],
    ['unknown table set', { REPARTO_TABLE_SET: 'legacy' }, 'REPARTO_TABLE_SET'],
    ['production table set in test', { REPARTO_TABLE_SET: 'production' }, 'isolated_test'],
    ['missing evidence TTL', { REPARTO_EVIDENCE_PENDING_TTL_HOURS: undefined }, 'REPARTO_EVIDENCE_PENDING_TTL_HOURS'],
    ['missing DSN', { ODBC_DSN: '' }, 'ODBC_DSN'],
    ['unknown ERP production gate', { REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'yes' }, 'REPARTO_PRODUCTION_ERP_WRITES_APPROVED'],
    ['unknown app schema', { REPARTIDOR_FINANCE_APP_SCHEMA: 'UNKNOWN' }, 'REPARTIDOR_FINANCE_APP_SCHEMA'],
    ['DSEDAC test writes', { REPARTIDOR_FINANCE_APP_SCHEMA: 'DSEDAC' }, 'DSEDAC'],
    [
      'contradictory write schema alias',
      { DB2_WRITE_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER' },
      'DB2_WRITE_SCHEMA',
    ],
  ])('fails closed for %s', (_label, overrides, expectedError) => {
    const { resolveRepartoRuntime } = loadResolver();
    const runtime = resolveRepartoRuntime(validTestEnv(overrides));

    expect(runtime.valid).toBe(false);
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.productionWritesEnabled).toBe(false);
    expect(runtime.errors.join(' ')).toContain(expectedError);
  });

  test.each([
    ['test', 'missing', undefined],
    ['test', 'empty', ''],
    ['test', 'unknown', 'preview'],
    ['staging', 'missing', undefined],
    ['staging', 'empty', ''],
    ['staging', 'unknown', 'preview'],
    ['production', 'missing', undefined],
    ['production', 'empty', ''],
    ['production', 'unknown', 'preview'],
  ])('rejects %s reparto with %s NODE_ENV', (environment, _case, nodeEnvironment) => {
    const { resolveRepartoRuntime } = loadResolver();
    const base = environment === 'production'
      ? validProductionEnv({
        REPARTO_WRITES_ENABLED: 'true',
        REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
        REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'true',
        REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
      })
      : validTestEnv({
        REPARTO_ENVIRONMENT: environment,
        REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
      });
    const runtime = resolveRepartoRuntime({ ...base, NODE_ENV: nodeEnvironment });

    expect(runtime.valid).toBe(false);
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.financeCapabilityApproved).toBe(false);
    expect(runtime.errors.join(' ')).toContain('NODE_ENV');
  });

  test('never infers production when the reparto mode is omitted', () => {
    const { resolveRepartoRuntime } = loadResolver();
    const env = validTestEnv({ REPARTO_ENVIRONMENT: undefined });
    const runtime = resolveRepartoRuntime(env);

    expect(runtime.environment).not.toBe('production');
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.valid).toBe(false);
  });

  test('keeps finance capability independent and fail-closed outside production', () => {
    const { resolveRepartoRuntime, validateFinanceTableMapping } = loadResolver();

    const isolated = resolveRepartoRuntime(validTestEnv({ REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true' }));
    expect(isolated.financeCapabilityApproved).toBe(true);
    expect(isolated.confirmationCapabilityApproved).toBe(false);
    expect(validateFinanceTableMapping(isolated)).toEqual({ valid: true, errors: [] });

    const staging = resolveRepartoRuntime(validTestEnv({
      NODE_ENV: 'production',
      REPARTO_ENVIRONMENT: 'staging',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
    }));
    expect(staging.financeCapabilityApproved).toBe(true);

    const nativeStaging = resolveRepartoRuntime(validTestEnv({
      NODE_ENV: 'staging',
      REPARTO_ENVIRONMENT: 'staging',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
    }));
    expect(nativeStaging.financeCapabilityApproved).toBe(true);

    const disabled = resolveRepartoRuntime(validTestEnv({
      REPARTO_WRITES_ENABLED: 'false',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
    }));
    expect(disabled.valid).toBe(false);
    expect(disabled.financeCapabilityApproved).toBe(false);

    const unknown = resolveRepartoRuntime(validTestEnv({ REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'yes' }));
    expect(unknown.valid).toBe(false);
    expect(unknown.financeCapabilityApproved).toBe(false);
  });

  test('accepts only the exact isolated finance table mapping', () => {
    const { resolveRepartoRuntime, validateFinanceTableMapping } = loadResolver();
    const runtime = resolveRepartoRuntime(validTestEnv());

    expect(validateFinanceTableMapping(runtime)).toEqual({ valid: true, errors: [] });
  });

  test.each([
    ['missing key', (finance) => {
      const { liquidationOps: _liquidationOps, ...missing } = finance;
      return missing;
    }, 'keys do not match the exact allowlist'],
    ['extra key', (finance) => ({ ...finance, shadow: 'JAVIER.TEST_SHADOW' }), 'keys do not match the exact allowlist'],
    ['non-canonical identifier', (finance) => ({ ...finance, liquidationOps: 'JAVIER.test_ops' }), 'not a canonical qualified identifier'],
    ['unexpected isolated identifier', (finance) => ({ ...finance, liquidationOps: 'JAVIER.TEST_OTHER_OPS' }), 'does not match the versioned isolated_test mapping'],
    ['non-test isolated table', (finance) => ({ ...finance, liquidationOps: 'JAVIER.REPARTIDOR_LIQUIDACION_OPS' }), 'must use JAVIER.TEST_* in isolated_test'],
  ])('rejects isolated finance mapping with %s', (_label, mutateFinance, expectedError) => {
    const { resolveRepartoRuntime, validateFinanceTableMapping } = loadResolver();
    const runtime = resolveRepartoRuntime(validTestEnv());
    const mutated = runtimeWithFinanceMapping(runtime, mutateFinance(runtime.tables.finance));
    const validation = validateFinanceTableMapping(mutated);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain(expectedError);
  });

  test('accepts only the exact production finance table mapping', () => {
    const { resolveRepartoRuntime, validateFinanceTableMapping } = loadResolver();
    const runtime = resolveRepartoRuntime(validProductionEnv());

    expect(runtime.valid).toBe(true);
    expect(validateFinanceTableMapping(runtime)).toEqual({ valid: true, errors: [] });

  });
  test.each([
    ['production schema alias', (finance) => ({ ...finance, liquidationOps: 'DSEDAC.REPARTIDOR_LIQUIDACION_OPS' })],
    ['test table alias', (finance) => ({ ...finance, cobros: 'JAVIER.TEST_REPARTIDOR_COBROS' })],
  ])('rejects altered production finance mapping: %s', (_label, mutateFinance) => {
    const { resolveRepartoRuntime, validateFinanceTableMapping } = loadResolver();
    const runtime = resolveRepartoRuntime(validProductionEnv());
    const mutated = runtimeWithFinanceMapping(runtime, mutateFinance(runtime.tables.finance));
    const validation = validateFinanceTableMapping(mutated);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('does not match the versioned production mapping');
  });
});
