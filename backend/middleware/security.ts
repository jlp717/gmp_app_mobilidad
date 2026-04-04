/**
 * GMP App Security Middleware - Comprehensive Security Layer
 * ============================================================
 * OWASP Top 10 Protection | Rate Limiting | Input Validation | Security Headers
 * 
 * This middleware provides:
 * - Advanced rate limiting with IP fingerprinting
 * - Strict CORS configuration
 * - Security headers (CSP, HSTS, X-Frame-Options, etc.)
 * - Input sanitization and validation
 * - SQL injection prevention
 * - XSS protection
 * - Request size limiting
 */

import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { sanitizeForSQL } from '../utils/common';

// =============================================================================
// CONFIGURATION - Environment-based security settings
// =============================================================================

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 min default
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT || '5', 10);
const API_RATE_LIMIT_MAX = parseInt(process.env.API_RATE_LIMIT || '500', 10);

// CORS configuration
const parseCorsOrigin = (value?: string): cors.CorsOptions['origin'] => {
    if (isProduction) {
        if (!value || value === 'true' || value === '*') {
            return false; // Block all origins in production if not explicitly configured
        }
        return value.split(',').map(o => o.trim()).filter(Boolean);
    }
    // Development: allow all or specific origins
    if (value === 'true' || value === '*') return true;
    if (value) return value.split(',').map(o => o.trim()).filter(Boolean);
    return true; // Allow all in development
};

// =============================================================================
// RATE LIMITERS
// =============================================================================

/**
 * Global rate limiter - Applied to all /api routes
 * Prevents DDoS and brute force attacks
 */
export const globalLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    message: { 
        error: 'Demasiadas solicitudes. Por favor, inténtelo de nuevo más tarde.',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
        // Use IP + User-Agent fingerprint for more accurate rate limiting
        const fingerprint = `${req.ip || 'unknown'}-${req.get('user-agent') || 'unknown'}`;
        return fingerprint;
    },
    skip: (req: Request) => {
        // Skip rate limiting for health checks
        return req.path === '/api/health';
    }
});

/**
 * Login-specific rate limiter - Strict limits to prevent brute force
 */
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: LOGIN_RATE_LIMIT_MAX,
    message: { 
        error: 'Demasiados intentos de login. Espere 15 minutos antes de intentar de nuevo.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
        // Rate limit by IP and username combination
        const username = req.body?.username || 'unknown';
        return `${req.ip || 'unknown'}-${username}`;
    }
});

/**
 * API-specific rate limiter for authenticated endpoints
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: API_RATE_LIMIT_MAX,
    message: { 
        error: 'Límite de solicitudes API excedido. Intente más tarde.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
        // Use user ID from auth token if available
        const userId = (req as any).user?.id || req.ip || 'unknown';
        return userId;
    }
});

/**
 * Upload-specific rate limiter - Strict limits for file uploads
 */
export const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { 
        error: 'Demasiadas subidas de archivos. Intente más tarde.',
        retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Email-specific rate limiter - Prevent email spam
 */
export const emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { 
        error: 'Demasiados envíos de email. Intente en una hora.',
        retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false
});

// =============================================================================
// SECURITY HEADERS MIDDLEWARE
// =============================================================================

/**
 * Creates comprehensive security headers middleware
 * Combines Helmet defaults with custom strict headers
 */
export function createSecurityHeaders() {
    const helmetMiddleware = helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"], // Required for some Flutter web features
                imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
                connectSrc: ["'self'", 'https://api.mari-pepa.com'],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"],
                upgradeInsecureRequests: isProduction ? [] : undefined
            }
        },
        crossOriginEmbedderPolicy: true,
        crossOriginOpenerPolicy: true,
        crossOriginResourcePolicy: { policy: "same-site" },
        dnsPrefetchControl: { allow: false },
        frameguard: { action: 'deny' },
        hidePoweredBy: true,
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        },
        ieNoOpen: true,
        noSniff: true,
        originAgentCluster: true,
        permittedCrossDomainPolicies: { permittedPolicies: "none" },
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        xssFilter: true
    });

    return (req: Request, res: Response, next: NextFunction) => {
        // Apply Helmet defaults
        helmetMiddleware(req, res, () => {
            // Add custom security headers
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '0'); // Modern browsers use CSP instead
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            
            // Remove server identification headers
            res.removeHeader('X-Powered-By');
            res.removeHeader('Server');
            
            next();
        });
    };
}

