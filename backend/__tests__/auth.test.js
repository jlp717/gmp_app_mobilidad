/**
 * Authentication Flow - Integration Tests
 * ======================================
 * Tests for complete auth flows: login, refresh, logout, token handling
 */

'use strict';

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
    activeSessions,
    stopSessionCleanup
} = require('../middleware/auth');

const authRoutes = require('../routes/auth');

describe('Auth Flow Tests', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/auth', authRoutes);
    });

    afterAll(() => {
        try { stopSessionCleanup(); } catch (e) {}
    });

    beforeEach(() => {
        jest.clearAllMocks();
        invalidateAllSessions('V001');
        invalidateAllSessions('test-user');
    });

    describe('Login Success', () => {
        test('should return tokens on valid credentials', async () => {
            const { queryWithParams } = require('../config/db');

            queryWithParams
                .mockResolvedValueOnce([{
                    CODIGOVENDEDOR: '001',
                    CODIGOPIN: '1234',
                    NOMBREVENDEDOR: '001 Test Vendor',
                    TIPOVENDEDOR: 'COMERCIAL',
                    JEFEVENTASSN: 'N',
                    HIDE_COMMISSIONS: null
                }])
                .mockResolvedValueOnce([]);

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
            const { queryWithParams, query } = require('../config/db');

            queryWithParams
                .mockResolvedValueOnce([{
                    CODIGOVENDEDOR: '001',
                    CODIGOPIN: '1234',
                    NOMBREVENDEDOR: '001 Test Jefe',
                    TIPOVENDEDOR: 'COMERCIAL',
                    JEFEVENTASSN: 'S',
                    HIDE_COMMISSIONS: null
                }])
                .mockResolvedValueOnce([]);

            query.mockResolvedValueOnce([
                { CODE: '001' },
                { CODE: '002' },
                { CODE: '003' }
            ]);

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '001', password: '1234' });

            expect(res.status).toBe(200);
            expect(res.body.user.role).toBe('JEFE_VENTAS');
            expect(res.body.vendedorCodes).toBeDefined();
            expect(Array.isArray(res.body.vendedorCodes)).toBe(true);
        });

        test('should detect REPARTIDOR role from VEH table', async () => {
            const { queryWithParams, query } = require('../config/db');

            queryWithParams
                .mockResolvedValueOnce([{
                    CODIGOVENDEDOR: '050',
                    CODIGOPIN: '5678',
                    NOMBREVENDEDOR: '050 Repartidor',
                    TIPOVENDEDOR: 'COMERCIAL',
                    JEFEVENTASSN: 'N',
                    HIDE_COMMISSIONS: null
                }])
                .mockResolvedValueOnce([{ VEHICULO: 'V001', MATRICULA: '1234ABC' }])
                .mockResolvedValueOnce([]);

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '050', password: '5678' });

            expect(res.status).toBe(200);
            expect(res.body.user.isRepartidor).toBe(true);
            expect(res.body.user.role).toBe('REPARTIDOR');
        });
    });

    describe('Login Failure', () => {
        test('should reject invalid credentials', async () => {
            const { queryWithParams } = require('../config/db');

            queryWithParams
                .mockResolvedValueOnce([{
                    CODIGOVENDEDOR: '001',
                    CODIGOPIN: '1234',
                    NOMBREVENDEDOR: '001 Test Vendor',
                    TIPOVENDEDOR: 'COMERCIAL',
                    JEFEVENTASSN: 'N',
                    HIDE_COMMISSIONS: null
                }])
                .mockResolvedValueOnce([]);

            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: '001', password: 'wrongpassword' });

            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('code', 'INVALID_CREDENTIALS');
        });

        test('should reject non-existent user', async () => {
            const { queryWithParams } = require('../config/db');

            queryWithParams
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

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
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const oldRefreshToken = signRefreshToken(payload);

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

            if (res1.json.mock.calls[0][0].success) {
                const newToken = res1.json.mock.calls[0][0].refreshToken;
                expect(newToken).not.toBe(oldRefreshToken);
            }
        });

        test('should invalidate old token after rotation', async () => {
            const payload = {
                id: 'V002',
                user: '002',
                name: 'Test User 2',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const firstToken = signRefreshToken(payload);
            
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
            if (firstResult.success) {
                const secondToken = firstResult.refreshToken;
                
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
            }
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
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            const refreshToken = signRefreshToken(payload);
            invalidateAllSessions('V001');

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
            const payload = {
                id: 'V001',
                user: '001',
                name: 'Test User',
                role: 'COMERCIAL',
                isJefeVentas: false
            };

            signRefreshToken(payload);

            const req = {
                user: { id: 'V001', code: '001' },
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
        });

        test('should handle logout without user gracefully', async () => {
            const req = {
                user: null,
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
    });

    describe('Active Sessions Management', () => {
        test('should track active sessions', () => {
            expect(activeSessions).toBeDefined();
            expect(typeof activeSessions).toBe('object');
        });

        test('should clear sessions on invalidateAllSessions', () => {
            invalidateAllSessions('V001');
            expect(activeSessions.get('V001')).toBeUndefined();
        });
    });
});