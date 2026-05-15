/**
 * GMP App Security Middleware - Comprehensive Security Layer
 * ============================================================
 * OWASP Top 10 Protection | Rate Limiting | Input Validation | Security Headers
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
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

// =============================================================================
// RATE LIMITERS
// =============================================================================

exports.globalLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    message: {
        error: 'Demasiadas solicitudes. Por favor, inténtelo de nuevo más tarde.',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip || 'unknown'}-${req.get('user-agent') || 'unknown'}`,
    skip: (req) => req.path === '/api/health' || req.path === '/health/version-check'
});

exports.loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes (reduced from 15)
    max: LOGIN_RATE_LIMIT_MAX,
    message: {
        error: 'Demasiados intentos. Espera unos minutos antes de intentar de nuevo.',
        retryAfter: 300
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip || 'unknown'}-${req.body?.username || 'unknown'}`
});

exports.apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    message: { 
        error: 'Límite de solicitudes API excedido. Intente más tarde.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health' || req.path === '/health/version-check', // Skip health checks
    keyGenerator: (req) => req.user?.id || req.ip || 'unknown'
});

exports.uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiadas subidas de archivos. Intente más tarde.' },
    standardHeaders: true,
    legacyHeaders: false
});

exports.emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados envíos de email. Intente en una hora.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Para apps moviles los limites deben ser GENEROSOS por usuario. La app abre
// pestanas que disparan 20-40 GET en paralelo. Limites bajos producen 429
// masivos y rompen la UI. Limites RESTRICTIVOS solo en POST/PUT/DELETE
// (escritura), no en GET de lectura.
exports.cobrosLimiter = rateLimit({
    windowMs: 60 * 1000,         // 1 minuto
    max: 240,                    // 240 req/min/usuario (lectura GET intensiva OK)
    message: {
        error: 'Demasiadas solicitudes de cobros. Espera un momento.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip || 'unknown',
    skip: (req) => req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE'
        ? false : false // aplicar siempre, pero con limite generoso
});

exports.pedidosLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,                    // 300 req/min/usuario para pedidos
    message: {
        error: 'Demasiadas solicitudes de pedidos. Espera un momento.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip || 'unknown'
});

exports.bolsaLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,                    // 120 req/min/usuario
    message: {
        error: 'Demasiadas solicitudes de bolsa comercial. Espera un momento.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip || 'unknown'
});

exports.evolutionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,                    // 120 req/min/usuario (era 40)
    message: {
        error: 'Demasiadas solicitudes de evolución. Espera un momento.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip || 'unknown'
});

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
            logger.warn(`[SQL Injection Blocked] Suspicious query param: ${key} from IP: ${req.ip}`);
            return res.status(400).json({ error: 'Invalid input detected' });
        }
    }
    
    if (req.body && typeof req.body === 'object') {
        const checkObject = (obj, path = '') => {
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = path ? `${path}.${key}` : key;
                
                if (typeof value === 'string' && checkForSqlInjection(value)) {
                    logger.warn(`[SQL Injection Blocked] Suspicious field: ${currentPath} from IP: ${req.ip}`);
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
        logger.warn(`[Security] Blocked request with empty User-Agent from IP: ${req.ip} on ${req.path}`);
        return res.status(403).json({ error: 'User-Agent header required' });
    }
    
    // Whitelist our own app and Dart runtime
    if (userAgent.startsWith('GMP-App/') || userAgent.startsWith('Dart/')) {
        return next();
    }
    
    for (const pattern of suspiciousUserAgents) {
        if (pattern.test(userAgent)) {
            logger.warn(`[Security] Blocked suspicious User-Agent "${userAgent}" from IP: ${req.ip}`);
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
            logger.warn(`[Security] Blocked large payload (${contentLength} bytes) from IP: ${req.ip} on ${req.path}`);
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
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.get('user-agent'),
        userId: req.user?.id,
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

    const ip = req.ip || 'unknown';
    const now = Date.now();

    let tracker = scannerIpTracker.get(ip);
    if (!tracker || now - tracker.lastSeen > SCANNER_LOG_WINDOW_MS) {
        tracker = { count: 0, firstSeen: now, lastSeen: 0 };
    }

    tracker.count++;
    tracker.lastSeen = now;
    scannerIpTracker.set(ip, tracker);

    if (tracker.count === 1) {
        logger.warn(`[SCANNER] New scanner from ${ip}: ${req.method} ${fullPath}`);
    } else if (tracker.count % 10 === 0) {
        logger.warn(`[SCANNER] Persistent scanner from ${ip}: ${tracker.count} probes (latest: ${req.method} ${fullPath})`);
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

    const ip = req.ip || 'unknown';
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
        logger.warn(`[BRUTE FORCE] IP ${ip} probed ${tracker.users.size} usernames in ${windowSec}s — BLOCKED for 30min`);
        setTimeout(() => bruteForceTracker.delete(ip), 30 * 60 * 1000);
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
