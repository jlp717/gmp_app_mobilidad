/**
 * GMP App Enhanced Authentication Middleware
 * ===========================================
 * HMAC-signed JWT tokens with refresh token rotation
 * Secure session management with automatic token renewal
 * 
 * Features:
 * - HMAC-SHA256 signed tokens (more secure than standard JWT)
 * - Access token (1 hour) + Refresh token (7 days)
 * - Token rotation on refresh (invalidates old refresh tokens)
 * - Session tracking and concurrent session limits
 * - Automatic token renewal for active sessions
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import logger from './logger';

// =============================================================================
// CONFIGURATION
// =============================================================================

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

// Validate secrets are strong enough
if (ACCESS_SECRET.length < 32) {
    logger.warn('[AUTH] WARNING: JWT_ACCESS_SECRET is too short. Use at least 32 characters.');
}
if (REFRESH_SECRET.length < 32) {
    logger.warn('[AUTH] WARNING: JWT_REFRESH_SECRET is too short. Use at least 32 characters.');
}

const ACCESS_TTL_MS = parseInt(process.env.JWT_ACCESS_EXPIRES || '3600000', 10); // 1 hour default
const REFRESH_TTL_MS = parseInt(process.env.JWT_REFRESH_EXPIRES || '604800000', 10); // 7 days default

// Session management
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10);
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Clean up expired sessions every hour

// =============================================================================
// SESSION STORAGE (In-memory with cleanup)
// =============================================================================

interface Session {
    refreshToken: string;
    userId: string;
    userAgent: string;
    ip: string;
    createdAt: number;
    expiresAt: number;
}

const activeSessions: Map<string, Session[]> = new Map();

// Periodic cleanup of expired sessions
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, sessions] of activeSessions.entries()) {
        const validSessions = sessions.filter(s => s.expiresAt > now);
        if (validSessions.length !== sessions.length) {
            activeSessions.set(userId, validSessions);
            cleanedCount += sessions.length - validSessions.length;
        }
        if (validSessions.length === 0) {
            activeSessions.delete(userId);
        }
    }
    
    if (cleanedCount > 0) {
        logger.info(`[AUTH] Cleaned up ${cleanedCount} expired sessions`);
    }
}, SESSION_CLEANUP_INTERVAL_MS);

// =============================================================================
// TOKEN SIGNING & VERIFICATION
// =============================================================================

/**
 * Signs a token with HMAC-SHA256
 * Format: base64(payload).hex(signature)
 */
function signToken(payload: Record<string, any>, secret: string): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return `${data}.${sig}`;
}

/**
 * Verifies token data with timing-safe comparison
 */
function verifyTokenData(
    token: string,
    secret: string,
    ttlMs: number
): Record<string, any> | null {
    if (!token || !token.includes('.')) {
        logger.debug('[AUTH] Invalid token format: missing dot separator');
        return null;
    }
    
    const parts = token.split('.');
    if (parts.length !== 2) {
        logger.debug('[AUTH] Invalid token format: expected 2 parts');
        return null;
    }
    
    const [data, sig] = parts;
    if (!data || !sig) {
        logger.debug('[AUTH] Invalid token: empty data or signature');
        return null;
    }
    
    // Timing-safe signature comparison
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    
    if (sig.length !== expectedSig.length) {
        logger.debug('[AUTH] Signature length mismatch');
        return null;
    }
    
    try {
        const sigBuffer = Buffer.from(sig, 'hex');
        const expectedBuffer = Buffer.from(expectedSig, 'hex');
        
        if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            logger.debug('[AUTH] Signature verification failed');
            return null;
        }
    } catch (e) {
        logger.debug(`[AUTH] Signature comparison error: ${e}`);
        return null;
    }
    
    // Decode and validate payload
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
        
        // Check timestamp exists
        if (!payload.timestamp) {
            logger.debug('[AUTH] Token missing timestamp');
            return null;
        }
        
        // Check expiration
        const age = Date.now() - payload.timestamp;
        if (age > ttlMs) {
            logger.debug(`[AUTH] Token expired: age=${age}ms, ttl=${ttlMs}ms`);
            return null;
        }
        
        return payload;
    } catch (e) {
        logger.debug(`[AUTH] Failed to decode token payload: ${e}`);
        return null;
    }
}

/**
 * Signs an access token
 */
export function signAccessToken(payload: { 
    id: string; 
    user: string; 
    role: string;
    isJefeVentas?: boolean;
}): string {
    const tokenPayload = {
        ...payload,
        type: 'access',
        timestamp: Date.now()
    };
    return signToken(tokenPayload, ACCESS_SECRET);
}

/**
 * Signs a refresh token
 */