// =============================================================================
// INPUT VALIDATION & SANITIZATION
// =============================================================================

/**
 * Zod schemas for common input validation
 */
export const validationSchemas = {
    // Login validation
    login: z.object({
        username: z.string()
            .min(1, 'Username is required')
            .max(50, 'Username too long')
            .regex(/^[a-zA-Z0-9 ]+$/, 'Invalid username format'),
        password: z.string()
            .min(1, 'Password is required')
            .max(100, 'Password too long')
    }),

    // Client code validation
    clientCode: z.string()
        .max(20, 'Client code too long')
        .regex(/^[a-zA-Z0-9]+$/, 'Invalid client code format'),

    // Vendor code validation
    vendorCode: z.string()
        .max(10, 'Vendor code too long')
        .regex(/^[a-zA-Z0-9]+$/, 'Invalid vendor code format'),

    // Product code validation
    productCode: z.string()
        .max(50, 'Product code too long')
        .regex(/^[a-zA-Z0-9\-_]+$/, 'Invalid product code format'),

    // Date validation
    date: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (expected YYYY-MM-DD)'),

    // Numeric ID validation
    numericId: z.string()
        .regex(/^\d+$/, 'Invalid numeric ID'),

    // Search query validation
    searchQuery: z.string()
        .max(200, 'Search query too long')
        .transform(val => sanitizeForSQL(val))
};

/**
 * Middleware factory for validating request body against Zod schema
 */
export function validateBody(schema: z.ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const validatedData = schema.parse(req.body);
            (req as any).validatedBody = validatedData;
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));
                res.status(400).json({
                    error: 'Validation failed',
                    details: errors
                });
                return;
            }
            next(error);
        }
    };
}

/**
 * Middleware factory for validating query parameters against Zod schema
 */
export function validateQuery(schema: z.ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const validatedData = schema.parse(req.query);
            (req as any).validatedQuery = validatedData;
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.errors.map(e => ({
                    field: e.path.join('.'),
                    message: e.message
                }));
                res.status(400).json({
                    error: 'Invalid query parameters',
                    details: errors
                });
                return;
            }
            next(error);
        }
    };
}

/**
 * Sanitizes all string inputs in request body
 * Removes potentially dangerous characters for SQL injection and XSS
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction) {
    if (req.body && typeof req.body === 'object') {
        const sanitize = (obj: any): any => {
            if (typeof obj === 'string') {
                // Remove potentially dangerous characters
                let sanitized = obj
                    .replace(/[<>'"\\;]/g, '') // Remove HTML/script chars
                    .replace(/&(?!(amp|lt|gt|quot|#39);)/g, '&amp;') // Encode unescaped ampersands
                    .replace(/\r?\n/g, ' ') // Remove newlines
                    .trim();
                
                // Additional SQL injection protection
                sanitized = sanitizeForSQL(sanitized);
                
                return sanitized;
            } else if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
                const sanitizedObj: any = {};
                for (const key of Object.keys(obj)) {
                    sanitizedObj[key] = sanitize(obj[key]);
                }
                return sanitizedObj;
            } else if (Array.isArray(obj)) {
                return obj.map(item => sanitize(item));
            }
            return obj;
        };
        
        req.body = sanitize(req.body);
    }
    
    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
        const sanitizedQuery: any = {};
        for (const [key, value] of Object.entries(req.query)) {
            if (typeof value === 'string') {
                sanitizedQuery[key] = sanitizeForSQL(value);
            } else {
                sanitizedQuery[key] = value;
            }
        }
        req.query = sanitizedQuery;
    }
    
    next();
}

/**
 * Validates Content-Type header for POST/PUT/PATCH requests
 */
