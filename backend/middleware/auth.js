/**
 * GMP App Enhanced Authentication Middleware
 * HMAC-signed JWT tokens with refresh token rotation
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const logger = require('./logger');
const {
    AuthSessionStoreError,
    createAuthClaimsSessionStore,
} = require('../src/modules/auth/application/auth-claims-session-store');
const { AUTH_CLAIMS_VERSION } = require('../src/modules/auth/application/auth-claims-resolver');

const AUTH_LOG = Object.freeze({
    redacted: 'AUTH_EVENT_REDACTED',
    accessSecretEphemeral: 'AUTH_CONFIG_ACCESS_SECRET_EPHEMERAL',
    refreshSecretEphemeral: 'AUTH_CONFIG_REFRESH_SECRET_EPHEMERAL',
    accessSecretTooShort: 'AUTH_CONFIG_ACCESS_SECRET_TOO_SHORT',
    refreshSecretTooShort: 'AUTH_CONFIG_REFRESH_SECRET_TOO_SHORT',
    accessExpiryInvalid: 'AUTH_CONFIG_ACCESS_EXPIRY_INVALID',
    refreshExpiryInvalid: 'AUTH_CONFIG_REFRESH_EXPIRY_INVALID',
    plaintextPinWindowInvalid: 'AUTH_PLAINTEXT_PIN_WINDOW_INVALID',
    plaintextPinEnabled: 'AUTH_PLAINTEXT_PIN_TEMPORARILY_ENABLED',
    tokenLifetimesConfigured: 'AUTH_TOKEN_LIFETIMES_CONFIGURED',
    subsystemShutdown: 'AUTH_SUBSYSTEM_SHUTDOWN',
    tokenSignatureLength: 'AUTH_TOKEN_REJECTED_SIGNATURE_LENGTH',
    tokenSignatureMismatch: 'AUTH_TOKEN_REJECTED_SIGNATURE',
    tokenSignatureComparison: 'AUTH_TOKEN_REJECTED_SIGNATURE_COMPARISON',
    tokenMissingTimestamp: 'AUTH_TOKEN_REJECTED_TIMESTAMP',
    tokenExpired: 'AUTH_TOKEN_REJECTED_EXPIRED',
    tokenInvalidPayload: 'AUTH_TOKEN_REJECTED_PAYLOAD',
    sessionRegistered: 'AUTH_SESSION_REGISTERED',
    userSessionsInvalidated: 'AUTH_USER_SESSIONS_INVALIDATED',
    requestMissingToken: 'AUTH_REQUEST_REJECTED_MISSING_TOKEN',
    requestInvalidToken: 'AUTH_REQUEST_REJECTED_INVALID_TOKEN',
    middlewareFailure: 'AUTH_MIDDLEWARE_FAILURE',
    roleDenied: 'AUTH_ROLE_DENIED',
    jefeVentasDenied: 'AUTH_JEFE_VENTAS_DENIED',
    sessionLogout: 'AUTH_SESSION_LOGOUT',
});
const AUTH_LOG_CODES = new Set(Object.values(AUTH_LOG));
const AUTH_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const AUTH_LOG_NUMERIC_METADATA = new Set(['count', 'suppressed']);

function emitAuthLog(level, code, metadata = null) {
    const safeLevel = AUTH_LOG_LEVELS.has(level) ? level : 'warn';
    const safeCode = AUTH_LOG_CODES.has(code) ? code : AUTH_LOG.redacted;
    const safeMetadata = {};
    if (metadata && typeof metadata === 'object') {
        for (const [key, value] of Object.entries(metadata)) {
            if (AUTH_LOG_NUMERIC_METADATA.has(key) && Number.isSafeInteger(value) && value >= 0) {
                safeMetadata[key] = value;
            }
        }
    }
    if (Object.keys(safeMetadata).length === 0) {
        logger[safeLevel](safeCode);
        return;
    }
    logger[safeLevel](safeCode, safeMetadata);
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

if (isProduction && !process.env.JWT_ACCESS_SECRET) {
    throw new Error('AUTH_CONFIG_ACCESS_SECRET_REQUIRED');
}
if (isProduction && !process.env.JWT_REFRESH_SECRET) {
    throw new Error('AUTH_CONFIG_REFRESH_SECRET_REQUIRED');
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

if (!isProduction && !process.env.JWT_ACCESS_SECRET) {
    emitAuthLog('warn', AUTH_LOG.accessSecretEphemeral);
}
if (!isProduction && !process.env.JWT_REFRESH_SECRET) {
    emitAuthLog('warn', AUTH_LOG.refreshSecretEphemeral);
}

if (ACCESS_SECRET.length < 32) {
    emitAuthLog('warn', AUTH_LOG.accessSecretTooShort);
}
if (REFRESH_SECRET.length < 32) {
    emitAuthLog('warn', AUTH_LOG.refreshSecretTooShort);
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
    // Pure integer â†’ already milliseconds
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
    emitAuthLog(
        'warn',
        label === 'JWT_REFRESH_EXPIRES'
            ? AUTH_LOG.refreshExpiryInvalid
            : AUTH_LOG.accessExpiryInvalid
    );
    return fallbackMs;
}

const ACCESS_TTL_MS = parseTtlMs(process.env.JWT_ACCESS_EXPIRES, 86_400_000, 'JWT_ACCESS_EXPIRES'); // 24h default
const REFRESH_TTL_MS = parseTtlMs(process.env.JWT_REFRESH_EXPIRES, 604_800_000, 'JWT_REFRESH_EXPIRES'); // 7d default
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10);
const AUTH_REDIS_TIMEOUT_MS = parseInt(process.env.AUTH_REDIS_TIMEOUT_MS || process.env.REDIS_COMMAND_TIMEOUT_MS || '1000', 10);

function allowPlaintextPinAuth() {
    if (!isProduction) return true;
    if (process.env.AUTH_ALLOW_PLAINTEXT_PIN !== 'true') return false;

    const rawUntil = process.env.AUTH_PLAINTEXT_PIN_AUTH_UNTIL;
    const until = rawUntil ? Date.parse(rawUntil) : NaN;
    if (!Number.isFinite(until) || until <= Date.now()) {
        emitAuthLog('error', AUTH_LOG.plaintextPinWindowInvalid);
        return false;
    }

    emitAuthLog('warn', AUTH_LOG.plaintextPinEnabled);
    return true;
}

emitAuthLog('info', AUTH_LOG.tokenLifetimesConfigured);

// =============================================================================
// SESSION STORAGE
// =============================================================================

// Deduplicate noisy auth warnings per IP (signature mismatches, etc.)
const _authWarnTracker = new Map();
const _AUTH_WARN_WINDOW_MS = 5 * 60 * 1000;

function _dedupWarn(ip, key, code) {
    const now = Date.now();
    const entry = _authWarnTracker.get(`${ip}:${key}`);
    if (entry && now - entry.last < _AUTH_WARN_WINDOW_MS) {
        entry.count++;
        if (entry.count === 10 || entry.count % 50 === 0) {
            emitAuthLog('warn', code, {
                count: entry.count,
                suppressed: entry.count - 1,
            });
        }
        return;
    }
    _authWarnTracker.set(`${ip}:${key}`, { count: 1, last: now });
    emitAuthLog('warn', code);
    // Cleanup old entries periodically
    if (_authWarnTracker.size > 500) {
        for (const [k, v] of _authWarnTracker) {
            if (now - v.last > _AUTH_WARN_WINDOW_MS * 4) _authWarnTracker.delete(k);
        }
    }
}

// Graceful shutdown helper - call this on server shutdown
function shutdown() {
    canonicalSessionStore?.reset();
    emitAuthLog('info', AUTH_LOG.subsystemShutdown);
}

exports.shutdown = shutdown;

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
        _dedupWarn('global', 'sig_length', AUTH_LOG.tokenSignatureLength);
        return null;
    }
    
    try {
        const sigBuffer = Buffer.from(sig, 'hex');
        const expectedBuffer = Buffer.from(expectedSig, 'hex');
        
        if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            _dedupWarn('global', 'sig_mismatch', AUTH_LOG.tokenSignatureMismatch);
            return null;
        }
    } catch (_error) {
        _dedupWarn('global', 'hmac_error', AUTH_LOG.tokenSignatureComparison);
        return null;
    }
    
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
        if (!payload.timestamp) {
            _dedupWarn('global', 'no_timestamp', AUTH_LOG.tokenMissingTimestamp);
            return null;
        }
        
        const age = Date.now() - payload.timestamp;
        if (age > ttlMs) {
            _dedupWarn('global', 'expired', AUTH_LOG.tokenExpired);
            return null;
        }
        
        return payload;
    } catch (_error) {
        _dedupWarn('global', 'parse_error', AUTH_LOG.tokenInvalidPayload);
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

let authClaimsResolver = null;
const canonicalSessionStore = createAuthClaimsSessionStore({
    mode: process.env.AUTH_SESSION_STORE_MODE || (isProduction ? 'redis' : 'memory'),
    production: isProduction,
    getRedisClient,
    verifyRefreshToken: (token) => exports.verifyRefreshToken(token),
    refreshTtlMs: REFRESH_TTL_MS,
    redisTimeoutMs: AUTH_REDIS_TIMEOUT_MS,
    maxSessionsPerUser: MAX_SESSIONS_PER_USER,
});

exports.setAuthClaimsResolver = (resolver) => {
    if (!resolver || typeof resolver.resolve !== 'function') {
        throw new TypeError('auth claims resolver must implement resolve');
    }
    authClaimsResolver = resolver;
};

exports.getSessionStoreReadiness = () => canonicalSessionStore.readiness();
exports.revokeSession = (sid, options) => canonicalSessionStore.revoke(sid, options);

function getRedisClient() {
    try {
        const { redisCache } = require('../services/redis-cache');
        if (redisCache?.isConnected && redisCache.client) return redisCache.client;
    } catch (_) {
        // The canonical store maps a missing client to a typed unavailable error.
    }
    return null;
}

async function registerSession(userId, refreshToken, userAgent, ip, identifiers = {}) {
    const result = await canonicalSessionStore.register({
        sid: identifiers.sid,
        userId,
        refreshToken,
        accessJti: identifiers.accessJti,
        refreshJti: identifiers.refreshJti,
        userAgent,
        ip,
    });
    emitAuthLog('info', AUTH_LOG.sessionRegistered);
    return result;
}

exports.registerSession = registerSession;

exports.invalidateAllSessions = async (userId) => {
    const result = await canonicalSessionStore.invalidateUser(userId);
    emitAuthLog('info', AUTH_LOG.userSessionsInvalidated, { count: result.count });
    return result;
};


// =============================================================================
// PASSWORD HASHING
// =============================================================================

exports.hashPassword = async (password, saltRounds = 12) => {
    return bcrypt.hash(password, saltRounds);
};

exports.verifyPassword = async (password, hash) => {
    return bcrypt.compare(password, hash);
};

exports.allowPlaintextPinAuth = allowPlaintextPinAuth;

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

function projectAuthenticatedUser(payload) {
    const role = String(payload.role || 'COMERCIAL').trim().toUpperCase();
    const isRepartidor = role === 'REPARTIDOR' && payload.isRepartidor === true;
    const vendorCodes = Array.isArray(payload.vendorCodes) ? [...payload.vendorCodes] : [];
    const vendedorCodes = Array.isArray(payload.vendedorCodes) ? [...payload.vendedorCodes] : [];
    const repartidorCodes = Array.isArray(payload.repartidorCodes) ? [...payload.repartidorCodes] : [];
    return {
        id: payload.id,
        code: payload.user,
        name: payload.name,
        company: payload.company || 'GMP',
        vendedorCode: payload.user,
        role,
        availableRoles: Array.isArray(payload.availableRoles) ? [...payload.availableRoles] : [],
        activeMode: payload.activeMode || (role === 'JEFE_VENTAS' ? 'COMERCIAL' : role),
        availableModes: Array.isArray(payload.availableModes) ? [...payload.availableModes] : [],
        isJefeVentas: role === 'JEFE_VENTAS' || role === 'ADMIN',
        isRepartidor,
        codigoConductor: isRepartidor ? payload.codigoConductor || null : null,
        matricula: isRepartidor ? payload.matricula || null : null,
        vendorCodes,
        vendedorCodes,
        repartidorCodes,
        tipoVendedor: String(payload.tipoVendedor || '-'),
        showCommissions: payload.showCommissions !== false,
        claimsVersion: payload.claimsVersion,
    };
}

function projectCanonicalClaims(payload) {
    const user = projectAuthenticatedUser(payload);
    return {
        user,
        role: user.role,
        availableRoles: user.availableRoles,
        activeMode: user.activeMode,
        availableModes: user.availableModes,
        isJefeVentas: user.isJefeVentas,
        isRepartidor: user.isRepartidor,
        codigoConductor: user.codigoConductor,
        matricula: user.matricula,
        vendorCodes: user.vendorCodes,
        vendedorCodes: user.vendedorCodes,
        repartidorCodes: user.repartidorCodes,
        tipoVendedor: user.tipoVendedor,
        showCommissions: user.showCommissions,
        claimsVersion: user.claimsVersion,
    };
}

function canonicalAccessIdentity(payload) {
    const sid = String(payload?.sid || '').trim();
    const subject = String(payload?.sub || '').trim();
    const jti = String(payload?.jti || '').trim();
    return sid && subject && jti ? { sid, subject, jti } : null;
}

function sendSessionStoreError(res) {
    return res.status(503).json({
        error: 'El almac\u00e9n de sesiones no est\u00e1 disponible.',
        code: 'AUTH_SESSION_STORE_UNAVAILABLE',
    });
}

exports.verifyToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        _dedupWarn(req.ip, 'no_token', AUTH_LOG.requestMissingToken);
        return res.status(401).json({ error: 'Acceso denegado. Se requiere autenticaciÃ³n.', code: 'MISSING_TOKEN' });
    }
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Token con formato invÃ¡lido.', code: 'INVALID_FORMAT' });
    }
    
    const token = parts[1];
    
    try {
        const payload = exports.verifyAccessToken(token);
        
        if (!payload) {
            _dedupWarn(req.ip, 'invalid_token', AUTH_LOG.requestInvalidToken);
            return res.status(401).json({ error: 'SesiÃ³n expirada. Por favor, inicia sesiÃ³n de nuevo.', code: 'TOKEN_EXPIRED' });
        }
        
        const identity = canonicalAccessIdentity(payload);
        if (!identity) {
            return res.status(401).json({
                error: 'La sesi\u00f3n debe renovarse iniciando sesi\u00f3n de nuevo.',
                code: 'AUTH_RELOGIN_REQUIRED',
            });
        }
        if (payload.claimsVersion !== AUTH_CLAIMS_VERSION) {
            try {
                await canonicalSessionStore.revoke(identity.sid, { userId: identity.subject });
            } catch (_error) {
                // Relogin remains mandatory even if the session store cannot revoke.
            }
            return res.status(401).json({
                error: 'La sesi\u00f3n debe renovarse iniciando sesi\u00f3n de nuevo.',
                code: 'AUTH_RELOGIN_REQUIRED',
            });
        }
        if (!await canonicalSessionStore.isActive(identity.sid, identity.subject, identity.jti)) {
            return res.status(401).json({
                error: 'Sesi\u00f3n revocada. Inicia sesi\u00f3n de nuevo.',
                code: 'SESSION_REVOKED',
            });
        }

        req.user = projectAuthenticatedUser(payload);

        req.tokenPayload = payload;
        next();
    } catch (error) {
        if (error instanceof AuthSessionStoreError || error?.code === 'AUTH_SESSION_STORE_UNAVAILABLE') {
            return sendSessionStoreError(res);
        }
        emitAuthLog('error', AUTH_LOG.middlewareFailure);
        res.status(403).json({ error: 'Fallo de autenticaciÃ³n.', code: 'AUTH_FAILED' });
    }
};

exports.optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return next();

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return next();

    const token = parts[1];
    const payload = exports.verifyAccessToken(token);
    const identity = canonicalAccessIdentity(payload);

    if (payload && identity && payload.claimsVersion === AUTH_CLAIMS_VERSION) {
        try {
            if (!await canonicalSessionStore.isActive(identity.sid, identity.subject, identity.jti)) {
                return next();
            }
        } catch (_error) {
            return next();
        }
        req.user = projectAuthenticatedUser(payload);
        req.tokenPayload = payload;
    }

    next();
};

exports.requireRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'AutenticaciÃ³n requerida', code: 'MISSING_TOKEN' });
        }
        
        if (!roles.includes(req.user.role)) {
            emitAuthLog('warn', AUTH_LOG.roleDenied);
            return res.status(403).json({ error: 'No tienes permisos para realizar esta acciÃ³n', code: 'INSUFFICIENT_ROLE' });
        }
        
        next();
    };
};

exports.requireJefeVentas = (req, res, next) => {
    const role = String(req.user?.role || '').trim().toUpperCase();
    if (role !== 'JEFE_VENTAS' && role !== 'ADMIN') {
        emitAuthLog('warn', AUTH_LOG.jefeVentasDenied);
        return res.status(403).json({ error: 'Acceso restringido a Jefes de Ventas', code: 'INSUFFICIENT_ROLE' });
    }
    next();
};

// =============================================================================
// REFRESH TOKEN HANDLER
// =============================================================================


function canonicalTokenBundle(claims, sid = crypto.randomUUID()) {
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const tokenClaims = { ...claims, sub: claims.id, sid };
    return Object.freeze({
        sid,
        accessJti,
        refreshJti,
        accessToken: exports.signAccessToken({ ...tokenClaims, jti: accessJti }),
        refreshToken: exports.signRefreshToken({ ...tokenClaims, jti: refreshJti }),
    });
}

function sendCanonicalAuthError(res, error, fallbackCode = 'AUTH_PROFILE_UNAVAILABLE') {
    if (error instanceof AuthSessionStoreError || error?.code === 'AUTH_SESSION_STORE_UNAVAILABLE') {
        return sendSessionStoreError(res);
    }
    const status = Number(error?.status || error?.statusCode);
    const safeStatus = [400, 401, 403, 409, 422, 503].includes(status) ? status : 503;
    const safeCode = typeof error?.code === 'string' ? error.code : fallbackCode;
    return res.status(safeStatus).json({
        error: safeStatus === 503
            ? 'Perfil de autorizaci\u00f3n no disponible.'
            : 'La operaci\u00f3n de autenticaci\u00f3n no est\u00e1 autorizada.',
        code: safeCode,
    });
}

exports.handleRefreshToken = async (req, res) => {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token required', code: 'MISSING_REFRESH_TOKEN' });
    }
    const payload = exports.verifyRefreshToken(refreshToken);
    const sid = String(payload?.sid || '').trim();
    const subject = String(payload?.sub || '').trim();
    const refreshJti = String(payload?.jti || '').trim();
    if (!payload || !sid || !subject || !refreshJti) {
        return res.status(401).json({
            error: 'La sesi\u00f3n debe renovarse iniciando sesi\u00f3n de nuevo.',
            code: 'AUTH_RELOGIN_REQUIRED',
        });
    }
    if (!authClaimsResolver) {
        return res.status(503).json({
            error: 'Perfil de autorizaci\u00f3n no disponible.',
            code: 'AUTH_PROFILE_UNAVAILABLE',
        });
    }

    try {
        const claims = await authClaimsResolver.resolve({
            code: payload.user,
            selectedRole: payload.role,
            selectedMode: payload.activeMode,
        });
        if (String(claims.id) !== subject) {
            await canonicalSessionStore.revoke(sid, { userId: subject });
            return res.status(401).json({ error: 'Sesi\u00f3n revocada.', code: 'SESSION_REVOKED' });
        }
        const next = canonicalTokenBundle(claims, sid);
        const rotated = await canonicalSessionStore.rotate({
            sid,
            userId: subject,
            currentRefreshToken: refreshToken,
            newRefreshToken: next.refreshToken,
            accessJti: next.accessJti,
            refreshJti: next.refreshJti,
            userAgent: req.get?.('user-agent') || 'unknown',
            ip: req.ip || 'unknown',
        });
        if (!rotated) {
            return res.status(401).json({ error: 'Sesi\u00f3n revocada.', code: 'SESSION_REVOKED' });
        }
        return res.json({
            success: true,
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
            ...projectCanonicalClaims(claims),
            expiresIn: ACCESS_TTL_MS / 1000,
            tokenExpiresIn: Math.floor(ACCESS_TTL_MS / 1000),
            refreshExpiresIn: Math.floor(REFRESH_TTL_MS / 1000),
        });
    } catch (error) {
        if ([401, 403].includes(Number(error?.status || error?.statusCode))) {
            try { await canonicalSessionStore.revoke(sid, { userId: subject }); } catch (_revokeError) { /* fail closed below */ }
        }
        return sendCanonicalAuthError(res, error);
    }
};

