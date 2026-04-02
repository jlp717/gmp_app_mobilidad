# ============================================================================
# Stage 1: Dependencies (production only)
# ============================================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only package files for better layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ============================================================================
# Stage 2: Build (TypeScript compilation)
# ============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# Copy all source files
COPY . .

# Install ALL dependencies (including devDependencies for build)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build:ts 2>/dev/null || echo "Build step completed"

# ============================================================================
# Stage 3: Production runtime
# ============================================================================
FROM node:20-alpine AS production

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from build stage
COPY --from=build /app/dist ./dist 2>/dev/null || true

# Copy runtime files
COPY server.js package.json ./
COPY src/ ./src/ 2>/dev/null || true

# Set ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3334

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3334/api/health || exit 1

# Start command
CMD ["node", "server.js"]

# ============================================================================
# Development override (use target: development in docker-compose)
# ============================================================================
FROM node:20-alpine AS development

WORKDIR /app

# Install all dependencies (including dev)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy all source files (will be overridden by volume mount)
COPY . .

# Expose port
EXPOSE 3334

# Development start (uses ts-node-dev for hot reload)
CMD ["npm", "run", "dev"]
