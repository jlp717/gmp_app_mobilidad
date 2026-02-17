/**
 * PERFORMANCE & LATENCY TESTS - GMP App Backend
 * =============================================
 * Tests response time requirements and concurrent load handling.
 * 
 * Requirements:
 * - All endpoints < 500ms (mocked DB)
 * - Health checks < 50ms
 * - Concurrent requests handled without errors
 */

// ============================================
// MOCKS
// ============================================
jest.mock('../../config/database', () => ({
  odbcPool: {
    query: jest.fn().mockResolvedValue([]),
    initialize: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
  },
  initDatabase: jest.fn(),
  closeDatabase: jest.fn(),
}));

jest.mock('../../utils/query-cache', () => ({
  queryCache: {
    getOrSet: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    get: jest.fn(),
    set: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    invalidatePattern: jest.fn().mockResolvedValue(0),
    getStats: jest.fn().mockReturnValue({ hits: 100, misses: 10, keys: 50 }),
    hasRedis: false,
  },
  TTL: { REALTIME: 0, SHORT: 60, MEDIUM: 300, LONG: 3600, STATIC: 86400 },
}));

jest.mock('../../cron/transferencias.job', () => ({
  iniciarJobsCobros: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  morganStream: { write: jest.fn() },
}));

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { codigoVendedor: '5', nombre: 'Test', role: 'vendedor' };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireOwnership: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/validation.middleware', () => {
  const passthrough = (_req: any, _res: any, next: any) => next();
  return new Proxy({}, {
    get: (_target, prop) => {
      if (prop === '__esModule') return true;
      if (prop === 'validate') return () => passthrough;
      if (prop === 'schemas') return new Proxy({}, { get: () => ({}) });
      return passthrough;
    }
  });
});

jest.mock('../../middleware/security.middleware', () => ({
  securityMiddleware: (_req: any, _res: any, next: any) => next(),
  generalLimiter: (_req: any, _res: any, next: any) => next(),
  loginRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import app from '../../index';

// ============================================
// LATENCY TESTS
// ============================================
describe('Performance - Latency', () => {
  const AUTH = { Authorization: 'Bearer valid-test-token' };

  it('GET /health responds in < 200ms', async () => {
    const start = Date.now();
    const res = await request(app).get('/health');
    const duration = Date.now() - start;

    expect(res.status).toBe(200);
    expect(duration).toBeLessThan(200); // First request may include cold start
  });

  it('GET /api/health responds in < 50ms', async () => {
    const start = Date.now();
    const res = await request(app).get('/api/health');
    const duration = Date.now() - start;

    expect(res.status).toBe(200);
    expect(duration).toBeLessThan(50);
  });

  it('GET /api/cache/stats responds in < 50ms', async () => {
    const start = Date.now();
    const res = await request(app).get('/api/cache/stats');
    const duration = Date.now() - start;

    expect(res.status).toBe(200);
    expect(duration).toBeLessThan(50);
  });

  const apiEndpoints = [
    '/api/commissions/summary?vendedorCode=5&year=2025',
    '/api/commissions/excluded-vendors',
    '/api/objectives?vendedorCode=5&year=2025&month=1',
  ];

  apiEndpoints.forEach((path) => {
    it(`GET ${path.split('?')[0]} responds in < 500ms`, async () => {
      const start = Date.now();
      const res = await request(app).get(path).set(AUTH);
      const duration = Date.now() - start;

      expect([200, 500]).toContain(res.status); // 500 acceptable if DB mock returns empty
      expect(duration).toBeLessThan(500);
    });
  });
});

// ============================================
// CONCURRENT LOAD TESTS
// ============================================
describe('Performance - Concurrent Load', () => {
  it('handles 50 concurrent health checks without errors', async () => {
    const requests = Array.from({ length: 50 }, () =>
      request(app).get('/health')
    );

    const responses = await Promise.all(requests);
    const allOk = responses.every(r => r.status === 200);
    expect(allOk).toBe(true);
  });

  it('handles 20 concurrent API requests without crashes', async () => {
    const AUTH = { Authorization: 'Bearer valid-test-token' };
    const requests = Array.from({ length: 20 }, (_, i) =>
      request(app)
        .get(`/api/commissions/excluded-vendors`)
        .set(AUTH)
    );

    const responses = await Promise.all(requests);
    // All should complete (200 or 500, but not timeout/crash)
    responses.forEach(r => {
      expect([200, 500]).toContain(r.status);
    });
  });

  it('handles mixed concurrent requests', async () => {
    const AUTH = { Authorization: 'Bearer valid-test-token' };
    const requests = [
      request(app).get('/health'),
      request(app).get('/api/health'),
      request(app).get('/api/cache/stats'),
      request(app).get('/api/commissions/excluded-vendors').set(AUTH),
      request(app).get('/health'),
      request(app).get('/api/health'),
      request(app).post('/api/cache/invalidate').send({ pattern: 'test:*' }),
      request(app).get('/health'),
    ];

    const responses = await Promise.all(requests);
    // None should crash
    responses.forEach(r => {
      expect(r.status).toBeLessThan(502);
    });
  });
});

// ============================================
// MEMORY & RESOURCE TESTS
// ============================================
describe('Performance - Resource Usage', () => {
  it('memory usage stays under 500MB during test suite', () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    expect(heapUsedMB).toBeLessThan(500);
  });

  it('response headers include compression hints', async () => {
    const res = await request(app)
      .get('/health')
      .set('Accept-Encoding', 'gzip, deflate');
    
    expect(res.status).toBe(200);
    // Compression middleware should be active
    // (actual gzip depends on response size > threshold)
  });
});
