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
    expect(app.max_restarts).toBe(50);
    expect(app.restart_delay).toBe(1000);
    expect(app.exp_backoff_restart_delay).toBe(500);
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

  test('request timeout and route error helpers suppress duplicate responses', () => {
    const serverSource = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');
    const commonSource = fs.readFileSync(path.join(backendRoot, 'utils/common.js'), 'utf8');
    const httpCacheSource = fs.readFileSync(path.join(backendRoot, 'middleware/http-cache.js'), 'utf8');

    expect(serverSource).toMatch(/LATE_RESPONSE_SUPPRESSED/);
    expect(serverSource).toMatch(/requestTimedOut/);
    expect(commonSource).toMatch(/Response already completed/);
    expect(commonSource).toMatch(/DB_QUERY_QUEUE_TIMEOUT/);
    expect(httpCacheSource).toMatch(/requestTimedOut/);
  });

  test('objectives evolution avoids per-vendor LACLAE scans for multi-vendor scopes', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'routes/objectives.js'), 'utf8');

    expect(source).toMatch(/scoped aggregate/);
    expect(source).not.toMatch(/vendorCodesArray\.map\(code => buildVendorObjectiveTargets/);
  });

  test('commissions batch sales query avoids CASE predicates in vendor filters', () => {
    const source = fs.readFileSync(path.join(backendRoot, 'routes/commissions.js'), 'utf8');

    expect(source).toMatch(/UNION ALL/);
    expect(source).toMatch(/CASE predicate caused full scans/);
    expect(source).not.toMatch(/TRIM\(\$\{vendorColExpr\}\) IN/);
  });
});
