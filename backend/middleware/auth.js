const crypto = require('crypto');
const logger = require('./logger');

// =============================================================================
// TOKEN SECURITY — HMAC-SHA256 signed tokens
// =============================================================================
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sign a payload into an HMAC token: base64(payload).signature
 * Prevents token forgery — only the server can produce valid signatures.
 */
function signToken(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    return `${data}.${sig}`;
}

/**
 * Middleware to verify Authentication Token
 * Accepts HMAC-signed tokens (new) and legacy Base64 tokens (backward-compatible)
 * Header: Authorization: Bearer <token>
 */
function verifyToken(req, res, next) {
    // 1. Check Header
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        logger.warn(`⛔ Access attempt without token: ${req.method} ${req.path} (${req.ip})`);
        return res.status(401).json({ error: 'Acceso denegado. Se requiere autenticación.' });
    }

    // 2. Parse Bearer Token
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token con formato inválido.' });
    }

    try {
        // Attempt HMAC-signed token first (new format: base64payload.signature)
        if (token.includes('.')) {
            const [data, sig] = token.split('.');
            if (data && sig) {
                const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
                // Timing-safe comparison to prevent timing attacks
                if (sig.length === expectedSig.length &&
                    crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
                    const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
                    if (Date.now() - payload.timestamp > TOKEN_TTL_MS) {
                        logger.warn(`⛔ Expired HMAC token: ${payload.user}`);
                        return res.status(401).json({ error: 'Sesión expirada. Por favor, inicia sesión de nuevo.' });
                    }
                    req.user = { id: payload.id, code: payload.user };
                    return next();
                }
            }
        }

        // Fallback: Legacy Base64 token (backward-compatible for existing sessions)
        const decoded = Buffer.from(token, 'base64').toString('ascii');
        const parts = decoded.split(':');

        if (parts.length < 3) {
            logger.warn(`⛔ Invalid token format: ${req.ip}`);
            return res.status(403).json({ error: 'Token inválido.' });
        }

        const [id, user, timestamp] = parts;
        const tokenTime = parseInt(timestamp);

        if (isNaN(tokenTime) || (Date.now() - tokenTime > TOKEN_TTL_MS)) {
            logger.warn(`⛔ Expired legacy token: ${user}`);
            return res.status(401).json({ error: 'Sesión expirada. Por favor, inicia sesión de nuevo.' });
        }

        req.user = { id, code: user };
        next();

    } catch (error) {
        logger.error(`Auth middleware error: ${error.message}`);
        return res.status(403).json({ error: 'Fallo de autenticación.' });
    }
}

module.exports = verifyToken;
module.exports.signToken = signToken;
