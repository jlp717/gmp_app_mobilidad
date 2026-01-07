const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

// Track failed login attempts per username (in-memory)
const failedLoginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_TIME = 30 * 60 * 1000; // 30 minutes lockout

// STRICT rate limiter for login endpoint
// STRICT rate limiter for login endpoint
const loginLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute (Reduced for debug)
    max: 100, // Increased for debug
    message: { error: 'Demasiados intentos de login. Espera 1 minuto.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Helper to handle failed logins
function failLogin(res, safeUser, requestId, message) {
    const currentAttempts = failedLoginAttempts.get(safeUser) || { count: 0, lastAttempt: 0 };
    currentAttempts.count += 1;
    currentAttempts.lastAttempt = Date.now();
    failedLoginAttempts.set(safeUser, currentAttempts);

    const remainingAttempts = MAX_FAILED_ATTEMPTS - currentAttempts.count;
    logger.warn(`[${requestId}] ❌ Login failed for user: ${safeUser} (attempt ${currentAttempts.count}/${MAX_FAILED_ATTEMPTS})`);

    if (remainingAttempts <= 0) {
        return res.status(429).json({
            error: 'Cuenta bloqueada por demasiados intentos fallidos. Espera 30 minutos.'
        });
    }

    return res.status(401).json({
        error: `${message}. Te quedan ${remainingAttempts} intentos.`
    });
}

// =============================================================================
// LOGIN ENDPOINT
// =============================================================================
router.post('/login', loginLimiter, async (req, res) => {
    const requestId = Date.now().toString(36);

    try {
        const { username, password } = req.body;

        // Input validation
        if (!username || !password) {
            logger.warn(`[${requestId}] Login attempt with missing credentials`);
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        // Sanitize and normalize inputs
        // Sanitize and normalize inputs (Allow spaces/dots/hyphens/parens for names)
        const safeUser = username.replace(/[^a-zA-Z0-9 .-_()]/g, '').trim().toUpperCase();

        if (safeUser.length < 2 || safeUser.length > 50) {
            logger.warn(`[${requestId}] Login attempt with invalid username length: ${safeUser.length}`);
            return res.status(400).json({ error: 'Usuario inválido' });
        }

        // Check if account is locked out due to failed attempts
        const lockoutInfo = failedLoginAttempts.get(safeUser);
        if (lockoutInfo && lockoutInfo.count >= MAX_FAILED_ATTEMPTS) {
            const timeSinceLockout = Date.now() - lockoutInfo.lastAttempt;
            if (timeSinceLockout < LOCKOUT_TIME) {
                const minutesRemaining = Math.ceil((LOCKOUT_TIME - timeSinceLockout) / 60000);
                logger.warn(`[${requestId}] Locked account access attempt: ${safeUser}`);
                return res.status(429).json({
                    error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutesRemaining} minutos.`
                });
            } else {
                // Lockout expired, reset counter
                failedLoginAttempts.delete(safeUser);
            }
        }

        // Use parameterized query to prevent SQL injection
        const trimmedPwd = password.trim();

        // Query database for user WITHOUT password check first (to allow PIN lookup)
        // We find the user by ID/Name, then check if they have a PIN.
        // MODIFIED: Check both CODIGOUSUARIO and NOMBREUSUARIO for exact match
        const users = await queryWithParams(`
            SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA, DELEGACION, GRUPO
            FROM DSEDAC.APPUSUARIOS
            WHERE (UPPER(TRIM(CODIGOUSUARIO)) = ? OR UPPER(TRIM(NOMBREUSUARIO)) = ?)
              AND SUBEMPRESA = 'GMP'
            FETCH FIRST 1 ROWS ONLY
        `, [safeUser, safeUser], false);

        if (users.length === 0) {
            // USABILITY FIX: If not found by UserID/Name, try finding by VENDOR CODE
            // 1. Look up Vendor by Code to get the Name/Email
            const vendorLookup = await query(`
                SELECT X.CORREOELECTRONICO 
                FROM DSEDAC.VDC V
                JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                WHERE V.SUBEMPRESA = 'GMP' AND TRIM(V.CODIGOVENDEDOR) = ?
                FETCH FIRST 1 ROWS ONLY
            `, [safeUser], false);

            if (vendorLookup.length > 0) {
                const namePattern = (vendorLookup[0].CORREOELECTRONICO || '').trim().substring(0, 5); // First 5 chars
                if (namePattern.length >= 3) {
                    logger.info(`🔄 VendorCode ${safeUser} mapped to Pattern '${namePattern}'. Searching AppUser...`);
                    // 2. Find AppUser by this name pattern
                    // 2. Find AppUser by this name pattern (String Interpolation for ODBC compatibility)
                    const safePattern = namePattern.replace(/'/g, "''");
                    logger.info(`Searching APPUSUARIOS for LIKE '%${safePattern}%'`);
                    users = await query(`
                        SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA, DELEGACION 
                        FROM DSEDAC.APPUSUARIOS 
                        WHERE UPPER(NOMBREUSUARIO) LIKE '%${safePattern}%'
                          AND SUBEMPRESA = 'GMP'
                     `, false);
                }
            }
        }

        if (users.length === 0) {
            // FALLBACK C: DIRECT VENDOR LOGIN (No App User)
            // If the input is a valid Vendor Code, allow login if PIN matches.
            // This covers vendors who don't have a linked APPUSER account.

            logger.info(`🔍 User '${safeUser}' not found in APPUSUARIOS. Checking if it is a direct Vendor Code...`);

            const directVendorCheck = await query(`
                SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, P.CODIGOPIN
                FROM DSEDAC.VDC V
                LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                LEFT JOIN DSEDAC.VDPL1 P ON V.CODIGOVENDEDOR = P.CODIGOVENDEDOR
                WHERE V.SUBEMPRESA = 'GMP' AND TRIM(V.CODIGOVENDEDOR) = ?
                FETCH FIRST 1 ROWS ONLY
            `, [safeUser], false);

            if (directVendorCheck.length > 0) {
                const vendorInfo = directVendorCheck[0];
                const dbPin = vendorInfo.CODIGOPIN?.toString().trim();

                if (dbPin === trimmedPwd) {
                    logger.info(`🔐 Direct Vendor Login Successful: ${safeUser}`);

                    // Create a synthetic user session
                    const isJefe = vendorInfo.JEFEVENTASSN === 'S';
                    const token = Buffer.from(`VENDOR:${safeUser}:${Date.now()}`).toString('base64');

                    // Fetch all vendor codes if Jefe (Logic aligned with standard flow)
                    let vendedorCodes = [safeUser];
                    if (isJefe) {
                        const allVendedores = await query("SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'");
                        const orphans = ['82', '20', 'UNK'];
                        const existingCodes = new Set(allVendedores.map(v => v.CODE));
                        orphans.forEach(o => existingCodes.add(o));
                        vendedorCodes = Array.from(existingCodes);
                    }

                    return res.json({
                        user: {
                            id: `V${safeUser}`,
                            code: safeUser,
                            name: `Comercial ${safeUser}`, // Synthetic Name
                            company: 'GMP',
                            delegation: '',
                            vendedorCode: safeUser,
                            isJefeVentas: isJefe,
                            tipoVendedor: vendorInfo.TIPOVENDEDOR?.trim() || '-',
                            role: isJefe ? 'JEFE_VENTAS' : 'COMERCIAL'
                        },
                        vendedorCodes: vendedorCodes,
                        token: token
                    });
                } else {
                    logger.warn(`🚫 Direct Vendor Login: User ${safeUser} found but PIN mismatch.`);
                    return failLogin(res, safeUser, requestId, 'Contraseña o PIN incorrecto');
                }
            }

            // User doesn't exist at all (Neither AppUser nor VendorCode)
            return failLogin(res, safeUser, requestId, 'Usuario no encontrado');
        }

        const user = users[0];
        // trimmedPwd already declared above line 60
        let isAuthenticated = false;
        let authMethod = 'NONE';

        // ---------------------------------------------------------
        // A. RESOLVE VENDOR & CHECK PIN (Priority for Mobile App)
        // ---------------------------------------------------------
        const searchPattern = (user.NOMBREUSUARIO || '').trim().toUpperCase().substring(0, 4);
        let vendedorInfo = [];

        let vendedorCode = null;
        let isJefeVentas = false;
        let tipoVendedor = null;

        if (searchPattern.length >= 2) {
            try {
                // Sanitize pattern further to avoid SQL errors
                const safeSearchPattern = searchPattern.replace(/'/g, "''");

                vendedorInfo = await query(`
                    SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
                    FROM DSEDAC.VDC V
                    LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                    WHERE V.SUBEMPRESA = 'GMP' AND UPPER(X.CORREOELECTRONICO) LIKE '${safeSearchPattern}%'
                    FETCH FIRST 1 ROWS ONLY
                `, false); // Don't log this query to avoid noise

                if (vendedorInfo.length > 0) {
                    vendedorCode = vendedorInfo[0].CODIGOVENDEDOR?.trim();
                    isJefeVentas = vendedorInfo[0].JEFEVENTASSN === 'S';
                    tipoVendedor = vendedorInfo[0].TIPOVENDEDOR?.trim();
                }
            } catch (err) {
                logger.warn(`Auth vendor lookup failed for pattern ${searchPattern}: ${err.message}`);
                // Continue without crashing - just means no vendor link
            }
        }

        // FORCE JEFE STATUS FOR ADMIN/JAVIER (Testing Override)
        const FORCE_JEFE_USERS = ['JAVIER', 'ADMIN', 'NDELAMO'];
        if (FORCE_JEFE_USERS.includes(safeUser)) {
            isJefeVentas = true;
            logger.info(`👑 Forced JEFE status for user: ${safeUser}`);
        }

        // If User is Linked to a Vendor, Check VDPL1 PIN
        if (vendedorCode) {
            try {
                // Check PIN in DSEDAC.VDPL1
                const pinResult = await query(`
                    SELECT CODIGOPIN 
                    FROM DSEDAC.VDPL1 
                    WHERE TRIM(CODIGOVENDEDOR) = '${vendedorCode}'
                    FETCH FIRST 1 ROWS ONLY
                `);

                if (pinResult.length > 0) {
                    const dbPin = pinResult[0].CODIGOPIN?.toString().trim();
                    if (dbPin === trimmedPwd) {
                        isAuthenticated = true;
                        authMethod = 'PIN';
                        logger.info(`🔐 User ${safeUser} authenticated via PIN (Vendor ${vendedorCode})`);
                    } else {
                        logger.warn(`🚫 User ${safeUser} PIN verification failed.`);
                    }
                } else {
                    logger.warn(`⚠️ User ${safeUser} is vendor ${vendedorCode} but has no PIN in VDPL1.`);
                }
            } catch (pinErr) {
                logger.error(`Error checking PIN: ${pinErr.message}`);
            }
        }

        // ---------------------------------------------------------
        // B. FALLBACK: APPUSUARIOS PASSWORD (Legacy/Admin)
        // ---------------------------------------------------------
        // CRITICAL FIX: Only allow password fallback if user is NOT linked to a vendor (No PIN available)
        // If they have a vendorCode, they MUST use the PIN.
        if (!isAuthenticated && !vendedorCode) {
            const dbPwd = user.PASSWORD ? user.PASSWORD.trim() : '';
            if (dbPwd === trimmedPwd) {
                isAuthenticated = true;
                authMethod = 'PASSWORD';
                logger.info(`🔑 User ${safeUser} authenticated via APPUSUARIOS Password (No Vendor Link)`);
            }
        }

        // ---------------------------------------------------------
        // C. FINAL DECISION
        // ---------------------------------------------------------
        if (!isAuthenticated) {
            return failLogin(res, safeUser, requestId, 'Contraseña o PIN incorrecto');
        }

        // Fetch all vendor codes for Jefe/Admin view
        const allVendedores = await query(`
            SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
        `);
        // Inject Orphan Vendor Codes (Critical for full scope)
        const orphans = ['82', '20', 'UNK'];
        const existingCodes = new Set(allVendedores.map(v => v.CODE));
        orphans.forEach(o => existingCodes.add(o));
        const vendedorCodes = Array.from(existingCodes);

        const response = {
            user: {
                id: user.ID,
                code: user.CODIGOUSUARIO?.trim(),
                name: user.NOMBREUSUARIO?.trim(),
                company: user.SUBEMPRESA?.trim(),
                delegation: user.DELEGACION?.trim() || '',
                vendedorCode: vendedorCode,
                isJefeVentas: isJefeVentas,
                tipoVendedor: tipoVendedor || '-',
                role: isJefeVentas ? 'JEFE_VENTAS' : 'COMERCIAL'
            },
            // If jefe ventas, return ALL codes. If commercial, return their code (if any)
            vendedorCodes: isJefeVentas ? vendedorCodes : (vendedorCode ? [vendedorCode] : []),
            token: Buffer.from(`${user.ID}:${user.CODIGOUSUARIO}:${Date.now()}`).toString('base64')
        };

        logger.info(`✅ Login successful: ${user.CODIGOUSUARIO} (${response.user.role})`);
        res.json(response);

    } catch (error) {
        logger.error(`Login error: ${error.message}`);
        // Return 401 Unauthorized for ANY login failure to show modal in frontend, 
        // instead of 500 which is treated as server crash.
        // Unless it's a rate limit error handled above.
        res.status(401).json({ error: 'Error de autenticación. Verifique sus credenciales.' });
    }
});

module.exports = router;
