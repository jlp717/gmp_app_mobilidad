/**
 * Refresh Token Manager - Secure token rotation with session tracking
 */

const crypto = require('crypto');

const MAX_SESSIONS_PER_USER = 5;
const ACCESS_TOKEN_TTL = 3600;    // 1 hour
const REFRESH_TOKEN_TTL = 604800; // 7 days

class RefreshTokenManager {
  constructor() {
    this._sessions = new Map();
    this._blacklist = new Map();
  }

  /**
   * Generate access + refresh token pair
   */
  generateTokenPair(userPayload) {
    const accessToken = this._generateAccessToken(userPayload);
    const refreshToken = this._generateRefreshToken(userPayload);

    // Store session
    const sessionId = crypto.randomUUID();
    this._sessions.set(refreshToken, {
      sessionId,
      userId: userPayload.id || userPayload.user,
      userCode: userPayload.user,
      role: userPayload.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + (REFRESH_TOKEN_TTL * 1000),
      ip: userPayload.ip,
      userAgent: userPayload.userAgent,
      rotationCount: 0
    });

    // Enforce max sessions
    this._enforceMaxSessions(userPayload.id || userPayload.user);

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL,
      tokenType: 'Bearer'
    };
  }

  /**
   * Rotate refresh token (issues new pair, invalidates old)
   */
  rotateToken(refreshToken) {
    const session = this._sessions.get(refreshToken);
    if (!session) {
      throw new TokenError('Invalid refresh token', 'INVALID_TOKEN');
    }

    if (Date.now() > session.expiresAt) {
      this._sessions.delete(refreshToken);
      throw new TokenError('Refresh token expired', 'TOKEN_EXPIRED');
    }

    if (this._blacklist.has(refreshToken)) {
      // Possible token theft - invalidate entire session chain
      this._invalidateUserSessions(session.userId);
      throw new TokenError('Token reuse detected - possible theft', 'TOKEN_REUSE');
    }

    // Blacklist old token
    this._blacklist.set(refreshToken, Date.now() + (REFRESH_TOKEN_TTL * 1000));

    // Generate new tokens
    const userPayload = {
      id: session.userId,
      user: session.userCode,
      role: session.role
    };

    const newTokens = this.generateTokenPair({
      ...userPayload,
      ip: session.ip,
      userAgent: session.userAgent
    });

    // Update session
    session.rotationCount++;
    session.createdAt = Date.now();

    return newTokens;
  }

  /**
   * Revoke a refresh token (logout)
   */
  revokeToken(refreshToken) {
    const session = this._sessions.get(refreshToken);
    if (session) {
      this._sessions.delete(refreshToken);
      this._blacklist.set(refreshToken, Date.now() + (REFRESH_TOKEN_TTL * 1000));
    }
  }

  /**
   * Revoke all sessions for a user
   */
  revokeAllUserSessions(userId) {
    this._invalidateUserSessions(userId);
  }

  /**
   * Get active sessions for a user
   */
  getUserSessions(userId) {
    const sessions = [];
    for (const [token, session] of this._sessions.entries()) {
      if (session.userId === userId) {
        sessions.push({
          sessionId: session.sessionId,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ip: session.ip,
          userAgent: session.userAgent,
          rotationCount: session.rotationCount
        });
      }
    }
    return sessions;
  }

  /**
   * Cleanup expired tokens
   */
  cleanup() {
    const now = Date.now();

    // Clean expired sessions
    for (const [token, session] of this._sessions.entries()) {
      if (now > session.expiresAt) {
        this._sessions.delete(token);
      }
    }

    // Clean expired blacklist entries
    for (const [token, expiry] of this._blacklist.entries()) {
      if (now > expiry) {
        this._blacklist.delete(token);
      }
    }
  }

  _generateAccessToken(payload) {
    const header = { alg: 'HMAC-SHA256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: payload.id || payload.user,
      user: payload.user,
      role: payload.role,
      isJefeVentas: payload.isJefeVentas || false,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'default-secret' || secret.length < 32) {
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters. NEVER use default secrets in production.');
    }
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  _generateRefreshToken(payload) {
    return `rt_${crypto.randomBytes(32).toString('hex')}`;
  }

  _enforceMaxSessions(userId) {
    const userSessions = [];
    for (const [token, session] of this._sessions.entries()) {
      if (session.userId === userId) {
        userSessions.push({ token, session });
      }
    }

    if (userSessions.length > MAX_SESSIONS_PER_USER) {
      // Remove oldest sessions
      userSessions.sort((a, b) => a.session.createdAt - b.session.createdAt);
      const toRemove = userSessions.slice(0, userSessions.length - MAX_SESSIONS_PER_USER);
      for (const { token } of toRemove) {
        this._sessions.delete(token);
      }
    }
  }

  _invalidateUserSessions(userId) {
    for (const [token, session] of this._sessions.entries()) {
      if (session.userId === userId) {
        this._sessions.delete(token);
        this._blacklist.set(token, Date.now() + (REFRESH_TOKEN_TTL * 1000));
      }
    }
  }
}

class TokenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

// Singleton
const refreshTokenManager = new RefreshTokenManager();
setInterval(() => refreshTokenManager.cleanup(), 3600000); // Cleanup every hour

module.exports = { refreshTokenManager, RefreshTokenManager, TokenError, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL };
