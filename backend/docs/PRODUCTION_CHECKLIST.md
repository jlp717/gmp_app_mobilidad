# GMP APP MOBILIDAD - PRODUCTION CHECKLIST 10/10
## ================================================

## 🚀 PRE-DESPLIEGUE

### 1. 📋 Configuración de Variables (.env)
```bash
# Copiar .env.example a .env y configurar:
cp .env.example .env
# Editar con valores reales
```

### 2. 🔐 Generación de Secrets
```bash
# Generar JWT secrets seguros (32+ caracteres):
openssl rand -hex 32  # Linux/Mac
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # Windows

# NO usar secrets de ejemplo - generar propios
```

### 3. ✅ Validar Configuración
```bash
# Ejecutar validador:
NODE_ENV=production node scripts/validate_production_config.js

# Debe mostrar "Configuration ready for production!"
```

### 4. 🗄️ Índices DB2
```bash
# Crear índices para rendimiento:
node scripts/db_create_indexes.js
```

---

## ✅ SEGURIDAD - CHECKLIST

| # | Control | Required | Status |
|---|--------|----------|--------|
| 1 | JWT secrets 32+ chars | YES | ⬜ |
| 2 | CORS whitelist | YES | ⬜ |
| 3 | Rate limiting | YES | ✅ |
| 4 | HTTPS only | YES | ⬜ |
| 5 | Input validation | YES | ✅ |
| 6 | SQL injection protection | YES | ✅ |
| 7 | XSS protection | YES | ✅ |
| 8 | Security headers (Helmet) | YES | ✅ |
| 9 | Request size limit | YES | ✅ |
| 10 | Suspicious UA blocking | YES | ✅ |

---

## 🚀 DESPLIEGUE

### Production Start
```bash
# Verificar Redis
redis-cli ping

# Iniciar servidor
pm2 start ecosystem.config.js --env production

# Verificar health
curl http://localhost:3197/api/health
```

### Health Check - Debe mostrar:
```json
{
  "status": "ok",
  "database": { "status": "connected" },
  "redis": { "status": "connected" or "L1_only" },
  "security": "enabled"
}
```

---

## 📊 CONFIGURACIÓN MÍNIMA REQUERIDA

```
NODE_ENV=production
PORT=3334
HOST=0.0.0.0

# DB2
ODBC_DSN=GMP
ODBC_UID=JAVIER
ODBC_PWD=[TU_PASSWORD]

# JWT (generar con openssl rand -hex 32)
JWT_ACCESS_SECRET=[32+ CHAR SECRET]
JWT_REFRESH_SECRET=[32+ CHAR SECRET]
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# CORS (NO wildcards en producción!)
CORS_ORIGIN=https://tu-dominio.com

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=1000
LOGIN_RATE_LIMIT=30

# SMTP
SMTP_HOST=mail.tudominio.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@tudominio.com
SMTP_PASSWORD=[TU_PASSWORD]
SMTP_FROM=noreply@tudominio.com

# Redis
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=info
```

---

## 🔍 VERIFICACIÓN POST-DESPLIEGUE

### 1. Health Check
```bash
curl http://localhost:3197/api/health
```

### 2. Security Headers
```bash
curl -I http://localhost:3197/api/health
# Debe incluir:
# - X-Content-Type-Options: nosniff
# - X-Frame-Options: DENY
# - X-XSS-Protection: 0
# - Cache-Control: no-store, no-cache...
# - Strict-Transport-Security: max-age=...
```

### 3. Rate Limiting
```bash
# Hacer 100+ requests rápidos
# Debe retornar 429 después del límite
```

### 4. SQL Injection Protection
```bash
# Probar con payloads maliciosos en params
curl "http://localhost:3197/api/clients?search=DROP%20TABLE"
# Debe retornar 400

curl -X POST http://localhost:3197/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"' OR '1'='1\"}"
# Debe sanitizear o rechazar
```

---

## ⚠️ NUNCA HACER EN PRODUCCIÓN

- ❌ Commit de archivos .env
- ❌ Passwords en código fuente
- ❌ CORS_ORIGIN=* o CORS_ORIGIN=true
- ❌ Secrets de ejemplo en producción
- ❌ Deshabilitar rate limiting
- ❌ Ignorar errores de validación

---

## ✅ CHECKLIST COMPLETO - FIRMAR

- [ ] Configuración .env completa
- [ ] Secrets 生成 (no ejemplo)
- [ ] Validación pasar 0 errores
- [ ] Índices DB2 creados
- [ ] Redis conectando
- [ ] Health check OK
- [ ] Security headers OK
- [ ] Rate limiting OK
- [ ] SQL injection blocked
- [ ] logged en monitorización

**FECHA: __________**
**FIRMA: __________**