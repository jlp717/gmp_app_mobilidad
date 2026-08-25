'use strict';

const logger = require('../../middleware/logger');
const { createErrorResponse } = require('../../utils/common');

let Sentry = null;
try {
    Sentry = require('@sentry/node');
} catch (_) {
    Sentry = null;
}

// Mismos codes que handleRouteError legacy: degradacion controlada a 503.
const DB_UNAVAILABLE_CODES = new Set(['DB_CIRCUIT_OPEN', 'DB_QUERY_QUEUE_TIMEOUT', 'DB_QUERY_TIMEOUT']);

function captureException(error, context) {
    if (Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(error, { extra: context });
    }
}

function safeErrorCode(error) {
    const rawCode = String(error?.code || '').trim().toUpperCase();
    return /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'UNEXPECTED_ERROR';
}

/**
 * Serializacion unica de errores.
 * - style 'finanzas': shape { success:false, code, error } (reemplaza sendError
 *   inline del route legacy, paridad exacta incluida ZodError 400).
 * - resto: shape createErrorResponse legacy ({ error, code, details }).
 * El stack completo SOLO va al log interno; nunca al cliente.
 */
function respondError(res, error, { style = 'legacy', action } = {}) {
    // Log interno con stack completo.
    logger.error(`[ERROR HANDLER] ${error?.message || error}${error?.stack ? '\n' + error.stack : ''}`, {
        style,
        code: error?.code,
        action,
    });

    if (res.headersSent || res.writableEnded || res.locals?.requestTimedOut) {
        logger.warn(`[ERROR HANDLER] Response already completed; suppressing duplicate error response: ${error?.message}`);
        return;
    }

    if (style === 'finanzas') {
        if (error && error.code === 'REPARTO_SCHEMA_UNAVAILABLE') {
            logger.error('[REPARTIDOR_FINANZAS] esquema de reparto no disponible', { action });
            return res.status(503).json({
                success: false,
                code: error.code,
                error: 'El origen de datos de reparto no esta disponible. Reintenta mas tarde.',
            });
        }
        if (error && error.name === 'ZodError') {
            return res.status(400).json({
                success: false,
                error: 'Invalid request',
                details: error.errors.map((item) => ({
                    path: item.path.join('.'),
                    message: item.message,
                })),
            });
        }
        const typedStatus = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
            ? error.statusCode
            : null;
        const safeCode = safeErrorCode(error);
        // Nunca loguear SQL, binds ni PII aqui.
        logger.error('[REPARTIDOR_FINANZAS] request failed', {
            action: action || 'unknown',
            code: safeCode,
            statusCode: typedStatus || 500,
        });
        captureException(error, { action });
        if (typedStatus) {
            return res.status(typedStatus).json({
                success: false,
                code: safeCode,
                error: typedStatus >= 500 ? 'Servicio temporalmente no disponible' : error.message,
            });
        }
        return res.status(500).json({
            success: false,
            code: 'INTERNAL_SERVER_ERROR',
            error: 'Error interno del servidor',
        });
    }

    let statusCode = res.locals?.errorStatus || 500;
    let userMessage = res.locals?.errorMessage || 'Error interno del servidor';

    if (DB_UNAVAILABLE_CODES.has(error?.code)) {
        statusCode = 503;
        userMessage = 'Base de datos temporalmente no disponible';
    }

    const responseExtras = {};
    if (error?.code || res.locals?.errorCode) {
        responseExtras.code = error?.code || res.locals?.errorCode;
    }

    // Paridad: el estilo legacy nunca capturaba en Sentry.
    return res.status(statusCode).json(createErrorResponse(error, userMessage, responseExtras));
}

/**
 * Middleware Express 4. Delega en respondError para que controladores que
 * prefieren responder inline usen EXACTAMENTE la misma serializacion.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
    return respondError(res, error, {
        style: res.locals?.errorStyle || 'legacy',
        action: res.locals?.errorAction,
    });
}

module.exports = { errorHandler, respondError, DB_UNAVAILABLE_CODES };
