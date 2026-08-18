---
name: backend-api-design
description: REST API design best practices — status codes, pagination, versioning, error format, rate limiting, filtering.
---

# REST API Design — Professional Guide

## Overview

A well-designed REST API is predictable, self-documenting, and forwards-compatible. This guide establishes the conventions for HTTP semantics, response envelopes, pagination strategies, versioning, and error formats used across all services.

## When to Use

- Designing a new REST API from scratch
- Auditing an existing API for consistency and correctness
- Onboarding a new service into an existing ecosystem
- Defining the contract between frontend and backend teams

## When NOT to Use

- Real-time bidirectional communication — use WebSockets or SSE instead
- Graph-shaped data with deeply nested relationships — consider GraphQL
- Internal RPC between microservices — consider gRPC for performance

---

## Step-by-Step Process

### 1. HTTP Status Codes — Exact Usage

| Code | When to use |
|---|---|
| `200 OK` | Successful GET, PUT, PATCH |
| `201 Created` | Successful POST that creates a resource; include `Location` header |
| `204 No Content` | Successful DELETE or action with no response body |
| `400 Bad Request` | Malformed request syntax, invalid JSON |
| `401 Unauthorized` | Missing or invalid authentication credentials |
| `403 Forbidden` | Authenticated but not authorized for this resource |
| `404 Not Found` | Resource does not exist |
| `409 Conflict` | State conflict (duplicate email, optimistic lock failure) |
| `422 Unprocessable Entity` | Valid syntax but failed business validation |
| `429 Too Many Requests` | Rate limit exceeded; include `Retry-After` header |
| `500 Internal Server Error` | Unhandled server exception — never expose stack traces |

### 2. Error Response Format

All errors MUST use this envelope. Never return different shapes.

```ts
// types/api.ts
export interface ApiError {
  error: {
    code: string;           // Machine-readable, SCREAMING_SNAKE_CASE
    message: string;        // Human-readable, safe to display
    details?: ErrorDetail[];// Field-level validation errors
    request_id: string;     // Correlates with server logs
  };
}

export interface ErrorDetail {
  field: string;
  message: string;
}
```

```ts
// middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../errors/AppError';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details ?? [], request_id: requestId },
    });
    return;
  }

  // Unknown error — log full details, return sanitized response
  console.error({ requestId, error: err });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', request_id: requestId },
  });
}
```

### 3. Pagination — Cursor vs Offset

**Cursor-based** (preferred for feeds, large datasets, real-time data):
- Stable under inserts/deletes
- Cannot jump to arbitrary pages
- Use `next_cursor` opaque token (base64-encoded `id:timestamp`)

**Offset-based** (use for admin tables with explicit page numbers):
- Simple to implement
- Degrades on large offsets (`OFFSET 10000` is slow in PostgreSQL)

```ts
// Response envelope — consistent across all list endpoints
interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;        // Total matching records (omit for cursor if expensive)
    per_page: number;
    // Cursor pagination
    next_cursor?: string;
    has_more: boolean;
    // Offset pagination (alternative)
    page?: number;
    total_pages?: number;
  };
}
```

```ts
// routes/users.ts — cursor-based pagination
router.get('/users', authenticate, async (req, res, next) => {
  try {
    const perPage = Math.min(Number(req.query.per_page) ?? 20, 100);
    const cursor = req.query.cursor as string | undefined;

    const decodedCursor = cursor ? Buffer.from(cursor, 'base64').toString('utf8') : undefined;
    const [id, createdAt] = decodedCursor?.split(':') ?? [undefined, undefined];

    const users = await db.user.findMany({
      take: perPage + 1,
      where: createdAt ? { createdAt: { lt: new Date(createdAt) } } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = users.length > perPage;
    const items = hasMore ? users.slice(0, perPage) : users;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore
      ? Buffer.from(`${lastItem.id}:${lastItem.createdAt.toISOString()}`).toString('base64')
      : undefined;

    res.json({
      data: items,
      meta: { per_page: perPage, has_more: hasMore, next_cursor: nextCursor },
    });
  } catch (err) {
    next(err);
  }
});
```

### 4. API Versioning

**URL versioning** (`/v1/`, `/v2/`) — preferred for external/public APIs:
- Explicit, cache-friendly, easy to route at the load balancer
- Dead-simple to deprecate: return `Sunset` header months before removal

```ts
// app.ts
import v1Router from './routes/v1';
import v2Router from './routes/v2';

app.use('/v1', v1Router);
app.use('/v2', v2Router);

// Deprecation header on v1 responses
v1Router.use((_req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Sat, 01 Jan 2026 00:00:00 GMT');
  res.set('Link', '</v2/docs>; rel="successor-version"');
  next();
});
```

**Header versioning** (`Accept: application/vnd.api+json;version=2`) — for internal APIs where URL stability matters.

### 5. Filtering & Sorting

Only allow explicitly whitelisted fields to prevent injection and unintended data exposure.

```ts
// utils/queryBuilder.ts
const ALLOWED_SORT_FIELDS = new Set(['createdAt', 'name', 'email', 'updatedAt']);
const ALLOWED_FILTER_FIELDS = new Set(['status', 'role', 'createdAt']);

export function buildSafeQuery(query: Record<string, unknown>) {
  const sortField = String(query.sort_by ?? 'createdAt');
  const sortDir = query.order === 'asc' ? 'asc' : 'desc';

  if (!ALLOWED_SORT_FIELDS.has(sortField)) {
    throw new AppError('INVALID_SORT_FIELD', `Cannot sort by "${sortField}"`, 400);
  }

  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (ALLOWED_FILTER_FIELDS.has(key) && value !== undefined) {
      filters[key] = value;
    }
  }

  return { orderBy: { [sortField]: sortDir }, where: filters };
}
```

### 6. Rate Limiting Headers

```ts
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,  // Sends X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please retry after the reset window.',
        request_id: res.locals.requestId,
      },
    });
  },
});
// Response headers automatically include:
// X-RateLimit-Limit: 100
// X-RateLimit-Remaining: 42
// X-RateLimit-Reset: 1735689600
// Retry-After: 37
```

---

## Verification Checklist

- [ ] POST returning a new resource responds with `201` and a `Location` header
- [ ] DELETE responds with `204` and empty body
- [ ] Auth failures return `401`; permission failures return `403` — never conflated
- [ ] All error responses use the `{error: {code, message, details, request_id}}` envelope
- [ ] Error `code` is SCREAMING_SNAKE_CASE and machine-readable
- [ ] Pagination response includes `has_more` and `next_cursor` or `total_pages`
- [ ] `per_page` is capped at a maximum (e.g. 100) to prevent DoS
- [ ] Sort and filter fields validated against explicit allowlist
- [ ] Rate limiting middleware applied; `X-RateLimit-*` headers present in responses
- [ ] API version prefix present in all routes (`/v1/`)
- [ ] `Sunset` and `Deprecation` headers set on deprecated versions
- [ ] Stack traces never included in 500 responses
