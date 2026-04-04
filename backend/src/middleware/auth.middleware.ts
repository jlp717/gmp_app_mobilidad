/**
 * Auth Middleware - Production Grade v4.0.0
 * 
 * Verifies HMAC-signed JWT access tokens and injects user context.
 * No DB lookup — all user data is in the JWT payload.
 * 
 * @agent Security - HMAC verification, timing-safe comparison
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// ============================================================
// INTERFACES
// ============================================================

export interface AuthUser {
  id: string;
  code: string;
  username: string;
  role: string;
  vendedorCode: string;
  vendedorCodes?: string[];
  name?: string;
  delegation?: string;
  company?: string;
  tipoVendedor?: string;
  showCommissions?: boolean;
  isJefeVentas?: boolean;
  codigoConductor?: string;
  matriculaVehiculo?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ============================================================
// TOKEN VERIFICATION
// ============================================================

/**
 * Verify and decode HMAC-signed JWT access token
 * Format: base64url(header).base64url(payload).base64url(signature)
 * Signature: HMAC-SHA256(header.payload, JWT_SECRET)
 */
function verifyAccessToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature (timing-safe comparison)
    const expectedSignature = crypto
      .createHmac('sha256', config.auth.accessTokenSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const signatureBuffer = Buffer.from(signatureB64, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    // Check expiry
    if (payload.exp && Date.now() / 1000 > (payload.exp as number)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ============================================================
// MIDDLEWARE
// ============================================================

/**
 * Main auth middleware — verifies token and injects user into request
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required', code: 'MISSING_TOKEN' });
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);

    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
      return;
    }

    // Inject user from JWT payload
    req.user = {
      id: String(payload.userId || ''),
      code: String(payload.username || payload.code || ''),
      username: String(payload.username || ''),
      role: String(payload.role || 'COMERCIAL'),
      vendedorCode: String(payload.vendedorCode || ''),
    };

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'AUTH_ERROR' });
  }
}

/**
 * Optional auth — sets user if valid, but doesn't block unauthenticated requests
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    if (!payload) return next();

    req.user = {
      id: String(payload.userId || ''),
      code: String(payload.username || payload.code || ''),
      username: String(payload.username || ''),
      role: String(payload.role || 'COMERCIAL'),
      vendedorCode: String(payload.vendedorCode || ''),
    };
  } catch {
    // Silently ignore
  }
  next();
}

// ============================================================
// ROLE CHECKERS
// ============================================================

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(403).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(`🚫 Role check failed: ${req.user.role} not in [${roles.join(', ')}]`);
      res.status(403).json({ error: 'Insufficient permissions', code: 'INSUFFICIENT_ROLE' });
      return;
    }

    next();
  };
}

export function requireJefeVentas(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'JEFE_VENTAS' && req.user.role !== 'JEFE')) {
    res.status(403).json({ error: 'JEFE_VENTAS role required' });
    return;
  }
  next();
}

/**
 * Password hashing (bcrypt) — used by legacy migration only
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.auth.bcryptRounds);
}

/**
 * Password verification (bcrypt)
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcrypt');