export function signRefreshToken(payload: { 
    id: string; 
    user: string; 
    role: string;
    isJefeVentas?: boolean;
}): string {
    const tokenPayload = {
        ...payload,
        type: 'refresh',
        timestamp: Date.now()
    };
    return signToken(tokenPayload, REFRESH_SECRET);
}

/**
 * Verifies an access token
 */
export function verifyAccessToken(token: string): Record<string, any> | null {
    const payload = verifyTokenData(token, ACCESS_SECRET, ACCESS_TTL_MS);
    
    if (!payload) return null;
    if (payload.type !== 'access') {
        logger.debug('[AUTH] Token type mismatch: expected access');
        return null;
    }
    
    return payload;
}

/**
 * Verifies a refresh token
 */
export function verifyRefreshToken(token: string): Record<string, any> | null {
    const payload = verifyTokenData(token, REFRESH_SECRET, REFRESH_TTL_MS);
    
    if (!payload) return null;
    if (payload.type !== 'refresh') {
        logger.debug('[AUTH] Token type mismatch: expected refresh');
        return null;
    }
    
    return payload;
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Registers a new refresh token session
 */
function registerSession(
    userId: string,
    refreshToken: string,
    userAgent: string,
    ip: string
): void {
    const now = Date.now();
    const session: Session = {
        refreshToken,
        userId,
        userAgent,
        ip,
        createdAt: now,
        expiresAt: now + REFRESH_TTL_MS
    };
    
    const userSessions = activeSessions.get(userId) || [];
    
    // Enforce max sessions limit
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
        // Remove oldest session
        userSessions.sort((a, b) => a.createdAt - b.createdAt);
        userSessions.shift();
        logger.info(`[AUTH] Removed oldest session for user ${userId} (max ${MAX_SESSIONS_PER_USER} sessions)`);
    }
    
    userSessions.push(session);
    activeSessions.set(userId, userSessions);
    
    logger.info(`[AUTH] Registered new session for user ${userId} from ${ip}`);
}

/**
 * Invalidates all sessions for a user (logout)
 */
export function invalidateAllSessions(userId: string): void {
    activeSessions.delete(userId);
    logger.info(`[AUTH] Invalidated all sessions for user ${userId}`);
}

/**
 * Checks if a refresh token is still valid (not revoked)
 */
function isRefreshTokenValid(userId: string, refreshToken: string): boolean {
    const sessions = activeSessions.get(userId);
    if (!sessions) return false;
    
    return sessions.some(s => s.refreshToken === refreshToken && s.expiresAt > Date.now());
}

/**
 * Revokes a specific refresh token
 */
export function revokeRefreshToken(userId: string, refreshToken: string): void {
    const sessions = activeSessions.get(userId);
    if (sessions) {
        const filtered = sessions.filter(s => s.refreshToken !== refreshToken);
        if (filtered.length > 0) {
            activeSessions.set(userId, filtered);
        } else {
            activeSessions.delete(userId);
        }
        logger.info(`[AUTH] Revoked refresh token for user ${userId}`);
    }
}

// =============================================================================
// PASSWORD HASHING UTILITIES
// =============================================================================

/**
 * Hashes a password using bcrypt
 */
export async function hashPassword(password: string, saltRounds: number = 12): Promise<string> {
    return bcrypt.hash(password, saltRounds);
}

/**
 * Compares a password with a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

/**
 * Validates password strength
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }
    if (password.length > 100) {
        errors.push('Password must be less than 100 characters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

// =============================================================================
// EXPRESS MIDDLEWARE
// =============================================================================

/**
 * Extended Request interface with user info
 */
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        code: string;
        role: string;
        isJefeVentas: boolean;
    };
    tokenPayload?: Record<string, any>;
}

/**
 * Middleware to verify access token
 */
export function verifyToken(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        logger.warn(`[AUTH] Access attempt without token: ${req.method} ${req.path} (${req.ip})`);
        return res.status(401).json({ 
            error: 'Acceso denegado. Se requiere autenticación.',
            code: 'MISSING_TOKEN'
        });
    }
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        logger.warn(`[AUTH] Invalid auth header format: ${req.ip}`);
        return res.status(401).json({ 
            error: 'Formato de token inválido. Use: Bearer <token>',
            code: 'INVALID_FORMAT'
        });
    }
    
    const token = parts[1];
    
    try {
        const payload = verifyAccessToken(token);
        
        if (!payload) {
            logger.warn(`[AUTH] Invalid or expired token: ${req.ip}`);
            return res.status(401).json({ 
                error: 'Sesión expirada. Por favor, inicia sesión de nuevo.',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        // Attach user info to request
        req.user = {
            id: payload.id,
            code: payload.user,
            role: payload.role || 'COMERCIAL',
            isJefeVentas: payload.isJefeVentas || false
        };
        
        req.tokenPayload = payload;
        
        next();
    } catch (error) {
        logger.error(`[AUTH] Middleware error: ${error}`);
        return res.status(403).json({ 
            error: 'Fallo de autenticación.',
            code: 'AUTH_FAILED'
        });
    }
}

/**
 * Optional auth middleware - attaches user if token valid, continues otherwise
 */
export function optionalAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return next();
    }
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return next();
    }
    
    const token = parts[1];
    const payload = verifyAccessToken(token);
    
    if (payload) {
        req.user = {
            id: payload.id,
            code: payload.user,
            role: payload.role || 'COMERCIAL',
            isJefeVentas: payload.isJefeVentas || false
        };
        req.tokenPayload = payload;
    }
    
    next();
}

