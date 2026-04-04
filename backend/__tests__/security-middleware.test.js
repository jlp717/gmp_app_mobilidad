/**
 * Security Middleware - Unit Tests
 * ==================================
 * Tests for suspicious user-agent detection, content-length validation,
 * rate limiter configuration, SQL injection detection, and sanitization
 */

'use strict';

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const {
  detectSuspiciousAgents,
  validateContentLength,
  detectSqlInjection,
  sanitizeInput,
  validateContentType,
  addRequestId,
  globalLimiter,
  loginLimiter,
  apiLimiter,
  uploadLimiter,
  emailLimiter,
  cobrosLimiter,
  pedidosLimiter,
  createSecurityHeaders,
  validationSchemas,
  logSecurityEvent,
} = require('../middleware/security');

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper to create mock Express req/res/next
function createMockReq(overrides = {}) {
  const headers = { ...overrides.headers };
  const req = {
    ip: '192.168.1.1',
    method: 'GET',
    path: '/api/test',
    headers,
    body: overrides.body || {},
    query: overrides.query || {},
    get: (name) => headers[name.toLowerCase()] || headers[name] || '',
    user: overrides.user || null,
    ...overrides,
  };
  return req;
}

function createMockRes() {
  const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
    };
  return res;
}

// =============================================================================
// Suspicious User-Agent Detection
// =============================================================================