export function validateContentType(req: Request, res: Response, next: NextFunction) {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const contentType = req.headers['content-type'];
        
        if (!contentType) {
            return res.status(415).json({ 
                error: 'Content-Type header required. Use application/json.' 
            });
        }
        
        if (!contentType.includes('application/json') && 
            !contentType.includes('multipart/form-data')) {
            return res.status(415).json({ 
                error: 'Content-Type no soportado. Se requiere application/json o multipart/form-data.' 
            });
        }
    }
    next();
}

/**
 * Limits request body size to prevent DoS attacks
 */
export function limitRequestBodySize(maxSize: string = '2mb') {
    return (req: Request, res: Response, next: NextFunction) => {
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        const maxSizeBytes = parseSize(maxSize);
        
        if (contentLength > maxSizeBytes) {
            return res.status(413).json({ 
                error: `Request body too large. Maximum size is ${maxSize}.` 
            });
        }
        next();
    };
}

function parseSize(size: string): number {
    const match = size.match(/^(\d+)([km]?)b?$/i);
    if (!match) return 2 * 1024 * 1024; // Default 2MB
    
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
        case 'k': return value * 1024;
        case 'm': return value * 1024 * 1024;
        default: return value;
    }
}

// =============================================================================
// SQL INJECTION PREVENTION
// =============================================================================

/**
 * Middleware to detect and block potential SQL injection attempts
 * Analyzes query parameters and body for suspicious patterns
 */
export function detectSqlInjection(req: Request, res: Response, next: NextFunction) {
    const sqlInjectionPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i,
        /(--|\/\*|\*\/)/, // SQL comments
        /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i, // OR 1=1 style attacks
        /(;|\||`|')/, // Statement terminators and pipes
        /(\bEXEC\b|\bEXECUTE\b)/i,
        /(\bxp_|sp_)/i // SQL Server extended procedures
    ];
    
    const checkForSqlInjection = (value: string): boolean => {
        return sqlInjectionPatterns.some(pattern => pattern.test(value));
    };
    
    // Check query parameters
    for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string' && checkForSqlInjection(value)) {
            logger.warn(`[SQL Injection Blocked] Suspicious query param: ${key}=${value} from IP: ${req.ip}`);
            return res.status(400).json({ 
                error: 'Invalid input detected. Potential security violation.' 
            });
        }
    }
    
    // Check body
    if (req.body && typeof req.body === 'object') {
        const checkObject = (obj: any, path: string = ''): boolean => {
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = path ? `${path}.${key}` : key;
                
                if (typeof value === 'string') {
                    if (checkForSqlInjection(value)) {
                        logger.warn(`[SQL Injection Blocked] Suspicious body field: ${currentPath}=${value.substring(0, 100)} from IP: ${req.ip}`);
                        return true;
                    }
                } else if (typeof value === 'object' && value !== null) {
                    if (checkObject(value, currentPath)) {
                        return true;
                    }
                }
            }
            return false;
        };
        
        if (checkObject(req.body)) {
            return res.status(400).json({ 
                error: 'Invalid input detected. Potential security violation.' 
            });
        }
    }
    
    next();
}

// =============================================================================
// AUDIT LOGGING HELPER
// =============================================================================

const logger = require('./logger');

/**
 * Logs security-relevant events
 */
export function logSecurityEvent(
    event: string,
    req: Request,
    details?: Record<string, any>
) {
    logger.warn(`[SECURITY] ${event}`, {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.get('user-agent'),
        userId: (req as any).user?.id,
        timestamp: new Date().toISOString(),
        ...details
    });
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
    // Rate limiters
    globalLimiter,
    loginLimiter,
    apiLimiter,
    uploadLimiter,
    emailLimiter,
    
    // Security headers
    createSecurityHeaders,
    
    // Input validation
    validateBody,
    validateQuery,
    sanitizeInput,
    validateContentType,
    limitRequestBodySize,
    validationSchemas,
    
    // SQL injection prevention
    detectSqlInjection,
    
    // Utilities
    logSecurityEvent
};
