/**
 * Authentication Flow - Integration Tests
 * ======================================
 * Tests for complete auth flows: login, refresh, logout, token handling
 */

'use strict';

const mockAuthRepository = {
    findByCode: jest.fn(),
    findRepartidorAssociation: jest.fn(),
    getVendorVisibilityScope: jest.fn(),
    logLoginAttempt: jest.fn(),
};

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../middleware/audit', () => ({
    auditLogin: jest.fn(),
    getClientIP: jest.fn(() => '127.0.0.1')
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => '{}'),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn()
}));

jest.mock('bcrypt', () => ({
    hash: jest.fn(() => Promise.resolve('$2b$12$hashed')),
    compare: jest.fn((password, hash) => Promise.resolve(password === hash))
}));

// Keep this route-level suite on the repository contract. Importing the real
// infrastructure index would load the native ODBC binding before tests run.
jest.mock('../src/modules/auth', () => ({
    Db2AuthRepository: jest.fn(() => mockAuthRepository),
}));

const request = require('supertest');
const express = require('express');

const {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    handleRefreshToken,
    handleLogout,
    invalidateAllSessions,
    registerSession,
    setAuthClaimsResolver,
} = require('../middleware/auth');
const { AUTH_CLAIMS_VERSION } = require('../src/modules/auth/application/auth-claims-resolver');

const authRoutes = require('../routes/auth');

