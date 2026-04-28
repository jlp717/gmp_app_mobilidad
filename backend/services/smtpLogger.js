'use strict';

const logger = require('../middleware/logger');

const DEBUG_VALUES = new Set(['1', 'true', 'yes', 'on']);
const NOISY_LEVELS = new Set(['trace', 'debug', 'info']);

function isSmtpDebugEnabled() {
    const value = process.env.SMTP_DEBUG || process.env.SMTP_PDF_DEBUG || '';
    return DEBUG_VALUES.has(String(value).trim().toLowerCase());
}

function sanitizeData(data) {
    if (!data || typeof data !== 'object' || Buffer.isBuffer(data)) {
        return undefined;
    }

    const clean = { ...data };
    delete clean.auth;
    delete clean.pass;
    delete clean.password;
    delete clean.accessToken;
    return clean;
}

function stringifyPart(part) {
    if (part === null || part === undefined) {
        return '';
    }
    if (typeof part === 'string') {
        return part;
    }
    if (part instanceof Error) {
        return part.message;
    }
    if (typeof part === 'number' || typeof part === 'boolean') {
        return String(part);
    }
    return '';
}

function write(level, data, message, ...args) {
    if (NOISY_LEVELS.has(level) && !isSmtpDebugEnabled()) {
        return false;
    }

    const logLevel = level === 'fatal' ? 'error' : level;
    const logFn = logger[logLevel] || logger.info || (() => false);
    const text = [message, ...args]
        .map(stringifyPart)
        .filter(Boolean)
        .join(' ');
    const fallbackText = stringifyPart(data);
    const logMessage = `[SMTP] ${text || fallbackText || level}`;
    const cleanData = sanitizeData(data);

    if (cleanData) {
        return logFn.call(logger, logMessage, cleanData);
    }
    return logFn.call(logger, logMessage);
}

const smtpLogger = {
    trace: (...args) => write('trace', ...args),
    debug: (...args) => write('debug', ...args),
    info: (...args) => write('info', ...args),
    warn: (...args) => write('warn', ...args),
    error: (...args) => write('error', ...args),
    fatal: (...args) => write('fatal', ...args),
    log: (...args) => write('debug', ...args)
};

module.exports = {
    smtpLogger,
    isSmtpDebugEnabled
};
