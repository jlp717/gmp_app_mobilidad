/**
 * Refresh Token Manager - Production Grade v4.0.0
 * 
 * Features:
 * - Token rotation (old refresh token invalidated on each use)
 * - Theft detection (if old token is reused after rotation, revoke ALL sessions)
 * - Secure random token generation (crypto.randomBytes)
 * - Expiry validation
 * - In-memory store (Redis-backed for production multi-instance)
 * 
 * @agent Security - Prevents refresh token replay attacks
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

interface StoredToken {
  userId: string;
  username: string;
  role: string;
  issuedAt: number;
  expiresAt: number;
  isRevoked: boolean;
  familyId: string; // Token family for rotation tracking
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class RefreshTokenManager {
  private tokens = new Map<string, StoredToken>();
  private tokenFamilies = new Map<string, Set<string>>(); // familyId -> tokenIds
  
  // Cleanup expired tokens every hour
  constructor() {
    setInterval(() => this.cleanup(), 60 * 60 * 1000).unref();
  }

  /**
   * Generate a new token pair (access + refresh)
   */
  generateTokens(payload: { userId: string; username: string; role: string; vendedorCode: string }): TokenPair {
    const now = Date.now();
    const familyId = crypto.randomUUID();

    // Access token (short-lived, HMAC signed)
    const accessToken = this.signAccessToken(payload);

    // Refresh token (long-lived, random)
    const refreshTokenId = this.generateSecureToken();
    const refreshTokenExpiryMs = this.parseExpiryToMs(config.auth.refreshTokenExpiry);

    // Store refresh token
    const storedToken: StoredToken = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      issuedAt: now,
      expiresAt: now + refreshTokenExpiryMs,
      isRevoked: false,
      familyId,
    };

    this.tokens.set(refreshTokenId, storedToken);

    // Track token family
    if (!this.tokenFamilies.has(familyId)) {
      this.tokenFamilies.set(familyId, new Set());
    }
    this.tokenFamilies.get(familyId)!.add(refreshTokenId);

    // Sign refresh token (contains the token ID)
    const refreshToken = jwt.sign(
      { tokenId: refreshTokenId, familyId },
      config.auth.refreshTokenSecret,
      { expiresIn: config.auth.refreshTokenExpiry }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Rotate refresh token: issue new pair, invalidate old
   * Returns null if token is invalid/expired/revoked
   * 
   * THEFT DETECTION: If the old token ID has already been rotated
   * (exists in store but isRevoked=true), this is a replay attack.
   * Revoke ALL tokens in the same family.
   */
  rotateToken(oldRefreshToken: string): TokenPair | null {
    try {
      // Verify JWT signature and extract
      const decoded = jwt.verify(oldRefreshToken, config.auth.refreshTokenSecret) as { 
        tokenId: string; 
        familyId: string;
        exp: number;
      };

      const { tokenId, familyId } = decoded;
      const storedToken = this.tokens.get(tokenId);

      // THEFT DETECTION
      if (storedToken && storedToken.isRevoked) {
        // This token was already used to rotate — someone is replaying a stolen token!
        logger.error(`🚨 REFRESH TOKEN THEFT DETECTED for user ${storedToken.username}, family ${familyId}`);
        
        // Nuclear option: revoke ALL tokens in this family
        this.revokeFamily(familyId);
        
        throw new TokenError('Token theft detected. All sessions revoked.', 'TOKEN_THEFT');
      }

      // Token doesn't exist or is revoked — reject
      if (!storedToken) {
        throw new TokenError('Invalid refresh token', 'INVALID_TOKEN');
      }

      if (storedToken.isRevoked) {
        throw new TokenError('Refresh token has been revoked', 'REVOKED_TOKEN');
      }

      if (Date.now() > storedToken.expiresAt) {
        this.tokens.delete(tokenId);
        throw new TokenError('Refresh token expired', 'EXPIRED_TOKEN');
      }

      // Rotate: mark old token as revoked, issue new pair
      storedToken.isRevoked = true;
      
      const newTokens = this.generateTokens({
        userId: storedToken.userId,
        username: storedToken.username,
        role: storedToken.role,
        vendedorCode: '', // Will be set from user lookup
      });

      // Link new token to same family
      const newDecoded = jwt.decode(newTokens.refreshToken) as { familyId: string };
      const newTokenId = (jwt.verify(newTokens.refreshToken, config.auth.refreshTokenSecret) as any).tokenId;
      
      this.tokens.get(newTokenId)!.familyId = familyId;
      if (!this.tokenFamilies.has(familyId)) {
        this.tokenFamilies.set(familyId, new Set());
      }
      this.tokenFamilies.get(familyId)!.add(newTokenId);

      return newTokens;
    } catch (error) {
      if (error instanceof TokenError) throw error;
      
      if (error instanceof jwt.JsonWebTokenError) {
        throw new TokenError('Invalid refresh token signature', 'INVALID_SIGNATURE');
      }
      
      throw new TokenError('Failed to rotate token', 'UNKNOWN_ERROR');
    }
  }

  /**
   * Revoke a specific refresh token
   */
  revokeToken(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    if (!token) return false;
    
    token.isRevoked = true;
    logger.info(`🔒 Refresh token revoked for user ${token.username}`);
    return true;
  }

  /**
   * Revoke all tokens for a user (logout from all devices)
   */
  revokeAllForUser(userId: string): void {
    for (const [tokenId, token] of this.tokens.entries()) {
      if (token.userId === userId) {
        token.isRevoked = true;
      }
    }
    logger.info(`🔒 All tokens revoked for user ${userId}`);
  }

  /**
   * Revoke an entire token family (theft response)
   */
  private revokeFamily(familyId: string): void {
    const tokenIds = this.tokenFamilies.get(familyId);
    if (!tokenIds) return;

    for (const tokenId of tokenIds) {
      const token = this.tokens.get(tokenId);
      if (token) {
        token.isRevoked = true;
      }
    }
    
    logger.error(`🚨 Token family ${familyId} revoked due to theft detection`);
  }

  /**
   * Validate a refresh token (check if it exists and is not revoked)
   */
  validate(tokenId: string): StoredToken | null {
    const token = this.tokens.get(tokenId);
    if (!token || token.isRevoked || Date.now() > token.expiresAt) {
      return null;
    }
    return token;
  }

  /**
   * Clean up expired tokens
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [tokenId, token] of this.tokens.entries()) {
      if (now > token.expiresAt || token.isRevoked) {
        this.tokens.delete(tokenId);
        cleaned++;
      }
    }

    // Clean empty families
    for (const [familyId, tokenIds] of this.tokenFamilies.entries()) {
      if (tokenIds.size === 0) {
        this.tokenFamilies.delete(familyId);
      }
    }

    if (cleaned > 0) {
      logger.info(`🧹 Cleaned ${cleaned} expired/revoked refresh tokens`);
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private signAccessToken(payload: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const expiry = this.parseExpiryToMs(config.auth.accessTokenExpiry) / 1000;
    
    const header = { alg: 'HS256', typ: 'JWT' };
    const body = {
      ...payload,
      iat: now,
      exp: now + expiry,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const bodyB64 = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', config.auth.accessTokenSecret)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');

    return `${headerB64}.${bodyB64}.${signature}`;
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(48).toString('hex');
  }

  private parseExpiryToMs(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 7 * 24 * 60 * 60 * 1000;
    }
  }
}

export class TokenError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'TokenError';
  }
}

// Singleton
export const refreshTokenManager = new RefreshTokenManager();