exports.handleSwitchRole = async (req, res) => {
    const requestedUser = String(req.body?.userId || '').trim().toUpperCase();
    const selectedRole = String(req.body?.newRole || '').trim().toUpperCase();
    if (!requestedUser || !selectedRole) {
        return res.status(400).json({ error: 'Usuario y rol requeridos.', code: 'INVALID_ROLE_REQUEST' });
    }
    if (requestedUser !== String(req.user?.code || '').trim().toUpperCase()) {
        return res.status(403).json({ error: 'No autorizado.', code: 'FORBIDDEN' });
    }
    const current = req.tokenPayload;
    const identity = canonicalAccessIdentity(current);
    if (!identity) {
        return res.status(401).json({ error: 'Nuevo inicio de sesi\u00f3n requerido.', code: 'AUTH_RELOGIN_REQUIRED' });
    }
    if (!authClaimsResolver) {
        return res.status(503).json({ error: 'Perfil no disponible.', code: 'AUTH_PROFILE_UNAVAILABLE' });
    }

    try {
        let claims;
        if (selectedRole === 'ALMACEN') {
            claims = await authClaimsResolver.resolve({
                code: requestedUser,
                selectedRole: 'ALMACEN',
                selectedMode: 'ALMACEN',
            });
        } else if (selectedRole === 'REPARTIDOR') {
            // Jefe/Admin keep supervision in Perfil Reparto even if VDDX
            // PERMITEREPARTOSN=S. Personal REPARTIDOR only when they are not
            // a manager. Fallback covers older JEFE tokens without driver role.
            try {
                claims = await authClaimsResolver.resolve({
                    code: requestedUser,
                    selectedRole: 'REPARTIDOR',
                    selectedMode: 'REPARTIDOR',
                });
            } catch (driverError) {
                if (driverError?.code !== 'ROLE_NOT_ASSOCIATED') throw driverError;
                claims = await authClaimsResolver.resolve({
                    code: requestedUser,
                    selectedRole: 'JEFE_VENTAS',
                    selectedMode: 'REPARTIDOR',
                });
            }
        } else {
            claims = await authClaimsResolver.resolve({
                code: requestedUser,
                selectedRole,
                selectedMode: ['JEFE_VENTAS', 'COMERCIAL'].includes(selectedRole)
                    ? 'COMERCIAL'
                    : selectedRole,
            });
        }
        if (String(claims.id) !== identity.subject) {
            return res.status(403).json({ error: 'No autorizado.', code: 'FORBIDDEN' });
        }
        const next = canonicalTokenBundle(claims);
        const rotated = await canonicalSessionStore.transitionForAccess({
            currentSid: identity.sid,
            sid: next.sid,
            userId: identity.subject,
            currentAccessJti: identity.jti,
            newRefreshToken: next.refreshToken,
            accessJti: next.accessJti,
            refreshJti: next.refreshJti,
            userAgent: req.get?.('user-agent') || 'unknown',
            ip: req.ip || 'unknown',
        });
        if (!rotated) {
            return res.status(401).json({ error: 'Sesi\u00f3n revocada.', code: 'SESSION_REVOKED' });
        }
        return res.json({
            success: true,
            ...projectCanonicalClaims(claims),
            token: next.accessToken,
            refreshToken: next.refreshToken,
            tokenExpiresIn: Math.floor(ACCESS_TTL_MS / 1000),
            refreshExpiresIn: Math.floor(REFRESH_TTL_MS / 1000),
        });
    } catch (error) {
        return sendCanonicalAuthError(res, error, 'ROLE_NOT_ASSOCIATED');
    }
};

exports.handleLogout = async (req, res) => {
    try {
        const sid = String(req.tokenPayload?.sid || '').trim();
        const userId = String(req.tokenPayload?.sub || req.user?.id || '').trim();
        if (!sid || !userId) {
            return res.status(401).json({
                error: 'Nuevo inicio de sesi\u00f3n requerido.',
                code: 'AUTH_RELOGIN_REQUIRED',
            });
        }
        await canonicalSessionStore.revoke(sid, { userId });
        emitAuthLog('info', AUTH_LOG.sessionLogout);
        return res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        return sendCanonicalAuthError(res, error, 'LOGOUT_ERROR');
    }
};

// =============================================================================
// EXPORTS
// =============================================================================

exports.ACCESS_TTL_MS = ACCESS_TTL_MS;
exports.REFRESH_TTL_MS = REFRESH_TTL_MS;
