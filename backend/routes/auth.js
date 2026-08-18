/**
 * GMP App - Auth Routes (Security Hardened)
 * Secure authentication with bcrypt, rate limiting, and audit logging
 */

const express = require('express');
const router = express.Router();
const { 
    verifyToken, 
    handleRefreshToken,
    handleLogout
} = require('../middleware/auth');
const { loginLimiter, sanitizeInput, bruteForceIpTracker } = require('../middleware/security');
const { verifyVendorPin } = require('../services/vendor-pin-auth');
const authTokenService = require('../middleware/auth');
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

router.post('/refresh', async (req, res) => {
    await handleRefreshToken(req, res);
});

router.post('/logout', verifyToken, async (req, res) => {
    await handleLogout(req, res);
});

router.post('/switch-role', verifyToken, async (req, res) => {
    return authTokenService.handleSwitchRole(req, res);
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
