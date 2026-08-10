'use strict';

const { TABLE_MAPPINGS, resolveRepartoRuntime, sanitizedRepartoDiagnostic } = require('../config/reparto-runtime');
const {
  STATIC_REPARTO_CATALOG,
  canEnableCanonicalConfirmation,
  createCanonicalConfirmationBootstrap,
  createDb2ConnectionFactory,
} = require('../config/reparto-confirmation-bootstrap');

function runtime(overrides = {}) {
  return {
    valid: true,
    environment: 'test',
    writesEnabled: true,
    confirmationCapabilityApproved: true,
    financeCapabilityApproved: true,
    tableSet: 'isolated_test',
    tables: TABLE_MAPPINGS.isolated_test,
    evidencePendingTtlHours: 24,
    schemas: { app: 'JAVIER' },
    ...overrides,
  };
}

describe('canonical reparto confirmation bootstrap', () => {
  test('parses capability strictly and keeps it out of diagnostics secrets', () => {
    const base = {
      NODE_ENV: 'test',
      REPARTO_ENVIRONMENT: 'test',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
      ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
      REPARTO_WRITES_ENABLED: 'true',
    };
    const defaulted = resolveRepartoRuntime(base);
    const malformed = resolveRepartoRuntime({ ...base, REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'yes' });

    expect(defaulted.valid).toBe(true);
    expect(defaulted.confirmationCapabilityApproved).toBe(false);
    expect(malformed.valid).toBe(false);
    expect(malformed.errors).toContain('REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED must be explicitly true or false');
    expect(sanitizedRepartoDiagnostic(defaulted, { valid: true, mode: 'ddd', errors: [] })).toMatchObject({
      confirmationCapabilityApproved: false,
      productionErpWritesApproved: false,
      dsn: 'configured',
    });
  });

  test('is fail-closed by default and never calls DB bootstrap', () => {
    const initDb = jest.fn();
    const result = createCanonicalConfirmationBootstrap({
      runtime: runtime({ confirmationCapabilityApproved: false }),
      db: { initDb, getPool: jest.fn() },
    });

    expect(result.enabled).toBe(false);
    expect(result.diagnostic).toMatchObject({ capabilityApproved: false, enabled: false });
    expect(initDb).not.toHaveBeenCalled();
    return expect(result.runtime.confirmationService.confirm()).rejects.toMatchObject({
      code: 'REPARTO_CONFIRMATION_RUNTIME_UNAVAILABLE', statusCode: 503,
    });
  });

  test.each([
    ['invalid runtime', runtime({ valid: false })],
    ['writes disabled', runtime({ writesEnabled: false })],
    ['DSEDAC app schema', runtime({ schemas: { app: 'DSEDAC' } })],
    ['capability absent', runtime({ confirmationCapabilityApproved: false })],
  ])('does not enable when %s', (_, value) => {
    expect(canEnableCanonicalConfirmation(value)).toBe(false);
  });

  test('keeps production receipt reads fail-closed without an approved isolated mapping and catalog', () => {
    const initDb = jest.fn();
    const result = createCanonicalConfirmationBootstrap({
      runtime: runtime({ environment: 'production', writesEnabled: false, tableSet: 'production' }),
      db: { initDb, getPool: jest.fn() },
    });
    expect(result.enabled).toBe(false);
    expect(initDb).not.toHaveBeenCalled();
  });

  test('enables the production mapping only after all independent confirmation gates', () => {
    const base = {
      NODE_ENV: 'production', REPARTO_ENVIRONMENT: 'production', REPARTO_TABLE_SET: 'production',
      REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24', ODBC_DSN: 'GMP',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC', REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'true',
      REPARTO_PRODUCTION_WRITES_APPROVED: 'true', REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'true',
    };
    const denied = resolveRepartoRuntime(base);
    expect(denied.valid).toBe(false);
    expect(createCanonicalConfirmationBootstrap({ runtime: denied, db: { initDb: jest.fn(), getPool: jest.fn() } }).enabled).toBe(false);

    const enabled = resolveRepartoRuntime({ ...base, REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'true' });
    expect(enabled).toMatchObject({ valid: true, confirmationCapabilityApproved: true, productionConfirmationApproved: true });
    const result = createCanonicalConfirmationBootstrap({ runtime: enabled, db: { initDb: jest.fn(), getPool: jest.fn() } });
    expect(result).toMatchObject({ enabled: true, diagnostic: { tableSet: 'production', productionConfirmationApproved: true } });
  });

  test('injects repository and static catalog only after every capability condition', async () => {
    const db = { initDb: jest.fn(), getPool: jest.fn() };
    const result = createCanonicalConfirmationBootstrap({ runtime: runtime(), db });

    expect(result.enabled).toBe(true);
    expect(result.diagnostic).toMatchObject({ enabled: true, capabilityApproved: true, appSchema: 'JAVIER' });
    await expect(result.runtime.catalogService.validateConfirmation({
      delivery: { status: 'ENTREGADO', lineas: [] },
      cobro: { formaPago: 'EFECTIVO' },
    })).resolves.toBeDefined();
    expect(db.initDb).not.toHaveBeenCalled();
    expect(STATIC_REPARTO_CATALOG.statuses).toContain('PARCIAL');
  });

  test('acquires one lazy connection from the initialized pool', async () => {
    const connection = { execute: jest.fn(), close: jest.fn() };
    const pool = { connect: jest.fn().mockResolvedValue(connection) };
    const factory = createDb2ConnectionFactory({
      initDb: jest.fn().mockResolvedValue(pool),
      getPool: jest.fn(),
    });

    await expect(factory()).resolves.toBe(connection);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  test('does not silently fall back when the initialized pool has no connect', async () => {
    const factory = createDb2ConnectionFactory({
      initDb: jest.fn().mockResolvedValue(null),
      getPool: jest.fn().mockReturnValue({}),
    });
    await expect(factory()).rejects.toMatchObject({ code: 'REPARTO_DB2_POOL_UNAVAILABLE' });
  });
});
