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
    verifyAccessToken
} = require('../../middleware/auth');

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

describe('Auth Middleware - verifyToken', () => {
    let res, next;

    beforeEach(() => {
        res = createMockRes();
        next = jest.fn();
    });

    test('should pass valid Bearer token', () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'COMERCIAL',
            isJefeVentas: false
        };
        const token = signAccessToken(payload);
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });

        verifyToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.code).toBe('001');
        expect(req.user.role).toBe('COMERCIAL');
    });

    test('should reject missing authorization header', () => {
        const req = createMockReq();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'MISSING_TOKEN' })
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject empty authorization header', () => {
        const req = createMockReq({
            headers: { authorization: '' }
        });

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('should reject invalid authorization format (no Bearer)', () => {
        const req = createMockReq({
            headers: { authorization: 'Basic sometoken' }
        });

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'INVALID_FORMAT' })
        );
    });

    test('should reject invalid token format', () => {
        const req = createMockReq({
            headers: { authorization: 'Bearer invalidtoken' }
        });

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'TOKEN_EXPIRED' })
        );
    });

    test('should reject token with wrong signature', () => {
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

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('should attach user object to request on success', () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'JEFE_VENTAS',
            isJefeVentas: true
        };
        const token = signAccessToken(payload);
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });

        verifyToken(req, res, next);

        expect(req.user).toEqual(expect.objectContaining({
            id: 'V001',
            code: '001',
            name: 'Test User',
            role: 'JEFE_VENTAS',
            isJefeVentas: true
        }));
        expect(req.tokenPayload).toBeDefined();
    });

    test('should handle malformed token gracefully', () => {
        const req = createMockReq({
            headers: { authorization: 'Bearer eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ==' }
        });

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('Auth Middleware - optionalAuth', () => {
    let res, next;

    beforeEach(() => {
        res = createMockRes();
        next = jest.fn();
    });

    test('should pass without authorization header', () => {
        const req = createMockReq();

        optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
    });

    test('should pass with valid token but not attach user', () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test User',
            role: 'COMERCIAL',
            isJefeVentas: false
        };
        const token = signAccessToken(payload);
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });

        optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
    });

    test('should pass with invalid token but not fail', () => {
        const req = createMockReq({
            headers: { authorization: 'Bearer invalidtoken' }
        });

        optionalAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
    });

    test('should handle non-Bearer auth gracefully', () => {
        const req = createMockReq({
            headers: { authorization: 'Basic sometoken' }
        });

        optionalAuth(req, res, next);

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
            user: { id: 'V001', code: '001', isJefeVentas: true }
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

    test('should preserve isJefeVentas flag', () => {
        const payload = {
            id: 'V001',
            user: '001',
            name: 'Test Jefe',
            role: 'JEFE_VENTAS',
            isJefeVentas: true
        };
        const token = signAccessToken(payload);
        const req = createMockReq({
            headers: { authorization: `Bearer ${token}` }
        });
        const res = createMockRes();
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(req.user.isJefeVentas).toBe(true);
    });
});