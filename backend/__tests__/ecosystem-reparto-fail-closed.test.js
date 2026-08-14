'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRepartoRuntime, resolveRepartoRouteMode, sanitizedRepartoDiagnostic } = require('../config/reparto-runtime');

const previousDeployFlag = process.env.ENABLE_PM2_DEPLOY;
process.env.ENABLE_PM2_DEPLOY = 'false';
const ecosystem = require('../ecosystem.config');
if (previousDeployFlag === undefined) delete process.env.ENABLE_PM2_DEPLOY;
else process.env.ENABLE_PM2_DEPLOY = previousDeployFlag;

const EXPECTED_FAIL_CLOSED = Object.freeze({
  REPARTO_ENVIRONMENT: 'production',
  REPARTO_TABLE_SET: 'production',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  REPARTO_WRITES_ENABLED: 'false',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
  REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
  REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  USE_TS_ROUTES: 'false',
  USE_DDD_ROUTES: 'true',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
});

describe('PM2 reparto configuration', () => {
  const app = ecosystem.apps.find((candidate) => candidate.name === 'gmp-api');

  test('defines the gmp-api process', () => {
    expect(app).toBeDefined();
  });

  test('disables PM2 deploy automation and contains no forbidden process mutation command', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'ecosystem.config.js'), 'utf8');

    expect(ecosystem.deploy).toEqual({});
    expect(source).not.toContain('ENABLE_PM2_DEPLOY');
    expect(source).not.toMatch(/\bpm2\s+(?:reload|restart\s+all|delete|start|stop)\b/i);
    expect(source).not.toMatch(/\b(?:pre|post)-deploy\b/i);
    expect(source).not.toMatch(/\bnpm\s+(?:ci|install)\b/i);
  });

  test.each(['env', 'env_production', 'env_ts'])('%s is explicit and fail-closed', (blockName) => {
    const block = app[blockName];
    expect(block).toMatchObject(EXPECTED_FAIL_CLOSED);
    expect(Object.prototype.hasOwnProperty.call(block, 'ODBC_DSN')).toBe(false);

    const routeMode = resolveRepartoRouteMode(block);
    expect(routeMode).toMatchObject({ valid: true, mode: 'ddd', useTsRoutes: false, useDddRoutes: true });
    const runtime = resolveRepartoRuntime({ ODBC_DSN: 'GMP', ...block });
    expect(runtime).toMatchObject({
      valid: true,
      environment: 'production',
      writesEnabled: false,
      productionWritesEnabled: false,
      productionErpWritesApproved: false,
      confirmationCapabilityApproved: false,
      financeCapabilityApproved: false,
      schemas: { read: 'DSEDAC', app: 'JAVIER', erp: 'JAVIER' },
    });
    expect(sanitizedRepartoDiagnostic(runtime, routeMode)).toMatchObject({
      routeMode: 'ddd',
      environment: 'production',
      writesEnabled: false,
      productionWritesEnabled: false,
      productionErpWritesApproved: false,
      confirmationCapabilityApproved: false,
      financeCapabilityApproved: false,
    });
  });

  test('.env.example documents the capability disabled exactly once', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '.env.example'), 'utf8');
    expect(source.match(/^REPARTO_PRODUCTION_ERP_WRITES_APPROVED=false$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/^REPARTO_PRODUCTION_ERP_WRITES_APPROVED=true$/m);
    expect(source.match(/^REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=false$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/^REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=true$/m);
    expect(source.match(/^REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=false$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/^REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=true$/m);
    expect(source.match(/^REPARTO_TABLE_SET=isolated_test$/gm)).toHaveLength(1);
    expect(source).not.toContain('REPARTO_CONFIRMATION_TABLE_SET');
  });

  test('honors staging isolated_test from the PM2 environment without changing the fail-closed default', () => {
    const names = [
      'REPARTO_ENVIRONMENT',
      'REPARTO_TABLE_SET',
      'REPARTO_WRITES_ENABLED',
      'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
      'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
    ];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    let configured;
    try {
      process.env.REPARTO_ENVIRONMENT = 'staging';
      process.env.REPARTO_TABLE_SET = 'isolated_test';
      process.env.REPARTO_WRITES_ENABLED = 'true';
      process.env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED = 'true';
      process.env.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED = 'true';
      jest.resetModules();
      configured = require('../ecosystem.config');
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      jest.resetModules();
    }
    const configuredApp = configured.apps.find((candidate) => candidate.name === 'gmp-api');
    expect(configuredApp.env).toMatchObject({
      REPARTO_ENVIRONMENT: 'staging',
      REPARTO_TABLE_SET: 'isolated_test',
      REPARTO_WRITES_ENABLED: 'true',
    });
    const runtime = resolveRepartoRuntime({ ODBC_DSN: 'GMP', ...configuredApp.env });
    expect(runtime).toMatchObject({
      valid: true,
      environment: 'staging',
      tableSet: 'isolated_test',
      writesEnabled: true,
      productionWritesEnabled: false,
    });
  });

  test('preserves explicit valid approval booleans from the PM2 environment', () => {
    const flagNames = [
      'REPARTO_WRITES_ENABLED',
      'REPARTO_PRODUCTION_WRITES_APPROVED',
      'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
      'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
      'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
      'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
    ];
    const previous = Object.fromEntries(flagNames.map((name) => [name, process.env[name]]));
    const explicit = Object.fromEntries(flagNames.map((name) => [name, 'true']));
    let configured;
    try {
      Object.assign(process.env, explicit);
      jest.resetModules();
      configured = require('../ecosystem.config');
    } finally {
      for (const name of flagNames) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      jest.resetModules();
    }

    const configuredApp = configured.apps.find((candidate) => candidate.name === 'gmp-api');
    for (const blockName of ['env', 'env_production', 'env_ts']) {
      expect(configuredApp[blockName]).toMatchObject(explicit);
    }
  });

  test('preserves an invalid explicit approval value for fail-closed runtime validation', () => {
    const name = 'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED';
    const previous = process.env[name];
    let configured;
    try {
      process.env[name] = 'not-a-boolean';
      jest.resetModules();
      configured = require('../ecosystem.config');
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
      jest.resetModules();
    }

    const configuredApp = configured.apps.find((candidate) => candidate.name === 'gmp-api');
    const runtime = resolveRepartoRuntime({ ODBC_DSN: 'GMP', ...configuredApp.env });
    expect(configuredApp.env[name]).toBe('not-a-boolean');
    expect(runtime.valid).toBe(false);
    expect(runtime.errors.join(' ')).toContain(name);
  });
});
