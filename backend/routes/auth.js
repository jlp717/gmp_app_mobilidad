/**
 * GMP App - Auth Routes (Security Hardened)
 * Secure authentication with bcrypt, rate limiting, and audit logging
 */

const express = require('express');
const router = express.Router();
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { 
    verifyToken, 
    signAccessToken, 
    signRefreshToken, 
    hashPassword, 
    verifyPassword,
    handleRefreshToken,
    handleLogout
} = require('../middleware/auth');
const { loginLimiter, validateBody, sanitizeInput, detectSqlInjection } = require('../middleware/security');
const { auditLogin, getClientIP } = require('../middleware/audit');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

const lockoutsPath = path.join(__dirname, '../data/lockouts.json');
const lockoutsDir = path.dirname(lockoutsPath);

if (!fs.existsSync(lockoutsDir)) {
    fs.mkdirSync(lockoutsDir, { recursive: true, mode: 0o700 });
}

function loadLockouts() {
    try {
        if (fs.existsSync(lockoutsPath)) {
            return JSON.parse(fs.readFileSync(lockoutsPath, 'utf8'));
        }
    } catch (e) {
        logger.warn(`[Auth] Failed to load lockouts: ${e.message}`);
    }
    return {};
}

function saveLockouts(lockouts) {
    try {
        fs.writeFileSync(lockoutsPath, JSON.stringify(lockouts, null, 2), { mode: 0o600 });
    } catch (e) {
        logger.error(`[Auth] Failed to save lockouts: ${e.message}`);
    }
}

const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_TIME_MS = parseInt(process.env.LOCK_TIME_MINUTES || '30', 10) * 60 * 1000;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// =============================================================================
// HELPERS
// =============================================================================

function handleFailedLogin(res, safeUser, requestId, message) {
    const lockouts = loadLockouts();
    const current = lockouts[safeUser] || { count: 0, lastAttempt: 0 };
    current.count += 1;
    current.lastAttempt = Date.now();
    
    if (current.count >= MAX_FAILED_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOCKOUT_TIME_MS;
        logger.warn(`[Auth] [${requestId}] Account locked: ${safeUser}`);
    }
    
    lockouts[safeUser] = current;
    saveLockouts(lockouts);

    const remainingAttempts = MAX_FAILED_ATTEMPTS - current.count;
    
    if (current.lockedUntil) {
        const minutesRemaining = Math.ceil((LOCKOUT_TIME_MS - (Date.now() - current.lastAttempt)) / 60000);
        return res.status(429).json({
            error: `Cuenta bloqueada. Espera ${minutesRemaining} minutos.`,
            code: 'ACCOUNT_LOCKED',
            lockedUntil: current.lockedUntil
        });
    }

    return res.status(401).json({
        error: `${message}. Te quedan ${remainingAttempts} intentos.`,
        code: 'INVALID_CREDENTIALS',
        remainingAttempts
    });
}

function sanitizeUsername(username) {
    return username.replace(/[^a-zA-Z0-9 ]/g, '').trim().toUpperCase();
}

// =============================================================================
// LOGIN ENDPOINT
// =============================================================================

