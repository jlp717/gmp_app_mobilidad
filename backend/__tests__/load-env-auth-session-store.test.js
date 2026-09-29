'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = [
  'NODE_ENV',
  'PM2_INSTANCES',
  'PM2_EXEC_MODE',
  'AUTH_SESSION_STORE_MODE',
  'GMP_ENV_FILE',
  'GMP_LOADED_ENV_FILE',
  'JWT_ACCESS_EXPIRES',
  'JWT_REFRESH_EXPIRES',
  'AUTH_REDIS_TIMEOUT_MS',
];

describe('authentication session store selection during environment loading', () => {
  let originalEnv;
  let envDir;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'staging';
    envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-auth-session-env-'));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    if (envDir) fs.rmSync(envDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function writeEnv(contents = '') {
    fs.writeFileSync(path.join(envDir, '.env'), contents);
  }

  test('PM2 cluster with eight staging workers overrides an unsafe memory selection', () => {
    process.env.PM2_INSTANCES = '8';
    process.env.PM2_EXEC_MODE = 'cluster';
    process.env.AUTH_SESSION_STORE_MODE = 'memory';
    writeEnv('AUTH_SESSION_STORE_MODE=memory\n');

    require('../config/load-env').loadEnv(envDir);

    expect(process.env.AUTH_SESSION_STORE_MODE).toBe('redis');
  });

  test('cluster execution selects Redis even when the configured instance count is one', () => {
    process.env.PM2_INSTANCES = '1';
    process.env.PM2_EXEC_MODE = 'cluster';
    writeEnv();

    require('../config/load-env').loadEnv(envDir);

    expect(process.env.AUTH_SESSION_STORE_MODE).toBe('redis');
  });

  test('single-process staging keeps the existing memory default when no store is selected', () => {
    process.env.PM2_INSTANCES = '1';
    process.env.PM2_EXEC_MODE = 'fork';
    writeEnv();

    require('../config/load-env').loadEnv(envDir);

    expect(process.env.AUTH_SESSION_STORE_MODE).toBeUndefined();
  });

  test('server loads its environment before importing the app and authentication middleware', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const loadEnvIndex = serverSource.indexOf("require('./config/load-env').loadEnv(__dirname)");
    const appImportIndex = serverSource.indexOf("require('./app')");

    expect(loadEnvIndex).toBeGreaterThanOrEqual(0);
    expect(appImportIndex).toBeGreaterThan(loadEnvIndex);
  });
});
