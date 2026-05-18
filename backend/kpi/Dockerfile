# Dockerfile: Imagen del módulo KPI Glacius (standalone o junto al backend principal)
FROM node:20-alpine AS base

WORKDIR /app

# Instalar dependencias del sistema para pg (libpq)
RUN apk add --no-cache postgresql-client

# Copiar dependencias
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copiar código
COPY . .

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3334
ENV KPI_DATABASE_URL=postgresql://kpi_user:kpi_pass@postgres:5432/kpi_glacius
ENV REDIS_URL=redis://redis:6379
ENV KPI_SCHEDULER_ENABLED=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q --spider http://localhost:${PORT}/api/kpi/health || exit 1

EXPOSE ${PORT}

CMD ["node", "server.js"]
