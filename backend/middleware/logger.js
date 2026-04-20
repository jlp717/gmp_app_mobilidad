const winston = require('winston');

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
        }),
        new winston.transports.File({ 
            filename: 'server.log', 
            maxsize: 5242880, 
            maxFiles: 5,
            level: 'info'
        }),
        new winston.transports.File({ 
            filename: 'error.log', 
            maxsize: 5242880, 
            maxFiles: 3,
            level: 'error'
        })
    ]
});

// =============================================================================
// SECURE LOGGING HELPERS
// =============================================================================
// Loggear sin exponer datos sensibles
const sanitizeForLog = (data) => {
    if (typeof data !== 'object' || data === null) {
        return data;
    }
    const sensitive = ['password', 'token', 'secret', 'authorization', 'Bearer', 'api_key', 'apikey', 'credential'];
    const sanitized = { ...data };
    for (const key of sensitive) {
        if (sanitized[key]) {
            sanitized[key] = '[REDACTED]';
        }
    }
    return sanitized;
};

// Loggear request sin credenciales
const logRequest = (req, message) => {
    logger.http(message, {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent')
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
module.exports.log = log;
module.exports.NODE_ENV = NODE_ENV;