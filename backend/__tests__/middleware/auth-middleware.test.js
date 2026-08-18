/**
 * Auth Middleware - Unit Tests
 * ============================
 * Tests for verifyToken, optionalAuth, requireRoles, requireJefeVentas
 */

'use strict';

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

const {
    verifyToken,
    optionalAuth,
    requireRoles,
    requireJefeVentas,
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    registerSession,
    invalidateAllSessions,
    ACCESS_TTL_MS,
} = require('../../middleware/auth');
const logger = require('../../middleware/logger');
const { AUTH_CLAIMS_VERSION } = require('../../src/modules/auth/application/auth-claims-resolver');

let sessionSequence = 0;

async function canonicalAccessToken(payload, label = 'session') {
    sessionSequence += 1;
    const subject = payload.id;
    const sid = `sid-${label}-${sessionSequence}`;
    const accessJti = `access-${label}-${sessionSequence}`;
    const refreshJti = `refresh-${label}-${sessionSequence}`;
    const claims = { claimsVersion: AUTH_CLAIMS_VERSION, ...payload, sub: subject, sid };
    const refreshToken = signRefreshToken({ ...claims, jti: refreshJti });
    await registerSession(subject, refreshToken, 'jest', '127.0.0.1', {
        sid,
        accessJti,
        refreshJti,
    });
    return signAccessToken({ ...claims, jti: accessJti });
}

function createMockReq(overrides = {}) {
    const headers = { ...overrides.headers };
    return {
        method: 'GET',
        path: '/api/test',
        headers,
        body: overrides.body || {},
        query: overrides.query || {},
        user: null,
        tokenPayload: null,
        ip: '127.0.0.1',
        get: (name) => headers[name.toLowerCase()] || '',
        ...overrides,
    };
}

function createMockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(async () => {
    await invalidateAllSessions('V001');
});

describe('Auth Middleware - verifyToken', () => {
    let res, next;

    beforeEach(() => {
        res = createMockRes();
        next = jest.fn();
    });

    test('should pass valid Bearer token', async () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'COMERCIAL',
            isJefeVentas: false
        };
        const token = await canonicalAccessToken(payload, 'valid');
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });

        await verifyToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.code).toBe('001');
        expect(req.user.role).toBe('COMERCIAL');
        expect(req.user.claimsVersion).toBe(4);
    });

    test('should reject a stale v2 token and require login without calling next', async () => {
        const token = await canonicalAccessToken({
            id: 'V001', user: '001', name: 'Stale User', role: 'COMERCIAL', claimsVersion: 2,
        }, 'stale-v2');
        const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'AUTH_RELOGIN_REQUIRED',
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject missing authorization header', async () => {
        const req = createMockReq();

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'MISSING_TOKEN' })
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject empty authorization header', async () => {
        const req = createMockReq({
            headers: { authorization: '' }
        });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should reject invalid authorization format (no Bearer)', async () => {
        const req = createMockReq({
            headers: { authorization: 'Basic sometoken' }
        });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INVALID_FORMAT' })
        );
    });

    test('should reject invalid token format', async () => {
        const req = createMockReq({
            headers: { authorization: 'Bearer invalidtoken' }
        });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'TOKEN_EXPIRED' })
        );
    });

    test('should reject token with wrong signature', async () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'COMERCIAL',
            isJefeVentas: false,
            timestamp: Date.now()
        };
        
        const token = signAccessToken(payload);
        const tamperedToken = token.slice(0, -10) + 'XXXXXXXXXX';
        const req = createMockReq({
            headers: { authorization: `Bearer ${tamperedToken}` }
        });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject expired tokens without logging token claims or raw data', () => {
        const syntheticUser = ['synthetic', 'operator', '987'].join('-');
        const token = signAccessToken({
            id: 'V987',
            user: syntheticUser,
            sub: syntheticUser,
            role: 'COMERCIAL',
        });
        const issuedAt = Date.now();
        logger.warn.mockClear();

        const clock = jest
            .spyOn(Date, 'now')
            .mockReturnValue(issuedAt + ACCESS_TTL_MS + 1);
        try {
            expect(verifyAccessToken(token)).toBeNull();
        } finally {
            clock.mockRestore();
        }

        const warning = logger.warn.mock.calls.flat().join(' ');
        expect(warning).toBe('AUTH_TOKEN_REJECTED_EXPIRED');
        expect(warning).not.toContain(syntheticUser);
        expect(warning).not.toContain(token);
        expect(warning).not.toMatch(/\b(?:user|sub|age|ttl|token)=/i);
    });

    test('should attach user object to request on success', async () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'JEFE_VENTAS',
            isJefeVentas: true
        };
        const token = await canonicalAccessToken(payload, 'projection');
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });

        await verifyToken(req, res, next);

        expect(req.user).toEqual(expect.objectContaining({
            id: 'V001',
            code: '001',
            name: 'Test User',
            role: 'JEFE_VENTAS',
            isJefeVentas: true
        }));
        expect(req.tokenPayload).toBeDefined();
    });

    test('should preserve ADMIN supervisor claims in a valid token', async () => {
        const token = await canonicalAccessToken({
            id: 'VA17',
            user: 'A17',
            name: 'Admin Supervisor',
            role: 'ADMIN',
            activeMode: 'REPARTIDOR',
            availableRoles: ['COMERCIAL', 'ADMIN', 'JEFE_VENTAS'],
            isJefeVentas: true,
            isRepartidor: false,
            codigoConductor: null,
            matricula: null,
        }, 'admin-supervisor');
        const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

        await verifyToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual(expect.objectContaining({
            code: 'A17',
            role: 'ADMIN',
            activeMode: 'REPARTIDOR',
            isJefeVentas: true,
            isRepartidor: false,
            codigoConductor: null,
            matricula: null,
        }));
    });

    test('should handle malformed token gracefully', async () => {
        const req = createMockReq({
            headers: { authorization: 'Bearer eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ==' }
        });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should reject a signed legacy token without sid/sub/jti instead of falling back', async () => {
        const token = signAccessToken({
            id: 'V001', user: '001', name: 'Legacy', role: 'COMERCIAL',
        });
        const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

        await verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'AUTH_RELOGIN_REQUIRED',
        }));
        expect(next).not.toHaveBeenCalled();
    });
});

describe('Auth Middleware - optionalAuth', () => {
    let res, next;

    beforeEach(() => {
        res = createMockRes();
        next = jest.fn();
    });

    test('should pass without authorization header', async () => {
        const req = createMockReq();

        await optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
    });

    test('should pass with valid token and attach canonical user', async () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'COMERCIAL',
            isJefeVentas: false
        };
        const token = await canonicalAccessToken(payload, 'optional');
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });

        await optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
    });

    test('should pass with invalid token but not fail', async () => {
        const req = createMockReq({
            headers: { authorization: 'Bearer invalidtoken' }
        });

        await optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
    });

    test('should ignore a stale v2 token', async () => {
        const token = await canonicalAccessToken({
            id: 'V001', user: '001', name: 'Stale Optional', role: 'COMERCIAL', claimsVersion: 2,
        }, 'optional-stale-v2');
        const req = createMockReq({ headers: { authorization: `Bearer ${token}` } });

        await optionalAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toBeNull();
        expect(req.tokenPayload).toBeNull();
    });

    test('should handle non-Bearer auth gracefully', async () => {
        const req = createMockReq({
            headers: { authorization: 'Basic sometoken' }
        });

        await optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
    });
});

describe('Auth Middleware - requireRoles', () => {
    let res, next;

    beforeEach(() => {
        res = createMockRes();
        next = jest.fn();
    });

    test('should pass when user has required role', () => {
        const middleware = requireRoles('COMERCIAL');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'COMERCIAL' }
        });

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should pass when user has one of multiple allowed roles', () => {
        const middleware = requireRoles('COMERCIAL', 'JEFE_VENTAS');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'JEFE_VENTAS' }
        });

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should allow ADMIN when ADMIN is required', () => {
        const middleware = requireRoles('ADMIN');
        const req = createMockReq({
            user: { id: 'VA17', code: 'A17', role: 'ADMIN', isJefeVentas: true }
        });

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('should reject when user lacks required role', () => {
        const middleware = requireRoles('JEFE_VENTAS');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'COMERCIAL' }
        });

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INSUFFICIENT_ROLE' })
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject when user is not authenticated', () => {
        const middleware = requireRoles('COMERCIAL');
        const req = createMockReq({
            user: null
        });

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'MISSING_TOKEN' })
        );
    });

    test('should reject when user object has no role', () => {
        const middleware = requireRoles('COMERCIAL');
        const req = createMockReq({
            user: { id: 'V001', code: '001' }
        });

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should allow ALMACEN role for warehouse access', () => {
        const middleware = requireRoles('ALMACEN');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'ALMACEN' }
        });

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should allow REPARTIDOR role for delivery access', () => {
        const middleware = requireRoles('REPARTIDOR');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'REPARTIDOR' }
        });

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});

