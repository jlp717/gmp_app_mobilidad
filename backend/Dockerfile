# syntax=docker/dockerfile:1
# ============================================================================
# GMP Backend - Production Dockerfile
# Base: node:22-slim (Debian). NOT Alpine: the IBM i Access ODBC driver
# (libcwbodbc.so) is glibc-only and will not load on musl.
# Stages: deps -> build -> development -> production (production = default).
# ============================================================================

# ── Stage 1: production dependencies ────────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

# No --ignore-scripts: odbc/bcrypt fetch prebuilt glibc binaries during their
# install scripts; skipping them breaks the runtime on node:22-slim.
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: TypeScript build ───────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Fail loudly on compile errors (previous version masked them with || echo).
RUN npm run build:ts

# ── Stage 3: development (compose --profile dev, target: development) ───────
FROM node:22-slim AS development

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

EXPOSE 3335

CMD ["npm", "run", "dev"]

# ── Stage 4: production runtime ─────────────────────────────────────────────
FROM node:22-slim AS production

# IBM i Access ODBC Driver version (Linux x86-64). Bump only after validating
# the matching Fix Central tarball for the new release.
ARG IBMI_ACCESS_VERSION=7.1.0

# curl: healthchecks; tini: PID1 signal reaping; unixodbc: driver manager.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      tini \
      unixodbc \
    && rm -rf /var/lib/apt/lists/*

# --- IBM i Access ODBC Driver -----------------------------------------------
# Source: IBM Fix Central -> https://www.ibm.com/support/fixcentral/
#   product: IBM i Access -> ODBC driver for Linux x86-64.
# Exact URL (verify before first build; IBM moves these per release):
#   https://public.dhe.ibm.com/as400/fixpacks/ibm_i_access/linux_x86_64/ibm-iaccess-<VERSION>.x86_64.tar.gz
# If the tarball requires entitlement credentials, pass a curl config file:
#   docker build --secret id=ibm_fixcentral,src=./fixcentral.curl
# fixcentral.curl holds curl --config options only (see curl man page for the
# "user" option syntax). NEVER commit that file; it stays outside the repo.
RUN --mount=type=secret,id=ibm_fixcentral \
    set -eux; \
    mkdir -p /opt/ibm/iaccess; \
    CURL_CFG=""; \
    if [ -f /run/secrets/ibm_fixcentral ]; then CURL_CFG="-K /run/secrets/ibm_fixcentral"; fi; \
    curl -fsSL --retry 3 ${CURL_CFG} \
      -o /tmp/ibm-iaccess.tar.gz \
      "https://public.dhe.ibm.com/as400/fixpacks/ibm_i_access/linux_x86_64/ibm-iaccess-${IBMI_ACCESS_VERSION}.x86_64.tar.gz"; \
    tar -xzf /tmp/ibm-iaccess.tar.gz -C /opt/ibm/iaccess --strip-components=1; \
    rm -f /tmp/ibm-iaccess.tar.gz; \
    printf '%s\n' \
      '[IBM i Access ODBC Driver]' \
      'Description=IBM i Access ODBC Driver (glibc)' \
      'Driver=/opt/ibm/iaccess/lib/libcwbodbc.so' \
      'Setup=/opt/ibm/iaccess/lib/libcwbodbc.so' \
      >> /etc/odbcinst.ini
# ponytail: assumes tarball ships lib/libcwbodbc.so under one top-level dir.
# upgrade: adapt extraction/registration if IBM changes the tarball layout.

WORKDIR /app

# Production deps + compiled output
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Runtime entry + legacy JS that server.js requires at boot:
# config/, middleware/, services/, routes/, utils/, kpi/, src/ (.js modules
# under src/shared + src/core) and scripts/validate_production_config.js
# (loaded only when NODE_ENV=production).
COPY package.json server.js app.js instrument.js ./
COPY config/ ./config/
COPY middleware/ ./middleware/
COPY services/ ./services/
COPY routes/ ./routes/
COPY utils/ ./utils/
COPY kpi/ ./kpi/
COPY src/ ./src/
COPY scripts/validate_production_config.js ./scripts/

# Non-root runtime user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser \
    && chown -R appuser:appgroup /app

ENV NODE_ENV=production \
    PORT=3335 \
    NODE_OPTIONS="--max-old-space-size=384" \
    ODBCINI=/etc/odbc.ini \
    ODBCINSTINI=/etc/odbcinst.ini \
    LD_LIBRARY_PATH=/opt/ibm/iaccess/lib

USER appuser

EXPOSE 3335

# Liveness only (no DB/Redis): container stays up while DB2 is briefly down;
# /api/ready remains the real readiness signal for traffic.
# NOTE: /api/live is served by server.js in BOTH route modes (legacy and
# USE_TS_ROUTES). health.routes.ts '/health/live' is not mounted by the
# runtime entry yet (src/index.ts does not use healthRoutes), so probing it
# would 404. Switch to /health/live once the TS app mounts healthRoutes.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS -A "GMP-SRE-HealthCheck/1.0" "http://localhost:${PORT:-3335}/api/live" || exit 1

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
