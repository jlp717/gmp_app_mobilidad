---
name: jwt-refresh-flow
description: JWT access + refresh token flow — short-lived in-memory access tokens, httpOnly cookie refresh tokens, token rotation with family-based reuse detection, Axios interceptor for automatic refresh. Use when implementing or auditing stateless auth with secure token management.
---

# JWT Access + Refresh Token Flow — Professional Guide

## Overview
A secure JWT strategy uses two tokens: a **short-lived access token** (15 min) kept in memory, and a **long-lived refresh token** (7 days) stored in an httpOnly, SameSite=Strict cookie. Every refresh rotates both tokens; reuse of a revoked refresh token triggers full family revocation (breach detection).

---

## When to Use
- Implementing stateless authentication in a Node.js/Express API
- Replacing session-cookie auth with JWT while maintaining security
- Fixing XSS-vulnerable localStorage token storage
- Adding automatic token refresh to an Axios client

## When NOT to Use
- Do NOT store access tokens in `localStorage` or `sessionStorage` (XSS risk)
- Do NOT use a single long-lived access token — if stolen, it cannot be revoked
- Do NOT skip refresh token rotation — without it, stolen refresh tokens are permanent

---

## Architecture

```
Client (memory)          Server (DB)
┌────────────────┐       ┌──────────────────────────┐
│ accessToken    │◄─────►│ /auth/login               │
│ (JS variable)  │       │ /auth/refresh             │
└────────────────┘       │ /auth/logout              │
                         └──────────┬───────────────┘
Browser (httpOnly cookie)           │
┌────────────────┐       ┌──────────▼───────────────┐
│ refreshToken   │       │ refresh_tokens table      │
│ (httpOnly)     │       │ (token_hash, family_id,   │
└────────────────┘       │  revoked_at)              │
                         └──────────────────────────┘
```

---

## Step-by-Step Process

### 1. Database Schema

```sql
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT    NOT NULL UNIQUE,   -- SHA-256 of the raw token
  user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID    NOT NULL,          -- all rotations share the same family
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,               -- NULL = active
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_user ON refresh_tokens (user_id);
CREATE INDEX idx_rt_family ON refresh_tokens (family_id);
```

### 2. Express Auth Routes

```ts
// src/auth/auth.router.ts
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { db } from '../db';

const router = Router();
const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function signAccess(userId: string) {
  return jwt.sign({ sub: userId }, ACCESS_SECRET, { expiresIn: '15m' });
}

function hashToken(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = await db.user.findByEmail(email);
  if (!user || !(await user.verifyPassword(password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const rawRefresh = uuid();
  const familyId   = uuid();
  await db.refreshToken.create({
    token_hash: hashToken(rawRefresh),
    user_id:    user.id,
    family_id:  familyId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  res.cookie('refreshToken', rawRefresh, COOKIE_OPTS);
  return res.json({ accessToken: signAccess(user.id) });
});

// POST /auth/refresh — token rotation with reuse detection
router.post('/refresh', async (req: Request, res: Response) => {
  const rawRefresh = req.cookies['refreshToken'] as string | undefined;
  if (!rawRefresh) return res.status(401).json({ error: 'No refresh token' });

  const stored = await db.refreshToken.findByHash(hashToken(rawRefresh));
  if (!stored) return res.status(401).json({ error: 'Invalid token' });

  // REUSE DETECTION: token was already revoked → revoke entire family
  if (stored.revoked_at) {
    await db.refreshToken.revokeFamily(stored.family_id);
    res.clearCookie('refreshToken');
    return res.status(401).json({ error: 'Token reuse detected — please log in again' });
  }

  if (new Date() > stored.expires_at) {
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  // Rotate: revoke old, issue new (same family)
  await db.refreshToken.revoke(stored.id);
  const newRaw = uuid();
  await db.refreshToken.create({
    token_hash: hashToken(newRaw),
    user_id:    stored.user_id,
    family_id:  stored.family_id,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  res.cookie('refreshToken', newRaw, COOKIE_OPTS);
  return res.json({ accessToken: signAccess(stored.user_id) });
});

// DELETE /auth/logout
router.delete('/logout', async (req: Request, res: Response) => {
  const rawRefresh = req.cookies['refreshToken'] as string | undefined;
  if (rawRefresh) {
    const stored = await db.refreshToken.findByHash(hashToken(rawRefresh));
    if (stored) await db.refreshToken.revokeFamily(stored.family_id);
  }
  res.clearCookie('refreshToken');
  return res.sendStatus(204);
});

export default router;
```

### 3. authenticateToken Middleware

```ts
// src/auth/authenticate.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1]; // Bearer <token>
  if (!token) return res.status(401).json({ error: 'No access token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { sub: string };
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Access token expired or invalid' });
  }
}
```

### 4. Axios Interceptor (Client)

```ts
// src/api/client.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };

const api = axios.create({ baseURL: '/api', withCredentials: true });

// Attach access token to every request
api.interceptors.request.use((config) => {
  if (accessToken) config.headers['Authorization'] = `Bearer ${accessToken}`;
  return config;
});

// Queue of waiting requests during token refresh
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];

const processQueue = (newToken: string) => {
  queue.forEach((resolve) => resolve(newToken));
  queue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status !== 401 || original._retry) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise((resolve) => {
        queue.push((token) => {
          original.headers['Authorization'] = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    original._retry = true;
    isRefreshing = true;
    try {
      const { data } = await axios.post('/auth/refresh', {}, { withCredentials: true });
      setAccessToken(data.accessToken);
      processQueue(data.accessToken);
      original.headers['Authorization'] = `Bearer ${data.accessToken}`;
      return api(original);
    } catch (refreshError) {
      setAccessToken(null);
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
```

---

## Verification Checklist

- [ ] Access token is stored in a JS variable (memory), never in `localStorage`
- [ ] Refresh token cookie is `httpOnly`, `SameSite=Strict`, `Secure` in production
- [ ] Every `/auth/refresh` call revokes old token and issues a new one (same `family_id`)
- [ ] Reuse of a revoked token triggers `revokeFamily()` and clears the cookie
- [ ] `/auth/logout` revokes the entire token family server-side
- [ ] `token_hash` is SHA-256 of the raw token — raw token never stored in DB
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are different secrets
- [ ] Axios interceptor queues concurrent 401s — no thundering herd on refresh
- [ ] `authenticateToken` middleware returns 401 (not 403) for missing/expired tokens
- [ ] Refresh tokens have a DB expiry checked server-side (not just JWT expiry)
