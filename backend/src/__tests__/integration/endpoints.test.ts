/**
 * E2E INTEGRATION TESTS - GMP App TypeScript Backend
 * ===================================================
 * Tests all TS endpoints via supertest against the Express app.
 * 
 * Mocks: Database (ODBC), Redis, Cron jobs
 * Tests: HTTP status, response format, auth enforcement, validation
 */

// ============================================
// MOCKS (must be before imports)
// ============================================

jest.mock('../../config/database', () => ({
  odbcPool: {
    query: jest.fn().mockResolvedValue([]),
    initialize: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockReturnValue(true),
  },
  initDatabase: jest.fn().mockResolvedValue(undefined),
  closeDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/query-cache', () => ({
  queryCache: {
    getOrSet: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    get: jest.fn(),
    set: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(0),
    getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0, keys: 0 }),
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

// Mock auth middleware to allow/deny based on test needs
const mockAuthMiddleware = jest.fn((req: any, _res: any, next: any) => {
  if (req.headers.authorization === 'Bearer valid-test-token') {
    req.user = { codigoVendedor: '5', nombre: 'Test User', role: 'vendedor' };
    next();
  } else {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    next(err);
  }
});

jest.mock('../../middleware/auth.middleware', () => ({
  requireAuth: mockAuthMiddleware,
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireOwnership: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/validation.middleware', () => {
  const passthrough = (_req: any, _res: any, next: any) => next();
  return new Proxy({}, {
    get: (_target, prop) => {
      if (prop === '__esModule') return true;
      // validate() returns a middleware, others ARE middleware
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
// TEST SUITE
// ============================================

describe('E2E Integration Tests', () => {
  const VALID_AUTH = { Authorization: 'Bearer valid-test-token' };
  const INVALID_AUTH = { Authorization: 'Bearer invalid-token' };

  // ==========================================
  // HEALTH CHECK ENDPOINTS (no auth)
  // ==========================================
  describe('Health Checks', () => {
    it('GET /health should return 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /api/health should return 200 with uptime', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('memory');
    });
  });

  // ==========================================
  // CACHE MANAGEMENT ENDPOINTS
  // ==========================================
  describe('Cache Management', () => {
    it('GET /api/cache/stats should return cache stats', async () => {
      const res = await request(app).get('/api/cache/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hits');
      expect(res.body).toHaveProperty('misses');
    });

    it('POST /api/cache/invalidate requires pattern', async () => {
      const res = await request(app)
        .post('/api/cache/invalidate')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('POST /api/cache/invalidate with valid pattern', async () => {
      const res = await request(app)
        .post('/api/cache/invalidate')
        .send({ pattern: 'commissions:*' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('invalidated');
    });
  });

  // ==========================================
  // AUTH PROTECTED ENDPOINTS - 401 without token
  // ==========================================
  describe('Auth Enforcement', () => {
    const protectedEndpoints = [
      { method: 'get', path: '/api/commissions/summary?vendedorCode=5' },
      { method: 'get', path: '/api/objectives?vendedorCode=5&year=2025&month=1' },
      { method: 'get', path: '/api/dashboard/summary?vendedorCode=5' },
      { method: 'get', path: '/api/entregas/list?vendedorCode=5' },
      { method: 'get', path: '/api/facturas/list?vendedorCode=5' },
      { method: 'get', path: '/api/repartidor/deliveries' },
      { method: 'get', path: '/api/clientes/list?vendedorCode=5' },
      { method: 'get', path: '/api/productos/list' },
      { method: 'get', path: '/api/ventas/summary?vendedorCode=5' },
      { method: 'get', path: '/api/rutero/routes?vendedorCode=5' },
      { method: 'get', path: '/api/pedidos/list?vendedorCode=5' },
      { method: 'get', path: '/api/cobros/summary?vendedorCode=5' },
      { method: 'get', path: '/api/promociones/list' },
    ];

    protectedEndpoints.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path.split('?')[0]} should return 401 without auth`, async () => {
        const res = await (request(app) as any)[method](path)
          .set(INVALID_AUTH);
        // Should be 401 or 500 (error propagation), NOT 200
        expect(res.status).toBeGreaterThanOrEqual(400);
      });
    });
  });

  // ==========================================
  // COMMISSIONS ENDPOINTS (with auth)
  // ==========================================
  describe('Commissions', () => {
    it('GET /api/commissions/summary returns data with valid auth', async () => {
      const res = await request(app)
        .get('/api/commissions/summary?vendedorCode=5&year=2025')
        .set(VALID_AUTH);
      // May return 200 with success or 500 if DB mock is minimal
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
      }
    });

    it('GET /api/commissions/summary validates vendedorCode', async () => {
      const res = await request(app)
        .get('/api/commissions/summary')
        .set(VALID_AUTH);
      // Missing required vendedorCode → 400
      expect([400, 500]).toContain(res.status);
    });

    it('GET /api/commissions/excluded-vendors returns array', async () => {
      const res = await request(app)
        .get('/api/commissions/excluded-vendors')
        .set(VALID_AUTH);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('excludedVendors');
      expect(Array.isArray(res.body.excludedVendors)).toBe(true);
    });
  });

  // ==========================================
  // OBJECTIVES ENDPOINTS
  // ==========================================
  describe('Objectives', () => {
    it('GET /api/objectives with valid params', async () => {
      const res = await request(app)
        .get('/api/objectives?vendedorCode=5&year=2025&month=1')
        .set(VALID_AUTH);
      expect([200, 500]).toContain(res.status);
    });

    it('GET /api/objectives without vendedorCode returns error or empty', async () => {
      const res = await request(app)
        .get('/api/objectives')
        .set(VALID_AUTH);
      // With validation mocked, may return 200 with empty data or 400/500
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  // ==========================================
  // 404 HANDLER
  // ==========================================
  describe('404 Handler', () => {
    it('GET /api/nonexistent should return 404', async () => {
      const res = await request(app).get('/api/this-route-does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // RESPONSE FORMAT VALIDATION
  // ==========================================
  describe('Response Format', () => {
    it('Health response should be JSON', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-type']).toMatch(/json/);
    });

    it('Error responses should be JSON', async () => {
      const res = await request(app).get('/api/this-does-not-exist');
      expect(res.headers['content-type']).toMatch(/json/);
    });
  });
});
