/**
 * MIDDLEWARE DE SEGURIDAD
 * Protección contra ataques comunes (XSS, CSRF, Rate Limiting)
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Rate limiter general para toda la API
 */
export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: 'Demasiadas peticiones. Intente más tarde.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit excedido: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Demasiadas peticiones. Intente más tarde.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  },
});

/**
 * Rate limiter específico para login
 */
export const loginRateLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindow,
  max: config.rateLimit.loginLimit,
  message: {
    success: false,
    error: 'Demasiados intentos de login. Espere 15 minutos.',
    code: 'LOGIN_RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Usar IP + código cliente para el key
    const codigoCliente = req.body?.codigoCliente || 'unknown';
    return `${req.ip}-${codigoCliente}`;
  },
  handler: (req, res) => {
    logger.warn(`Login rate limit excedido: ${req.ip} - ${req.body?.codigoCliente}`);
    res.status(429).json({
      success: false,
      error: 'Demasiados intentos de login. Espere 15 minutos.',
      code: 'LOGIN_RATE_LIMIT',
    });
  },
});

/**
 * Rate limiter para operaciones sensibles (PDFs, etc.)
 */
export const sensitiveLimiter = rateLimit({
  windowMs: 60000, // 1 minuto
  max: 10, // 10 peticiones por minuto
  message: {
    success: false,
    error: 'Límite de operaciones alcanzado. Espere un momento.',
    code: 'SENSITIVE_RATE_LIMIT',
  },
});

/**
 * Sanitización de inputs (anti-XSS)
 */
export function sanitizeInputs(req: Request, _res: Response, next: NextFunction): void {
  const sanitize = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Remover caracteres peligrosos
        result[key] = value
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .trim();
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = sanitize(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  };

  if (req.body && typeof req.body === 'object') {
    req.body = sanitize(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitize(req.query as Record<string, unknown>) as typeof req.query;
  }

  next();
}

/**
 * Detección de patrones sospechosos (SQL Injection, etc.)
 */
export function detectSuspiciousPatterns(req: Request, _res: Response, next: NextFunction): void {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b)/i,
    /(--|;|'|"|\bOR\b\s+\d+\s*=\s*\d+)/i,
    /(<\s*script|javascript\s*:|eval\s*\()/i,
    /(\/\*|\*\/)/,
  ];

  const checkValue = (value: unknown): boolean => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some((pattern) => pattern.test(value));
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some(checkValue);
    }
    return false;
  };

  const isSuspicious = 
    checkValue(req.body) || 
    checkValue(req.query) || 
    checkValue(req.params);

  if (isSuspicious) {
    logger.warn('Patrón sospechoso detectado:', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });

    // En producción, podríamos bloquear la IP
    // Por ahora, solo logueamos y continuamos
  }

  next();
}

/**
 * Añade request ID para tracking
 */
export function addRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

/**
 * Logger de seguridad
 */
export function securityLogger(req: Request, _res: Response, next: NextFunction): void {
  if (config.isProduction) {
    // En producción, log reducido
    logger.debug('Request:', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
  } else {
    // En desarrollo, log completo
    logger.debug('Request detallado:', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      body: req.method !== 'GET' ? '***' : undefined,
    });
  }

  next();
}

/**
 * Headers de seguridad adicionales
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Middleware de seguridad combinado para el servidor
 */
export function securityMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Añadir request ID
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Headers de seguridad
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');

  next();
}

export default {
  generalLimiter,
  loginRateLimiter,
  sensitiveLimiter,
  sanitizeInputs,
  detectSuspiciousPatterns,
  addRequestId,
  securityLogger,
  securityHeaders,
  securityMiddleware,
};