describe('Auth Flow Tests', () => {
    let app;

    function profile(overrides = {}) {
        return {
            code: '001',
            name: 'Test Vendor',
            isActive: true,
            isJefeVentas: false,
            tipoVendedor: 'COMERCIAL',
            showCommissions: true,
            _passwordHash: '1234',
            ...overrides,
        };
    }

    function claims(overrides = {}) {
        const code = overrides.user || overrides.code || '001';
        const role = overrides.role || 'COMERCIAL';
        return {
            id: `V${code}`,
            user: code,
            name: 'Test User',
            role,
            availableRoles: role === 'JEFE_VENTAS' ? ['COMERCIAL', 'JEFE_VENTAS'] : ['COMERCIAL'],
            isJefeVentas: role === 'JEFE_VENTAS',
            isRepartidor: role === 'REPARTIDOR',
            codigoConductor: role === 'REPARTIDOR' ? code : null,
            matricula: role === 'REPARTIDOR' ? '1234ABC' : null,
            vendorCodes: [code],
            vendedorCodes: [code],
            tipoVendedor: 'COMERCIAL',
            showCommissions: true,
            claimsVersion: AUTH_CLAIMS_VERSION,
            ...overrides,
        };
    }

    async function canonicalSession(payload, suffix) {
        const sid = `sid-${suffix}`;
        const accessJti = `access-${suffix}`;
        const refreshJti = `refresh-${suffix}`;
        const tokenClaims = { ...payload, sub: payload.id, sid };
        const refreshToken = signRefreshToken({ ...tokenClaims, jti: refreshJti });
        const accessToken = signAccessToken({ ...tokenClaims, jti: accessJti });
        await registerSession(payload.id, refreshToken, 'jest-agent', '127.0.0.1', {
            sid,
            accessJti,
            refreshJti,
        });
        return { sid, accessJti, refreshJti, accessToken, refreshToken };
    }

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/auth', authRoutes);
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        const { query, queryWithParams } = require('../config/db');
        query.mockReset().mockResolvedValue([]);
        queryWithParams.mockReset().mockResolvedValue([]);
        await invalidateAllSessions('V001');
        await invalidateAllSessions('V002');
        await invalidateAllSessions('V050');
        await invalidateAllSessions('test-user');
        mockAuthRepository.findByCode.mockResolvedValue(profile());
        mockAuthRepository.findRepartidorAssociation.mockResolvedValue(null);
        mockAuthRepository.getVendorVisibilityScope.mockImplementation(async (code) => [code]);
        mockAuthRepository.logLoginAttempt.mockResolvedValue({ ok: true });
        setAuthClaimsResolver({
            resolve: jest.fn(async ({ code }) => claims({ user: code, id: `V${code}` })),
        });
    });

    describe('Login Success', () => {
        test('should return tokens on valid credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '001', password: '1234' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('refreshToken');
            expect(res.body).toHaveProperty('user');
            expect(res.body.user).toHaveProperty('code', '001');
            expect(res.body.user).toHaveProperty('role', 'COMERCIAL');
        });

        test('should include vendor codes for JEFE_VENTAS', async () => {
            mockAuthRepository.findByCode.mockResolvedValue(profile({ isJefeVentas: true }));
            mockAuthRepository.getVendorVisibilityScope.mockResolvedValue(['001', '002', '003']);

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '001', password: '1234' });

            expect(res.status).toBe(200);
            expect(res.body.user.role).toBe('JEFE_VENTAS');
            expect(res.body.vendedorCodes).toBeDefined();
            expect(Array.isArray(res.body.vendedorCodes)).toBe(true);
        });

        test('should keep COMERCIAL default when a DB reparto association exists', async () => {
            mockAuthRepository.findByCode.mockResolvedValue(profile({
                code: '050', name: 'Repartidor', _passwordHash: '5678',
            }));
            mockAuthRepository.findRepartidorAssociation.mockResolvedValue({
                isRepartidor: true, codigoConductor: '050', matricula: '1234ABC',
            });

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '050', password: '5678' });

            expect(res.status).toBe(200);
            expect(res.body.user.role).toBe('COMERCIAL');
            expect(res.body.user.isRepartidor).toBe(false);
            expect(res.body.user.availableRoles).toEqual(['COMERCIAL', 'REPARTIDOR']);
            expect(res.body.user.availableModes).toEqual(['COMERCIAL', 'REPARTIDOR']);
        });
    });

    describe('Login Failure', () => {
        test('should reject invalid credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '001', password: ['invalid', 'credential'].join('-') });

            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('code', 'INVALID_CREDENTIALS');
        });

        test('should reject non-existent user', async () => {
            mockAuthRepository.findByCode.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: 'NONEXISTENT', password: '1234' });

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('INVALID_CREDENTIALS');
        });

        test('should reject missing credentials', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('MISSING_CREDENTIALS');
        });

        test('should reject empty username', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '', password: '1234' });

            expect(res.status).toBe(400);
        });

        test('should reject empty password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '001', password: '' });

            expect(res.status).toBe(400);
        });
    });

    describe('Token Refresh Success', () => {
        test('should rotate refresh tokens', async () => {
            const payload = claims();
            const { refreshToken: oldRefreshToken, sid } = await canonicalSession(payload, 'rotate');

            const req1 = {
                body: { refreshToken: oldRefreshToken },
                ip: '127.0.0.1',
                get: jest.fn(() => 'test-agent')
            };
            const res1 = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            await handleRefreshToken(req1, res1);

            expect(res1.status).not.toHaveBeenCalled();
            const result = res1.json.mock.calls[0][0];
            expect(result.success).toBe(true);
            expect(result.refreshToken).not.toBe(oldRefreshToken);
            expect(verifyRefreshToken(result.refreshToken)).toEqual(expect.objectContaining({
                sid,
                sub: 'V001',
                jti: expect.any(String),
            }));
        });

        test('should invalidate old token after rotation', async () => {
            const payload = claims({ id: 'V002', user: '002', name: 'Test User 2' });
            setAuthClaimsResolver({ resolve: jest.fn(async () => payload) });
            const { refreshToken: firstToken } = await canonicalSession(payload, 'old-token');
            
            const req1 = {
                body: { refreshToken: firstToken },
                ip: '127.0.0.1',
                get: jest.fn(() => 'test-agent')
            };
            const res1 = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            await handleRefreshToken(req1, res1);

            const firstResult = res1.json.mock.calls[0][0];
            expect(firstResult.success).toBe(true);

            const req2 = {
                body: { refreshToken: firstToken },
                ip: '127.0.0.1',
                get: jest.fn(() => 'test-agent')
            };
            const res2 = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            await handleRefreshToken(req2, res2);

            expect(res2.status).toHaveBeenCalledWith(401);
            expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_REVOKED' }));
        });
    });

    describe('Token Refresh Failure', () => {
        test('should reject invalid refresh token format', async () => {
            const req = {
                body: { refreshToken: 'not.a.valid.format' },
                ip: '127.0.0.1',
                get: jest.fn(() => 'test-agent')
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };

            await handleRefreshToken(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('should reject missing refresh token', async () => {
            const req = {
                body: {},
                ip: '127.0.0.1',
                get: jest.fn(() => 'test-agent')
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };

            await handleRefreshToken(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            const calledWith = res.json.mock.calls[0][0];
            expect(calledWith.code).toBe('MISSING_REFRESH_TOKEN');
        });

        test('should reject revoked refresh token', async () => {
            const payload = claims();
            const { refreshToken } = await canonicalSession(payload, 'revoked');
            await invalidateAllSessions('V001');

            const req = {
                body: { refreshToken },
                ip: '127.0.0.1',
                get: jest.fn(() => 'test-agent')
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };

            await handleRefreshToken(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            const calledWith = res.json.mock.calls[0][0];
            expect(calledWith.code).toBe('SESSION_REVOKED');
        });
    });

    describe('Logout Success', () => {
        test('should invalidate session on logout', async () => {
            const payload = claims();
            const session = await canonicalSession(payload, 'logout');

            const req = {
                user: { id: 'V001', code: '001' },
                tokenPayload: { sid: session.sid, sub: 'V001', jti: session.accessJti },
                body: {}
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };

            await handleLogout(req, res);

            expect(res.json).toHaveBeenCalled();
            const calledWith = res.json.mock.calls[0][0];
            expect(calledWith).toHaveProperty('success', true);

            const protectedReq = {
                headers: { authorization: `Bearer ${session.accessToken}` },
                method: 'GET', path: '/protected', ip: '127.0.0.1',
            };
            const protectedRes = {
                status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(),
            };
            const next = jest.fn();
            const { verifyToken } = require('../middleware/auth');
            await verifyToken(protectedReq, protectedRes, next);
            expect(protectedRes.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        test('should require canonical session identity when logging out', async () => {
            const req = {
                user: null,
                body: {}
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };

            await handleLogout(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                code: 'AUTH_RELOGIN_REQUIRED',
            }));
        });
    });

    describe('Token Verification', () => {
        test('should verify valid access token', () => {
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const token = signAccessToken(payload);
            const decoded = verifyAccessToken(token);

            expect(decoded).not.toBeNull();
            expect(decoded.user).toBe('001');
            expect(decoded.role).toBe('COMERCIAL');
        });

        test('should reject invalid token', () => {
            const decoded = verifyAccessToken('invalid.token');
            expect(decoded).toBeNull();
        });

        test('should reject refresh token used as access token', () => {
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const refreshToken = signRefreshToken(payload);
            const decoded = verifyAccessToken(refreshToken);

            expect(decoded).toBeNull();
        });

        test('should verify valid refresh token', () => {
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const token = signRefreshToken(payload);
            const decoded = verifyRefreshToken(token);

            expect(decoded).not.toBeNull();
            expect(decoded.user).toBe('001');
        });

        test('should reject access token used as refresh token', () => {
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const accessToken = signAccessToken(payload);
            const decoded = verifyRefreshToken(accessToken);

            expect(decoded).toBeNull();
        });

        test('legacy access tokens never fall back to an in-process session', async () => {
            const token = signAccessToken({
                id: 'V001', user: '001', name: 'Legacy', role: 'COMERCIAL',
            });
            const req = {
                headers: { authorization: `Bearer ${token}` },
                method: 'GET', path: '/protected', ip: '127.0.0.1',
            };
            const res = {
                status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(),
            };
            const next = jest.fn();
            const { verifyToken } = require('../middleware/auth');

            await verifyToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                code: 'AUTH_RELOGIN_REQUIRED',
            }));
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Active Sessions Management', () => {
        test('invalidates canonical sessions without exposing legacy in-process state', async () => {
            await expect(invalidateAllSessions('V001')).resolves.toEqual(
                expect.objectContaining({ ok: true }),
            );
        });
    });
});
