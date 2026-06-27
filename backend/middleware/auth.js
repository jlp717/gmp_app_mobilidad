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

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

if (isProduction && !process.env.JWT_ACCESS_SECRET) {
    throw new Error('[AUTH] FATAL: JWT_ACCESS_SECRET must be set in production. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
if (isProduction && !process.env.JWT_REFRESH_SECRET) {
    throw new Error('[AUTH] FATAL: JWT_REFRESH_SECRET must be set in production. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

if (!isProduction && !process.env.JWT_ACCESS_SECRET) {
    logger.warn('[AUTH] ⚠️ JWT_ACCESS_SECRET not set — using ephemeral secret (dev only, all sessions reset on restart)');
}
if (!isProduction && !process.env.JWT_REFRESH_SECRET) {
    logger.warn('[AUTH] ⚠️ JWT_REFRESH_SECRET not set — using ephemeral secret (dev only, all sessions reset on restart)');
}

if (ACCESS_SECRET.length < 32) {
    logger.warn('[AUTH] WARNING: JWT_ACCESS_SECRET is too short. Use at least 32 characters.');
}
if (REFRESH_SECRET.length < 32) {
    logger.warn('[AUTH] WARNING: JWT_REFRESH_SECRET is too short. Use at least 32 characters.');
}

/**
 * Parse a TTL value that may come as:
 *   - plain milliseconds (e.g. "3600000")
 *   - suffixed duration ("15m", "1h", "7d", "30s")
 * Returns milliseconds. Defaults to `fallbackMs` if input is invalid/empty.
 */
function parseTtlMs(raw, fallbackMs, label) {
    if (raw === undefined || raw === null || raw === '') return fallbackMs;
    const value = String(raw).trim();
    // Pure integer → already milliseconds
    if (/^\d+$/.test(value)) {
        const ms = parseInt(value, 10);
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    // Suffixed duration (e.g. 15m, 1h, 7d)
    const m = value.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
        if (Number.isFinite(n) && n > 0 && mult) return n * mult;
    }
    logger.warn(`[AUTH] Invalid ${label}='${raw}', falling back to ${fallbackMs}ms`);
    return fallbackMs;
}

const ACCESS_TTL_MS = parseTtlMs(process.env.JWT_ACCESS_EXPIRES, 86_400_000, 'JWT_ACCESS_EXPIRES'); // 24h default
const REFRESH_TTL_MS = parseTtlMs(process.env.JWT_REFRESH_EXPIRES, 604_800_000, 'JWT_REFRESH_EXPIRES'); // 7d default
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10);
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const AUTH_REDIS_TIMEOUT_MS = parseInt(process.env.AUTH_REDIS_TIMEOUT_MS || process.env.REDIS_COMMAND_TIMEOUT_MS || '1000', 10);
const AUTH_ALLOW_STATELESS_REFRESH_FALLBACK = process.env.AUTH_ALLOW_STATELESS_REFRESH_FALLBACK === 'true'
    || (isProduction && process.env.PM2_EXEC_MODE === 'cluster');
const AUTH_SESSION_PREFIX = 'gmp:auth:session:';
const AUTH_USER_PREFIX = 'gmp:auth:user:';
const AUTH_REVOKED_PREFIX = 'gmp:auth:revoked:';

logger.info(`[AUTH] Access TTL: ${ACCESS_TTL_MS}ms (${Math.round(ACCESS_TTL_MS / 60000)}min), Refresh TTL: ${REFRESH_TTL_MS}ms (${Math.round(REFRESH_TTL_MS / 86400000)}d)`);

// =============================================================================
// SESSION STORAGE
// =============================================================================

const activeSessions = new Map();
const revokedRefreshTokens = new Map();
let sessionCleanupInterval = null;

function startSessionCleanup() {
    if (sessionCleanupInterval) return; // Already running
    sessionCleanupInterval = setInterval(() => {
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

        for (const [tokenHash, expiresAt] of revokedRefreshTokens.entries()) {
            if (expiresAt <= now) revokedRefreshTokens.delete(tokenHash);
        }
        
        if (cleanedCount > 0) {
            logger.info(`[AUTH] Cleaned up ${cleanedCount} expired sessions`);
        }
    }, SESSION_CLEANUP_INTERVAL_MS);
}

function stopSessionCleanup() {
    if (sessionCleanupInterval) {
        clearInterval(sessionCleanupInterval);
        sessionCleanupInterval = null;
        logger.info('[AUTH] Session cleanup stopped');
    }
}

startSessionCleanup();

// Deduplicate noisy auth warnings per IP (signature mismatches, etc.)
const _authWarnTracker = new Map();
const _AUTH_WARN_WINDOW_MS = 5 * 60 * 1000;

function _dedupWarn(ip, key, message) {
    const now = Date.now();
    const entry = _authWarnTracker.get(`${ip}:${key}`);
    if (entry && now - entry.last < _AUTH_WARN_WINDOW_MS) {
        entry.count++;
        if (entry.count === 10 || entry.count % 50 === 0) {
            logger.warn(`[AUTH-DEBUG] ${message} (from ${ip}, count=${entry.count}, suppressed ${entry.count - 1} similar)`);
        }
        return;
    }
    _authWarnTracker.set(`${ip}:${key}`, { count: 1, last: now });
    logger.warn(`[AUTH-DEBUG] ${message}`);
    // Cleanup old entries periodically
    if (_authWarnTracker.size > 500) {
        for (const [k, v] of _authWarnTracker) {
            if (now - v.last > _AUTH_WARN_WINDOW_MS * 4) _authWarnTracker.delete(k);
        }
    }
}

// Graceful shutdown helper - call this on server shutdown
function shutdown() {
    stopSessionCleanup();
    activeSessions.clear();
    revokedRefreshTokens.clear();
    logger.info('[AUTH] Auth subsystem shut down');
}

exports.shutdown = shutdown;
exports.stopSessionCleanup = stopSessionCleanup;
exports.startSessionCleanup = startSessionCleanup;

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
    
    if (sig.length !== expectedSig.length) {
        _dedupWarn('global', 'sig_length', 'Token rejected: sig length mismatch (wrong secret?)');
        return null;
    }
    
    try {
        const sigBuffer = Buffer.from(sig, 'hex');
        const expectedBuffer = Buffer.from(expectedSig, 'hex');
        
        if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            _dedupWarn('global', 'sig_mismatch', 'Token rejected: SIGNATURE MISMATCH (secret changed after token was issued?)');
            return null;
        }
    } catch (e) {
        _dedupWarn('global', 'hmac_error', `Token rejected: HMAC comparison error: ${e.message}`);
        return null;
    }
    
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
        if (!payload.timestamp) {
            _dedupWarn('global', 'no_timestamp', 'Token rejected: no timestamp field');
            return null;
        }
        
        const age = Date.now() - payload.timestamp;
        if (age > ttlMs) {
            _dedupWarn('global', 'expired', `Token rejected: EXPIRED age=${age}ms ttl=${ttlMs}ms user=${payload.user || '?'}`);
            return null;
        }
        
        return payload;
    } catch (e) {
        _dedupWarn('global', 'parse_error', `Token rejected: JSON parse error: ${e.message}`);
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

function hashRefreshToken(refreshToken) {
    return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function refreshTtlSeconds(expiresAt = Date.now() + REFRESH_TTL_MS) {
    return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function getRedisClient() {
    try {
        const { redisCache } = require('../services/redis-cache');
        if (redisCache?.isConnected && redisCache.client) return redisCache.client;
    } catch (_) {
        // Redis cache is optional; fall back to per-worker memory.
    }
    return null;
}

async function withRedisTimeout(promise, operation) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`auth redis ${operation} timeout after ${AUTH_REDIS_TIMEOUT_MS}ms`)),
                    AUTH_REDIS_TIMEOUT_MS
                );
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function redisSetEx(client, key, ttlSeconds, value) {
    if (typeof client.setEx === 'function') return withRedisTimeout(client.setEx(key, ttlSeconds, value), 'setEx');
    if (typeof client.setex === 'function') return withRedisTimeout(client.setex(key, ttlSeconds, value), 'setex');
    return withRedisTimeout(client.set(key, value, { EX: ttlSeconds }), 'set');
}

async function redisGet(client, key) {
    return withRedisTimeout(client.get(key), 'get');
}

async function redisDel(client, keys) {
    if (!Array.isArray(keys)) return withRedisTimeout(client.del(keys), 'del');
    if (keys.length === 0) return 0;
    return withRedisTimeout(client.del(keys), 'del');
}

async function redisSAdd(client, key, value) {
    if (typeof client.sAdd === 'function') return withRedisTimeout(client.sAdd(key, value), 'sAdd');
    return withRedisTimeout(client.sadd(key, value), 'sadd');
}

async function redisSRem(client, key, value) {
    if (typeof client.sRem === 'function') return withRedisTimeout(client.sRem(key, value), 'sRem');
    return withRedisTimeout(client.srem(key, value), 'srem');
}

async function redisSMembers(client, key) {
    if (typeof client.sMembers === 'function') return withRedisTimeout(client.sMembers(key), 'sMembers');
    return withRedisTimeout(client.smembers(key), 'smembers');
}

async function redisExpire(client, key, ttlSeconds) {
    return withRedisTimeout(client.expire(key, ttlSeconds), 'expire');
}

function rememberSessionInProcess(userId, session) {
    const userSessions = activeSessions.get(userId) || [];

    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
        userSessions.sort((a, b) => a.createdAt - b.createdAt);
        userSessions.shift();
        logger.info(`[AUTH] Removed oldest session for user ${userId}`);
    }

    userSessions.push(session);
    activeSessions.set(userId, userSessions);
}

