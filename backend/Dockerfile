# ============================================================
# GMP Backend - Multi-stage Docker Build v4.0.0
# 
# Stage 1: dependencies - Install node_modules
# Stage 2: build - Compile TypeScript
# Stage 3: production - Minimal runtime image
# ============================================================

# ─── Stage 1: Dependencies ───────────────────────────────
FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production && \
    npm cache clean --force

COPY package.json package-lock.json* ./
RUN npm ci && \
    npm cache clean --force

# ─── Stage 2: Build ──────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
COPY tsconfig.json ./

RUN npm run build

# ─── Stage 3: Production ─────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install system dependencies for DB2 ODBC
RUN apk add --no-cache \
    bash \
    curl \
    wget \
    unixodbc \
    unixodbc-dev

# Copy built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=dependencies /app/node_modules ./node_modules

# Copy legacy services (temporary until full migration)
COPY services/ ./services/
COPY middleware/ ./middleware/
COPY utils/ ./utils/
COPY config/ ./config/

# Create logs directory
RUN mkdir -p /app/logs

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3334

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --spider -q http://localhost:3334/api/health || exit 1

CMD ["node", "dist/server.js"]