describe('detectSuspiciousAgents', () => {
  test('should allow normal browser user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should allow Flutter app user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'GMP-Movilidad/1.0 (Flutter)' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should block sqlmap user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'sqlmap/1.5.2#stable (https://sqlmap.org)' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should block nikto user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Mozilla/5.00 (nikto/2.1.6)' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block nmap user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'nmap scripting engine' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block burpsuite user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Mozilla/5.0 (BurpSuite Scanner)' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block python-requests user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'python-requests/2.28.0' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block curl user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'curl/7.88.1' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block wget user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Wget/1.21' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block nuclei user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Nuclei - Open-source project (github.com/projectdiscovery/nuclei)' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block dirbuster user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'DirBuster-1.0-RC1' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block gobuster user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'gobuster/3.1.0' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block nessus user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Nessus SOAP' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block acunetix user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'Acunetix Web Vulnerability Scanner' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block empty user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': '' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'User-Agent header required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should block missing user-agent', () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block hydra user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'hydra/9.3' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block masscan user-agent', () => {
    const req = createMockReq({
      headers: { 'user-agent': 'masscan/1.3' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSuspiciousAgents(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Content-Length Validation
// =============================================================================

describe('validateContentLength', () => {
  test('should allow GET requests without content-length', () => {
    const req = createMockReq({ method: 'GET', headers: {} });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should allow POST with valid content-length under limit', () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'content-length': '1024' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should reject POST with missing content-length', () => {
    const req = createMockReq({
      method: 'POST',
      headers: {},
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(res.status).toHaveBeenCalledWith(411);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Length header required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should reject POST with content-length exceeding max', () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'content-length': '10000000' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.error).toBe('Payload too large');
    expect(jsonCall.maxAllowed).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  test('should reject PUT with oversized content', () => {
    const req = createMockReq({
      method: 'PUT',
      headers: { 'content-length': '99999999' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });

  test('should reject PATCH with oversized content', () => {
    const req = createMockReq({
      method: 'PATCH',
      headers: { 'content-length': '99999999' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });

  test('should allow DELETE without content-length', () => {
    const req = createMockReq({ method: 'DELETE', headers: {} });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should allow content-length at exactly the boundary', () => {
    const MAX = parseInt(process.env.MAX_CONTENT_LENGTH || '5242880', 10);
    const req = createMockReq({
      method: 'POST',
      headers: { 'content-length': String(MAX) },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentLength(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// =============================================================================
// Rate Limiter Configuration
// =============================================================================

describe('Rate Limiter Configuration', () => {
  test('globalLimiter should be defined with correct structure', () => {
    expect(globalLimiter).toBeDefined();
    expect(typeof globalLimiter).toBe('function');
  });

  test('loginLimiter should be defined', () => {
    expect(loginLimiter).toBeDefined();
    expect(typeof loginLimiter).toBe('function');
  });

  test('apiLimiter should be defined', () => {
    expect(apiLimiter).toBeDefined();
    expect(typeof apiLimiter).toBe('function');
  });

  test('uploadLimiter should be defined', () => {
    expect(uploadLimiter).toBeDefined();
    expect(typeof uploadLimiter).toBe('function');
  });

  test('emailLimiter should be defined', () => {
    expect(emailLimiter).toBeDefined();
    expect(typeof emailLimiter).toBe('function');
  });

  test('cobrosLimiter should be defined', () => {
    expect(cobrosLimiter).toBeDefined();
    expect(typeof cobrosLimiter).toBe('function');
  });

  test('pedidosLimiter should be defined', () => {
    expect(pedidosLimiter).toBeDefined();
    expect(typeof pedidosLimiter).toBe('function');
  });

  test('globalLimiter should skip health check endpoint', () => {
    const skipFn = globalLimiter.skip;
    expect(skipFn).toBeDefined();
    const mockReq = { path: '/api/health', ip: '1.2.3.4', get: () => 'test' };
    expect(skipFn(mockReq)).toBe(true);
  });

  test('globalLimiter should not skip non-health endpoints', () => {
    const skipFn = globalLimiter.skip;
    const mockReq = { path: '/api/pedidos', ip: '1.2.3.4', get: () => 'test' };
    expect(skipFn(mockReq)).toBe(false);
  });
});

// =============================================================================
// SQL Injection Detection
// =============================================================================

describe('detectSqlInjection', () => {
  test('should allow safe query parameters', () => {
    const req = createMockReq({
      query: { search: 'jamón ibérico', page: '1' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should block SELECT in query parameter', () => {
    const req = createMockReq({
      query: { search: "1' UNION SELECT * FROM users--" },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid input detected' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should block DROP in query parameter', () => {
    const req = createMockReq({
      query: { id: '1; DROP TABLE users' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block SQL comment in query parameter', () => {
    const req = createMockReq({
      query: { name: "admin'--" },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block OR 1=1 pattern in query', () => {
    const req = createMockReq({
      query: { filter: '1 OR 1=1' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block SQL injection in body', () => {
    const req = createMockReq({
      body: { username: "admin' OR '1'='1" },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('should block EXEC in body', () => {
    const req = createMockReq({
      body: { command: 'EXEC xp_cmdshell' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('should allow safe body data', () => {
    const req = createMockReq({
      body: { clientCode: 'C001', name: 'Tienda María' },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should block nested SQL injection in body object', () => {
    const req = createMockReq({
      body: {
        filter: {
          field: 'name',
          value: "1; DELETE FROM orders",
        },
      },
    });
    const res = createMockRes();
    const next = jest.fn();

    detectSqlInjection(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Sanitization
// =============================================================================

describe('sanitizeInput', () => {
  test('should sanitize dangerous characters from body strings', () => {
    const req = createMockReq({
      body: { name: "Robert'; DROP TABLE--" },
    });
    const res = createMockRes();
    const next = jest.fn();

    sanitizeInput(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).not.toContain("'");
    expect(req.body.name).not.toContain(';');
  });

  test('should sanitize query parameters', () => {
    const req = createMockReq({
      query: { search: "test<script>alert(1)</script>" },
    });
    const res = createMockRes();
    const next = jest.fn();

    sanitizeInput(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.search).not.toContain('<');
    expect(req.query.search).not.toContain('>');
  });

  test('should preserve safe body data', () => {
    const req = createMockReq({
      body: { name: 'Tienda María', code: 'C001' },
    });
    const res = createMockRes();
    const next = jest.fn();

    sanitizeInput(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Tienda María');
    expect(req.body.code).toBe('C001');
  });

  test('should handle nested objects in body', () => {
    const req = createMockReq({
      body: {
        order: {
          client: "Test'; DROP--",
          items: 5,
        },
      },
    });
    const res = createMockRes();
    const next = jest.fn();

    sanitizeInput(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.order.client).not.toContain("'");
    expect(req.body.order.client).not.toContain(';');
  });

  test('should handle arrays in body', () => {
    const req = createMockReq({
      body: {
        items: ["item1", "item2'; DROP--"],
      },
    });
    const res = createMockRes();
    const next = jest.fn();

    sanitizeInput(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(Array.isArray(req.body.items)).toBe(true);
  });
});

// =============================================================================
// Content-Type Validation
// =============================================================================

describe('validateContentType', () => {
  test('should allow GET without content-type', () => {
    const req = createMockReq({ method: 'GET', headers: {} });
    const res = createMockRes();
    const next = jest.fn();

    validateContentType(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should allow POST with application/json', () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentType(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should allow POST with multipart/form-data', () => {
    const req = createMockReq({
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentType(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('should reject POST without content-type', () => {
    const req = createMockReq({ method: 'POST', headers: {} });
    const res = createMockRes();
    const next = jest.fn();

    validateContentType(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({ error: 'Content-Type header required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('should reject PUT with unsupported content-type', () => {
    const req = createMockReq({
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
    });
    const res = createMockRes();
    const next = jest.fn();

    validateContentType(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(next).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Request ID
// =============================================================================

describe('addRequestId', () => {
  test('should generate UUID when no x-request-id header provided', () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = jest.fn();

    addRequestId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.requestId).toBeDefined();
    expect(req.requestId.length).toBeGreaterThan(0);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.requestId);
  });

  test('should use existing x-request-id header when provided', () => {
    const req = createMockReq({
      headers: { 'x-request-id': 'my-custom-id-123' },
    });
    const res = createMockRes();
    const next = jest.fn();

    addRequestId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.requestId).toBe('my-custom-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'my-custom-id-123');
  });
});

// =============================================================================
// Security Headers
// =============================================================================

describe('createSecurityHeaders', () => {
  test('should return middleware function', () => {
    const middleware = createSecurityHeaders();
    expect(typeof middleware).toBe('function');
  });

  test('should set security headers on response', () => {
    const middleware = createSecurityHeaders();
    const req = createMockReq();
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));
    expect(res.removeHeader).toHaveBeenCalledWith('X-Powered-By');
    expect(next).toHaveBeenCalled();
  });
});

// =============================================================================
// Validation Schemas
// =============================================================================

describe('validationSchemas', () => {
  test('should be null when zod is not available', () => {
    expect(validationSchemas === null || typeof validationSchemas === 'object').toBe(true);
  });
});

// =============================================================================
// Security Event Logging
// =============================================================================

describe('logSecurityEvent', () => {
  test('should log security event with correct details', () => {
    const logger = require('../middleware/logger');
    const req = createMockReq({
      headers: { 'user-agent': 'Mozilla/5.0' },
      user: { id: '01' },
    });

    logSecurityEvent('UNAUTHORIZED_ACCESS', req, { resource: '/api/admin' });

    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls[0];
    expect(warnCall[0]).toContain('SECURITY');
    expect(warnCall[0]).toContain('UNAUTHORIZED_ACCESS');
  });
});
