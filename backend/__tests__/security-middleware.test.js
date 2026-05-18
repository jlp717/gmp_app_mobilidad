/**
 * Security Middleware - Unit Tests
 * ==================================
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
    logSecurityEvent,
} = require('../middleware/security');

beforeEach(() => {
    jest.clearAllMocks();
});

function createMockReq(overrides = {}) {
    const headers = {...overrides.headers};
    const req = {
        ip: '192.168.1.1',
        method: 'GET',
        path: '/api/test',
        headers,
        body: overrides.body || {},
        query: overrides.query || {},
        get: (name) => headers[name.toLowerCase()] || headers[name] || '',
        ...overrides,
    };
    return req;
}

function createMockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    res.header = jest.fn().mockReturnValue(res);
    return res;
}

// =============================================================================
// SUSPICIOUS USER-AGENT DETECTION
// =============================================================================

describe('detectSuspiciousAgents', () => {
    test('should allow normal browser user-agent', () => {
        const req = createMockReq({ headers: {'user-agent': 'Mozilla/5.0 Chrome/120.0' }});
        const res = createMockRes();
        const next = jest.fn();
        detectSuspiciousAgents(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('should allow Flutter app user-agent', () => {
        const req = createMockReq({ headers: {'user-agent': 'GMP-App/1.0 Dart/3.0' }});
        const res = createMockRes();
        const next = jest.fn();
        detectSuspiciousAgents(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('should block sqlmap user-agent', () => {
        const req = createMockReq({ headers: {'user-agent': 'sqlmap/1.0' }});
        const res = createMockRes();
        const next = jest.fn();
        detectSuspiciousAgents(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should block nikto user-agent', () => {
        const req = createMockReq({ headers: {'user-agent': 'nikto/2.1' }});
        const res = createMockRes();
        const next = jest.fn();
        detectSuspiciousAgents(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

// =============================================================================
// CONTENT-LENGTH VALIDATION
// =============================================================================

describe('validateContentLength', () => {
    test('should allow GET without content-length', () => {
        const req = createMockReq({ method: 'GET' });
        const res = createMockRes();
        const next = jest.fn();
        validateContentLength(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('should allow POST with valid content-length', () => {
        const req = createMockReq({ method: 'POST', headers: {'content-length': '1000'} });
        const res = createMockRes();
        const next = jest.fn();
        validateContentLength(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('should reject POST with oversized content', () => {
        const req = createMockReq({ method: 'POST', headers: {'content-length': '99999999'} });
        const res = createMockRes();
        const next = jest.fn();
        validateContentLength(req, res, next);
        expect(res.status).toHaveBeenCalledWith(413);
    });
});

// =============================================================================
// RATE LIMITER CONFIGURATION
// =============================================================================

describe('Rate Limiter Configuration', () => {
    test('globalLimiter should be defined', () => {
        expect(globalLimiter).toBeDefined();
        expect(typeof globalLimiter).toBe('function');
    });

    test('loginLimiter should be defined', () => {
        expect(loginLimiter).toBeDefined();
    });
});

// =============================================================================
// SQL INJECTION DETECTION
// =============================================================================

describe('detectSqlInjection', () => {
    test('should allow safe query parameters', () => {
        const req = createMockReq({ query: { search: 'client' } });
        const res = createMockRes();
        const next = jest.fn();
        detectSqlInjection(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('should block DROP in query parameter', () => {
        const req = createMockReq({ query: { search: 'DROP TABLE' } });
        const res = createMockRes();
        const next = jest.fn();
        detectSqlInjection(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});

// =============================================================================
// INPUT SANITIZATION
// =============================================================================

describe('sanitizeInput', () => {
    test('should sanitize dangerous characters', () => {
        const req = createMockReq({
            body: { name: "Test<script>alert(1)</script>" }
        });
        const res = createMockRes();
        const next = jest.fn();
        sanitizeInput(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});

// =============================================================================
// VALIDATE CONTENT TYPE
// =============================================================================

describe('validateContentType', () => {
    test('should allow application/json', () => {
        const req = createMockReq({
            method: 'POST',
            headers: {'content-type': 'application/json'}
        });
        const res = createMockRes();
        const next = jest.fn();
        validateContentType(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});

// =============================================================================
// REQUEST ID
// =============================================================================

describe('addRequestId', () => {
    test('should generate UUID when no x-request-id', () => {
        const req = createMockReq();
        const res = createMockRes();
        const next = jest.fn();
        addRequestId(req, res, next);
        expect(req.requestId).toBeDefined();
    });
});

// =============================================================================
// SECURITY HEADERS
// =============================================================================

describe('createSecurityHeaders', () => {
    test('should return middleware function', () => {
        const middleware = createSecurityHeaders();
        expect(typeof middleware).toBe('function');
    });
});