async function rememberSessionInRedis(userId, refreshToken, session) {
    const client = getRedisClient();
    if (!client) return false;

    const tokenHash = hashRefreshToken(refreshToken);
    const ttl = refreshTtlSeconds(session.expiresAt);
    const sessionKey = `${AUTH_SESSION_PREFIX}${tokenHash}`;
    const userKey = `${AUTH_USER_PREFIX}${userId}`;
    const storedSession = {
        ...session,
        refreshToken: undefined,
        tokenHash
    };

    try {
        await redisSetEx(client, sessionKey, ttl, JSON.stringify(storedSession));
        await redisSAdd(client, userKey, tokenHash);
        await redisExpire(client, userKey, REFRESH_TTL_MS / 1000);
        await enforceRedisMaxSessions(client, userId);
        return true;
    } catch (error) {
        logger.warn(`[AUTH] Redis session store unavailable: ${error.message}`);
        return false;
    }
}

async function getRedisSession(refreshToken) {
    const client = getRedisClient();
    if (!client) return null;

    try {
        const tokenHash = hashRefreshToken(refreshToken);
        const raw = await redisGet(client, `${AUTH_SESSION_PREFIX}${tokenHash}`);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        logger.warn(`[AUTH] Redis session lookup failed: ${error.message}`);
        return null;
    }
}

