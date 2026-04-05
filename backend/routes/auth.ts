/**
 * GMP App - Auth Routes (Security Hardened)
 * ===========================================
 * Secure authentication with bcrypt password hashing,
 * rate limiting, input validation, and audit logging.
 * 
 * Security improvements:
 * - bcrypt password hashing with salt rounds
 * - Zod input validation
 * - Rate limiting for brute force protection
 * - SQL injection prevention with parameterized queries
 * - Comprehensive audit logging
 * - Account lockout after failed attempts
 */

import express, { Request, Response } from 'express';
import { query, queryWithParams } from '../config/db';
import logger from '../middleware/logger';
import { 
    verifyToken, 
    signAccessToken, 
    signRefreshToken, 
    hashPassword, 
    verifyPassword,
    handleRefreshToken,
    handleLogout,
    AuthenticatedRequest 
} from '../middleware/auth';
import { loginLimiter, validateBody, validationSchemas, detectSqlInjection } from '../middleware/security';
import { auditLogin, getClientIP } from '../middleware/audit';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// =============================================================================
// FILE-BASED LOCKOUT STORAGE (Secure alternative to in-memory)
// =============================================================================

interface LockoutInfo {
    count: number;
    lastAttempt: number;
    lockedUntil?: number;
}

const lockoutsPath = path.join(__dirname, '../data/lockouts.json');
const lockoutsDir = path.dirname(lockoutsPath);

// Ensure data directory exists
if (!fs.existsSync(lockoutsDir)) {
    fs.mkdirSync(lockoutsDir, { recursive: true, mode: 0o700 }); // Restrictive permissions
}