describe('Auth Middleware - requireJefeVentas', () => {
    let res, next;

    beforeEach(() => {
        res = createMockRes();
        next = jest.fn();
    });

    test('should pass when user is Jefe Ventas', () => {
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'JEFE_VENTAS', isJefeVentas: true }
        });

        requireJefeVentas(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should reject when user is not Jefe Ventas', () => {
        const req = createMockReq({
            user: { id: 'V001', code: '001', isJefeVentas: false }
        });

        requireJefeVentas(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INSUFFICIENT_ROLE' })
        );
    });

    test('should reject when user is undefined', () => {
        const req = createMockReq({
            user: undefined
        });

        requireJefeVentas(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should reject when user is null', () => {
        const req = createMockReq({
            user: null
        });

        requireJefeVentas(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should reject when isJefeVentas is missing', () => {
        const req = createMockReq({
            user: { id: 'V001', code: '001' }
        });

        requireJefeVentas(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe('Auth Middleware - Role-based Access Control', () => {
    test('should define role hierarchy correctly', () => {
        const roles = ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR', 'ALMACEN'];

        expect(roles).toContain('JEFE_VENTAS');
        expect(roles).toContain('COMERCIAL');
        expect(roles).toContain('REPARTIDOR');
        expect(roles).toContain('ALMACEN');
    });

    test('should allow JEFE_VENTAS to access COMERCIAL routes', () => {
        const middleware = requireRoles('COMERCIAL', 'JEFE_VENTAS');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'JEFE_VENTAS', isJefeVentas: true }
        });
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should allow JEFE_VENTAS to access all routes', () => {
        const middleware = requireRoles('COMERCIAL', 'REPARTIDOR', 'ALMACEN', 'JEFE_VENTAS');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'JEFE_VENTAS', isJefeVentas: true }
        });
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should not allow COMERCIAL to access JEFE_VENTAS only routes', () => {
        const middleware = requireRoles('JEFE_VENTAS');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'COMERCIAL', isJefeVentas: false }
        });
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('should not allow REPARTIDOR to access JEFE_VENTAS only routes', () => {
        const middleware = requireRoles('JEFE_VENTAS');
        const req = createMockReq({
            user: { id: 'V050', code: '050', role: 'REPARTIDOR', isJefeVentas: false }
        });
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('should not allow ALMACEN to access REPARTIDOR routes', () => {
        const middleware = requireRoles('REPARTIDOR');
        const req = createMockReq({
            user: { id: 'V001', code: '001', role: 'ALMACEN', isJefeVentas: false }
        });
        const res = createMockRes();
        const next = jest.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('Token Payload Preservation', () => {
    test('should preserve user name in token payload', () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Juan Perez',
            role: 'COMERCIAL',
            isJefeVentas: false
        };
        const token = signAccessToken(payload);
        const decoded = verifyAccessToken(token);

        expect(decoded.name).toBe('Juan Perez');
    });

    test('signed inconsistent REPARTIDOR boolean is projected without jefe privilege', async () => {
        const token = await canonicalAccessToken({
            id: 'V001', user: '001', name: 'Driver',
            role: 'REPARTIDOR', isJefeVentas: true, isRepartidor: true,
        }, 'inconsistent-repartidor');
        const req = createMockReq({ headers: { authorization: 'Bearer ' + token } });
        const res = createMockRes();
        const next = jest.fn();
        await verifyToken(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject({ role: 'REPARTIDOR', isJefeVentas: false });
    });

    test('should preserve isJefeVentas flag', async () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test Jefe',
            role: 'JEFE_VENTAS',
            isJefeVentas: true
        };
        const token = await canonicalAccessToken(payload, 'jefe');
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });
        const res = createMockRes();
        const next = jest.fn();

        await verifyToken(req, res, next);

        expect(req.user.isJefeVentas).toBe(true);
    });
});
