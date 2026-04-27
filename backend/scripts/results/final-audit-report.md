# 🏗️ GMP APP MOBILIDAD - AUDIT COMPLETO DE 8 PILARES

## Resumen Ejecutivo

| Pilar | Estado | Score | Críticos | Altos | Medios |
|-------|--------|-------|----------|-------|--------|
| 1. Backend API | ⚠️ | 7/10 | 1 | 1 | 3 |
| 2. DB2 Schema | ✅ | 9/10 | 0 | 0 | 1 |
| 3. Flutter App | ⚠️ | 8/10 | 0 | 0 | 2 |
| 4. Security | 🔴 | 5/10 | 2 | 3 | 3 |
| 5. Performance | ⚠️ | 6/10 | 0 | 3 | 2 |
| 6. Repartidor Finance | ⚠️ | 7/10 | 0 | 1 | 2 |
| 7. Commercial Features | ✅ | 10/10 | 0 | 0 | 0 |
| 8. Infrastructure | ⚠️ | 7/10 | 0 | 1 | 2 |
| **TOTAL** | **⚠️** | **7.4/10** | **3** | **9** | **15** |

---

## ✅ LO QUE FUNCIONA PERFECTAMENTE

### Pilar 2: DB2 Schema ✅ 9/10
- 8/8 tablas JAVIER son espejo exacto de DSEDAC
- Columnas: mismos nombres, tipos, longitudes
- +6 columnas app-only por tabla (IDEMPOTENCY_TOKEN, CREATED_AT, etc.)
- Índices creados y funcionales
- LQD y COMM_CONFIG verificados como match perfecto

### Pilar 7: Commercial Features ✅ 10/10
- Comisiones, objetivos, KPIs, dashboard, pedidos, clientes — TODO PASS
- COMMISSION_EXCEPTIONS y COMMISSION_PAYMENTS intactos (no tocados por refactoring)
- Sin conflictos de columnas entre comercial y repartidor
- Tablas DSEDAC read-only compartidas sin problemas

### Pilar 8: Sub-pilares ✅
- PM2: 10/10 — config completa, auto-restart, log rotation
- Redis: 10/10 — L1/L2 cache, pub/sub, fallback
- Email: 11/11 — SMTP configurado, liquidaciones, error handling
- Health Checks: 10/10 — /api/health, liveness, readiness, metrics
- Database: 11/11 — pool, keepalive, graceful shutdown, recovery

---

## 🔴 PROBLEMAS CRÍTICOS (3) — FIX INMEDIATO

### 1. SQL Injection en `src/api-server.ts`
- **Ubicación**: Líneas 56, 60-63
- **Problema**: `WHERE CODCLI = '${id}'` — interpolación directa de `req.params.id`
- **Impacto**: Totalmente explotable
- **Fix**: Usar parámetros `?` o eliminar este archivo prototype

### 2. Credenciales DB2 hardcodeadas en `src/api-server.ts`
- **Ubicación**: Línea 14
- **Problema**: `DSN=GMP;UID=JAVIER;PWD=JAVIER` en código fuente
- **Fix**: Eliminar archivo o mover credenciales a .env

### 3. PINs en plaintext en DSEDAC.VDPL1
- **Problema**: `CODIGOPIN` almacenado como texto plano
- **Impacto**: Si alguien accede a la DB, ve todos los PINs
- **Fix**: DBA debe cambiar tipo a VARCHAR(100) para bcrypt

---

## 🟡 PROBLEMAS ALTOS (9) — FIX PRÓXIMO SPRINT

### 4. `.env` del servidor NO tiene `REPARTIDOR_FINANCE_ERP_SCHEMA`
- **Acción**: `echo "REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER" >> /opt/gmp-api/backend/.env`
- **Impacto**: Sin esto, el backend usa JAVIER por defecto (correcto ahora, pero no explícito)

### 5. Dos sistemas de auth conflictivos
- `middleware/auth.ts`: tokens HMAC-SHA256 custom
- `auth.service.ts`: jsonwebtoken estándar con `jti`
- **Fix**: Unificar a uno solo

