'use strict';

const fs = require('fs');
const path = require('path');

describe('runtime performance configuration', () => {
  const backendRoot = path.join(__dirname, '..');

  afterEach(() => {
    jest.resetModules();
    delete process.env.PM2_INSTANCES;
    delete process.env.UV_THREADPOOL_SIZE;
    delete process.env.NODE_OPTIONS;
    delete process.env.DB_TOTAL_CONNECTION_BUDGET;
    delete process.env.DB_TOTAL_QUERY_CONCURRENCY;
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_QUERY_CONCURRENCY;
  });

  test('PM2 defaults to 8 cluster workers with 128 libuv threads and 512 MB old-space', () => {
    const config = require('../ecosystem.config');
    const app = config.apps.find((entry) => entry.name === 'gmp-api');

    expect(app.instances).toBe('8');
    expect(app.exec_mode).toBe('cluster');
    expect(app.env.UV_THREADPOOL_SIZE).toBe('128');
    expect(app.env.NODE_OPTIONS).toBe('--max-old-space-size=512');
    expect(app.env.HTTP_REQUEST_TIMEOUT_MS).toBe('30000');
    expect(app.env.DB_POOL_MAX).toBe('5');
    expect(app.env.DB_QUERY_CONCURRENCY).toBe('4');
    expect(app.watch).toBe(false);
    expect(app.kill_timeout).toBe(5000);
    expect(app.max_memory_restart).toBe('512M');
  });

  test('.env.produccion keeps production runtime budgets aligned with 8 workers', () => {
    const env = fs.readFileSync(path.join(backendRoot, '.env.produccion'), 'utf8');

    expect(env).toMatch(/^PM2_INSTANCES=8$/m);
    expect(env).toMatch(/^PM2_EXEC_MODE=cluster$/m);
    expect(env).toMatch(/^UV_THREADPOOL_SIZE=128$/m);
    expect(env).toMatch(/^NODE_OPTIONS=--max-old-space-size=512$/m);
    expect(env).toMatch(/^DB_TOTAL_CONNECTION_BUDGET=40$/m);
    expect(env).toMatch(/^DB_POOL_MIN=1$/m);
    expect(env).toMatch(/^DB_POOL_MAX=5$/m);
    expect(env).toMatch(/^DB_QUERY_CONCURRENCY=4$/m);
    expect(env).toMatch(/^REDIS_DISABLE_OFFLINE_QUEUE=true$/m);
  });

  test('DB layer contains slow-query logging, circuit breaker, and request context hooks', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'config/db.js'), 'utf8');

    expect(source).toMatch(/DB_QUERY_SLOW_MS/);
    expect(source).toMatch(/SLOW_QUERY/);
    expect(source).toMatch(/DB_CIRCUIT_OPEN/);
    expect(source).toMatch(/runWithDbRequestContext/);
    expect(source).toMatch(/startPoolMetrics/);
  });

  test('Redis cache is fail-fast and exposes batch writes', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'services/redis-cache.js'), 'utf8');

    expect(source).toMatch(/disableOfflineQueue/);
    expect(source).toMatch(/enableOfflineQueue:\s*false/);
    expect(source).toMatch(/L1_CACHE_TTL_MS/);
    expect(source).toMatch(/async setMany/);
    expect(source).toMatch(/multi\.setEx/);
    expect(source).toMatch(/getRedisClient/);
  });
});