router.post('/login', 
    loginLimiter,
    sanitizeInput,
    async (req, res) => {
        const requestId = Date.now().toString(36);
        const clientIp = getClientIP(req);

        try {
            const { username, password } = req.body;

            if (!username || !password) {
                logger.warn(`[${requestId}] Login attempt with missing credentials`);
                return res.status(400).json({ error: 'Usuario y contraseña requeridos', code: 'MISSING_CREDENTIALS' });
            }

            const safeUser = sanitizeUsername(username);
            const trimmedPwd = password.trim();

            if (safeUser.length < 1 || safeUser.length > 50) {
                logger.warn(`[${requestId}] Invalid username length: ${safeUser.length}`);
                return res.status(400).json({ error: 'Usuario inválido', code: 'INVALID_USERNAME' });
            }

            // Check lockout
            const lockouts = loadLockouts();
            const lockoutInfo = lockouts[safeUser];
            
            if (lockoutInfo && lockoutInfo.lockedUntil) {
                const timeUntilUnlock = lockoutInfo.lockedUntil - Date.now();
                if (timeUntilUnlock > 0) {
                    const minutesRemaining = Math.ceil(timeUntilUnlock / 60000);
                    logger.warn(`[${requestId}] Locked account access attempt: ${safeUser}`);
                    return res.status(429).json({
                        error: `Cuenta bloqueada. Intenta en ${minutesRemaining} minutos.`,
                        code: 'ACCOUNT_LOCKED',
                        lockedUntil: lockoutInfo.lockedUntil
                    });
                } else {
                    delete lockouts[safeUser];
                    saveLockouts(lockouts);
                }
            }

            // Find vendor
            logger.info(`[${requestId}] Login attempt for: ${safeUser}`);

            let pinRecord = [];

            // Try code search
            if (safeUser.length <= 10) {
                try {
                    pinRecord = await queryWithParams(`
                        SELECT P.CODIGOVENDEDOR, P.CODIGOPIN,
                               TRIM(D.NOMBREVENDEDOR) as NOMBREVENDEDOR,
                               V.TIPOVENDEDOR, X.JEFEVENTASSN,
                               E.HIDE_COMMISSIONS
                        FROM DSEDAC.VDPL1 P
                        JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
                        JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
                        LEFT JOIN DSEDAC.VDDX X ON P.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                        LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON P.CODIGOVENDEDOR = E.CODIGOVENDEDOR
                        WHERE TRIM(P.CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
                        FETCH FIRST 1 ROWS ONLY
                    `, [safeUser], false);
                } catch (e) {
                    logger.debug(`[${requestId}] Code search failed: ${e.message}`);
                }
            }

            // Try name search
            if (pinRecord.length === 0) {
                const searchParam = safeUser.replace(/ /g, '');
                const nameSearch = await queryWithParams(`
                    SELECT P.CODIGOVENDEDOR, P.CODIGOPIN,
                           TRIM(D.NOMBREVENDEDOR) as NOMBREVENDEDOR,
                           V.TIPOVENDEDOR, X.JEFEVENTASSN,
                           E.HIDE_COMMISSIONS
                    FROM DSEDAC.VDD D
                    JOIN DSEDAC.VDPL1 P ON D.CODIGOVENDEDOR = P.CODIGOVENDEDOR
                    JOIN DSEDAC.VDC V ON D.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
                    LEFT JOIN DSEDAC.VDDX X ON D.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                    LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON D.CODIGOVENDEDOR = E.CODIGOVENDEDOR
                    WHERE REPLACE(UPPER(TRIM(D.NOMBREVENDEDOR)), ' ', '') LIKE '%' CONCAT CAST(? AS VARCHAR(100)) CONCAT '%'
                    FETCH FIRST 1 ROWS ONLY
                `, [searchParam], false);

                if (nameSearch.length > 0) {
                    pinRecord = nameSearch;
                    logger.info(`[${requestId}] Found vendor by name`);
                }
            }

            if (pinRecord.length === 0) {
                logger.warn(`[${requestId}] User not found: ${safeUser}`);
                return handleFailedLogin(res, safeUser, requestId, 'Usuario no encontrado');
            }

            const vendor = pinRecord[0];
            const dbPin = vendor.CODIGOPIN?.toString().trim();
            const vendedorCode = vendor.CODIGOVENDEDOR?.toString().trim();
            let rawName = vendor.NOMBREVENDEDOR || `Comercial ${vendedorCode}`;
            const vendedorName = rawName.replace(/^\d+\s+/, '').trim();
            const isJefeVentas = vendor.JEFEVENTASSN === 'S';
            const tipoVendedor = vendor.TIPOVENDEDOR?.trim();

            // Verify PIN
            let pinValid = false;

            if (dbPin && dbPin.startsWith('$2b$')) {
                // Bcrypt hash - use compare
                pinValid = await verifyPassword(trimmedPwd, dbPin);
            } else if (dbPin === trimmedPwd) {
                // Plaintext PIN (legacy) - VALID ONLY, don't migrate
                pinValid = true;
                
                // MIGRATION DISABLED: DB2 field CODIGOPIN is too small for bcrypt hashes
                // Bcrypt produces ~60 char hashes, DB2 field is likely VARCHAR(20-30)
                // To migrate, DBA must first: ALTER TABLE DSEDAC.VDPL1 ALTER COLUMN CODIGOPIN SET DATA TYPE VARCHAR(100)
                // For now, plaintext PINs work but are NOT stored as hashes
                logger.info(`[${requestId}] ⚠️ Vendor ${vendedorCode} has plaintext PIN (migration pending DB schema change)`);
            }

            if (!pinValid) {
                logger.warn(`[${requestId}] PIN mismatch for vendor ${vendedorCode}`);
                return handleFailedLogin(res, safeUser, requestId, 'PIN incorrecto');
            }

            // Check Repartidor role
            let isRepartidor = false;
            let codigoConductor = null;
            let matriculaVehiculo = null;

            try {
                const currentYear = new Date().getFullYear();
                const vehCheck = await queryWithParams(`
                    SELECT TRIM(CODIGOVEHICULO) as VEHICULO, TRIM(MATRICULA) as MATRICULA
                    FROM DSEDAC.VEH
                    WHERE TRIM(CODIGOCONDUCTOR) = ?
                      AND TRIM(CODIGOCONDUCTOR) <> '98'
                    FETCH FIRST 1 ROWS ONLY
                `, [vendedorCode], false);

                if (vehCheck.length > 0) {
                    isRepartidor = true;
                    matriculaVehiculo = vehCheck[0].MATRICULA;
                    codigoConductor = vendedorCode;
                } else {
                    const oppCheck = await queryWithParams(`
                        SELECT COUNT(*) as CNT FROM DSEDAC.OPP
                        WHERE TRIM(CODIGOREPARTIDOR) = ?
                          AND ANOREPARTO = ?
                    `, [vendedorCode, currentYear], false);
                    
                    if (oppCheck.length > 0 && (oppCheck[0].CNT || 0) >= 100) {
                        isRepartidor = true;
                        codigoConductor = vendedorCode;
                    }
                }
            } catch (e) {
                logger.warn(`[${requestId}] Error checking vehicle: ${e.message}`);
            }

            // Success
            logger.info(`[${requestId}] Login successful for ${vendedorName} (${vendedorCode})`);

            // Clear lockout on success
            const successLockouts = loadLockouts();
            delete successLockouts[safeUser];
            saveLockouts(successLockouts);

            let finalRole = 'COMERCIAL';
            if (isJefeVentas) finalRole = 'JEFE_VENTAS';
            else if (isRepartidor) finalRole = 'REPARTIDOR';

            let vendedorCodes = [vendedorCode];
            if (isJefeVentas) {
                const allVendedores = await query(`
                    SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE 
                    FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
                `);
                const orphans = ['82', '20', 'UNK'];
                const existingCodes = new Set(allVendedores.map(v => v.CODE));
                orphans.forEach(o => existingCodes.add(o));
                vendedorCodes = Array.from(existingCodes);
            }

            const accessToken = signAccessToken({ 
                id: `V${vendedorCode}`, 
                user: vendedorCode, 
                role: finalRole, 
                isJefeVentas,
                timestamp: Date.now()
            });
            
            const refreshToken = signRefreshToken({ 
                id: `V${vendedorCode}`, 
                user: vendedorCode, 
                role: finalRole, 
                isJefeVentas
            });

            res.json({
                user: {
                    id: `V${vendedorCode}`,
                    code: vendedorCode,
                    name: vendedorName,
                    company: 'GMP',
                    vendedorCode,
                    isJefeVentas,
                    tipoVendedor: tipoVendedor || '-',
                    role: finalRole,
                    isRepartidor,
                    codigoConductor,
                    matricula: matriculaVehiculo,
                    showCommissions: vendor.HIDE_COMMISSIONS !== 'Y'
                },
                role: finalRole,
                isRepartidor,
                showCommissions: vendor.HIDE_COMMISSIONS !== 'Y',
                vendedorCodes,
                token: accessToken,
                refreshToken,
                latestVersion: '3.3.1',
                tokenExpiresIn: 3600,
                refreshExpiresIn: 604800
            });

            auditLogin(req, vendedorCode, vendedorName, finalRole, true);

        } catch (error) {
            logger.error(`[${requestId}] Login error: ${error.message}`);
            auditLogin(req, req.body?.username || 'unknown', null, null, false);
            res.status(401).json({ error: 'Error de autenticación', code: 'AUTH_ERROR' });
        }
    }
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
    try {
        const { userId, newRole } = req.body;
        const validRoles = ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR', 'ALMACEN'];
        
        if (!validRoles.includes(newRole)) {
            return res.status(400).json({ error: 'Rol no válido', code: 'INVALID_ROLE' });
        }
        
        if (req.user?.code !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para cambiar este rol', code: 'FORBIDDEN' });
        }

        const accessToken = signAccessToken({ id: userId, user: userId, role: newRole, timestamp: Date.now() });
        const refreshToken = signRefreshToken({ id: userId, user: userId, role: newRole });

        res.json({ success: true, role: newRole, token: accessToken, refreshToken, tokenExpiresIn: 3600 });
    } catch (error) {
        logger.error(`Switch role error: ${error.message}`);
        res.status(500).json({ error: 'Error cambiando de rol', code: 'SERVER_ERROR' });
    }
});

// =============================================================================
// REPARTIDORES LIST
// =============================================================================

let _repartidoresCache = null;
let _repartidoresCacheTime = 0;
const REPARTIDORES_CACHE_TTL = 5 * 60 * 1000;

router.get('/repartidores', verifyToken, async (req, res) => {
    try {
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