async function getRedisUserTokenHashes(client, userId) {
    try {
        const values = await redisSMembers(client, `${AUTH_USER_PREFIX}${userId}`);
        return Array.isArray(values) ? values : [];
    } catch (error) {
        logger.warn(`[AUTH] Redis user session lookup failed: ${error.message}`);
        return [];
    }
}

async function enforceRedisMaxSessions(client, userId) {
    const tokenHashes = await getRedisUserTokenHashes(client, userId);
    if (tokenHashes.length <= MAX_SESSIONS_PER_USER) return;

    const sessions = [];
    for (const tokenHash of tokenHashes) {
        const raw = await redisGet(client, `${AUTH_SESSION_PREFIX}${tokenHash}`);
        if (!raw) {
            await redisSRem(client, `${AUTH_USER_PREFIX}${userId}`, tokenHash);
            continue;
        }
        try {
            sessions.push({ tokenHash, session: JSON.parse(raw) });
        } catch (_) {
            await redisSRem(client, `${AUTH_USER_PREFIX}${userId}`, tokenHash);
        }
    }

    sessions.sort((a, b) => (a.session.createdAt || 0) - (b.session.createdAt || 0));
    const toRemove = sessions.slice(0, Math.max(0, sessions.length - MAX_SESSIONS_PER_USER));
    for (const { tokenHash } of toRemove) {
        await redisDel(client, `${AUTH_SESSION_PREFIX}${tokenHash}`);
        await redisSRem(client, `${AUTH_USER_PREFIX}${userId}`, tokenHash);
    }
}

