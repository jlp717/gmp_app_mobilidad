/**
 * GMP App Enhanced Authentication Middleware
 * HMAC-signed JWT tokens with refresh token rotation
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const logger = require('./logger');

// =============================================================================
// CONFIGURATION
// =============================================================================

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

if (ACCESS_SECRET.length < 32) {
    logger.warn('[AUTH] WARNING: JWT_ACCESS_SECRET is too short. Use at least 32 characters.');
}
if (REFRESH_SECRET.length < 32) {
    logger.warn('[AUTH] WARNING: JWT_REFRESH_SECRET is too short. Use at least 32 characters.');
}

const ACCESS_TTL_MS = parseInt(process.env.JWT_ACCESS_EXPIRES || '3600000', 10);
const REFRESH_TTL_MS = parseInt(process.env.JWT_REFRESH_EXPIRES || '604800000', 10);
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10);
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// =============================================================================
// SESSION STORAGE
// =============================================================================

const activeSessions = new Map();

setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, sessions] of activeSessions.entries()) {
        const validSessions = sessions.filter(s => s.expiresAt > now);
        if (validSessions.length !== sessions.length) {
            activeSessions.set(userId, validSessions);
            cleanedCount += sessions.length - validSessions.length;
        }
        if (validSessions.length === 0) {
            activeSessions.delete(userId);
        }
    }
    
    if (cleanedCount > 0) {
        logger.info(`[AUTH] Cleaned up ${cleanedCount} expired sessions`);
    }
}, SESSION_CLEANUP_INTERVAL_MS);

// =============================================================================
// TOKEN SIGNING & VERIFICATION
// =============================================================================

function signToken(payload, secret) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return `${data}.${sig}`;
}

function verifyTokenData(token, secret, ttlMs) {
    if (!token || !token.includes('.')) return null;
    
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    const [data, sig] = parts;
    if (!data || !sig) return null;
    
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    
    if (sig.length !== expectedSig.length) return null;
    
    try {
        const sigBuffer = Buffer.from(sig, 'hex');
        const expectedBuffer = Buffer.from(expectedSig, 'hex');
        
        if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;
    } catch (e) {
        return null;
    }
    
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
        if (!payload.timestamp) return null;
        
        const age = Date.now() - payload.timestamp;
        if (age > ttlMs) return null;
        
        return payload;
    } catch (e) {
        return null;
    }
}

exports.signAccessToken = (payload) => {
    return signToken({ ...payload, type: 'access', timestamp: Date.now() }, ACCESS_SECRET);
};

exports.signRefreshToken = (payload) => {
    return signToken({ ...payload, type: 'refresh', timestamp: Date.now() }, REFRESH_SECRET);
};

exports.verifyAccessToken = (token) => {
    const payload = verifyTokenData(token, ACCESS_SECRET, ACCESS_TTL_MS);
    if (!payload || payload.type !== 'access') return null;
    return payload;
};

exports.verifyRefreshToken = (token) => {
    const payload = verifyTokenData(token, REFRESH_SECRET, REFRESH_TTL_MS);
    if (!payload || payload.type !== 'refresh') return null;
    return payload;
};

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

function registerSession(userId, refreshToken, userAgent, ip) {
    const now = Date.now();
    const session = {
        refreshToken,
        userId,
        userAgent,
        ip,
        createdAt: now,
        expiresAt: now + REFRESH_TTL_MS
    };
    
    const userSessions = activeSessions.get(userId) || [];
    
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
        userSessions.sort((a, b) => a.createdAt - b.createdAt);
        userSessions.shift();
        logger.info(`[AUTH] Removed oldest session for user ${userId}`);
    }
    
    userSessions.push(session);
    activeSessions.set(userId, userSessions);
    
    logger.info(`[AUTH] Registered new session for user ${userId} from ${ip}`);
}

exports.invalidateAllSessions = (userId) => {
    activeSessions.delete(userId);
    logger.info(`[AUTH] Invalidated all sessions for user ${userId}`);
};

function isRefreshTokenValid(userId, refreshToken) {
    const sessions = activeSessions.get(userId);
    if (!sessions) return false;
    return sessions.some(s => s.refreshToken === refreshToken && s.expiresAt > Date.now());
}

function revokeRefreshToken(userId, refreshToken) {
    const sessions = activeSessions.get(userId);
    if (sessions) {
        const filtered = sessions.filter(s => s.refreshToken !== refreshToken);
        if (filtered.length > 0) {
            activeSessions.set(userId, filtered);
        } else {
            activeSessions.delete(userId);
        }
    }
}

// =============================================================================
// PASSWORD HASHING
// =============================================================================

exports.hashPassword = async (password, saltRounds = 12) => {
    return bcrypt.hash(password, saltRounds);
};

exports.verifyPassword = async (password, hash) => {
    return bcrypt.compare(password, hash);
};

exports.validatePasswordStrength = (password) => {
    const errors = [];
    
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (password.length > 100) errors.push('Password must be less than 100 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number');
    
    return { valid: errors.length === 0, errors };
};

// =============================================================================
// EXPRESS MIDDLEWARE
// =============================================================================

exports.verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        logger.warn(`[AUTH] Access attempt without token: ${req.method} ${req.path} (${req.ip})`);
        return res.status(401).json({ error: 'Acceso denegado. Se requiere autenticación.', code: 'MISSING_TOKEN' });
    }
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Token con formato inválido.', code: 'INVALID_FORMAT' });
    }
    
    const token = parts[1];
    
    try {
        const payload = exports.verifyAccessToken(token);
        
        if (!payload) {
            logger.warn(`[AUTH] Invalid or expired token: ${req.ip}`);
            return res.status(401).json({ error: 'Sesión expirada. Por favor, inicia sesión de nuevo.', code: 'TOKEN_EXPIRED' });
        }
        
        req.user = {
            id: payload.id,
            code: payload.user,
            name: payload.name, // INCLUDE name from token
            role: payload.role || 'COMERCIAL',
            isJefeVentas: payload.isJefeVentas || false
        };

        req.tokenPayload = payload;
        next();
    } catch (error) {
        logger.error(`[AUTH] Middleware error: ${error.message}`);
        res.status(403).json({ error: 'Fallo de autenticación.', code: 'AUTH_FAILED' });
    }
};

exports.optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return next();

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return next();

    const token = parts[1];
    const payload = exports.verifyAccessToken(token);

    if (payload) {
        req.user = {
            id: payload.id,
            code: payload.user,
            name: payload.name, // INCLUDE name from token
            role: payload.role || 'COMERCIAL',
            isJefeVentas: payload.isJefeVentas || false
        };
        req.tokenPayload = payload;
    }

    next();
};

exports.requireRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Autenticación requerida', code: 'MISSING_TOKEN' });
        }
        
        if (!roles.includes(req.user.role)) {
            logger.warn(`[AUTH] Role check failed: ${req.user.role} not in [${roles.join(', ')}]`);
            return res.status(403).json({ error: 'No tienes permisos para realizar esta acción', code: 'INSUFFICIENT_ROLE' });
        }
        
        next();
    };
};

exports.requireJefeVentas = (req, res, next) => {
    if (!req.user?.isJefeVentas) {
        logger.warn(`[AUTH] Jefe Ventas access denied for user: ${req.user?.code}`);
        return res.status(403).json({ error: 'Acceso restringido a Jefes de Ventas', code: 'INSUFFICIENT_ROLE' });
    }
    next();
};

// =============================================================================
// REFRESH TOKEN HANDLER
// =============================================================================

exports.handleRefreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required', code: 'MISSING_REFRESH_TOKEN' });
        }
        
        const payload = exports.verifyRefreshToken(refreshToken);
        
        if (!payload) {
            logger.warn(`[AUTH] Invalid or expired refresh token from IP: ${req.ip}`);
            return res.status(401).json({ error: 'Refresh token inválido o expirado', code: 'INVALID_REFRESH_TOKEN' });
        }
        
        const userId = payload.id;
        const userCode = payload.user;
        
        if (!isRefreshTokenValid(userId, refreshToken)) {
            logger.warn(`[AUTH] Revoked refresh token used from IP: ${req.ip}`);
            exports.invalidateAllSessions(userId);
            return res.status(401).json({ error: 'Sesión revocada. Por favor, inicia sesión de nuevo.', code: 'SESSION_REVOKED' });
        }
        
        revokeRefreshToken(userId, refreshToken);
        
        const newAccessToken = exports.signAccessToken({
            id: userId,
            user: userCode,
            role: payload.role,
            isJefeVentas: payload.isJefeVentas
        });
        
        const newRefreshToken = exports.signRefreshToken({
            id: userId,
            user: userCode,
            role: payload.role,
            isJefeVentas: payload.isJefeVentas
        });
        
        registerSession(userId, newRefreshToken, req.get('user-agent') || 'unknown', req.ip || 'unknown');
        
        logger.info(`[AUTH] Token refreshed for user ${userCode}`);
        
        res.json({
            success: true,
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: ACCESS_TTL_MS / 1000
        });
        
    } catch (error) {
        logger.error(`[AUTH] Refresh token error: ${error.message}`);
        res.status(500).json({ error: 'Error refreshing token', code: 'REFRESH_ERROR' });
    }
};

exports.handleLogout = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (userId) {
            exports.invalidateAllSessions(userId);
            logger.info(`[AUTH] User ${userId} logged out`);
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        logger.error(`[AUTH] Logout error: ${error.message}`);
        res.status(500).json({ error: 'Error during logout' });
    }
};

// =============================================================================
// EXPORTS
// =============================================================================

exports.ACCESS_TTL_MS = ACCESS_TTL_MS;
exports.REFRESH_TTL_MS = REFRESH_TTL_MS;
exports.activeSessions = activeSessions;

module.exports = exports;
