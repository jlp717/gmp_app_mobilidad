/**
 * GMP App Security Middleware - Comprehensive Security Layer
 * ============================================================
 * OWASP Top 10 Protection | Rate Limiting | Input Validation | Security Headers
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const logger = require('./logger');

// Try to import zod, but make it optional for backward compatibility
let z;
try {
    z = require('zod');
} catch (e) {
    logger.warn('[Security] Zod not available - input validation will be limited. Run: npm install zod');
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30000', 10); // 30k for production
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT || '10', 10);
const API_RATE_LIMIT_MAX = parseInt(process.env.API_RATE_LIMIT || '30000', 10); // 30k for mobile apps
const RATE_LIMIT_REDIS_TIMEOUT_MS = parseInt(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS || '500', 10);

// One Redis command owns both the increment and its expiry. It also repairs a
// pre-existing counter without TTL, so an interrupted older deployment cannot
// leave a permanent rate-limit key behind.
const RATE_LIMIT_INCREMENT_SCRIPT = `
local total = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if total == 1 or ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return { total, ttl }
`;

// CORS configuration
const parseCorsOrigin = (value) => {
    if (isProduction) {
        // SECURITY: In production, must specify explicit origins - wildcard NOT allowed
        if (!value || value === 'true' || value === '*') {
            logger.error('[SECURITY] CORS_ORIGIN cannot be wildcard (*) in production!');
            return [];
        }
        return value.split(',').map(o => o.trim()).filter(Boolean);
    }
    if (value === 'true' || value === '*') return true;
    if (value) return value.split(',').map(o => o.trim()).filter(Boolean);
    return true;
};

class RedisRateLimitStore {
    constructor(prefix, { requireRedis = isProduction, getClient } = {}) {
        this.prefix = prefix;
        this.windowMs = 60_000;
        this.requireRedis = requireRedis;
        this.getClient = getClient || (() => {
            try {
                const { redisCache } = require('../services/redis-cache');
                return redisCache?.isConnected && redisCache.client ? redisCache.client : null;
            } catch (_) {
                return null;
            }
        });
        // Development/test may be intentionally self-contained. Production is
        // never allowed a per-worker counter because it defeats rate limiting.
        this.fallback = requireRedis ? null : new rateLimit.MemoryStore();
    }

    init(options) {
        this.windowMs = options.windowMs;
        if (typeof this.fallback?.init === 'function') {
            this.fallback.init(options);
        }
    }

    _client() {
        return this.getClient();
    }

    isAvailable() {
        return Boolean(this._client());
    }

    _unavailable() {
        const error = new Error('Rate limiting is temporarily unavailable');
        error.code = 'RATE_LIMIT_REDIS_UNAVAILABLE';
        error.status = 503;
        return error;
    }

    _key(key) {
        const hash = crypto.createHash('sha256').update(String(key)).digest('hex');
        return `gmp:rate-limit:${this.prefix}:${hash}`;
    }

    async _withTimeout(promise, operation) {
        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`Redis rate-limit ${operation} timeout`)),
                        RATE_LIMIT_REDIS_TIMEOUT_MS
                    );
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async increment(key) {
        const client = this._client();
        if (!client) {
            if (this.requireRedis) throw this._unavailable();
            return this.fallback.increment(key);
        }

        try {
            const redisKey = this._key(key);
            const result = await this._withTimeout(client.eval(RATE_LIMIT_INCREMENT_SCRIPT, {
                keys: [redisKey],
                arguments: [String(this.windowMs)],
            }), 'increment');
            const totalHits = Number(result?.[0]);
            const ttlMs = Number(result?.[1]);
            if (!Number.isSafeInteger(totalHits) || totalHits < 1 || !Number.isFinite(ttlMs) || ttlMs < 0) {
                throw new Error('Invalid Redis rate-limit response');
            }
            return {
                totalHits,
                resetTime: new Date(Date.now() + ttlMs),
            };
        } catch (error) {
            if (this.requireRedis) {
                logger.warn('[Security] Redis rate-limit store unavailable');
                throw this._unavailable();
            }
            logger.warn('[Security] Redis rate-limit store unavailable; using development fallback');
            return this.fallback.increment(key);
        }
    }

    async decrement(key) {
        const client = this._client();
        if (!client) {
            if (this.requireRedis) return;
            return this.fallback.decrement(key);
        }
        try {
            const redisKey = this._key(key);
            const current = parseInt(await this._withTimeout(client.get(redisKey), 'get'), 10) || 0;
            if (current > 0) {
                await this._withTimeout(client.decr(redisKey), 'decr');
            }
        } catch (_) {
            if (!this.requireRedis) await this.fallback.decrement(key);
        }
    }

    async resetKey(key) {
        const client = this._client();
        if (!client) {
            if (this.requireRedis) return;
            return this.fallback.resetKey(key);
        }
        try {
            await this._withTimeout(client.del(this._key(key)), 'del');
        } catch (_) {
            if (!this.requireRedis) await this.fallback.resetKey(key);
        }
    }
}

function sharedRateLimitStore(prefix, options) {
    return new RedisRateLimitStore(prefix, options);
}

function createRateLimiter(options, { store } = {}) {
    const rateLimitStore = store || sharedRateLimitStore(options.prefix);
    const skipRequest = options.skip || (() => false);
    let limiter = null;
    const getLimiter = () => {
        if (!limiter) limiter = rateLimit({ ...options, skip: () => false, store: rateLimitStore });
        return limiter;
    };

    const failClosedLimiter = async (req, res, next) => {
        try {
            // Liveness endpoints must remain observable during a Redis outage.
            if (await skipRequest(req, res)) return next();
            if (rateLimitStore.requireRedis && !rateLimitStore.isAvailable()) {
                return res.status(503).json({ error: 'Servicio temporalmente no disponible', code: 'RATE_LIMIT_UNAVAILABLE' });
            }
            return getLimiter()(req, res, (error) => {
                if (error?.code === 'RATE_LIMIT_REDIS_UNAVAILABLE') {
                    return res.status(503).json({ error: 'Servicio temporalmente no disponible', code: 'RATE_LIMIT_UNAVAILABLE' });
                }
                return error ? next(error) : next();
            });
        } catch (error) {
            return next(error);
        }
    };
    failClosedLimiter.resetKey = (...args) => getLimiter().resetKey(...args);
    failClosedLimiter.getKey = (...args) => getLimiter().getKey(...args);
    failClosedLimiter.store = rateLimitStore;
    return failClosedLimiter;
}

// Do not use req.ip here. It can be derived from X-Forwarded-For when proxy
// settings change; rate limiting must retain the connected peer identity.
function rateLimitPeerIp(req) {
    const address = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
    return typeof address === 'string' && address.startsWith('::ffff:')
        ? address.slice(7)
        : address || 'unknown';
}

function globalRateLimitKey(req) {
    return rateLimitPeerIp(req);
}

// =============================================================================
// RATE LIMITERS
// =============================================================================

exports.globalLimiter = createRateLimiter({
    prefix: 'global',
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    message: {
        error: 'Demasiadas solicitudes. Por favor, inténtelo de nuevo más tarde.',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: globalRateLimitKey,
    skip: (req) => req.path === '/api/health' || req.path === '/health/version-check'
});

exports.loginLimiter = createRateLimiter({
    prefix: 'login',
    windowMs: 5 * 60 * 1000, // 5 minutes (reduced from 15)
    max: LOGIN_RATE_LIMIT_MAX,
    message: {
        error: 'Demasiados intentos. Espera unos minutos antes de intentar de nuevo.',
        retryAfter: 300
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${rateLimitPeerIp(req)}-${req.body?.username || 'unknown'}`
});

exports.apiLimiter = createRateLimiter({
    prefix: 'api',
    windowMs: 15 * 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    message: { 
        error: 'Límite de solicitudes API excedido. Intente más tarde.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health' || req.path === '/health/version-check', // Skip health checks
    keyGenerator: (req) => req.user?.id || rateLimitPeerIp(req)
});

exports.uploadLimiter = createRateLimiter({
    prefix: 'upload',
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiadas subidas de archivos. Intente más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitPeerIp
});

exports.emailLimiter = createRateLimiter({
    prefix: 'email',
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados envíos de email. Intente en una hora.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitPeerIp
});

// Para apps moviles los limites deben ser GENEROSOS por usuario. La app abre
// pestanas que disparan 20-40 GET en paralelo. Limites bajos producen 429
// masivos y rompen la UI. Limites RESTRICTIVOS solo en POST/PUT/DELETE
// (escritura), no en GET de lectura.
exports.cobrosLimiter = createRateLimiter({
    prefix: 'cobros',
    windowMs: 60 * 1000,         // 1 minuto
    max: 240,                    // 240 req/min/usuario (lectura GET intensiva OK)
    message: {
        error: 'Demasiadas solicitudes de cobros. Espera un momento.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || rateLimitPeerIp(req),
    skip: (req) => req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE'
        ? false : false // aplicar siempre, pero con limite generoso
});

exports.pedidosLimiter = createRateLimiter({
    prefix: 'pedidos',
    windowMs: 60 * 1000,
    max: 300,                    // 300 req/min/usuario para pedidos
    message: {
        error: 'Demasiadas solicitudes de pedidos. Espera un momento.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || rateLimitPeerIp(req)
});

exports.bolsaLimiter = createRateLimiter({
    prefix: 'bolsa',
    windowMs: 60 * 1000,
    max: 120,                    // 120 req/min/usuario
    message: {
        error: 'Demasiadas solicitudes de bolsa comercial. Espera un momento.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || rateLimitPeerIp(req)
});

exports.evolutionLimiter = createRateLimiter({
    prefix: 'evolution',
    windowMs: 60 * 1000,
    max: 120,                    // 120 req/min/usuario (era 40)
    message: {
        error: 'Demasiadas solicitudes de evolución. Espera un momento.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || rateLimitPeerIp(req)
});

exports.rateLimitPeerIp = rateLimitPeerIp;
exports.globalRateLimitKey = globalRateLimitKey;
exports.RedisRateLimitStore = RedisRateLimitStore;
exports.createRateLimiter = createRateLimiter;

// =============================================================================
// SECURITY HEADERS
// =============================================================================

exports.createSecurityHeaders = () => {
    const helmetMiddleware = helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
                connectSrc: ["'self'", 'https://api.mari-pepa.com'],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameSrc: ["'none'"]
            }
        },
        crossOriginEmbedderPolicy: true,
        crossOriginOpenerPolicy: true,
        crossOriginResourcePolicy: { policy: "same-site" },
        dnsPrefetchControl: { allow: false },
        frameguard: { action: 'deny' },
        hidePoweredBy: true,
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        ieNoOpen: true,
        noSniff: true,
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        xssFilter: true
    });

    return (req, res, next) => {
        helmetMiddleware(req, res, () => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '0');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.removeHeader('X-Powered-By');
            res.removeHeader('Server');
            next();
        });
    };
};

// =============================================================================
// INPUT VALIDATION (Zod schemas if available)
// =============================================================================

exports.validationSchemas = z ? {
    login: z.object({
        username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9 ]+$/),
        password: z.string().min(1).max(100)
    }),
    clientCode: z.string().max(20).regex(/^[a-zA-Z0-9]+$/),
    vendorCode: z.string().max(10).regex(/^[a-zA-Z0-9]+$/),
    productCode: z.string().max(50).regex(/^[a-zA-Z0-9\-_]+$/),
    searchQuery: z.string().max(200)
} : null;

exports.validateBody = (schema) => {
    if (!z || !schema) {
        return (req, res, next) => next(); // Skip validation if zod not available
    }
    
    return (req, res, next) => {
        try {
            const validatedData = schema.parse(req.body);
            req.validatedBody = validatedData;
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));
                res.status(400).json({ error: 'Validation failed', details: errors });
                return;
            }
            next(error);
        }
    };
};

exports.validateQuery = (schema) => {
    if (!z || !schema) {
        return (req, res, next) => next();
    }
    
    return (req, res, next) => {
        try {
            const validatedData = schema.parse(req.query);
            req.validatedQuery = validatedData;
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));
                res.status(400).json({ error: 'Invalid query parameters', details: errors });
                return;
            }
            next(error);
        }
    };
};

// =============================================================================
// SANITIZATION
// =============================================================================

const { sanitizeForSQL } = require('../utils/common');

exports.sanitizeInput = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        const sanitize = (obj) => {
            if (typeof obj === 'string') {
                let sanitized = obj
                    .replace(/[<>'"\\;]/g, '')
                    .replace(/&(?!(amp|lt|gt|quot|#39);)/g, '&amp;')
                    .replace(/\r?\n/g, ' ')
                    .trim();
                sanitized = sanitizeForSQL(sanitized);
                return sanitized;
            } else if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
                const sanitizedObj = {};
                for (const key of Object.keys(obj)) {
                    sanitizedObj[key] = sanitize(obj[key]);
                }
                return sanitizedObj;
            } else if (Array.isArray(obj)) {
                return obj.map(item => sanitize(item));
            }
            return obj;
        };
        
        req.body = sanitize(req.body);
    }
    
    if (req.query && typeof req.query === 'object') {
        const sanitizedQuery = {};
        for (const [key, value] of Object.entries(req.query)) {
            sanitizedQuery[key] = typeof value === 'string' ? sanitizeForSQL(value) : value;
        }
        req.query = sanitizedQuery;
    }
    
    next();
};

exports.validateContentType = (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const contentType = req.headers['content-type'];
        
        if (!contentType) {
            return res.status(415).json({ error: 'Content-Type header required' });
        }
        
        if (!contentType.includes('application/json') && 
            !contentType.includes('multipart/form-data')) {
            return res.status(415).json({ error: 'Content-Type no soportado' });
        }
    }
    next();
};

// =============================================================================
// SQL INJECTION DETECTION
// =============================================================================

exports.detectSqlInjection = (req, res, next) => {
    const sqlInjectionPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i,
        /(--|\/\*|\*\/)/,
        /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,
        /(\bEXEC\b|\bEXECUTE\b)/i
    ];
    
    const checkForSqlInjection = (value) => {
        return sqlInjectionPatterns.some(pattern => pattern.test(value));
    };
    
    for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string' && checkForSqlInjection(value)) {
            logger.warn(`[SQL Injection Blocked] Suspicious query param: ${key}`);
            return res.status(400).json({ error: 'Invalid input detected' });
        }
    }
    
    if (req.body && typeof req.body === 'object') {
        const checkObject = (obj, path = '') => {
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = path ? `${path}.${key}` : key;
                
                if (typeof value === 'string' && checkForSqlInjection(value)) {
                    logger.warn(`[SQL Injection Blocked] Suspicious field: ${currentPath}`);
                    return true;
                } else if (typeof value === 'object' && value !== null) {
                    if (checkObject(value, currentPath)) return true;
                }
            }
            return false;
        };
        
        if (checkObject(req.body)) {
            return res.status(400).json({ error: 'Invalid input detected' });
        }
    }
    
    next();
};

// =============================================================================
// SUSPICIOUS USER-AGENT DETECTION
// =============================================================================

const suspiciousUserAgents = [
    /sqlmap/i,
    /nikto/i,
    /nmap/i,
    /masscan/i,
    /dirbuster/i,
    /gobuster/i,
    /wfuzz/i,
    /hydra/i,
    /burpsuite/i,
    /zap/i,
    /nessus/i,
    /openvas/i,
    /acunetix/i,
    /w3af/i,
    /arachni/i,
    /skipfish/i,
    /whatweb/i,
    /nuclei/i,
    /httpx/i,
    /subfinder/i,
    /curl\/[0-9]/i,
    /python-requests\/[0-9]/i,
    /python-urllib/i,
    /wget\//i,
    /libwww-perl/i,
    /java\//i,
    /go-http-client/i,
    /scrapy/i,
];

exports.detectSuspiciousAgents = (req, res, next) => {
    const userAgent = req.get('user-agent') || '';
    
    // Allow our own app and health checks
    if (!userAgent) {
        // Allow health checks without User-Agent (monitoring probes)
        if (req.path === '/api/health' || req.path === '/health') {
            return next();
        }
        logger.warn(`[Security] Blocked request with empty User-Agent on ${req.path}`);
        return res.status(403).json({ error: 'User-Agent header required' });
    }
    
    // Whitelist our own app and Dart runtime
    if (userAgent.startsWith('GMP-App/') || userAgent.startsWith('Dart/')) {
        return next();
    }
    
    for (const pattern of suspiciousUserAgents) {
        if (pattern.test(userAgent)) {
            logger.warn('[Security] Blocked suspicious User-Agent');
            return res.status(403).json({ error: 'Forbidden' });
        }
    }
    
    next();
};

// =============================================================================
// CONTENT-LENGTH VALIDATION (prevent large payload attacks)
// =============================================================================

const MAX_CONTENT_LENGTH = parseInt(process.env.MAX_CONTENT_LENGTH || '5242880', 10);

exports.validateContentLength = (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const contentLength = parseInt(req.headers['content-length'], 10);
        
        // Allow chunked transfer encoding (no Content-Length header)
        // Cloudflare tunnels and some proxies use chunked encoding
        if (isNaN(contentLength)) {
            return next();
        }
        
        if (contentLength > MAX_CONTENT_LENGTH) {
            logger.warn(`[Security] Blocked large payload (${contentLength} bytes) on ${req.path}`);
            return res.status(413).json({ 
                error: 'Payload too large',
                maxAllowed: MAX_CONTENT_LENGTH
            });
        }
    }
    
    next();
};

// =============================================================================
// X-REQUEST-ID TRACEABILITY
// =============================================================================

const { randomUUID } = require('crypto');

exports.addRequestId = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
};

// =============================================================================
// SECURITY LOGGING
// =============================================================================

exports.logSecurityEvent = (event, req, details) => {
    logger.warn(`[SECURITY] ${event}`, {
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        ...details
    });
};

// =============================================================================
// SCANNER PROBE DETECTION — blocks common scan paths, compact logging
// =============================================================================

const SCANNER_PATH_PATTERNS = [
    /\.env$/i, /\.env\./i, /\.git/i, /\.aws/i, /\.htaccess/i, /\.htpasswd/i,
    /phpinfo/i, /phpmyadmin/i, /wp-admin/i, /wp-login/i, /wp-content/i, /wp-includes/i, /wordpress/i,
    /\.well-known/i, /adminer/i, /mysql/i, /config\./i, /backup$|backup\./i,
    /database\./i, /\.sql$/i, /\.zip$/i, /\.tar/i, /\.gz$/i, /\.7z$/i, /\.rar$/i,
    /cgi-bin/i, /actuator/i, /swagger/i, /api-docs/i, /vendor/i, /composer/i,
    /server-status/i, /\.DS_Store/i, /\.svn/i, /\.hg/i, /\.bzr/i,
    /credentials/i, /\.passwd/i, /\.history/i, /\.bash/i, /id_rsa/i, /id_dsa/i,
    /known_hosts/i, /\.ssh/i, /dump\./i, /console/i, /manager/i, /jmx-console/i,
    /web-console/i, /invoker/i, /struts/i,
];

const scannerIpTracker = new Map();
const SCANNER_LOG_WINDOW_MS = 5 * 60 * 1000;

exports.detectScannerProbes = (req, res, next) => {
    const fullPath = req.path || '';

    const isScannerProbe = SCANNER_PATH_PATTERNS.some(p => p.test(fullPath));

    if (!isScannerProbe) return next();

    const ip = rateLimitPeerIp(req);
    const now = Date.now();

    let tracker = scannerIpTracker.get(ip);
    if (!tracker || now - tracker.lastSeen > SCANNER_LOG_WINDOW_MS) {
        tracker = { count: 0, firstSeen: now, lastSeen: 0 };
    }

    tracker.count++;
    tracker.lastSeen = now;
    scannerIpTracker.set(ip, tracker);

    if (tracker.count === 1) {
        logger.warn(`[SCANNER] New scanner probe blocked: ${req.method} ${fullPath}`);
    } else if (tracker.count % 10 === 0) {
        logger.warn(`[SCANNER] Persistent scanner: ${tracker.count} probes (latest: ${req.method} ${fullPath})`);
    }

    if (scannerIpTracker.size > 200) {
        for (const [k, v] of scannerIpTracker) {
            if (now - v.lastSeen > SCANNER_LOG_WINDOW_MS * 4) scannerIpTracker.delete(k);
        }
    }

    return res.status(404).json({ error: 'Not found' });
};

// =============================================================================
// BRUTE FORCE IP TRACKER — blocks IPs trying many different usernames
// =============================================================================

const bruteForceTracker = new Map();
const BRUTE_FORCE_WINDOW_MS = 5 * 60 * 1000;
const BRUTE_FORCE_MAX_USERS_PER_IP = parseInt(process.env.BRUTE_FORCE_MAX_USERS || '8', 10);

exports.bruteForceIpTracker = (req, res, next) => {
    if (req.method !== 'POST') return next();

    const ip = rateLimitPeerIp(req);
    const username = (req.body && req.body.username) || '__MISSING__';
    const now = Date.now();

    let tracker = bruteForceTracker.get(ip);
    if (!tracker) {
        tracker = { users: new Set(), first: now, last: now, blocked: false };
        bruteForceTracker.set(ip, tracker);
    } else if (now - tracker.last > BRUTE_FORCE_WINDOW_MS) {
        tracker.users.clear();
        tracker.first = now;
        tracker.blocked = false;
    }

    tracker.users.add(username);
    tracker.last = now;

    if (!tracker.blocked && tracker.users.size > BRUTE_FORCE_MAX_USERS_PER_IP) {
        tracker.blocked = true;
        const windowSec = Math.round((now - tracker.first) / 1000);
        logger.warn(`[BRUTE FORCE] ${tracker.users.size} usernames probed in ${windowSec}s — BLOCKED for 30min`);
        const unblockTimer = setTimeout(() => bruteForceTracker.delete(ip), 30 * 60 * 1000);
        unblockTimer.unref?.();
    }

    if (tracker.blocked) {
        return res.status(429).json({
            error: 'Demasiados intentos desde esta IP. Intente en 30 minutos.',
            code: 'IP_BLOCKED'
        });
    }

    // Periodic cleanup of old entries
    if (bruteForceTracker.size > 200) {
        for (const [k, v] of bruteForceTracker) {
            if (now - v.last > BRUTE_FORCE_WINDOW_MS * 4) bruteForceTracker.delete(k);
        }
    }

    next();
};
