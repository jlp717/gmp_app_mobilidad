'use strict';

/**
 * Serializador canonico de errores HTTP para el runtime CommonJS (backend/app.js).
 *
 * Shape canonico: { success: false, code, error, requestId }
 * - requestId sale de req.requestId (middleware addRequestId en
 *   backend/middleware/security.js) con fallback al header entrante.
 * - NO importa nada de backend/src/* (zona TS legacy): la clasificacion de
 *   AppError se hace por duck-typing (statusCode/code/expose), no por
 *   instanceof, para no acoplar el runtime JS al legacy.
 */

const DB_UNAVAILABLE_CODES = new Set([
    'DB_CIRCUIT_OPEN',
    'DB_QUERY_QUEUE_TIMEOUT',
    'DB_QUERY_TIMEOUT',
]);

function safeCode(raw, fallback) {
    const value = String(raw || '').trim().toUpperCase();
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) return value;
    return fallback;
}

function requestIdOf(req) {
    if (req && typeof req.requestId === 'string' && req.requestId) return req.requestId;
    const header = req && req.headers && (req.headers['x-request-id'] || req.headers['X-Request-ID']);
    if (typeof header === 'string' && header) return header;
    return null;
}

function zodDetails(err) {
    const issues = Array.isArray(err.errors) ? err.errors : err.issues;
    if (!Array.isArray(issues)) return null;
    return issues.map((item) => ({
        path: Array.isArray(item.path) ? item.path.join('.') : String(item.path || ''),
        message: String(item.message || 'Invalid value'),
    }));
}

/**
 * @param {any} err error lanzado / pasado a next(err)
 * @param {any} req request Express (solo se lee req.requestId + headers)
 * @returns {{ statusCode: number, body: { success: false, code: string, error: string, requestId: string|null, details?: any } }}
 */
function serializeError(err, req) {
    const requestId = requestIdOf(req);
    const body = { success: false, code: 'INTERNAL_ERROR', error: 'Internal Server Error', requestId };

    const fail = (statusCode, code, message, extra) => ({
        statusCode,
        body: { ...body, code, error: message, ...(extra || {}) },
    });

    if (err && (err.name === 'ZodError' || err.name === 'ValidationError')) {
        const details = err.name === 'ZodError' ? zodDetails(err) : null;
        return fail(400, 'VALIDATION_ERROR', 'Validation failed', details ? { details } : undefined);
    }
    if (err && err.name === 'UnauthorizedError') {
        return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    }
    if (err && err.name === 'ForbiddenError') {
        return fail(403, 'FORBIDDEN', 'Forbidden');
    }
    if (err && err.name === 'NotFoundError') {
        return fail(404, 'NOT_FOUND', 'Not found');
    }
    if (err && err.code && DB_UNAVAILABLE_CODES.has(String(err.code))) {
        return fail(503, String(err.code), 'Database temporarily unavailable');
    }
    if (err && (err.code === 'SQLITE_CANTOPEN' || (typeof err.message === 'string' && err.message.includes('database')))) {
        return fail(503, 'DATABASE_UNAVAILABLE', 'Database unavailable');
    }
    // Duck-typing de AppError (src/errors/AppError) sin importar src/:
    // respeta statusCode/code cuando son validos. 5xx => mensaje generico
    // SIEMPRE (el detalle va al log del servidor, nunca al cliente).
    if (err && Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode <= 599) {
        const statusCode = err.statusCode;
        const code = safeCode(err.code, statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
        const message = statusCode < 500 && err.expose !== false && typeof err.message === 'string' && err.message
            ? err.message
            : 'Internal Server Error';
        return fail(statusCode, code, message);
    }

    return { statusCode: 500, body };
}

module.exports = { serializeError, DB_UNAVAILABLE_CODES };
