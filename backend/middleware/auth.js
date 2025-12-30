const logger = require('./logger');

/**
 * Middleware to verify Authentication Token
 * Expects header: Authorization: Bearer <token>
 * Token format: Base64(ID:USER:TIMESTAMP)
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
        // 3. Decode Token
        const decoded = Buffer.from(token, 'base64').toString('ascii');
        // Expected format: ID:USER:TIMESTAMP
        const parts = decoded.split(':');

        if (parts.length < 3) {
            logger.warn(`⛔ Invalid token format: ${req.ip}`);
            return res.status(403).json({ error: 'Token inválido.' });
        }

        const [id, user, timestamp] = parts;

        // 4. Check Expiry (24 hours)
        const tokenTime = parseInt(timestamp);
        const now = Date.now();
        const headers = 24 * 60 * 60 * 1000;

        if (isNaN(tokenTime) || (now - tokenTime > headers)) {
            logger.warn(`⛔ Expired token usage: ${user}`);
            return res.status(401).json({ error: 'Sesión expirada. Por favor, inicia sesión de nuevo.' });
        }

        // 5. Attach User to Request
        req.user = { id, code: user };
        next();

    } catch (error) {
        logger.error(`Auth middleware error: ${error.message}`);
        return res.status(403).json({ error: 'Fallo de autenticación.' });
    }
}

module.exports = verifyToken;
