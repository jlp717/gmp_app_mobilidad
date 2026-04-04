/**
 * Refresh Token Manager - Secure token rotation with Redis-backed session storage
 * Supports distributed deployments (PM2 cluster, multi-instance)
 */
const crypto = require('crypto');

const MAX_SESSIONS_PER_USER = 5;
const ACCESS_TOKEN_TTL = 3600;    // 1 hour
const REFRESH_TOKEN_TTL = 604800; // 7 days
const REDIS_KEY_PREFIX = 'gmp:session:';
const REDIS_BLACKLIST_PREFIX = 'gmp:blacklist:';
const REDIS_USER_SESSIONS_PREFIX = 'gmp:user-sessions:';

class RefreshTokenManager {
  /**
   * @param {object} redisClient - Optional Redis client. Falls back to in-memory Map.
   */
  constructor(redisClient = null) {
    this._redis = redisClient;
    this._sessions = new Map(); // Fallback for when Redis is unavailable
    this._blacklist = new Map();
    this._useRedis = !!redisClient;
  }

  /**
   * Generate access + refresh token pair
   */
  async generateTokenPair(userPayload) {
    const accessToken = this._generateAccessToken(userPayload);
    const refreshToken = this._generateRefreshToken(userPayload);
    const sessionId = crypto.randomUUID();
    const userId = userPayload.id || userPayload.user;

    const session = {
      sessionId,
      userId,
      userCode: userPayload.user,
      role: userPayload.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + (REFRESH_TOKEN_TTL * 1000),
      ip: userPayload.ip,
      userAgent: userPayload.userAgent,
      rotationCount: 0
    };

    await this._storeSession(refreshToken, session);
    await this._addUserSession(userId, refreshToken);
    await this._enforceMaxSessions(userId);

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
  async rotateToken(refreshToken) {
    const session = await this._getSession(refreshToken);
    if (!session) {
      throw new TokenError('Invalid refresh token', 'INVALID_TOKEN');
    }

    if (Date.now() > session.expiresAt) {
      await this._deleteSession(refreshToken);
      throw new TokenError('Refresh token expired', 'TOKEN_EXPIRED');
    }

    const isBlacklisted = await this._isBlacklisted(refreshToken);
    if (isBlacklisted) {
      await this._invalidateUserSessions(session.userId);
      throw new TokenError('Token reuse detected - possible theft', 'TOKEN_REUSE');
    }

    // Blacklist old token
    await this._blacklistToken(refreshToken);

    // Generate new tokens
    const userPayload = {
      id: session.userId,
      user: session.userCode,
      role: session.role
    };

    const newTokens = await this.generateTokenPair({
      ...userPayload,
      ip: session.ip,
      userAgent: session.userAgent
    });

    // Update rotation count
    session.rotationCount++;
    session.createdAt = Date.now();
    await this._storeSession(newTokens.refreshToken, session);

    return newTokens;
  }

  /**
   * Revoke a refresh token (logout)
   */
  async revokeToken(refreshToken) {
    const session = await this._getSession(refreshToken);
    if (session) {
      await this._deleteSession(refreshToken);
      await this._removeUserSession(session.userId, refreshToken);
      await this._blacklistToken(refreshToken);
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId) {
    await this._invalidateUserSessions(userId);
  }

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId) {
    const tokens = await this._getUserSessionTokens(userId);
    const sessions = [];
    for (const token of tokens) {
      const session = await this._getSession(token);
      if (session && session.userId === userId) {
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

  // ─── Redis-backed storage methods ──────────────────────────────────────

  async _storeSession(token, session) {
    if (this._useRedis) {
      try {
        const key = `${REDIS_KEY_PREFIX}${token}`;
        await this._redis.setex(key, REFRESH_TOKEN_TTL, JSON.stringify(session));
        return;
      } catch (err) {
        this._useRedis = false; // Fallback to in-memory
      }
    }
    this._sessions.set(token, session);
  }

  async _getSession(token) {
    if (this._useRedis) {
      try {
        const key = `${REDIS_KEY_PREFIX}${token}`;
        const data = await this._redis.get(key);
        if (data) return JSON.parse(data);
      } catch {
        this._useRedis = false;
      }
    }
    return this._sessions.get(token) || null;
  }

  async _deleteSession(token) {
    if (this._useRedis) {
      try {
        await this._redis.del(`${REDIS_KEY_PREFIX}${token}`);
        return;
      } catch {
        this._useRedis = false;
      }
    }
    this._sessions.delete(token);
  }

  async _blacklistToken(token) {
    if (this._useRedis) {
      try {
        await this._redis.setex(`${REDIS_BLACKLIST_PREFIX}${token}`, REFRESH_TOKEN_TTL, '1');
        return;
      } catch {
        this._useRedis = false;
      }
    }
    this._blacklist.set(token, Date.now() + (REFRESH_TOKEN_TTL * 1000));
  }

  async _isBlacklisted(token) {
    if (this._useRedis) {
      try {
        const val = await this._redis.get(`${REDIS_BLACKLIST_PREFIX}${token}`);
        return val === '1';
      } catch {
        this._useRedis = false;
      }
    }
    const expiry = this._blacklist.get(token);
    return expiry && Date.now() < expiry;
  }

  async _addUserSession(userId, token) {
    if (this._useRedis) {
      try {
        await this._redis.sadd(`${REDIS_USER_SESSIONS_PREFIX}${userId}`, token);
        await this._redis.expire(`${REDIS_USER_SESSIONS_PREFIX}${userId}`, REFRESH_TOKEN_TTL);
        return;
      } catch {
        this._useRedis = false;
      }
    }
  }

  async _removeUserSession(userId, token) {
    if (this._useRedis) {
      try {
        await this._redis.srem(`${REDIS_USER_SESSIONS_PREFIX}${userId}`, token);
      } catch { /* ignore */ }
    }
  }

  async _getUserSessionTokens(userId) {
    if (this._useRedis) {
      try {
        return await this._redis.smembers(`${REDIS_USER_SESSIONS_PREFIX}${userId}`) || [];
      } catch {
        this._useRedis = false;
      }
    }
    // Fallback: scan in-memory
    const tokens = [];
    for (const [token, session] of this._sessions.entries()) {
      if (session.userId === userId) tokens.push(token);
    }
    return tokens;
  }

  async _enforceMaxSessions(userId) {
    const tokens = await this._getUserSessionTokens(userId);
    if (tokens.length > MAX_SESSIONS_PER_USER) {
      // Remove oldest sessions
      const sessionsWithTokens = [];
      for (const token of tokens) {
        const session = await this._getSession(token);
        if (session) sessionsWithTokens.push({ token, session });
      }
      sessionsWithTokens.sort((a, b) => a.session.createdAt - b.session.createdAt);
      const toRemove = sessionsWithTokens.slice(0, sessionsWithTokens.length - MAX_SESSIONS_PER_USER);
      for (const { token } of toRemove) {
        await this._deleteSession(token);
        await this._removeUserSession(userId, token);
      }
    }
  }

  async _invalidateUserSessions(userId) {
    const tokens = await this._getUserSessionTokens(userId);
    for (const token of tokens) {
      await this._deleteSession(token);
      await this._blacklistToken(token);
    }
    if (this._useRedis) {
      try {
        await this._redis.del(`${REDIS_USER_SESSIONS_PREFIX}${userId}`);
      } catch { /* ignore */ }
    }
  }

  // ─── Token generation (same as before) ─────────────────────────────────

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
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters.');
    }
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  _generateRefreshToken() {
    return `rt_${crypto.randomBytes(32).toString('hex')}`;
  }
}

class TokenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

// Singleton — Redis client injected at runtime from server.js
let refreshTokenManager = new RefreshTokenManager();

function initRefreshTokenManager(redisClient) {
  refreshTokenManager = new RefreshTokenManager(redisClient);
  return refreshTokenManager;
}

module.exports = { refreshTokenManager, initRefreshTokenManager, RefreshTokenManager, TokenError, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL };
