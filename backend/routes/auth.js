/**
 * GMP App - Auth Routes (Security Hardened)
 * Secure authentication with bcrypt, rate limiting, and audit logging
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { 
    verifyToken, 
    handleRefreshToken,
    handleLogout
} = require('../middleware/auth');
const { loginLimiter, sanitizeInput, bruteForceIpTracker } = require('../middleware/security');
const { verifyVendorPin } = require('../services/vendor-pin-auth');
const authTokenService = require('../middleware/auth');
const logger = require('../middleware/logger');
const { Db2AuthRepository } = require('../src/modules/auth');
const { createAuthClaimsResolver } = require('../src/modules/auth/application/auth-claims-resolver');
const { createAuthClaimsLoginHandler } = require('../src/modules/auth/application/auth-claims-login-handler');

// =============================================================================
// LOGIN ENDPOINT
// =============================================================================

const authRepository = new Db2AuthRepository();
const authClaimsResolver = createAuthClaimsResolver({ authRepository });
authTokenService.setAuthClaimsResolver(authClaimsResolver);
const authClaimsLoginHandler = createAuthClaimsLoginHandler({
    authRepository,
    authClaimsResolver,
    verifyVendorPin,
    tokenService: authTokenService,
});

router.post('/login',
    bruteForceIpTracker,
    loginLimiter,
    sanitizeInput,
    authClaimsLoginHandler
);
// =============================================================================
// REFRESH / LOGOUT / SWITCH ROLE
// =============================================================================

function shortSidHash(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'none';
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
}

function sidHintFromRefreshToken(refreshToken) {
    const token = String(refreshToken || '').trim();
    if (!token) return 'none';
    try {
        const payloadPart = token.split('.')[1];
        if (!payloadPart) return shortSidHash(token);
        const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
        const payload = JSON.parse(json);
        return shortSidHash(payload.sid || payload.jti || token);
    } catch (_err) {
        return shortSidHash(token);
    }
}

function attachRefreshResultLogger(req, res) {
    let logged = false;
    const emit = () => {
        if (logged) return;
        logged = true;
        const body = res.locals.refreshBody || {};
        const reason = res.locals.refreshReason
            || body.code
            || (res.statusCode < 400 ? 'OK' : 'UNKNOWN');
        const sid = sidHintFromRefreshToken(req.body && req.body.refreshToken);
        logger.info(
            `AUTH_REFRESH_RESULT status=${res.statusCode} reason=${reason} sid=${sid} id=${req.requestId || '-'}`
        );
    };
    const originalJson = res.json.bind(res);
    res.json = function captureRefreshBody(body) {
        res.locals.refreshBody = body;
        try {
            return originalJson(body);
        } finally {
            process.nextTick(emit);
        }
    };
    res.on('finish', emit);
}

router.post('/refresh', async (req, res) => {
    attachRefreshResultLogger(req, res);
    await handleRefreshToken(req, res);
});

router.post('/logout', verifyToken, async (req, res) => {
    await handleLogout(req, res);
});

router.post('/switch-role', verifyToken, (req, res) => {
    return authTokenService.handleSwitchRole(req, res);
});

// =============================================================================
// SESSION VALIDATION
// =============================================================================

// Lightweight liveness probe for the mobile cold-start path: the app restores
// a persisted session and confirms the access token is still active server-side
// without forcing a full login. verifyToken already rejects expired, tampered
// or revoked tokens, so reaching this handler means the session is valid.
router.get('/validate', verifyToken, (req, res) => {
    const user = req.user || {};
    return res.json({
        valid: true,
        role: user.role || null,
        activeMode: user.activeMode || null,
        claimsVersion: user.claimsVersion ?? null,
    });
});

// =============================================================================
// REPARTIDORES LIST
// =============================================================================

function repartoCodesMatch(left, right) {
    const a = String(left || '').trim().toUpperCase();
    const b = String(right || '').trim().toUpperCase();
    if (a === b) return true;
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    return (a.replace(/^0+/, '') || '0') === (b.replace(/^0+/, '') || '0');
}

function repartidoresAccess(user = {}) {
    const role = String(user.role || '').trim().toUpperCase();
    const activeMode = String(user.activeMode || '').trim().toUpperCase();
    if (role === 'REPARTIDOR') return 'SELF';
    if ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR') return 'FLEET';
    return 'DENIED';
}

router.get('/repartidores', verifyToken, async (req, res) => {
    try {
        const access = repartidoresAccess(req.user);
        const signedCodes = [...new Set((Array.isArray(req.user?.repartidorCodes)
            ? req.user.repartidorCodes : [])
            .map((code) => String(code || '').trim().toUpperCase())
            .filter(Boolean))];
        if (access === 'SELF') {
            const own = String(req.user?.code || '').trim().toUpperCase();
            if (signedCodes.length !== 1 || !repartoCodesMatch(signedCodes[0], own)) {
                return res.status(403).json({ error: 'Acceso restringido', code: 'REPARTIDOR_SCOPE_REQUIRED' });
            }
            return res.json([{ code: signedCodes[0], name: req.user.name || signedCodes[0] }]);
        }
        if (access !== 'FLEET') {
            return res.status(403).json({ error: 'Acceso restringido', code: 'INSUFFICIENT_ROLE' });
        }
        if (signedCodes.length === 0) {
            return res.status(403).json({ error: 'Acceso restringido', code: 'REPARTIDOR_SCOPE_REQUIRED' });
        }

        const directory = await authRepository.listRepartidorFleet();
        const selected = signedCodes.map((signedCode) =>
            directory.find((entry) => repartoCodesMatch(entry?.code, signedCode)));
        if (selected.some((entry) => !entry)) {
            return res.status(503).json({ error: 'Perfil de autorizacion no disponible', code: 'AUTH_PROFILE_UNAVAILABLE' });
        }
        return res.json(selected);
    } catch (_error) {
        return res.status(503).json({ error: 'Perfil de autorizacion no disponible', code: 'AUTH_PROFILE_UNAVAILABLE' });
    }
});

router.repartidoresAccess = repartidoresAccess;
module.exports = router;
