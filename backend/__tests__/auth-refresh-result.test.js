'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const mockHandleRefreshToken = jest.fn();

jest.mock('../middleware/auth', () => {
    const verifyToken = (req, _res, next) => next();
    return {
        verifyToken,
        handleRefreshToken: (...args) => mockHandleRefreshToken(...args),
        handleLogout: jest.fn(),
        setAuthClaimsResolver: jest.fn(),
        handleSwitchRole: jest.fn(),
    };
});

jest.mock('../middleware/security', () => ({
    loginLimiter: (req, _res, next) => next(),
    sanitizeInput: (req, _res, next) => next(),
    bruteForceIpTracker: (req, _res, next) => next(),
}));

jest.mock('../services/vendor-pin-auth', () => ({
    verifyVendorPin: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/modules/auth', () => ({
    Db2AuthRepository: jest.fn().mockImplementation(() => ({
        listRepartidorFleet: jest.fn().mockResolvedValue([]),
    })),
}));

jest.mock('../src/modules/auth/application/auth-claims-resolver', () => ({
    createAuthClaimsResolver: jest.fn(() => jest.fn()),
}));

jest.mock('../src/modules/auth/application/auth-claims-login-handler', () => ({
    createAuthClaimsLoginHandler: jest.fn(() => (req, res) => res.json({})),
}));

const authRouter = require('../routes/auth');
const logger = require('../middleware/logger');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.requestId = 'rid-refresh-1';
        next();
    });
    app.use('/auth', authRouter);
    return app;
}

describe('AUTH_REFRESH_RESULT logging', () => {
    beforeEach(() => {
        logger.info.mockClear();
        mockHandleRefreshToken.mockReset();
    });

    test('logs SESSION_REVOKED reason from response body on 401', async () => {
        mockHandleRefreshToken.mockImplementation(async (_req, res) => {
            return res.status(401).json({
                error: 'Sesion revocada.',
                code: 'SESSION_REVOKED',
            });
        });
        const res = await request(makeApp())
            .post('/auth/refresh')
            .send({ refreshToken: 'opaque-token' });
        expect(res.status).toBe(401);
        await new Promise((resolve) => setImmediate(resolve));
        const line = logger.info.mock.calls.map((call) => String(call[0])).join('\n');
        expect(line).toMatch(/AUTH_REFRESH_RESULT status=401 reason=SESSION_REVOKED/);
        expect(line).toMatch(/id=rid-refresh-1/);
        expect(line).not.toMatch(/opaque-token/);
    });

    test('logs OK on successful rotation', async () => {
        mockHandleRefreshToken.mockImplementation(async (_req, res) => {
            return res.status(200).json({ success: true, accessToken: 'a', refreshToken: 'b' });
        });
        const res = await request(makeApp())
            .post('/auth/refresh')
            .send({ refreshToken: 'opaque-token' });
        expect(res.status).toBe(200);
        await new Promise((resolve) => setImmediate(resolve));
        const line = logger.info.mock.calls.map((call) => String(call[0])).join('\n');
        expect(line).toMatch(/AUTH_REFRESH_RESULT status=200 reason=OK/);
    });
});
