/**
 * Audit Middleware - Production Grade v4.0.0
 * 
 * Logs every API request with IP, user, action, duration.
 * Ring buffer of 500 entries (in-memory).
 * 
 * @agent Observability - Request auditing, session tracking
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface AuditEntry {
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  user?: string;
  role?: string;
  status: number;
  duration: number;
  action: string;
}

// Ring buffer (max 500 entries)
const auditLog: AuditEntry[] = [];
const MAX_ENTRIES = 500;

// Active sessions tracker
const activeSessions = new Map<string, { user: string; role: string; lastSeen: string; ip: string }>();

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = (req as any).requestId || 'unknown';

  // On response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const user = (req as any).user;

    const entry: AuditEntry = {
      requestId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      user: user?.username,
      role: user?.role,
      status: res.statusCode,
      duration,
      action: `${req.method} ${getPathTemplate(req.originalUrl)}`,
    };

    // Add to ring buffer
    auditLog.push(entry);
    if (auditLog.length > MAX_ENTRIES) {
      auditLog.shift();
    }

    // Track active sessions
    if (user && req.path.startsWith('/api/auth/login')) {
      activeSessions.set(user.username, {
        user: user.username,
        role: user.role,
        lastSeen: entry.timestamp,
        ip: entry.ip,
      });
    }

    if (user) {
      activeSessions.set(user.username, {
        user: user.username,
        role: user.role,
        lastSeen: entry.timestamp,
        ip: entry.ip,
      });
    }

    // Log errors and slow requests
    if (res.statusCode >= 500) {
      logger.error(`AUDIT: ${entry.action} — ${res.statusCode} (${duration}ms) — ${entry.ip}`);
    } else if (duration > 1000) {
      logger.warn(`AUDIT SLOW: ${entry.action} — ${res.statusCode} (${duration}ms)`);
    }
  });

  next();
}

export function getRecentAuditEntries(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit).reverse();
}

export function getActiveSessions(): Map<string, { user: string; role: string; lastSeen: string; ip: string }> {
  return activeSessions;
}

// ============================================================
// PRIVATE
// ============================================================

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || req.socket.remoteAddress
    || 'unknown';
}

function getPathTemplate(path: string): string {
  // Replace numeric segments with :id for cleaner action names
  return path.replace(/\/\d+/g, '/:id');
}
