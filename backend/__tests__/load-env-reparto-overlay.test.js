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
