'use strict';

const {
  resolveRepartoRuntime,
  resolveRepartoRouteMode,
  sanitizedRepartoDiagnostic,
  createRepartoWriteGuard,
} = require('../config/reparto-runtime');

function env(overrides = {}) {
  return {
    NODE_ENV: 'production',
    REPARTO_ENVIRONMENT: 'staging',
    REPARTO_TABLE_SET: overrides.REPARTO_ENVIRONMENT === 'production' ? 'production' : 'isolated_test',
    REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
    REPARTO_WRITES_ENABLED: 'true',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    ODBC_DSN: 'GMP',
    REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    ...overrides,
  };
}

describe('reparto production write gate', () => {
  test('allows isolated staging writes without granting production writes', () => {
    const runtime = resolveRepartoRuntime(env());

    expect(runtime).toMatchObject({
      valid: true,
      environment: 'staging',
      writesEnabled: true,
      productionWritesEnabled: false,
      tableSet: 'isolated_test',
    });
  });

  test('does not require the ERP capability for production writes confined to JAVIER', () => {
    const runtime = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    }));

    expect(runtime).toMatchObject({
      valid: true,
      writesEnabled: true,
      productionWritesEnabled: true,
      productionErpWritesApproved: false,
      schemas: { app: 'JAVIER', erp: 'JAVIER' },
    });
  });

  test('blocks requested production writes without the explicit production gate', () => {
    const runtime = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    }));

    expect(runtime.valid).toBe(false);
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.productionWritesEnabled).toBe(false);
    expect(runtime.errors.join(' ')).toContain('REPARTO_PRODUCTION_WRITES_APPROVED');
  });

  test('does not infer an ERP write from a read-only DSEDAC schema or LQD mapping', () => {
    const runtime = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    }));

    expect(runtime.valid).toBe(true);
    expect(runtime.writesEnabled).toBe(true);
    expect(runtime.productionWritesEnabled).toBe(true);
    expect(runtime.productionErpWritesApproved).toBe(false);
  });

  test('enables DSEDAC ERP writes only when all three production gates are explicit', () => {
    const runtime = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'true',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    }));

    expect(runtime).toMatchObject({
      valid: true,
      environment: 'production',
      writesEnabled: true,
      productionWritesEnabled: true,
      productionErpWritesApproved: true,
      schemas: { read: 'DSEDAC', app: 'JAVIER', erp: 'DSEDAC' },
    });
  });

  test('permits finance capability in production only after applicable write gates', () => {
    const approved = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
      REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'true',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    }));
    expect(approved.financeCapabilityApproved).toBe(true);
    expect(approved.confirmationCapabilityApproved).toBe(false);

    const missingErpGate = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    }));
    expect(missingErpGate.valid).toBe(true);
    expect(missingErpGate.financeCapabilityApproved).toBe(true);

    const mappedDsedacWithoutGate = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true',
      REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'true',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
    }));
    expect(mappedDsedacWithoutGate.valid).toBe(true);
    expect(mappedDsedacWithoutGate.financeCapabilityApproved).toBe(true);
  });

  test('accepts explicit production read-only mode without a production write approval', () => {
    const runtime = resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: 'production',
      REPARTO_WRITES_ENABLED: 'false',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    }));

    expect(runtime.valid).toBe(true);
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.productionWritesEnabled).toBe(false);
    expect(runtime.tableSet).toBe('production');
    // Canonical finance ops live in JAVIER; LQD/DSEDAC.LQD was retired from the runtime map.
    expect(runtime.tables.finance.lqd).toBeUndefined();
    expect(runtime.tables.finance.liquidationOps).toBe('JAVIER.REPARTIDOR_LIQUIDACION_OPS');
  });

  test.each([
    [
      'writes are disabled',
      { REPARTO_ENVIRONMENT: 'production', REPARTO_WRITES_ENABLED: 'false',
        REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'true', REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC' },
    ],
    [
      'ERP target is JAVIER',
      { REPARTO_ENVIRONMENT: 'production', REPARTO_WRITES_ENABLED: 'true',
        REPARTO_PRODUCTION_WRITES_APPROVED: 'true', REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'true',
        REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER' },
    ],
  ])('rejects an armed no-op ERP gate when %s', (_label, overrides) => {
    const runtime = resolveRepartoRuntime(env(overrides));

    expect(runtime.valid).toBe(false);
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.productionWritesEnabled).toBe(false);
    expect(runtime.errors).toContain(
      'REPARTO_PRODUCTION_ERP_WRITES_APPROVED requires requested production writes with ERP schema DSEDAC',
    );
  });

  test.each([
    [{ REPARTO_WRITES_ENABLED: undefined }, 'REPARTO_WRITES_ENABLED'],
    [{ REPARTO_WRITES_ENABLED: 'yes' }, 'REPARTO_WRITES_ENABLED'],
    [{ REPARTO_PRODUCTION_WRITES_APPROVED: 'true' }, 'only valid in production'],
    [{ DB2_READ_SCHEMA: 'JAVIER' }, 'DB2_READ_SCHEMA'],
    [{ REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'yes' }, 'REPARTO_PRODUCTION_ERP_WRITES_APPROVED'],
    [{ REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'true' }, 'only valid in production'],
    [{ PEDIDOS_CONFIRMATION_SCHEMA: 'DSEDAC' }, 'PEDIDOS_CONFIRMATION_SCHEMA'],
  ])('blocks contradictory or unknown settings: %j', (overrides, expected) => {
    const runtime = resolveRepartoRuntime(env(overrides));

    expect(runtime.valid).toBe(false);
    expect(runtime.writesEnabled).toBe(false);
    expect(runtime.errors.join(' ')).toContain(expected);
  });

  test('sanitized diagnostic exposes no credentials or secret environment object', () => {
    const runtime = resolveRepartoRuntime(env());
    const routeMode = resolveRepartoRouteMode({
      USE_TS_ROUTES: 'false',
      USE_DDD_ROUTES: 'true',
    });
    const diagnostic = sanitizedRepartoDiagnostic(runtime, routeMode);

    expect(diagnostic).toMatchObject({
      environment: 'staging',
      dsn: 'configured',
      writesEnabled: true,
      productionErpWritesApproved: false,
      routeMode: 'ddd',
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/password|pwd|token|secret|uid/i);
  });

  test('write guard lets reads through but rejects mutation when runtime is invalid', () => {
    const guard = createRepartoWriteGuard(resolveRepartoRuntime(env({
      REPARTO_ENVIRONMENT: undefined,
    })));
    const next = jest.fn();
    const status = jest.fn(() => ({ json: jest.fn() }));

    guard({ method: 'GET' }, { status }, next);
    expect(next).toHaveBeenCalledTimes(1);

    guard({ method: 'POST' }, { status }, next);
    expect(status).toHaveBeenCalledWith(503);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['finance', 'financeCapabilityApproved'],
    ['confirmation', 'confirmationCapabilityApproved'],
  ])('write guard requires the explicit %s capability for mutations', (requiredCapability, flag) => {
    const baseRuntime = {
      valid: true,
      writesEnabled: true,
      financeCapabilityApproved: false,
      confirmationCapabilityApproved: false,
    };
    const deniedNext = jest.fn();
    const deniedStatus = jest.fn(() => ({ json: jest.fn() }));
    createRepartoWriteGuard(baseRuntime, { requiredCapability })(
      { method: 'POST' }, { status: deniedStatus }, deniedNext,
    );
    expect(deniedStatus).toHaveBeenCalledWith(503);
    expect(deniedNext).not.toHaveBeenCalled();

    const allowedNext = jest.fn();
    createRepartoWriteGuard({ ...baseRuntime, [flag]: true }, { requiredCapability })(
      { method: 'POST' }, { status: jest.fn() }, allowedNext,
    );
    expect(allowedNext).toHaveBeenCalledTimes(1);
  });

  test('capability-aware guard keeps reads free and rejects unknown capability names', () => {
    const guard = createRepartoWriteGuard({ valid: false }, { requiredCapability: 'finance' });
    const next = jest.fn();
    guard({ method: 'GET' }, { status: jest.fn() }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(() => createRepartoWriteGuard({}, { requiredCapability: 'other' })).toThrow(TypeError);
  });
});
