'use strict';

/**
 * Contract test for GET /auth/validate — the cold-start liveness probe.
 *
 * The mobile app restores its persisted session from secure storage and calls
 * this endpoint to confirm the access token is still valid before entering
 * the shell. It must return a minimal session projection built from the
 * claims attached by verifyToken, never a DB round-trip.
 *
 * Pattern copied from tests/routes/contract-parity.test.js: mock the whole
 * middleware/service chain the router loads at require time, then drive the
 * mounted router with supertest.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => {
    // verifyToken passes through when a valid token was already decoded;
    // the mock injects the claims shape the real middleware attaches.
    const verifyToken = (req, _res, next) => {
        if (!req.user) {
            req.user = {
                role: 'JEFE_VENTAS',
                activeMode: 'REPARTIDOR',
                claimsVersion: 3,
            };
        }
        next();
    };
    return {
        verifyToken,
        handleRefreshToken: jest.fn(),
        handleLogout: jest.fn(),
        setAuthClaimsResolver: jest.fn(),
        handleSwitchRole: jest.fn(),
    };
});
jest.mock('../../middleware/security', () => ({
    loginLimiter: (req, _res, next) => next(),
    sanitizeInput: (req, _res, next) => next(),
    bruteForceIpTracker: (req, _res, next) => next(),
}));
jest.mock('../../services/vendor-pin-auth', () => ({
    verifyVendorPin: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/modules/auth', () => ({
    Db2AuthRepository: jest.fn().mockImplementation(() => ({
        listRepartidorFleet: jest.fn().mockResolvedValue([]),
    })),
}));
jest.mock(
    '../../src/modules/auth/application/auth-claims-resolver',
    () => ({
        createAuthClaimsResolver: jest.fn(() => jest.fn()),
    })
);
jest.mock(
    '../../src/modules/auth/application/auth-claims-login-handler',
    () => ({
        createAuthClaimsLoginHandler: jest.fn(() => (req, res) =>
            res.json({})
        ),
    })
);

const authRouter = require('../../routes/auth');

function appWith(user) {
    const app = express();
    if (user !== undefined) {
        app.use((req, _res, next) => {
            req.user = user;
            next();
        });
    }
    app.use('/auth', authRouter);
    return app;
}

describe('GET /auth/validate (cold-start session probe)', () => {
    test('returns the claims projection for a valid token', async () => {
        // No preset req.user: the mocked verifyToken injects the defaults.
        const res = await request(appWith()).get('/auth/validate').expect(200);

        expect(res.body).toEqual({
            valid: true,
            role: 'JEFE_VENTAS',
            activeMode: 'REPARTIDOR',
            claimsVersion: 3,
        });
    });

    test('null-fills missing claims instead of crashing', async () => {
        const res = await request(appWith({}))
            .get('/auth/validate')
            .expect(200);

        expect(res.body).toEqual({
            valid: true,
            role: null,
            activeMode: null,
            claimsVersion: null,
        });
    });

    test('claimsVersion 0 is reported, not nullified', async () => {
        const res = await request(
            appWith({
                role: 'REPARTIDOR',
                activeMode: 'REPARTIDOR',
                claimsVersion: 0,
            })
        )
            .get('/auth/validate')
            .expect(200);

        expect(res.body).toEqual({
            valid: true,
            role: 'REPARTIDOR',
            activeMode: 'REPARTIDOR',
            claimsVersion: 0,
        });
    });
});
