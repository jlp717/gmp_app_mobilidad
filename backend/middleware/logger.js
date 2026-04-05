const winston = require('winston');

// =============================================================================
// WINSTON LOGGER CONFIGURATION
// =============================================================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) =>
            `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'server.log', maxsize: 5242880, maxFiles: 5 })
    ]
});

module.exports = logger;
