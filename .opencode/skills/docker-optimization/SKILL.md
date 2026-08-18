---
name: docker-optimization
description: Dockerfiles optimizados — multi-stage builds, cache de capas, imágenes mínimas, seguridad y Docker Compose con healthchecks.
---

## Overview

A good Dockerfile produces a small, fast-building, secure image. This skill covers the four pillars: multi-stage builds to separate build artifacts from runtime, layer ordering for maximum cache reuse, minimal base images, and hardened runtime security (non-root user, read-only filesystem, no secrets in layers).

---

## When to Use

- Creating a Dockerfile for a new service
- Auditing an existing Dockerfile that produces large images or slow builds
- Setting up CI/CD pipelines that build Docker images
- Configuring local development with Docker Compose

## When NOT to Use

- For serverless/edge functions where Docker is not the deployment unit
- When a managed platform (Railway, Render, Heroku) handles containerization — let the platform do it

---

## Step-by-Step Process

### 1. Multi-Stage Node.js Dockerfile

```dockerfile
# ─── Stage 1: deps ───────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# Copy manifests first — changes here are rare, maximises layer cache
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ─── Stage 2: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ─── Stage 3: runner (runtime only) ──────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy only what the app needs at runtime
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

Final image contains zero build tools, no `node_modules` source, no dev dependencies. Typical size: **~120 MB** vs **~1.2 GB** without multi-stage.

### 2. Base Image Selection

| Image | Size | Security | Use case |
|-------|------|----------|----------|
| `node:20` | ~1 GB | Many packages | Never in prod |
| `node:20-slim` | ~240 MB | Debian minimal | General purpose |
| `node:20-alpine` | ~60 MB | musl libc, minimal | Most Node apps |
| `gcr.io/distroless/nodejs20` | ~110 MB | No shell, no package manager | High-security prod |

**Alpine caveats:** some native modules (e.g., `bcrypt`, `canvas`) require `build-base` and `python3` — add them to the build stage only.

```dockerfile
# Alpine with native build deps in build stage only
FROM node:20-alpine AS builder
RUN apk add --no-cache build-base python3
```

### 3. Layer Caching Strategy

Order layers from **least frequently changed → most frequently changed**:

```dockerfile
# 1. Base image & system deps (changes: never)
FROM node:20-alpine
RUN apk add --no-cache dumb-init

# 2. Dependency manifests (changes: weekly)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 3. Application source (changes: every commit)
COPY . .
RUN pnpm build
```

If you `COPY . .` before installing dependencies, every source change invalidates the install cache. This is the single most common Dockerfile performance mistake.

### 4. Security Hardening

```dockerfile
FROM node:20-alpine AS runner

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# No new privileges
# (in docker-compose or k8s: securityContext.allowPrivilegeEscalation: false)

# Read-only filesystem — mount writable volumes for /tmp and logs
# docker run --read-only -v /tmp --tmpfs /app/tmp ...
```

**Secrets — never in layers:**
```dockerfile
# BAD — secret baked into layer, visible in docker history
RUN echo "DB_PASSWORD=secret" > .env

# GOOD — pass at runtime via environment variable
# docker run -e DB_PASSWORD=$DB_PASSWORD ...
# Or use Docker BuildKit secrets:
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm install
```

### 5. .dockerignore

```
node_modules
.next
.git
.env*
*.test.ts
*.spec.ts
coverage
dist
.DS_Store
README.md
```

A missing `.dockerignore` copies `node_modules` (often 500 MB+) into the build context, bloating every build.

### 6. Docker Compose with Healthchecks

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: runner
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/app
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

`condition: service_healthy` ensures the app does not start until PostgreSQL is accepting connections — eliminates the classic "ECONNREFUSED on startup" race condition.

### 7. Flutter CI Dockerfile

```dockerfile
FROM ghcr.io/cirruslabs/flutter:3.22.0 AS builder
WORKDIR /app
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get
COPY . .
RUN flutter build web --release --dart-define=FLUTTER_WEB_USE_SKIA=true

FROM nginx:alpine AS runner
COPY --from=builder /app/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

## Verification Checklist

- [ ] Multi-stage build — runtime image contains zero build tools or dev dependencies
- [ ] `COPY package*.json` / `COPY pubspec.*` before `COPY . .` for cache efficiency
- [ ] `.dockerignore` excludes `node_modules`, `.git`, `.env*`, test files
- [ ] Base image is `alpine` or `slim` — not full `node:20`
- [ ] Runtime process runs as non-root user (`USER appuser`)
- [ ] No secrets, tokens, or passwords in any `RUN`, `ENV`, or `ARG` layer
- [ ] `docker history <image>` shows no sensitive values
- [ ] `docker-compose.yml` uses `condition: service_healthy` for dependent services
- [ ] Healthcheck defined for every service
- [ ] Final image size verified: `docker images` — flag anything over 300 MB for Node, 150 MB for static