async function isRefreshTokenRevoked(refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    const localExpiry = revokedRefreshTokens.get(tokenHash);
    if (localExpiry && localExpiry > Date.now()) return true;
    if (localExpiry) revokedRefreshTokens.delete(tokenHash);

    const client = getRedisClient();
    if (!client) return false;

    try {
        const value = await redisGet(client, `${AUTH_REVOKED_PREFIX}${tokenHash}`);
        return value === '1';
    } catch (error) {
        logger.warn(`[AUTH] Redis revoked token lookup failed: ${error.message}`);
        return false;
    }
}

async function blacklistRefreshToken(refreshToken, expiresAt = Date.now() + REFRESH_TTL_MS) {
    const tokenHash = hashRefreshToken(refreshToken);
    revokedRefreshTokens.set(tokenHash, expiresAt);

    const client = getRedisClient();
    if (!client) return;

    try {
        await redisSetEx(client, `${AUTH_REVOKED_PREFIX}${tokenHash}`, refreshTtlSeconds(expiresAt), '1');
    } catch (error) {
        logger.warn(`[AUTH] Redis token blacklist failed: ${error.message}`);
    }
}

async function registerSession(userId, refreshToken, userAgent, ip) {
    const now = Date.now();
    const session = {
        refreshToken,
        userId,
        userAgent,
        ip,
        createdAt: now,
        expiresAt: now + REFRESH_TTL_MS
    };

    rememberSessionInProcess(userId, session);
    await rememberSessionInRedis(userId, refreshToken, session);

    logger.info(`[AUTH] Registered new session for user ${userId} from ${ip}`);
}

exports.registerSession = registerSession;

exports.invalidateAllSessions = async (userId) => {
    const sessions = activeSessions.get(userId) || [];
    activeSessions.delete(userId);

    for (const session of sessions) {
        await blacklistRefreshToken(session.refreshToken, session.expiresAt);
    }

    const client = getRedisClient();
    if (client) {
        const tokenHashes = await getRedisUserTokenHashes(client, userId);
        for (const tokenHash of tokenHashes) {
            await redisSetEx(client, `${AUTH_REVOKED_PREFIX}${tokenHash}`, REFRESH_TTL_MS / 1000, '1');
            await redisDel(client, `${AUTH_SESSION_PREFIX}${tokenHash}`);
        }
        await redisDel(client, `${AUTH_USER_PREFIX}${userId}`);
    }

    logger.info(`[AUTH] Invalidated all sessions for user ${userId}`);
};

async function isRefreshTokenValid(userId, refreshToken) {
    if (await isRefreshTokenRevoked(refreshToken)) return false;

    const sessions = activeSessions.get(userId);
    if (sessions?.some(s => s.refreshToken === refreshToken && s.expiresAt > Date.now())) {
        return true;
    }

    const redisSession = await getRedisSession(refreshToken);
    return Boolean(redisSession && redisSession.userId === userId && redisSession.expiresAt > Date.now());
}

