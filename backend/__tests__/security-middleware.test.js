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
    detectScannerProbes,
    bruteForceIpTracker,
    rateLimitPeerIp,
    globalRateLimitKey,
    RedisRateLimitStore,
    createRateLimiter,
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

    test('rate-limit identity ignores a forged X-Forwarded-For header', () => {
        const req = createMockReq({
            ip: '127.0.0.1',
            headers: {
                'x-forwarded-for': '127.0.0.1',
                'x-real-ip': '127.0.0.1',
                'user-agent': 'attacker-controlled-a',
            },
            socket: { remoteAddress: '203.0.113.10' },
            connection: { remoteAddress: '203.0.113.10' },
        });

        expect(rateLimitPeerIp(req)).toBe('203.0.113.10');
    });

    test('global bucket cannot be multiplied with forged IP headers or User-Agent', () => {
        const first = createMockReq({
            ip: '127.0.0.1',
            headers: { 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '10.0.0.2', 'user-agent': 'agent-a' },
            socket: { remoteAddress: '203.0.113.11' },
        });
        const second = createMockReq({
            ip: '10.9.8.7',
            headers: { 'x-forwarded-for': '10.0.0.3', 'x-real-ip': '10.0.0.4', 'user-agent': 'agent-b' },
            socket: { remoteAddress: '::ffff:203.0.113.11' },
        });

        expect(globalRateLimitKey(first)).toBe('203.0.113.11');
        expect(globalRateLimitKey(second)).toBe(globalRateLimitKey(first));
    });

    test('two workers share one atomic Redis counter operation per hit', async () => {
        const values = new Map();
        const client = {
            eval: jest.fn(async (script, options) => {
                const key = options.keys[0];
                const windowMs = Number(options.arguments[0]);
                const previous = values.get(key);
                const entry = {
                    total: (previous?.total || 0) + 1,
                    expiresAt: previous?.expiresAt || Date.now() + windowMs,
                };
                values.set(key, entry);
                expect(script).toContain("redis.call('INCR', KEYS[1])");
                expect(script).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[1])");
                return [entry.total, Math.max(0, entry.expiresAt - Date.now())];
            }),
        };
        const workerOne = new RedisRateLimitStore('global', { requireRedis: true, getClient: () => client });
        const workerTwo = new RedisRateLimitStore('global', { requireRedis: true, getClient: () => client });
        workerOne.init({ windowMs: 60_000 });
        workerTwo.init({ windowMs: 60_000 });

        expect((await workerOne.increment('203.0.113.10')).totalHits).toBe(1);
        expect((await workerTwo.increment('203.0.113.10')).totalHits).toBe(2);
        expect(client.eval).toHaveBeenCalledTimes(2);
        expect(Object.keys(client)).toEqual(['eval']);
    });

    test('required Redis outage returns 503 without reaching the handler', async () => {
        const store = new RedisRateLimitStore('global', { requireRedis: true, getClient: () => null });
        expect(store.fallback).toBeNull();
        const limiter = createRateLimiter({
            prefix: 'global', windowMs: 60_000, max: 10,
            keyGenerator: rateLimitPeerIp, standardHeaders: false, legacyHeaders: false,
        }, { store });
        const req = createMockReq({ socket: { remoteAddress: '203.0.113.10' } });
        const res = createMockRes();
        const next = jest.fn();

        await limiter(req, res, next);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMIT_UNAVAILABLE' }));
        expect(next).not.toHaveBeenCalled();
    });

    test('health skip runs before required Redis availability check', async () => {
        const store = new RedisRateLimitStore('global', { requireRedis: true, getClient: () => null });
        const limiter = createRateLimiter({
            prefix: 'global', windowMs: 60_000, max: 10,
            keyGenerator: rateLimitPeerIp, standardHeaders: false, legacyHeaders: false,
            skip: (req) => req.path === '/api/health',
        }, { store });
        const req = createMockReq({ path: '/api/health', socket: { remoteAddress: '203.0.113.12' } });
        const res = createMockRes();
        const next = jest.fn();

        await limiter(req, res, next);
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('Redis EVAL failure remains fail-closed with one store call', async () => {
        const client = { eval: jest.fn().mockRejectedValue(new Error('unavailable')) };
        const store = new RedisRateLimitStore('global', { requireRedis: true, getClient: () => client });
        const limiter = createRateLimiter({
            prefix: 'global', windowMs: 60_000, max: 10,
            keyGenerator: rateLimitPeerIp, standardHeaders: false, legacyHeaders: false,
        }, { store });
        const res = createMockRes();
        const next = jest.fn();

        await limiter(createMockReq({ socket: { remoteAddress: '203.0.113.13' } }), res, next);
        expect(client.eval).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });

    test.each([
        ['upload', uploadLimiter, 10],
        ['email', emailLimiter, 5],
    ])('%s limiter uses one peer bucket despite forged request identity', async (_name, limiter, max) => {
        for (let index = 0; index <= max; index += 1) {
            const req = createMockReq({
                ip: `10.0.0.${index + 1}`,
                headers: {
                    'x-forwarded-for': `192.0.2.${index + 1}`,
                    'x-real-ip': `198.51.100.${index + 1}`,
                    'user-agent': `forged-${index}`,
                },
                socket: { remoteAddress: `203.0.113.${_name === 'upload' ? 20 : 21}` },
            });
            const res = createMockRes();
            const next = jest.fn();
            await limiter(req, res, next);
            if (index < max) expect(next).toHaveBeenCalledWith();
            else expect(res.status).toHaveBeenCalledWith(429);
        }
    });

    test('test/development store permits its isolated memory fallback', async () => {
        const store = new RedisRateLimitStore('global', { requireRedis: false, getClient: () => null });
        store.init({ windowMs: 60_000 });
        expect((await store.increment('203.0.113.10')).totalHits).toBe(1);
    });
});

describe('peer-bound abuse trackers', () => {
    test('scanner tracker ignores forged request IP fields', () => {
        const logger = require('../middleware/logger');
        const first = createMockReq({
            path: '/wp-admin',
            ip: '127.0.0.1',
            headers: { 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '10.0.0.2' },
            socket: { remoteAddress: '203.0.113.30' },
        });
        const second = createMockReq({
            path: '/.env',
            ip: '10.9.8.7',
            headers: { 'x-forwarded-for': '10.0.0.3', 'x-real-ip': '10.0.0.4' },
            socket: { remoteAddress: '::ffff:203.0.113.30' },
        });

        detectScannerProbes(first, createMockRes(), jest.fn());
        detectScannerProbes(second, createMockRes(), jest.fn());
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    test('brute-force tracker aggregates forged identities by peer socket', () => {
        let lastRes;
        for (let index = 0; index < 9; index += 1) {
            lastRes = createMockRes();
            bruteForceIpTracker(createMockReq({
                method: 'POST',
                ip: `10.0.1.${index + 1}`,
                headers: { 'x-forwarded-for': `192.0.2.${index + 1}`, 'x-real-ip': `198.51.100.${index + 1}` },
                body: { username: `synthetic-${index}` },
                socket: { remoteAddress: '203.0.113.31' },
            }), lastRes, jest.fn());
        }
        expect(lastRes.status).toHaveBeenCalledWith(429);
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
