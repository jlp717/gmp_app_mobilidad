/**
 * GMP App - Auth Routes (Security Hardened)
 * Secure authentication with bcrypt, rate limiting, and audit logging
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const logger = require('../middleware/logger');
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

let _repartidoresCache = null;
let _repartidoresCacheTime = 0;
const REPARTIDORES_CACHE_TTL = 5 * 60 * 1000;

router.get('/repartidores', verifyToken, async (req, res) => {
    try {
        if (req.user?.role === 'REPARTIDOR' && !req.user?.isJefeVentas) {
            const code = (req.user.code || req.user.id || '').toString().trim();
            return res.json(code ? [{ code, name: req.user.name || code }] : []);
        }
        if (req.user?.role !== 'JEFE_VENTAS' && req.user?.role !== 'ADMIN' && !req.user?.isJefeVentas) {
            return res.status(403).json({ error: 'Acceso restringido', code: 'INSUFFICIENT_ROLE' });
        }

        const now = Date.now();
        if (_repartidoresCache && (now - _repartidoresCacheTime) < REPARTIDORES_CACHE_TTL) {
            return res.json(_repartidoresCache);
        }

        const currentYear = new Date().getFullYear();
        let results = [];

        // Source 1: VEH
        try {
            const vehRows = await query(`
                SELECT DISTINCT TRIM(V.CODIGOCONDUCTOR) as CODE, TRIM(D.NOMBREVENDEDOR) as NAME
                FROM DSEDAC.VEH V
                JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(V.CODIGOCONDUCTOR)
                WHERE TRIM(V.CODIGOCONDUCTOR) <> '98' AND TRIM(V.CODIGOCONDUCTOR) <> ''
            `, false);
            if (vehRows) results.push(...vehRows.map(r => ({ code: r.CODE?.trim(), name: r.NAME?.trim() })));
        } catch (e) { logger.warn(`Error querying VEH: ${e.message}`); }

        // Source 2: OPP
        try {
            const repRows = await query(`
                SELECT TRIM(OPP.CODIGOREPARTIDOR) as CODE,
                       COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR)) as NAME
                FROM DSEDAC.OPP OPP
                LEFT JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
                WHERE OPP.CODIGOREPARTIDOR IS NOT NULL AND OPP.ANOREPARTO = ${currentYear}
                  AND NOT EXISTS (SELECT 1 FROM DSEDAC.VDDX X WHERE TRIM(X.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR) AND TRIM(X.JEFEVENTASSN) = 'S')
                GROUP BY TRIM(OPP.CODIGOREPARTIDOR), COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR))
                HAVING COUNT(*) >= 100
            `, false);
            if (repRows) results.push(...repRows.map(r => ({ code: r.CODE?.trim(), name: r.NAME?.trim() })));
        } catch (e) { logger.warn(`Error querying OPP: ${e.message}`); }

        // Deduplicate
        const EXCLUDED_PREFIXES = ['ZZ', 'ZD', 'ZB', 'ZE', 'Z7', 'ZA', 'ZC', 'ZF', 'ZG', 'ZH', 'ZI', 'ZJ', 'ZK', 'ZL', 'ZM', 'ZN', 'ZO', 'ZP', 'ZQ', 'ZR', 'ZS', 'ZT', 'ZU', 'ZV', 'ZW', 'ZX', 'ZY', 'Z0', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z8', 'Z9', 'XX', 'TT', 'TEST'];
        const EXCLUDED_CODES = new Set(['UNK', '00', '0', '', 'NULL', 'NONE', 'N/A', '97', '98']);
        
        const uniqueMap = new Map();
        results.forEach(r => {
            if (!r.code) return;
            const code = r.code.trim().toUpperCase();
            if (EXCLUDED_CODES.has(code)) return;
            if (EXCLUDED_PREFIXES.some(p => code.startsWith(p))) return;
            if (r.name?.trim().toUpperCase().startsWith('ZZ')) return;
            uniqueMap.set(r.code, r);
        });
        
        _repartidoresCache = Array.from(uniqueMap.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
        _repartidoresCacheTime = now;
        
        res.json(_repartidoresCache);
        
    } catch (error) {
        logger.error(`Error fetching repartidores: ${error.message}`);
        res.status(500).json({ error: 'Error de base de datos', code: 'DB_ERROR' });
    }
});

module.exports = router;
