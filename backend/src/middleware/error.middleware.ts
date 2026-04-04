/**
 * Error Handling Middleware - Production Grade v4.0.0
 * 
 * @agent Code Quality - Consistent error format, proper HTTP status codes
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ============================================================
// CUSTOM ERROR CLASSES
// ============================================================

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public isOperational = true
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public details?: Record<string, string>[]) {
    super(400, message, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}

// ============================================================
// NOT FOUND HANDLER (404)
// ============================================================

export function notFoundHandler(req: Request, res: Response): void {
  logger.warn(`404 - ${req.method} ${req.originalUrl}`);
  
  res.status(404).json({
    error: 'Not Found',
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    path: req.originalUrl,
    method: req.method,
  });
}

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error
  if (err instanceof AppError && err.isOperational) {
    logger.warn(`${err.statusCode} - ${err.message} - ${err.code}`);
  } else {
    logger.error('Unhandled error:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
  }

  // Don't leak internal details in production
  const isProduction = process.env.NODE_ENV === 'production';
  
  const response: Record<string, unknown> = {
    error: err instanceof AppError ? err.message : 'Internal Server Error',
    code: err instanceof AppError ? err.code : 'INTERNAL_ERROR',
  };

  // Add details for validation errors
  if (err instanceof ValidationError && err.details) {
    response.details = err.details;
  }

  // Stack trace only in development
  if (!isProduction && err.stack) {
    response.stack = err.stack;
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  res.status(statusCode).json(response);
}
