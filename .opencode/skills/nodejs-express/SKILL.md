---
name: nodejs-express
description: Node.js Express patterns — middleware order, feature routers, async error handling, Zod validation, Winston logging, security middleware.
---

# Node.js Express — Professional Patterns Guide

## Overview

Express is minimalist by design — its power comes from composing middleware in the right order. This guide establishes the canonical application structure: security headers → logging → parsing → auth → routes → error handling, plus patterns for validation, async error propagation, and structured logging with correlation IDs.

## When to Use

- Building a new REST API or microservice with Express
- Refactoring an existing Express app for correctness and maintainability
- Adding structured logging, request validation, or security hardening to an existing service

## When NOT to Use

- New projects where Fastify's performance or Hono's edge runtime support is a requirement
- Serverless functions with < 100ms cold start requirements — consider a lighter framework

---

## Step-by-Step Process

### 1. Complete `app.ts` Setup — Middleware Order

Order is critical. Security and parsing must come before routes; error handler must come last.

```ts
// src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import { requestLogger } from './middleware/requestLogger';
import { authenticate } from './middleware/authenticate';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { usersRouter } from './routes/users';
import { ordersRouter } from './routes/orders';

export function createApp() {
  const app = express();

  // 1. Security headers (before anything else)
  app.use(helmet());
  app.disable('x-powered-by');

  // 2. CORS — explicit allowlist
  app.use(cors({
    origin: (process.env.ALLOWED_ORIGINS ?? '').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }));

  // 3. Rate limiting — applied globally; override per-router for auth endpoints
  app.use(rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // 4. Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 5. HTTP parameter pollution prevention
  app.use(hpp());

  // 6. Request logger with correlation ID (before routes)
  app.use(requestLogger);

  // 7. Routes (authentication happens inside routers where needed)
  app.use('/v1/users', usersRouter);
  app.use('/v1/orders', authenticate, ordersRouter); // auth for entire sub-router

  // 8. 404 handler (after all routes)
  app.use(notFoundHandler);

  // 9. Centralized error handler (must be last, 4 params)
  app.use(errorHandler);

  return app;
}
```

### 2. Feature-Based Router Organization

```ts
// src/routes/users/index.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getUserHandler, createUserHandler, updateUserHandler } from './users.controller';
import { validateBody } from '../../middleware/validate';
import { createUserSchema, updateUserSchema } from './users.schema';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';

export const usersRouter = Router();

// Stricter rate limit for public auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10 });

usersRouter.get('/', authenticate, authorize('admin'), getUserHandler.list);
usersRouter.get('/:id', authenticate, getUserHandler.byId);
usersRouter.post('/', authLimiter, validateBody(createUserSchema), createUserHandler);
usersRouter.patch('/:id', authenticate, validateBody(updateUserSchema), updateUserHandler);

// Sub-resource router
import { userOrdersRouter } from './orders';
usersRouter.use('/:userId/orders', authenticate, userOrdersRouter);
```

### 3. Async Handler Wrapper

Every async route handler must be wrapped to forward errors to the centralized middleware.

```ts
// src/middleware/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncFn): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Usage in controller
export const getUserHandler = {
  byId: asyncHandler(async (req, res, next) => {
    const result = await userService.getById(req.params.id);
    if (!result.ok) return next(result.error);
    res.json({ data: result.value });
  }),
};
```

### 4. Zod Validation Middleware

```ts
// src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../errors/AppError';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.errors.map((e: ZodError['errors'][number]) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return next(new ValidationError(details));
    }
    req.body = result.data; // Replaces body with parsed, typed data
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
      return next(new ValidationError(details));
    }
    req.query = result.data as typeof req.query;
    next();
  };
}
```

```ts
// src/routes/users/users.schema.ts
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(128),
  role: z.enum(['user', 'admin']).default('user'),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
```

### 5. Winston Logger with Correlation IDs

```ts
// src/lib/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.colorize({ all: true }),
    process.env.NODE_ENV !== 'production'
      ? winston.format.printf(({ timestamp, level, message, ...meta }) =>
          `${timestamp} [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`)
      : winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
         new winston.transports.File({ filename: 'logs/combined.log' })]
      : []),
  ],
});
```

```ts
// src/middleware/requestLogger.ts
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
  });

  next();
}
```

### 6. Environment Config — Fail Fast on Startup

```ts
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1); // Fail fast — never run with bad config
}

export const env = result.data;
```

### 7. 404 and Not Found Handler

```ts
// src/middleware/notFoundHandler.ts
import { Request, Response } from 'express';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      request_id: req.headers['x-request-id'],
    },
  });
}
```

---

## Verification Checklist

- [ ] Middleware order: `helmet` → `cors` → `rateLimit` → `bodyParser` → `hpp` → `requestLogger` → routes → `notFoundHandler` → `errorHandler`
- [ ] `errorHandler` has exactly 4 parameters and is registered last
- [ ] All async route handlers wrapped with `asyncHandler` — no unhandled rejections
- [ ] Request body validated with Zod before reaching controller logic
- [ ] `req.body` replaced with Zod-parsed data (ensures typed, sanitized input)
- [ ] `X-Request-Id` header set on every request and included in logs
- [ ] Winston configured with JSON format in production, colored text in development
- [ ] Environment variables validated on startup with `process.exit(1)` on failure
- [ ] `app.disable('x-powered-by')` called — no Express fingerprinting
- [ ] Stricter `rateLimit` applied on auth endpoints (login, register, password reset)
- [ ] `hpp()` prevents HTTP parameter pollution attacks
- [ ] CORS uses explicit origin array, not wildcard `*`