function loadLockouts(): Record<string, LockoutInfo> {
    try {
        if (fs.existsSync(lockoutsPath)) {
            const data = fs.readFileSync(lockoutsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        logger.warn(`[Auth] Failed to load lockouts file: ${e}`);
    }
    return {};
}

function saveLockouts(lockouts: Record<string, LockoutInfo>): void {
    try {
        // Write with restrictive file permissions
        fs.writeFileSync(lockoutsPath, JSON.stringify(lockouts, null, 2), {
            mode: 0o600, // Owner read/write only
            encoding: 'utf8'
        });
    } catch (e) {
        logger.error(`[Auth] Failed to save lockouts file: ${e}`);
    }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_TIME_MS = parseInt(process.env.LOCK_TIME_MINUTES || '30', 10) * 60 * 1000;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Handles failed login attempt with progressive lockout
 */
function handleFailedLogin(
    res: Response,
    safeUser: string,
    requestId: string,
    message: string
): void {
    const lockouts = loadLockouts();
    const current = lockouts[safeUser] || { count: 0, lastAttempt: 0 };
    current.count += 1;
    current.lastAttempt = Date.now();
    
    // Lock account if max attempts reached
    if (current.count >= MAX_FAILED_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOCKOUT_TIME_MS;
        logger.warn(`[Auth] [${requestId}] Account locked: ${safeUser} (${MAX_FAILED_ATTEMPTS} failed attempts)`);
    }
    
    lockouts[safeUser] = current;
    saveLockouts(lockouts);

    const remainingAttempts = MAX_FAILED_ATTEMPTS - current.count;
    
    if (current.lockedUntil) {
        const minutesRemaining = Math.ceil((LOCKOUT_TIME_MS - (Date.now() - current.lastAttempt)) / 60000);
        return res.status(429).json({
            error: `Cuenta bloqueada por demasiados intentos fallidos. Espera ${minutesRemaining} minutos.`,
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

/**
 * Sanitizes username input - strict alphanumeric only
 */
function sanitizeUsername(username: string): string {
    // Remove all non-alphanumeric characters except spaces
    return username.replace(/[^a-zA-Z0-9 ]/g, '').trim().toUpperCase();
}

// =============================================================================
// LOGIN ENDPOINT
// =============================================================================

router.post('/login', 
    loginLimiter,
    detectSqlInjection,
    validateBody(validationSchemas.login),
    async (req: Request, res: Response) => {
        const requestId = Date.now().toString(36);
        const clientIp = getClientIP(req);

        try {
            // Use validated body from middleware
            const { username, password } = (req as any).validatedBody;

            // Additional sanitization
            const safeUser = sanitizeUsername(username);
            const trimmedPwd = password.trim();

            // Validate username length
            if (safeUser.length < 1 || safeUser.length > 50) {
                logger.warn(`[${requestId}] Login attempt with invalid username length: ${safeUser.length}`);
                return res.status(400).json({ 
                    error: 'Usuario inválido',
                    code: 'INVALID_USERNAME'
                });
            }

            // Check if account is locked out
            const lockouts = loadLockouts();
            const lockoutInfo = lockouts[safeUser];
            
            if (lockoutInfo && lockoutInfo.lockedUntil) {
                const timeUntilUnlock = lockoutInfo.lockedUntil - Date.now();
                if (timeUntilUnlock > 0) {
                    const minutesRemaining = Math.ceil(timeUntilUnlock / 60000);
                    logger.warn(`[${requestId}] Locked account access attempt: ${safeUser}`);
                    return res.status(429).json({
                        error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutesRemaining} minutos.`,
                        code: 'ACCOUNT_LOCKED',
                        lockedUntil: lockoutInfo.lockedUntil
                    });
                } else {
                    // Lockout expired, reset
                    delete lockouts[safeUser];
                    saveLockouts(lockouts);
                }
            }

            // ===================================================================
            // STEP 1: Find vendor by CODE or NAME in VDPL1/VDD
            // ===================================================================
            logger.info(`[${requestId}] 🔍 Login attempt for: ${safeUser}`);

            let pinRecord: any[] = [];

            // Try code search first (if input is short enough for CODIGOVENDEDOR)
            if (safeUser.length <= 10) {
                try {
                    // PARAMETERIZED QUERY - prevents SQL injection
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
                } catch (codeErr) {
                    logger.debug(`[${requestId}] Code search failed: ${(codeErr as Error).message}`);
                    pinRecord = [];
                }
            }

            // Try name search if code search failed
            if (pinRecord.length === 0) {
                logger.info(`[${requestId}] 🔄 Not found by code, searching by name...`);

                const searchParam = safeUser.replace(/ /g, '');
                
                // PARAMETERIZED QUERY - prevents SQL injection
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
                    logger.info(`[${requestId}] ✅ Found vendor by name: ${nameSearch[0].NOMBREVENDEDOR}`);
                }
            }

            // ===================================================================
            // STEP 2: Validate credentials
            // ===================================================================
            if (pinRecord.length === 0) {
                logger.warn(`[${requestId}] ❌ User not found: ${safeUser}`);
                return handleFailedLogin(res, safeUser, requestId, 'Usuario no encontrado');
            }

            const vendor = pinRecord[0];
            const dbPin = vendor.CODIGOPIN?.toString().trim();
            const vendedorCode = vendor.CODIGOVENDEDOR?.toString().trim();
            
            // Clean vendor name
            let rawName = vendor.NOMBREVENDEDOR || `Comercial ${vendedorCode}`;
            const vendedorName = rawName.replace(/^\d+\s+/, '').trim();
            const isJefeVentas = vendor.JEFEVENTASSN === 'S';
            const tipoVendedor = vendor.TIPOVENDEDOR?.trim();

            // ===================================================================
            // STEP 3: Verify PIN with bcrypt support
            // ===================================================================
            let pinValid = false;
            
            if (dbPin && dbPin.startsWith('$2b$')) {
                // Bcrypt hash - use compare
                pinValid = await verifyPassword(trimmedPwd, dbPin);
            } else if (dbPin === trimmedPwd) {
                // Plaintext PIN (legacy) - migrate to bcrypt
                pinValid = true;
                
                // Migrate to bcrypt asynchronously (don't block login)
                hashPassword(trimmedPwd, BCRYPT_ROUNDS)
                    .then(hashedPin => {
                        queryWithParams(`
                            UPDATE DSEDAC.VDPL1 SET CODIGOPIN = ?
                            WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
                        `, [hashedPin, vendedorCode], false)
                        .then(() => {
                            logger.info(`[${requestId}] 🔒 Migrated plaintext PIN to bcrypt for vendor ${vendedorCode}`);
                        })
                        .catch(err => {
                            logger.warn(`[${requestId}] Failed to migrate PIN: ${err}`);
                        });
                    })
                    .catch(err => {
                        logger.warn(`[${requestId}] Failed to hash PIN: ${err}`);
                    });
            } else {
                pinValid = false;
            }

            if (!pinValid) {
                logger.warn(`[${requestId}] 🚫 PIN mismatch for vendor ${vendedorCode}`);
                return handleFailedLogin(res, safeUser, requestId, 'PIN incorrecto');
            }

            // ===================================================================
            // STEP 4: Check for REPARTIDOR Role
            // ===================================================================
            let isRepartidor = false;
            let codigoConductor: string | null = null;
            let matriculaVehiculo: string | null = null;

            try {
                const currentYear = new Date().getFullYear();
                
                // Check vehicle assignment
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
                    logger.info(`[${requestId}] 🚚 Detected Repartidor Role for ${vendedorCode}`);
                } else {
                    // Check delivery count in OPP
                    const oppCheck = await queryWithParams(`
                        SELECT COUNT(*) as CNT FROM DSEDAC.OPP
                        WHERE TRIM(CODIGOREPARTIDOR) = ?
                          AND ANOREPARTO = ?
                    `, [vendedorCode, currentYear], false);
                    
                    if (oppCheck.length > 0 && (oppCheck[0].CNT || 0) >= 100) {
                        isRepartidor = true;
                        codigoConductor = vendedorCode;
                        logger.info(`[${requestId}] 🚚 Detected Repartidor Role via OPP (${oppCheck[0].CNT} deliveries)`);
                    }
                }
            } catch (vehError) {
                logger.warn(`[${requestId}] Error checking vehicle: ${(vehError as Error).message}`);
            }

            // ===================================================================
            // STEP 5: Success - Build response
            // ===================================================================
            logger.info(`[${requestId}] 🔐 Login successful for ${vendedorName} (${vendedorCode})`);
            
            // Clear lockout on success
            const lockouts = loadLockouts();
            delete lockouts[safeUser];
            saveLockouts(lockouts);

            // Determine final role
            let finalRole = 'COMERCIAL';
            if (isJefeVentas) finalRole = 'JEFE_VENTAS';
            else if (isRepartidor) finalRole = 'REPARTIDOR';

            // Fetch vendor codes for Jefe view
            let vendedorCodes = [vendedorCode];
            if (isJefeVentas) {
                const allVendedores = await query(`
                    SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE 
                    FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
                `);
                const orphans = ['82', '20', 'UNK'];
                const existingCodes = new Set(allVendedores.map((v: any) => v.CODE));
                orphans.forEach(o => existingCodes.add(o));
                vendedorCodes = Array.from(existingCodes);
            }

            // Generate secure tokens
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

            const response = {
                user: {
                    id: `V${vendedorCode}`,
                    code: vendedorCode,
                    name: vendedorName,
                    company: 'GMP',
                    delegation: '',
                    vendedorCode: vendedorCode,
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
                updateMessage: 'Nueva versión disponible. ¡Actualiza para ver los nuevos objetivos!',
                // Security metadata
                tokenExpiresIn: 3600, // seconds
                refreshExpiresIn: 604800 // 7 days in seconds
            };

            logger.info(`✅ Login successful: ${vendedorCode} - ${vendedorName} (${response.user.role})`);
            auditLogin(req, vendedorCode, vendedorName, finalRole, true);
            res.json(response);

        } catch (error) {
            logger.error(`[${requestId}] Login error: ${(error as Error).message}`);
            auditLogin(req, req.body?.username || 'unknown', null, null, false);
            res.status(401).json({ 
                error: 'Error de autenticación. Verifique sus credenciales.',
                code: 'AUTH_ERROR'
            });
        }
    }
);

// =============================================================================
// REFRESH TOKEN ENDPOINT
// =============================================================================

router.post('/refresh', async (req: Request, res: Response) => {
    await handleRefreshToken(req, res);
});

// =============================================================================
// LOGOUT ENDPOINT
// =============================================================================

router.post('/logout', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
    await handleLogout(req, res);
});

// =============================================================================
// SWITCH ROLE ENDPOINT (For Jefes / Multi-role users)
// =============================================================================

router.post('/switch-role', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { userId, newRole, viewAs } = req.body;

        logger.info(`[Auth] Role switch request: User ${userId} -> ${newRole}`);
        auditLogin(req, userId, null, newRole, true);

        // Validate role
        const validRoles = ['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR', 'ALMACEN'];
        if (!validRoles.includes(newRole)) {
            return res.status(400).json({ 
                error: 'Rol no válido',
                code: 'INVALID_ROLE'
            });
        }

        // Verify the requesting user matches the userId
        if (req.user?.code !== userId) {
            logger.warn(`[Auth] Role switch denied: ${req.user?.code} tried to switch as ${userId}`);
            return res.status(403).json({ 
                error: 'No tienes permiso para cambiar este rol',
                code: 'FORBIDDEN'
            });
        }

        // Generate new tokens with new role
        const accessToken = signAccessToken({ 
            id: userId, 
            user: userId, 
            role: newRole,
            timestamp: Date.now()
        });
        
        const refreshToken = signRefreshToken({ 
            id: userId, 
            user: userId, 
            role: newRole
        });

        res.json({
            success: true,
            role: newRole,
            token: accessToken,
            refreshToken,
            viewAs: viewAs || null,
            tokenExpiresIn: 3600
        });

    } catch (error) {
        logger.error(`Switch role error: ${(error as Error).message}`);
        res.status(500).json({ 
            error: 'Error cambiando de rol',
            code: 'SERVER_ERROR'
        });
    }
});

// =============================================================================
// REPARTIDORES LIST ENDPOINT
// =============================================================================

let _repartidoresCache: any[] | null = null;
let _repartidoresCacheTime = 0;
const REPARTIDORES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

router.get('/repartidores', verifyToken, async (req: Request, res: Response) => {
    try {
        // Check cache
        const now = Date.now();
        if (_repartidoresCache && (now - _repartidoresCacheTime) < REPARTIDORES_CACHE_TTL) {
            logger.info(`[Auth] Returning ${_repartidoresCache.length} cached repartidores`);
            return res.json(_repartidoresCache);
        }

        const currentYear = new Date().getFullYear();
        let results: any[] = [];

        // Source 1: VEH.CODIGOCONDUCTOR
        try {
            const vehRows = await query(`
                SELECT DISTINCT TRIM(V.CODIGOCONDUCTOR) as CODE, TRIM(D.NOMBREVENDEDOR) as NAME
                FROM DSEDAC.VEH V
                JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(V.CODIGOCONDUCTOR)
                WHERE TRIM(V.CODIGOCONDUCTOR) <> '98'
                  AND TRIM(V.CODIGOCONDUCTOR) <> ''
                  AND V.CODIGOCONDUCTOR IS NOT NULL
            `, false);
            
            if (vehRows && vehRows.length > 0) {
                results.push(...vehRows.map((r: any) => ({ 
                    code: (r.CODE || '').toString().trim(), 
                    name: (r.NAME || '').toString().trim() 
                })));
            }
        } catch (e) {
            logger.warn(`[Auth] Error querying VEH conductors: ${(e as Error).message}`);
        }

        // Source 2: OPP active repartidores
        try {
            const repRows = await query(`
                SELECT TRIM(OPP.CODIGOREPARTIDOR) as CODE,
                       COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR)) as NAME
                FROM DSEDAC.OPP OPP
                LEFT JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
                WHERE OPP.CODIGOREPARTIDOR IS NOT NULL
                  AND TRIM(OPP.CODIGOREPARTIDOR) <> ''
                  AND OPP.ANOREPARTO = ${currentYear}
                  AND NOT EXISTS (
                    SELECT 1 FROM DSEDAC.VDDX X
                    WHERE TRIM(X.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
                      AND TRIM(X.JEFEVENTASSN) = 'S'
                  )
                GROUP BY TRIM(OPP.CODIGOREPARTIDOR), COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR))
                HAVING COUNT(*) >= 100
            `, false);
            
            if (repRows && repRows.length > 0) {
                results.push(...repRows.map((r: any) => ({ 
                    code: (r.CODE || '').toString().trim(), 
                    name: (r.NAME || '').toString().trim() 
                })));
            }
        } catch (e) {
            logger.warn(`[Auth] Error querying OPP: ${(e as Error).message}`);
        }

        // Deduplicate and filter
        const EXCLUDED_PREFIXES = ['ZZ', 'ZD', 'ZB', 'ZE', 'Z7', 'ZA', 'ZC', 'ZF', 'ZG', 'ZH', 'ZI', 'ZJ', 'ZK', 'ZL', 'ZM', 'ZN', 'ZO', 'ZP', 'ZQ', 'ZR', 'ZS', 'ZT', 'ZU', 'ZV', 'ZW', 'ZX', 'ZY', 'Z0', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z8', 'Z9', 'XX', 'TT', 'TEST'];
        const EXCLUDED_CODES = new Set(['UNK', '00', '0', '', 'NULL', 'NONE', 'N/A', '97', '98']);
        
        const uniqueMap = new Map();
        results.forEach(r => {
            if (!r.code || r.code.length === 0) return;
            const code = r.code.trim().toUpperCase();
            if (EXCLUDED_CODES.has(code)) return;
            if (EXCLUDED_PREFIXES.some(prefix => code.startsWith(prefix))) return;
            if (r.name && r.name.trim().toUpperCase().startsWith('ZZ')) return;
            if (code.length === 1 && !/^[0-9]$/.test(code)) return;
            if (!r.name || r.name.trim().length === 0 || r.name.trim() === r.code.trim()) return;
            uniqueMap.set(r.code, r);
        });
        
        const deduplicated = Array.from(uniqueMap.values())
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

        _repartidoresCache = deduplicated;
        _repartidoresCacheTime = now;
        
        logger.info(`[Auth] Repartidores list: ${deduplicated.length} entries`);
        res.json(deduplicated);
        
    } catch (error) {
        logger.error(`Error fetching repartidores: ${(error as Error).message}`);
        res.status(500).json({ error: 'Error de base de datos', code: 'DB_ERROR' });
    }
});

export default router;
