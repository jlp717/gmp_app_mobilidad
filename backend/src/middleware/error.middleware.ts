/**
 * MIDDLEWARE DE MANEJO DE ERRORES
 * Gestión centralizada de errores y respuestas
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config/env';

/**
 * Clase personalizada para errores de la API
 */
export class ApiError extends Error {
  statusCode: number;
  code: string;
  isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Errores predefinidos
 */
export const Errors = {
  NotFound: (message = 'Recurso no encontrado') => 
    new ApiError(message, 404, 'NOT_FOUND'),
  
  Unauthorized: (message = 'No autorizado') => 
    new ApiError(message, 401, 'UNAUTHORIZED'),
  
  Forbidden: (message = 'Acceso prohibido') => 
    new ApiError(message, 403, 'FORBIDDEN'),
  
  BadRequest: (message = 'Petición inválida') => 
    new ApiError(message, 400, 'BAD_REQUEST'),
  
  Validation: (message = 'Error de validación') => 
    new ApiError(message, 400, 'VALIDATION_ERROR'),
  
  RateLimit: (message = 'Límite de peticiones excedido') => 
    new ApiError(message, 429, 'RATE_LIMIT'),
  
  Internal: (message = 'Error interno del servidor') => 
    new ApiError(message, 500, 'INTERNAL_ERROR', false),
  
  Database: (message = 'Error de base de datos') => 
    new ApiError(message, 500, 'DATABASE_ERROR', false),
};

/**
 * Middleware para rutas no encontradas
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  logger.warn(`Ruta no encontrada: ${req.method} ${req.path}`);
  
  res.status(404).json({
    success: false,
    error: 'Endpoint no encontrado',
    code: 'NOT_FOUND',
    path: req.path,
    method: req.method,
  });
}

/**
 * Middleware principal de manejo de errores
 */
export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Determinar si es un error operacional o de programación
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;
  const code = isApiError ? err.code : 'INTERNAL_ERROR';
  const isOperational = isApiError ? err.isOperational : false;

  // Logging
  if (isOperational) {
    logger.warn(`Error operacional [${code}]:`, {
      message: err.message,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
    });
  } else {
    logger.error('Error no manejado:', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
    });
  }

  // Respuesta al cliente
  const response: Record<string, unknown> = {
    success: false,
    error: isOperational ? err.message : 'Error interno del servidor',
    code,
    requestId: req.requestId,
  };

  // En desarrollo, incluir stack trace
  if (config.isDevelopment && !isOperational) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * Logger de peticiones
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](`${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      requestId: req.requestId,
      ip: req.ip,
    });
  });

  next();
}

/**
 * Wrapper para async handlers
 * Captura errores de funciones async y los pasa al error handler
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default {
  ApiError,
  Errors,
  notFoundHandler,
  errorHandler,
  requestLogger,
  asyncHandler,
};