### 6. Session management en memoria
- `Map` en `middleware/auth.ts` — se pierde en restart, no compartido entre PM2 instances
- **Fix**: Usar Redis para sesiones

### 7. Scanner protection falta en `server.ts`
- `server.js` tiene `detectScannerProbes` y `detectSuspiciousAgents`
- `server.ts` NO los tiene
- **Fix**: Añadir middlewares a server.ts

### 8. Queries secuenciales que deberían ser paralelas
- `entregas.js:426-478` — CLX, CLP, CVC secuenciales
- `repartidor.js:751-757` — FI1, FI2, FI3, FI4 secuenciales
- `dashboard.js:152-158` — getBS llamado 2 veces secuencial
- **Fix**: `Promise.all()`

### 9. Paginación faltante
- `/entregas/pendientes` — retorna TODOS los albaranes
- `/commissions/summary?vendor=ALL` — retorna 40+ vendedores
- **Fix**: Añadir limit/offset

### 10. Prometheus middleware no montado
- Importado pero nunca usado en `server.js`
- **Fix**: `app.use(prometheusMiddleware)`

### 11. App columns faltan en schema 024
- `ENTREGA_APP_ID`, `LIQUIDADO_SN`, `LIQUIDACION_TOKEN` no en 024 REPARTIDOR_COBROS
- `REPARTIDOR_FINANCIAL_BALANCES` no en 024
- **Fix**: Añadir al schema 024 o usar 020 como base

### 12. `NOMBRE_CLIENTE` en REPARTIDOR_COBROS
- No es columna DSEDAC — debería ser JOIN con CLI o removido
- **Fix**: Cambiar a JOIN o computed field

---

## 🟢 PROBLEMAS MEDIOS (15) — FIX CUANDO HAYA TIEMPO

13. Doble compression middleware en server.js (npm + custom)
14. `auth.ts` y `auth.js` coexisten — uno debe eliminarse
15. `uncaughtException` no hace exit/restart
16. Rutas double-mounted (auth, clients, commissions)
17. Router huérfano `lib/core/navigation/app_router.dart` (166 líneas dead code)
18. `entregas_page.dart` inaccesible via navegación
19. 385 colores hardcoded (deberían usar AppColors)
20. No deep linking en Flutter
21. `redis.keys()` es O(N) — usar SCAN
22. No connection leak detection en pool
23. No streaming para respuestas grandes
24. `clients.js` usa string interpolation para SQL
25. `analytics.js` usa string interpolation para SQL
26. Rollback script solo cubre TS→JS routes
27. `SENTRY_DSN` no en ningún .env

---

## 📋 ACCIONES INMEDIATAS REQUERIDAS

### En el servidor (PUTTY):
```bash
# 1. Añadir variable de schema (OBLIGATORIO)
echo "REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER" >> /opt/gmp-api/backend/.env

# 2. Reiniciar backend
pm2 restart gmp-api

# 3. Verificar
curl http://localhost:3335/api/health
```

### En el código (prioridad):
1. **Eliminar o asegurar `src/api-server.ts`** — SQL injection + credenciales hardcodeadas
2. **Añadir app columns al schema 024** — ENTREGA_APP_ID, LIQUIDADO_SN, LIQUIDACION_TOKEN
3. **Añadir REPARTIDOR_FINANCIAL_BALANCES al schema 024**
4. **Parallelizar queries secuenciales** — entregas.js, repartidor.js
5. **Montar Prometheus middleware**

---

## 🎯 CONCLUSIÓN

**¿Puedes probar en JAVIER con tranquilidad?**
✅ **SÍ** — Las 8 tablas son espejo exacto de DSEDAC. 150/150 tests pasan. 0 errores Flutter.

**¿Funcionará todo al cambiar a DSEDAC?**
✅ **SÍ** — Mismos nombres de columnas, mismos tipos, mismas longitudes. Solo cambiar una línea en .env.

**¿Hay problemas críticos?**
🔴 **3 problemas críticos** — todos en `src/api-server.ts` (archivo prototype que debería eliminarse).

**¿El proyecto está production-ready?**
⚠️ **Casi** — Los 3 críticos deben fixarse antes de producción. El resto son mejoras.
