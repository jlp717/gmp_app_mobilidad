'use strict';

/**
 * Jerarquia de errores de aplicacion con statusCode propio.
 * Ningun controlador construye respuestas de error a mano: lanza una de estas
 * clases y el middleware central (middlewares/errorHandler) la serializa.
 */
class AppError extends Error {
    /**
     * @param {string} message
     * @param {object} [options]
     * @param {number} [options.statusCode=500]
     * @param {string} [options.code='INTERNAL_ERROR']
     * @param {boolean} [options.expose=true] false => el cliente recibe mensaje generico
     */
    constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', expose = true } = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.expose = expose;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message = 'Peticion invalida', options = {}) {
        super(message, { statusCode: 400, code: 'VALIDATION_ERROR', ...options });
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Recurso no encontrado', options = {}) {
        super(message, { statusCode: 404, code: 'NOT_FOUND', ...options });
    }
}

class DatabaseError extends AppError {
    constructor(message = 'Error de base de datos', options = {}) {
        super(message, { statusCode: options.statusCode || 503, code: options.code || 'DATABASE_ERROR', ...options });
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Acceso denegado', options = {}) {
        super(message, { statusCode: 403, code: options.code || 'FORBIDDEN', ...options });
    }
}

function isAppError(error) {
    return error instanceof AppError;
}

module.exports = {
    AppError,
    ValidationError,
    NotFoundError,
    DatabaseError,
    ForbiddenError,
    isAppError,
};