/**
 * Middleware to require specific roles
 */
export function requireRoles(...roles: string[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Autenticación requerida',
                code: 'MISSING_TOKEN'
            });
        }
        
        if (!roles.includes(req.user.role)) {
            logger.warn(`[AUTH] Role check failed: ${req.user.role} not in [${roles.join(', ')}]`);
            return res.status(403).json({ 
                error: 'No tienes permisos para realizar esta acción',
                code: 'INSUFFICIENT_ROLE'
            });
        }
        
        next();
    };
}

/**
 * Middleware to require Jefe Ventas role
 */
export function requireJefeVentas(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    if (!req.user?.isJefeVentas) {
        logger.warn(`[AUTH] Jefe Ventas access denied for user: ${req.user?.code}`);
        return res.status(403).json({ 
            error: 'Acceso restringido a Jefes de Ventas',
            code: 'INSUFFICIENT_ROLE'
        });
    }
    next();
}

// =============================================================================
// REFRESH TOKEN ENDPOINT HANDLER
// =============================================================================

/**
 * Handles refresh token requests
 * Implements token rotation for security
 */
export async function handleRefreshToken(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({ 
                error: 'Refresh token required',
                code: 'MISSING_REFRESH_TOKEN'
            });
        }
        
        // Verify refresh token
        const payload = verifyRefreshToken(refreshToken);
        
        if (!payload) {
            logger.warn(`[AUTH] Invalid or expired refresh token from IP: ${req.ip}`);
            return res.status(401).json({ 
                error: 'Refresh token inválido o expirado',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }
        
        const userId = payload.id;
        const userCode = payload.user;
        
        // Check if session is still valid (not revoked)
        if (!isRefreshTokenValid(userId, refreshToken)) {
            logger.warn(`[AUTH] Revoked refresh token used from IP: ${req.ip}`);
            // Security: revoke all sessions if revoked token is used
            invalidateAllSessions(userId);
            return res.status(401).json({ 
                error: 'Sesión revocada. Por favor, inicia sesión de nuevo.',
                code: 'SESSION_REVOKED'
            });
        }
        
        // Revoke old refresh token (token rotation)
        revokeRefreshToken(userId, refreshToken);
        
        // Generate new token pair
        const newAccessToken = signAccessToken({
            id: userId,
            user: userCode,
            role: payload.role,
            isJefeVentas: payload.isJefeVentas
        });
        
        const newRefreshToken = signRefreshToken({
            id: userId,
            user: userCode,
            role: payload.role,
            isJefeVentas: payload.isJefeVentas
        });
        
        // Register new session
        registerSession(userId, newRefreshToken, req.get('user-agent') || 'unknown', req.ip || 'unknown');
        
        logger.info(`[AUTH] Token refreshed for user ${userCode}`);
        
        res.json({
            success: true,
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresIn: ACCESS_TTL_MS / 1000
        });
        
    } catch (error) {
        logger.error(`[AUTH] Refresh token error: ${error}`);
        res.status(500).json({ 
            error: 'Error refreshing token',
            code: 'REFRESH_ERROR'
        });
    }
}

/**
 * Handles logout requests
 */
export async function handleLogout(
    req: AuthenticatedRequest,
    res: Response
): Promise<void> {
    try {
        const userId = req.user?.id;
        
        if (userId) {
            invalidateAllSessions(userId);
            logger.info(`[AUTH] User ${userId} logged out`);
        }
        
        res.json({ success: true, message: 'Logged out successfully' });
        
    } catch (error) {
        logger.error(`[AUTH] Logout error: ${error}`);
        res.status(500).json({ error: 'Error during logout' });
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default verifyToken;

export {
    ACCESS_TTL_MS,
    REFRESH_TTL_MS,
    activeSessions,
    signToken,
    verifyTokenData
};
