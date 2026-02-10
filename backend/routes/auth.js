const express = require('express');
const router = express.Router();
const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const authenticateToken = require('../middleware/auth');
const { signToken } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/security');

// Track failed login attempts per username (in-memory)
const failedLoginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_TIME = 30 * 60 * 1000; // 30 minutes lockout

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
// LOGIN ENDPOINT - Using VDPL1 as primary auth source
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
        const safeUser = username.replace(/[^a-zA-Z0-9 .-_()]/g, '').trim().toUpperCase();
        const trimmedPwd = password.trim();

        if (safeUser.length < 1 || safeUser.length > 50) {
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
                failedLoginAttempts.delete(safeUser);
            }
        }

        let vendedorCode = null;
        let vendedorName = null;
        let isJefeVentas = false;
        let tipoVendedor = null;

        // ===================================================================
        // STEP 1: Try to find vendor by CODE directly in VDPL1
        // ===================================================================
        logger.info(`[${requestId}] 🔍 Attempting login for: ${safeUser}`);

        let pinRecord = await queryWithParams(`
            SELECT P.CODIGOVENDEDOR, P.CODIGOPIN, 
                   TRIM(D.NOMBREVENDEDOR) as NOMBREVENDEDOR,
                   V.TIPOVENDEDOR, X.JEFEVENTASSN,
                   E.HIDE_COMMISSIONS
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
            LEFT JOIN DSEDAC.VDDX X ON P.CODIGOVENDEDOR = X.CODIGOVENDEDOR
            LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON P.CODIGOVENDEDOR = E.CODIGOVENDEDOR
            WHERE TRIM(P.CODIGOVENDEDOR) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [safeUser], false);

        // ===================================================================
        // STEP 2: If not found by code, try to find by NAME in VDD
        // ===================================================================
        if (pinRecord.length === 0) {
            logger.info(`[${requestId}] 🔄 Not found by code, searching by name...`);

            // Search by name - compare without spaces to handle "MARICARMEN" vs "93 MARI CARMEN"
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
                WHERE REPLACE(UPPER(TRIM(D.NOMBREVENDEDOR)), ' ', '') LIKE CONCAT('%', REPLACE(?, ' ', ''), '%')
                FETCH FIRST 1 ROWS ONLY
            `, [safeUser], false);

            if (nameSearch.length > 0) {
                pinRecord = nameSearch;
                logger.info(`[${requestId}] ✅ Found vendor by name: ${nameSearch[0].NOMBREVENDEDOR} -> Code ${nameSearch[0].CODIGOVENDEDOR}`);
            }
        }

        // ===================================================================
        // STEP 3: Validate credentials
        // ===================================================================
        if (pinRecord.length === 0) {
            logger.warn(`[${requestId}] ❌ User not found: ${safeUser}`);
            return failLogin(res, safeUser, requestId, 'Usuario no encontrado');
        }

        const vendor = pinRecord[0];
        const dbPin = vendor.CODIGOPIN?.toString().trim();
        vendedorCode = vendor.CODIGOVENDEDOR?.toString().trim();
        // Clean vendor name - remove leading code like "93 " from "93 MARI CARMEN"
        let rawName = vendor.NOMBREVENDEDOR || `Comercial ${vendedorCode}`;
        vendedorName = rawName.replace(/^\d+\s+/, '').trim(); // Remove leading digits and spaces
        isJefeVentas = vendor.JEFEVENTASSN === 'S';
        tipoVendedor = vendor.TIPOVENDEDOR?.trim();

        // Check PIN
        if (dbPin !== trimmedPwd) {
            logger.warn(`[${requestId}] 🚫 PIN mismatch for vendor ${vendedorCode}`);
            return failLogin(res, safeUser, requestId, 'PIN incorrecto');
        }

        // ===================================================================
        // NEW: Check for REPARTIDOR Role (Vehicle assigned)
        // ===================================================================
        let isRepartidor = false;
        let codigoConductor = null;
        let matriculaVehiculo = null;

        try {
            const vehCheck = await queryWithParams(`
                SELECT TRIM(CODIGOVEHICULO) as VEHICULO, TRIM(MATRICULA) as MATRICULA 
                FROM DSEDAC.VEH 
                WHERE TRIM(CODIGOVENDEDOR) = ? 
                FETCH FIRST 1 ROWS ONLY
            `, [vendedorCode], false);

            if (vehCheck.length > 0) {
                isRepartidor = true;
                matriculaVehiculo = vehCheck[0].MATRICULA;
                codigoConductor = vendedorCode;
                logger.info(`[${requestId}] 🚚 Detected Repartidor Role for ${vendedorCode} (Vehicle: ${matriculaVehiculo})`);
            }
        } catch (vehError) {
            logger.warn(`[${requestId}] Error checking vehicle: ${vehError.message}`);
        }

        // ===================================================================
        // STEP 4: Success! Build response
        // ===================================================================
        logger.info(`[${requestId}] 🔐 Login successful for ${vendedorName} (${vendedorCode})`);
        failedLoginAttempts.delete(safeUser); // Clear failed attempts on success

        // Determine final role
        let finalRole = 'COMERCIAL';
        if (isJefeVentas) finalRole = 'JEFE_VENTAS';
        else if (isRepartidor) finalRole = 'REPARTIDOR';

        // Fetch all vendor codes for Jefe/Admin view
        let vendedorCodes = [vendedorCode];
        if (isJefeVentas) {
            const allVendedores = await query(`
                SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
            `);
            const orphans = ['82', '20', 'UNK'];
            const existingCodes = new Set(allVendedores.map(v => v.CODE));
            orphans.forEach(o => existingCodes.add(o));
            vendedorCodes = Array.from(existingCodes);
        }

        // SECURITY: HMAC-signed token — prevents forgery
        const token = signToken({ id: `V${vendedorCode}`, user: vendedorCode, timestamp: Date.now() });

        const response = {
            user: {
                id: `V${vendedorCode}`,
                code: vendedorCode,
                name: vendedorName,
                company: 'GMP',
                delegation: '',
                vendedorCode: vendedorCode,
                isJefeVentas: isJefeVentas,
                tipoVendedor: tipoVendedor || '-',
                role: finalRole,
                // Add Repartidor specific fields
                isRepartidor: isRepartidor,
                codigoConductor: codigoConductor,
                matricula: matriculaVehiculo,
                // NEW: Commission Visibility
                showCommissions: vendor.HIDE_COMMISSIONS !== 'Y'
            },
            role: finalRole, // Root level role for easier access
            isRepartidor: isRepartidor, // Root level flag
            showCommissions: vendor.HIDE_COMMISSIONS !== 'Y', // Root level flag
            vendedorCodes: vendedorCodes,
            token: token,
            // NEW: Update Notification
            latestVersion: '3.0.1',
            updateMessage: 'Nueva versión disponible. ¡Actualiza para ver los nuevos objetivos!'
        };

        logger.info(`✅ Login successful: ${vendedorCode} - ${vendedorName} (${response.user.role})`);
        res.json(response);

    } catch (error) {
        logger.error(`Login error: ${error.message}`);
        res.status(401).json({ error: 'Error de autenticación. Verifique sus credenciales.' });
    }
});

