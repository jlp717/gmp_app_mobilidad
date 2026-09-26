const winston = require('winston');
const crypto = require('crypto');

// =============================================================================
// WINSTON LOGGER CONFIGURATION
// =============================================================================
const NODE_ENV = process.env.NODE_ENV || 'development';

const getLogLevel = () => {
    if (NODE_ENV === 'production') {
        return 'info'; // changed from 'warn' — startup messages must be visible
    }
    if (NODE_ENV === 'staging') {
        return 'info';
    }
    return 'debug';
};

const logger = winston.createLogger({
    level: getLogLevel(),
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            const base = `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}`;
            return stack ? `${base}\n${stack}` : base;
        })
    ),
    transports: [
        new winston.transports.Console({
            stderrLevels: ['error', 'warn']
        })
    ]
});

// =============================================================================
// SECURE LOGGING HELPERS
// =============================================================================
// Loggear sin exponer datos sensibles.
// Recursivo: cubre objetos/arrays anidados sin mutar el original.
// Solo se comparan NOMBRES de clave (nunca valores) contra la lista sensible.
const SENSITIVE_KEYS = new Set([
    'password', 'passwd', 'token', 'secret', 'authorization', 'bearer',
    'api_key', 'apikey', 'credential', 'credentials',
    'dni', 'email', 'pin', 'firma',
]);
const sanitizeForLog = (data, seen) => {
    if (typeof data !== 'object' || data === null) {
        return data;
    }
    const seenSet = seen || new WeakSet();
    if (seenSet.has(data)) {
        return '[CIRCULAR]';
    }
    seenSet.add(data);
    if (Array.isArray(data)) {
        return data.map((item) => sanitizeForLog(item, seenSet));
    }
    const sanitized = {};
    for (const key of Object.keys(data)) {
        if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
            sanitized[key] = '[REDACTED]';
        } else {
            sanitized[key] = sanitizeForLog(data[key], seenSet);
        }
    }
    return sanitized;
};

// La IP es dato personal (GDPR): guardarla en claro en logs permite
// correlacionar usuarios y amplifica una filtracion de logs. Se almacena
// solo su hash sha256 truncado a 12 chars: basta para correlacionar
// requests sin conservar la IP reversible.
const hashIpForLog = (ip) => {
    if (!ip || typeof ip !== 'string') {
        return 'unknown';
    }
    return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
};

// Loggear request sin credenciales ni IP en claro (mismo formato de claves).
const logRequest = (req, message) => {
    const userAgent = (req && typeof req.get === 'function' && req.get('user-agent'))
        || (req && req.headers && req.headers['user-agent'])
        || 'unknown';
    logger.http(message, {
        method: req.method,
        url: req.url,
        ip: hashIpForLog(req.ip),
        userAgent,
    });
};

// Loggear con sanitización automática
const log = {
    debug: (message, meta) => {
        logger.debug(message, meta ? sanitizeForLog(meta) : undefined);
    },
    info: (message, meta) => {
        logger.info(message, meta ? sanitizeForLog(meta) : undefined);
    },
    warn: (message, meta) => {
        logger.warn(message, meta ? sanitizeForLog(meta) : undefined);
    },
    error: (message, meta) => {
        logger.error(message, meta ? sanitizeForLog(meta) : undefined);
    },
    http: (message, meta) => {
        logger.http(message, meta);
    }
};

module.exports = logger;
module.exports.secureLog = log;
module.exports.sanitizeForLog = sanitizeForLog;
module.exports.hashIpForLog = hashIpForLog;
module.exports.logRequest = logRequest;
module.exports.NODE_ENV = NODE_ENV;