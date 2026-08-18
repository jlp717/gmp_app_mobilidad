---
name: error-handling
description: Error handling patterns — Result types, custom error classes, Express middleware, React Error Boundaries, Flutter repositories.
---

# Error Handling — Professional Patterns Guide

## Overview

Robust error handling is the difference between a system that fails gracefully and one that leaks internals, crashes silently, or leaves users with no feedback. This guide covers the full stack: TypeScript Result types for expected errors, custom error classes, Express centralized middleware, React Error Boundaries, and Flutter repository patterns.

## When to Use

- Designing any service, repository, or API handler
- Adding error handling to existing code that uses bare `try/catch`
- Implementing user-facing error states in React or Flutter
- Setting up Express error middleware that classifies and sanitizes errors

## When NOT to Use

- Do not use Result types for truly unexpected system errors (out of memory, disk full) — let them propagate and crash loudly
- Do not add `try/catch` inside `useEffect` without a proper error state — use Error Boundaries

---

## Step-by-Step Process

### 1. Custom Error Classes

A hierarchy of typed errors allows `instanceof` checks and carries structured context.

```ts
// errors/AppError.ts
export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: ErrorDetail[],
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (required when extending Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id "${id}" not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[]) {
    super('VALIDATION_FAILED', 'Validation failed', 422, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('UNAUTHORIZED', 'Authentication required', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(action: string) {
    super('FORBIDDEN', `You are not allowed to ${action}`, 403);
  }
}
```

### 2. Result Type — Avoid Throwing for Expected Errors

Use Result for operations that have predictable failure modes (DB not found, parse error, network timeout).

```ts
// types/Result.ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

```ts
// services/UserService.ts
import { ok, err, Result } from '../types/Result';
import { NotFoundError, ValidationError } from '../errors/AppError';

export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async getUserById(id: string): Promise<Result<User>> {
    if (!id.trim()) return err(new ValidationError([{ field: 'id', message: 'ID is required' }]));

    const user = await this.userRepo.findById(id);
    if (!user) return err(new NotFoundError('User', id));

    return ok(user);
  }
}

// Consumer — forced to handle both paths
const result = await userService.getUserById(req.params.id);
if (!result.ok) {
  return next(result.error); // Pass to Express error handler
}
const user = result.value; // TypeScript knows this is User, not undefined
```

### 3. Express Error Middleware

The 4-parameter signature is how Express identifies error middleware. It must be registered **last**.

```ts
// middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../errors/AppError';
import { logger } from '../lib/logger';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction // must be declared even if unused
): void {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  if (err instanceof AppError) {
    // Expected, operational error — log at warn level
    logger.warn({ requestId, code: err.code, statusCode: err.statusCode, message: err.message });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
        request_id: requestId,
      },
    });
    return;
  }

  // Unexpected error — log full stack, return sanitized response
  logger.error({ requestId, err }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      request_id: requestId,
    },
  });
}
```

```ts
// middleware/asyncHandler.ts — wraps async route handlers
import { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next); // Forwards thrown errors to errorHandler
  };
}

// Usage
router.get('/users/:id', asyncHandler(async (req, res, next) => {
  const result = await userService.getUserById(req.params.id);
  if (!result.ok) return next(result.error);
  res.json({ data: result.value });
}));
```

### 4. React Error Boundaries

Error Boundaries must be class components. They catch render errors in their subtree.

```tsx
// components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../lib/logger';

interface Props {
  fallback: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error({ error: error.message, componentStack: info.componentStack }, 'React render error');
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props;
      return typeof fallback === 'function'
        ? fallback(this.state.error, this.reset)
        : fallback;
    }
    return this.props.children;
  }
}

// Usage
<ErrorBoundary
  fallback={(error, reset) => (
    <div role="alert">
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )}
>
  <UserProfile />
</ErrorBoundary>
```

### 5. Process-Level Async Error Handlers

```ts
// server.ts
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  // Graceful shutdown — don't exit immediately in production
  gracefulShutdown();
});

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ error }, 'Uncaught exception — shutting down');
  process.exit(1); // Cannot recover from uncaught exception safely
});

async function gracefulShutdown() {
  logger.info('Graceful shutdown initiated');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // Force exit after 10s
}
```

### 6. Flutter — Result Type in Repository Layer

```dart
// lib/core/result.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'result.freezed.dart';

@freezed
class Result<T> with _$Result<T> {
  const factory Result.success(T data) = Success<T>;
  const factory Result.failure(AppException exception) = Failure<T>;
}

class AppException implements Exception {
  const AppException({required this.message, required this.code, this.statusCode});
  final String message;
  final String code;
  final int? statusCode;
}
```

```dart
// lib/data/repositories/user_repository.dart
class UserRepository {
  const UserRepository(this._apiClient);
  final ApiClient _apiClient;

  Future<Result<User>> getUserById(String id) async {
    try {
      final response = await _apiClient.get('/users/$id');
      return Result.success(User.fromJson(response.data as Map<String, dynamic>));
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        return const Result.failure(AppException(message: 'User not found', code: 'NOT_FOUND', statusCode: 404));
      }
      return Result.failure(AppException(message: e.message ?? 'Network error', code: 'NETWORK_ERROR'));
    } catch (e) {
      return Result.failure(AppException(message: 'Unexpected error', code: 'UNKNOWN'));
    }
  }
}

// Consumer in Riverpod provider
final userProvider = FutureProvider.family<User, String>((ref, id) async {
  final repo = ref.read(userRepositoryProvider);
  final result = await repo.getUserById(id);
  return result.when(
    success: (user) => user,
    failure: (exception) => throw exception,
  );
});
```

---

## Verification Checklist

- [ ] `AppError` and subclasses have `Object.setPrototypeOf(this, new.target.prototype)` for correct `instanceof`
- [ ] `Result<T>` used for all expected error paths (not found, validation, conflict)
- [ ] `throw` reserved for unexpected, unrecoverable errors only
- [ ] Express error handler has 4 parameters `(err, req, res, next)` and is registered last
- [ ] All async route handlers wrapped with `asyncHandler` — no unhandled promise rejections
- [ ] Error responses never include stack traces or internal system paths
- [ ] `request_id` included in all error responses for log correlation
- [ ] React Error Boundaries wrap all async data-fetching component subtrees
- [ ] `componentDidCatch` logs to error tracking (Sentry/logger) not `console.error`
- [ ] `unhandledRejection` and `uncaughtException` handlers registered in Node.js process
- [ ] Flutter repository `try/catch` catches `DioException` and generic `Exception` separately
- [ ] Flutter error states are handled in UI via `AsyncValue.error` or `Result.failure`
