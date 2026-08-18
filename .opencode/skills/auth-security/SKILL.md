---
name: auth-security
description: JWT, OAuth 2.0, secure sessions, CSRF, CORS — production-grade authentication and authorization patterns.
---

# Auth Security — Production Patterns Guide

## Overview

Authentication failures are consistently in the OWASP Top 10. This guide covers the correct implementation of JWT (stateless tokens), OAuth 2.0 with PKCE, secure cookie-based sessions, CSRF defenses, and CORS configuration for Node.js/Express backends.

## When to Use

- Designing or auditing an authentication system from scratch
- Adding OAuth 2.0 social login to an existing app
- Hardening cookie and CORS configuration before production deployment
- Implementing token rotation and revocation for stateless APIs

## When NOT to Use

- Do not roll your own crypto — use `jsonwebtoken`, `jose`, or `passport` with audited strategies
- Do not implement auth on a Friday afternoon without a security review
- Do not use this as a substitute for a full penetration test

---

## Step-by-Step Process

### 1. JWT — Access + Refresh Token Architecture

**HS256** uses a shared secret (symmetric) — fine for single-service. **RS256** uses a private/public key pair (asymmetric) — required when multiple services verify tokens independently.

```
Access token:  RS256, expires in 15 minutes, stored in memory (JS variable)
Refresh token: opaque random string OR RS256 JWT, expires in 7–30 days, stored in httpOnly cookie
```

```ts
// auth/tokens.ts
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';

const ACCESS_SECRET = process.env.JWT_PRIVATE_KEY!; // RS256 private key PEM
const ACCESS_EXPIRY = '15m';

export function signAccessToken(payload: { sub: string; role: string }): string {
  const options: SignOptions = { algorithm: 'RS256', expiresIn: ACCESS_EXPIRY, issuer: 'api.example.com' };
  return jwt.sign(payload, ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): jwt.JwtPayload {
  const PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!;
  // Explicitly disallow the 'none' algorithm — critical security check
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] }) as jwt.JwtPayload;
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}
```

### 2. Express JWT Middleware

```ts
// middleware/authenticate.ts
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/tokens';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub!, role: payload.role as string };
    next();
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token expired or invalid' } });
  }
}
```

### 3. Refresh Token Rotation

Issue a new refresh token on every use. Invalidate the old one. Detect reuse as a breach signal.

```ts
// auth/refresh.ts
import { db } from '../db';
import { signAccessToken, generateRefreshToken } from './tokens';

export async function rotateRefreshToken(oldToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const stored = await db.refreshToken.findUnique({ where: { token: oldToken } });

  if (!stored || stored.revokedAt !== null) {
    // Token reuse detected — revoke entire family
    if (stored) await db.refreshToken.updateMany({ where: { userId: stored.userId }, data: { revokedAt: new Date() } });
    throw new Error('REFRESH_TOKEN_REUSE');
  }

  if (stored.expiresAt < new Date()) throw new Error('REFRESH_TOKEN_EXPIRED');

  // Rotate
  await db.refreshToken.update({ where: { token: oldToken }, data: { revokedAt: new Date() } });
  const newRefreshToken = generateRefreshToken();
  await db.refreshToken.create({
    data: { token: newRefreshToken, userId: stored.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
  });

  const accessToken = signAccessToken({ sub: stored.userId, role: stored.role });
  return { accessToken, refreshToken: newRefreshToken };
}
```

```ts
// Set refresh token as httpOnly cookie
res.cookie('refreshToken', newRefreshToken, {
  httpOnly: true,
  secure: true,           // HTTPS only
  sameSite: 'strict',     // CSRF protection
  maxAge: 7 * 86_400_000, // 7 days in ms
  path: '/auth/refresh',  // Scope cookie to refresh endpoint only
});
```

### 4. OAuth 2.0 Authorization Code + PKCE

PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks. Required for SPAs and mobile apps.

```ts
// auth/pkce.ts
import crypto from 'crypto';

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}
```

```ts
// Client-side OAuth flow initiation
const { verifier, challenge } = generatePKCE();
const state = generateState();

// Store in sessionStorage (NOT localStorage)
sessionStorage.setItem('pkce_verifier', verifier);
sessionStorage.setItem('oauth_state', state);

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!);
authUrl.searchParams.set('redirect_uri', 'https://app.example.com/auth/callback');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'openid email profile');
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('state', state);
window.location.href = authUrl.toString();
```

```ts
// Callback handler — verify state before exchanging code
export async function handleOAuthCallback(code: string, returnedState: string) {
  const storedState = sessionStorage.getItem('oauth_state');
  if (returnedState !== storedState) throw new Error('STATE_MISMATCH'); // CSRF attempt

  const verifier = sessionStorage.getItem('pkce_verifier')!;
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');

  const tokens = await exchangeCodeForTokens(code, verifier);
  return tokens;
}
```

### 5. Session Security

```ts
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({ conString: process.env.DATABASE_URL }),
  secret: process.env.SESSION_SECRET!, // 64+ random bytes
  name: '__Host-session',              // __Host- prefix enforces secure + path=/
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 30 * 60 * 1000, // 30 minutes
  },
}));

// Session fixation prevention: regenerate session ID on login
req.session.regenerate((err) => {
  if (err) return next(err);
  req.session.userId = user.id;
  next();
});
```

### 6. CORS Configuration

```ts
import cors from 'cors';

const ALLOWED_ORIGINS = new Set(['https://app.example.com', 'https://admin.example.com']);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,  // Required for cookies
  maxAge: 86400,      // Cache preflight 24h
}));
```

---

## Verification Checklist

- [ ] Access tokens expire in ≤ 15 minutes; refresh tokens in ≤ 30 days
- [ ] `algorithms: ['RS256']` explicitly set in `jwt.verify()` — `none` algorithm blocked
- [ ] Refresh token stored in `httpOnly; Secure; SameSite=Strict` cookie
- [ ] Refresh token rotation implemented — old token invalidated on use
- [ ] Token reuse triggers full family revocation
- [ ] OAuth state parameter validated before code exchange
- [ ] PKCE code_challenge uses S256 method
- [ ] CORS origin uses explicit allowlist, not wildcard `*`
- [ ] Session ID regenerated after successful login (fixation prevention)
- [ ] No tokens stored in `localStorage` — memory or httpOnly cookie only
- [ ] All auth endpoints rate-limited
- [ ] `JWT_PRIVATE_KEY` and `SESSION_SECRET` loaded from environment, not hardcoded