// =============================================================================
// SWITCH ROLE ENDPOINT - For Jefes / Multi-role users
// =============================================================================
router.post('/switch-role', authenticateToken, async (req, res) => {
    try {
        const { userId, newRole, viewAs } = req.body;

        logger.info(`[Auth] Role switch request: User ${userId} -> ${newRole}`);

        // Validate role
        if (!['COMERCIAL', 'JEFE_VENTAS', 'REPARTIDOR'].includes(newRole)) {
            return res.status(400).json({ error: 'Rol no válido' });
        }

        // Verify the requesting user matches the userId
        if (req.user.code !== userId) {
            logger.warn(`[Auth] Role switch denied: ${req.user.code} tried to switch as ${userId}`);
            return res.status(403).json({ error: 'No tienes permiso para cambiar este rol' });
        }

        // SECURITY: HMAC-signed token
        const token = signToken({ id: userId, user: userId, timestamp: Date.now(), role: newRole });

        res.json({
            success: true,
            role: newRole,
            token: token,
            viewAs: viewAs || null
        });

    } catch (error) {
        logger.error(`Switch role error: ${error.message}`);
        res.status(500).json({ error: 'Error cambiando de rol' });
    }
});

// GET /repartidores - List of all repartidores for Jefe dropdown
router.get('/repartidores', authenticateToken, async (req, res) => {
    try {
        const sql = `
          SELECT DISTINCT 
            V.CODIGOVENDEDOR as code, 
            TRIM(D.NOMBREVENDEDOR) as name
          FROM DSEDAC.VEH V
          JOIN DSEDAC.VDD D ON V.CODIGOVENDEDOR = D.CODIGOVENDEDOR
          ORDER BY V.CODIGOVENDEDOR
        `;
        const result = await query(sql);
        res.json(result);
    } catch (error) {
        logger.error(`Error fetching repartidores: ${error.message}`);
        res.status(500).json({ error: 'Error de base de datos' });
    }
});

module.exports = router;
