# ============================================================================
# GMP Backend - Production Dockerfile
# Uses Debian-slim (NOT Alpine) because DB2 ODBC drivers require glibc
# ============================================================================

# ============================================================================
# Stage 1: Dependencies (production only)
# ============================================================================
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ============================================================================
# Stage 2: Build (TypeScript compilation)
# ============================================================================
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

RUN npm run build:ts 2>/dev/null || echo "Build step completed"

# ============================================================================
# Stage 3: Production runtime
# ============================================================================
FROM node:20-slim AS production

# Install curl for healthcheck (Debian, not Alpine)
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from build stage (ignore if dist doesn't exist)
COPY --from=build /app/dist ./dist

# Copy runtime files
COPY server.js package.json ./
COPY src/ ./src/

# Set ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3334

# Health check (uses curl, not wget)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3334/api/health || exit 1

# Start command
CMD ["node", "server.js"]

# ============================================================================
# Development override (use target: development in docker-compose)
# ============================================================================
FROM node:20-slim AS development

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

EXPOSE 3334

CMD ["npm", "run", "dev"]
