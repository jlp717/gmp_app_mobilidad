'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnv, overlayRepartoFlags } = require('../config/load-env');

test('REPARTO flags in .env override stale PM2 fail-closed values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-load-env-'));
  fs.writeFileSync(
    path.join(dir, '.env'),
    [
      'REPARTO_ENVIRONMENT=staging',
      'REPARTO_TABLE_SET=isolated_test',
      'REPARTO_WRITES_ENABLED=true',
      'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED=true',
      'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED=true',
      '',
    ].join('\n'),
  );

  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    GMP_ENV_FILE: process.env.GMP_ENV_FILE,
    REPARTO_ENVIRONMENT: process.env.REPARTO_ENVIRONMENT,
    REPARTO_TABLE_SET: process.env.REPARTO_TABLE_SET,
    REPARTO_WRITES_ENABLED: process.env.REPARTO_WRITES_ENABLED,
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED:
      process.env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED,
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED:
      process.env.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED,
  };

  process.env.NODE_ENV = 'test';
  delete process.env.GMP_ENV_FILE;
  process.env.REPARTO_ENVIRONMENT = 'production';
  process.env.REPARTO_TABLE_SET = 'production';
  process.env.REPARTO_WRITES_ENABLED = 'false';
  process.env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED = 'false';
  process.env.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED = 'false';

  try {
    const loaded = loadEnv(dir);
    expect(loaded).toBe(path.join(dir, '.env'));
    expect(process.env.REPARTO_ENVIRONMENT).toBe('staging');
    expect(process.env.REPARTO_TABLE_SET).toBe('isolated_test');
    expect(process.env.REPARTO_WRITES_ENABLED).toBe('true');
    expect(process.env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED).toBe('true');
    expect(process.env.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED).toBe('true');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('overlayRepartoFlags ignores unrelated keys', () => {
  const previousNode = process.env.NODE_ENV;
  const previousTable = process.env.REPARTO_TABLE_SET;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  try {
    overlayRepartoFlags({ NODE_ENV: 'hacked', REPARTO_TABLE_SET: 'isolated_test' });
    expect(process.env.NODE_ENV).not.toBe('hacked');
    expect(process.env.REPARTO_TABLE_SET).toBe('isolated_test');
  } finally {
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
    if (previousTable === undefined) delete process.env.REPARTO_TABLE_SET;
    else process.env.REPARTO_TABLE_SET = previousTable;
  }
});

test('routing capability flags in .env override stale PM2 fail-closed values', () => {
  const previousTracking = process.env.REPARTIDOR_TRACKING_ENABLED;
  const previousDayMove = process.env.REPARTIDOR_DAY_MOVE_ENABLED;
  const previousReadSchema = process.env.REPARTIDOR_FINANCE_READ_SCHEMA;

  process.env.REPARTIDOR_TRACKING_ENABLED = 'false';
  process.env.REPARTIDOR_DAY_MOVE_ENABLED = 'false';
  process.env.REPARTIDOR_FINANCE_READ_SCHEMA = 'DSEDAC';

  try {
    overlayRepartoFlags({
      REPARTIDOR_TRACKING_ENABLED: 'true',
      REPARTIDOR_DAY_MOVE_ENABLED: 'true',
      REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
    });
    expect(process.env.REPARTIDOR_TRACKING_ENABLED).toBe('true');
    expect(process.env.REPARTIDOR_DAY_MOVE_ENABLED).toBe('true');
    expect(process.env.REPARTIDOR_FINANCE_READ_SCHEMA).toBe('DSEDAC');
  } finally {
    for (const [key, value] of [
      ['REPARTIDOR_TRACKING_ENABLED', previousTracking],
      ['REPARTIDOR_DAY_MOVE_ENABLED', previousDayMove],
      ['REPARTIDOR_FINANCE_READ_SCHEMA', previousReadSchema],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('overlayRepartoFlags never repoints finance schema routing', () => {
  const previousReadSchema = process.env.REPARTIDOR_FINANCE_READ_SCHEMA;
  const previousAppSchema = process.env.REPARTIDOR_FINANCE_APP_SCHEMA;
  process.env.REPARTIDOR_FINANCE_READ_SCHEMA = 'DSEDAC';
  delete process.env.REPARTIDOR_FINANCE_APP_SCHEMA;
  try {
    overlayRepartoFlags({
      REPARTIDOR_FINANCE_READ_SCHEMA: 'JAVIER',
      REPARTIDOR_FINANCE_APP_SCHEMA: 'DSEDAC',
    });
    expect(process.env.REPARTIDOR_FINANCE_READ_SCHEMA).toBe('DSEDAC');
    expect(process.env.REPARTIDOR_FINANCE_APP_SCHEMA).toBeUndefined();
  } finally {
    if (previousReadSchema === undefined) delete process.env.REPARTIDOR_FINANCE_READ_SCHEMA;
    else process.env.REPARTIDOR_FINANCE_READ_SCHEMA = previousReadSchema;
    if (previousAppSchema === undefined) delete process.env.REPARTIDOR_FINANCE_APP_SCHEMA;
    else process.env.REPARTIDOR_FINANCE_APP_SCHEMA = previousAppSchema;
  }
});

test('production floor raises short access TTL to 24h without touching secrets', () => {
  const { enforceCommercialSessionTtlFloor, parseTtlMs } = require('../config/load-env');
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES,
    JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES,
    AUTH_REDIS_TIMEOUT_MS: process.env.AUTH_REDIS_TIMEOUT_MS,
    REDIS_COMMAND_TIMEOUT_MS: process.env.REDIS_COMMAND_TIMEOUT_MS,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  };

  try {
    process.env.JWT_ACCESS_EXPIRES = '1h';
    process.env.JWT_REFRESH_EXPIRES = '7d';
    process.env.AUTH_REDIS_TIMEOUT_MS = '1000';
    process.env.JWT_ACCESS_SECRET = 'unchanged-secret-marker-for-ttl-floor-test';

    const skipped = enforceCommercialSessionTtlFloor({ production: false });
    expect(skipped.applied).toBe(false);
    expect(process.env.JWT_ACCESS_EXPIRES).toBe('1h');

    const raised = enforceCommercialSessionTtlFloor({ production: true });
    expect(raised.applied).toBe(true);
    expect(process.env.JWT_ACCESS_EXPIRES).toBe('24h');
    expect(parseTtlMs(process.env.JWT_ACCESS_EXPIRES)).toBe(24 * 60 * 60 * 1000);
    expect(process.env.JWT_REFRESH_EXPIRES).toBe('7d');
    expect(process.env.AUTH_REDIS_TIMEOUT_MS).toBe('3000');
    expect(process.env.JWT_ACCESS_SECRET).toBe('unchanged-secret-marker-for-ttl-floor-test');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
