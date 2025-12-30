const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams } = require('../config/db');
const { loginLimiter } = require('../middleware/security');

// Track failed login attempts per username (in-memory - consider Redis for production)
const failedLoginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_TIME = 30 * 60 * 1000; // 30 minutes lockout

// =============================================================================
// LOGIN ENDPOINT (with security protections)
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
        const safeUser = username.replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();

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

        // Query database for user using parameterized query
        // Uses ? placeholders to prevent SQL injection
        const users = await queryWithParams(`
      SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA, DELEGACION, GRUPO
      FROM DSEDAC.APPUSUARIOS
      WHERE UPPER(TRIM(CODIGOUSUARIO)) = ?
        AND TRIM(PASSWORD) = ?
        AND SUBEMPRESA = 'GMP'
      FETCH FIRST 1 ROWS ONLY
    `, [safeUser, trimmedPwd], false); // Don't log query with password

        if (users.length === 0) {
            // Track failed attempt
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
                error: `Credenciales inválidas. Te quedan ${remainingAttempts} intentos.`
            });
        }

        // Successful login - clear any failed attempts
        failedLoginAttempts.delete(safeUser);

        const user = users[0];
        const searchPattern = (user.NOMBREUSUARIO || '').trim().toUpperCase().substring(0, 4);

        let vendedorInfo = [];
        if (searchPattern.length >= 2) {
            vendedorInfo = await query(`
        SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
        FROM DSEDAC.VDC V
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP' AND UPPER(X.CORREOELECTRONICO) LIKE '%${searchPattern}%'
        FETCH FIRST 1 ROWS ONLY
      `);
        }

        const allVendedores = await query(`
      SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
    `);
        const vendedorCodes = allVendedores.map(v => v.CODE);

        let vendedorCode = null;
        let isJefeVentas = false;
        let tipoVendedor = null;

        if (vendedorInfo.length > 0) {
            vendedorCode = vendedorInfo[0].CODIGOVENDEDOR?.trim();
            isJefeVentas = vendedorInfo[0].JEFEVENTASSN === 'S';
            tipoVendedor = vendedorInfo[0].TIPOVENDEDOR?.trim();
        } else {
            isJefeVentas = true;
        }

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
            vendedorCodes: isJefeVentas ? vendedorCodes : (vendedorCode ? [vendedorCode] : vendedorCodes),
            token: Buffer.from(`${user.ID}:${user.CODIGOUSUARIO}:${Date.now()}`).toString('base64')
        };

        logger.info(`✅ Login successful: ${user.CODIGOUSUARIO} (${response.user.role})`);
        res.json(response);

    } catch (error) {
        logger.error(`Login error: ${error.message}`);
        res.status(500).json({ error: 'Error de autenticación', details: error.message });
    }
});

module.exports = router;