async function revokeRefreshToken(userId, refreshToken) {
    const sessions = activeSessions.get(userId);
    let expiresAt = Date.now() + REFRESH_TTL_MS;
    if (sessions) {
        const session = sessions.find(s => s.refreshToken === refreshToken);
        if (session?.expiresAt) expiresAt = session.expiresAt;
        const filtered = sessions.filter(s => s.refreshToken !== refreshToken);
        if (filtered.length > 0) {
            activeSessions.set(userId, filtered);
        } else {
            activeSessions.delete(userId);
        }
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const client = getRedisClient();
    if (client) {
        const redisSession = await getRedisSession(refreshToken);
        if (redisSession?.expiresAt) expiresAt = redisSession.expiresAt;
        await redisDel(client, `${AUTH_SESSION_PREFIX}${tokenHash}`);
        await redisSRem(client, `${AUTH_USER_PREFIX}${userId}`, tokenHash);
    }
    await blacklistRefreshToken(refreshToken, expiresAt);
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
        _dedupWarn(req.ip, 'no_token', `Access attempt without token: ${req.method} ${req.path}`);
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
            _dedupWarn(req.ip, 'invalid_token', `Invalid or expired token from ${req.ip}`);
            return res.status(401).json({ error: 'Sesión expirada. Por favor, inicia sesión de nuevo.', code: 'TOKEN_EXPIRED' });
        }
        
        req.user = {
            id: payload.id,
            code: payload.user,
            name: payload.name, // INCLUDE name from token
            role: payload.role || 'COMERCIAL',
            isJefeVentas: payload.isJefeVentas || false,
            vendorCodes: Array.isArray(payload.vendorCodes) ? payload.vendorCodes : [],
            vendedorCodes: Array.isArray(payload.vendedorCodes) ? payload.vendedorCodes : []
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
            isJefeVentas: payload.isJefeVentas || false,
            vendorCodes: Array.isArray(payload.vendorCodes) ? payload.vendorCodes : [],
            vendedorCodes: Array.isArray(payload.vendedorCodes) ? payload.vendedorCodes : []
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
            _dedupWarn(req.ip, 'invalid_refresh', `Invalid or expired refresh token from IP: ${req.ip}`);
            return res.status(401).json({ error: 'Refresh token inválido o expirado', code: 'INVALID_REFRESH_TOKEN' });
        }
        
        const userId = payload.id;
        const userCode = payload.user;
        
        let validRefreshSession = await isRefreshTokenValid(userId, refreshToken);
        if (!validRefreshSession && AUTH_ALLOW_STATELESS_REFRESH_FALLBACK && !(await isRefreshTokenRevoked(refreshToken))) {
            validRefreshSession = true;
            logger.warn(`[AUTH] Refresh token for user ${userCode} was signed but missing from shared session store; accepting once for cluster migration`);
        }

        if (!validRefreshSession) {
            _dedupWarn(req.ip, 'revoked_refresh', `Revoked refresh token used from IP: ${req.ip}`);
            await exports.invalidateAllSessions(userId);
            return res.status(401).json({ error: 'Sesión revocada. Por favor, inicia sesión de nuevo.', code: 'SESSION_REVOKED' });
        }
        
        await revokeRefreshToken(userId, refreshToken);
        
        const newAccessToken = exports.signAccessToken({
            id: userId,
            user: userCode,
            role: payload.role,
            isJefeVentas: payload.isJefeVentas,
            vendorCodes: Array.isArray(payload.vendorCodes) ? payload.vendorCodes : [],
            vendedorCodes: Array.isArray(payload.vendedorCodes) ? payload.vendedorCodes : []
        });
        
        const newRefreshToken = exports.signRefreshToken({
            id: userId,
            user: userCode,
            role: payload.role,
            isJefeVentas: payload.isJefeVentas,
            vendorCodes: Array.isArray(payload.vendorCodes) ? payload.vendorCodes : [],
            vendedorCodes: Array.isArray(payload.vendedorCodes) ? payload.vendedorCodes : []
        });
        
        await registerSession(userId, newRefreshToken, req.get('user-agent') || 'unknown', req.ip || 'unknown');
        
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
            await exports.invalidateAllSessions(userId);
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
exports.revokedRefreshTokens = revokedRefreshTokens;
exports._authSessionStorage = {
    hashRefreshToken,
    isRefreshTokenValid,
    revokeRefreshToken,
    isRefreshTokenRevoked,
    blacklistRefreshToken,
};
