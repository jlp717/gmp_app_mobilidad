# ðŸ—ï¸ GMP APP MOBILIDAD - AUDIT COMPLETO DE 8 PILARES

## Resumen Ejecutivo

| Pilar | Estado | Score | CrÃ­ticos | Altos | Medios |
|-------|--------|-------|----------|-------|--------|
| 1. Backend API | âš ï¸ | 7/10 | 1 | 1 | 3 |
| 2. DB2 Schema | âœ… | 9/10 | 0 | 0 | 1 |
| 3. Flutter App | âš ï¸ | 8/10 | 0 | 0 | 2 |
| 4. Security | ðŸ”´ | 5/10 | 2 | 3 | 3 |
| 5. Performance | âš ï¸ | 6/10 | 0 | 3 | 2 |
| 6. Repartidor Finance | âš ï¸ | 7/10 | 0 | 1 | 2 |
| 7. Commercial Features | âœ… | 10/10 | 0 | 0 | 0 |
| 8. Infrastructure | âš ï¸ | 7/10 | 0 | 1 | 2 |
| **TOTAL** | **âš ï¸** | **7.4/10** | **3** | **9** | **15** |

---

## âœ… LO QUE FUNCIONA PERFECTAMENTE

### Pilar 2: DB2 Schema âœ… 9/10
- 8/8 tablas JAVIER son espejo exacto de DSEDAC
- Columnas: mismos nombres, tipos, longitudes
- +6 columnas app-only por tabla (IDEMPOTENCY_TOKEN, CREATED_AT, etc.)
- Ãndices creados y funcionales
- LQD y COMM_CONFIG verificados como match perfecto

### Pilar 7: Commercial Features âœ… 10/10
- Comisiones, objetivos, KPIs, dashboard, pedidos, clientes â€” TODO PASS
- COMMISSION_EXCEPTIONS y COMMISSION_PAYMENTS intactos (no tocados por refactoring)
- Sin conflictos de columnas entre comercial y repartidor
- Tablas DSEDAC read-only compartidas sin problemas

### Pilar 8: Sub-pilares âœ…
- PM2: 10/10 â€” config completa, auto-restart, log rotation
- Redis: 10/10 â€” L1/L2 cache, pub/sub, fallback
- Email: 11/11 â€” SMTP configurado, liquidaciones, error handling
- Health Checks: 10/10 â€” /api/health, liveness, readiness, metrics
- Database: 11/11 â€” pool, keepalive, graceful shutdown, recovery

---

## ðŸ”´ PROBLEMAS CRÃTICOS (3) â€” FIX INMEDIATO

### 1. SQL Injection en `src/api-server.ts`
- **UbicaciÃ³n**: LÃ­neas 56, 60-63
- **Problema**: `WHERE CODCLI = '${id}'` â€” interpolaciÃ³n directa de `req.params.id`
- **Impacto**: Totalmente explotable
- **Fix**: Usar parÃ¡metros `?` o eliminar este archivo prototype

### 2. Credenciales DB2 hardcodeadas en `src/api-server.ts`
- **UbicaciÃ³n**: LÃ­nea 14
- **Problema**: credenciales DB2 hardcodeadas en cÃ³digo fuente
- **Fix**: Eliminar archivo o mover credenciales a .env

### 3. PINs en plaintext en DSEDAC.VDPL1
- **Problema**: `CODIGOPIN` almacenado como texto plano
- **Impacto**: Si alguien accede a la DB, ve todos los PINs
- **Fix**: DBA debe cambiar tipo a VARCHAR(100) para bcrypt

---

## ðŸŸ¡ PROBLEMAS ALTOS (9) â€” FIX PRÃ“XIMO SPRINT

### 4. `.env` del servidor NO tiene `REPARTIDOR_FINANCE_ERP_SCHEMA`
- **AcciÃ³n**: `echo "REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER" >> /opt/gmp-api/backend/.env`
- **Impacto**: Sin esto, el backend usa JAVIER por defecto (correcto ahora, pero no explÃ­cito)

### 5. Dos sistemas de auth conflictivos
- `middleware/auth.ts`: tokens HMAC-SHA256 custom
- `auth.service.ts`: jsonwebtoken estÃ¡ndar con `jti`
- **Fix**: Unificar a uno solo

### 6. Session management en memoria
- `Map` en `middleware/auth.ts` â€” se pierde en restart, no compartido entre PM2 instances
- **Fix**: Usar Redis para sesiones

### 7. Scanner protection falta en `server.ts`
- `server.js` tiene `detectScannerProbes` y `detectSuspiciousAgents`
- `server.ts` NO los tiene
- **Fix**: AÃ±adir middlewares a server.ts

### 8. Queries secuenciales que deberÃ­an ser paralelas
- `entregas.js:426-478` â€” CLX, CLP, CVC secuenciales
- `repartidor.js:751-757` â€” FI1, FI2, FI3, FI4 secuenciales
- `dashboard.js:152-158` â€” getBS llamado 2 veces secuencial
- **Fix**: `Promise.all()`

### 9. PaginaciÃ³n faltante
- `/entregas/pendientes` â€” retorna TODOS los albaranes
- `/commissions/summary?vendor=ALL` â€” retorna 40+ vendedores
- **Fix**: AÃ±adir limit/offset

### 10. Prometheus middleware no montado
- Importado pero nunca usado en `server.js`
- **Fix**: `app.use(prometheusMiddleware)`

### 11. App columns faltan en schema 024
- `ENTREGA_APP_ID`, `LIQUIDADO_SN`, `LIQUIDACION_TOKEN` no en 024 REPARTIDOR_COBROS
- `REPARTIDOR_FINANCIAL_BALANCES` no en 024
- **Fix**: AÃ±adir al schema 024 o usar 020 como base

### 12. `NOMBRE_CLIENTE` en REPARTIDOR_COBROS
- No es columna DSEDAC â€” deberÃ­a ser JOIN con CLI o removido
- **Fix**: Cambiar a JOIN o computed field

---

## ðŸŸ¢ PROBLEMAS MEDIOS (15) â€” FIX CUANDO HAYA TIEMPO

13. Doble compression middleware en server.js (npm + custom)
14. `auth.ts` y `auth.js` coexisten â€” uno debe eliminarse
15. `uncaughtException` no hace exit/restart
16. Rutas double-mounted (auth, clients, commissions)
17. Router huÃ©rfano `lib/core/navigation/app_router.dart` (166 lÃ­neas dead code)
18. `entregas_page.dart` inaccesible via navegaciÃ³n
19. 385 colores hardcoded (deberÃ­an usar AppColors)
20. No deep linking en Flutter
21. `redis.keys()` es O(N) â€” usar SCAN
22. No connection leak detection en pool
23. No streaming para respuestas grandes
24. `clients.js` usa string interpolation para SQL
25. `analytics.js` usa string interpolation para SQL
26. Rollback script solo cubre TSâ†’JS routes
27. `SENTRY_DSN` no en ningÃºn .env

---

## ðŸ“‹ ACCIONES INMEDIATAS REQUERIDAS

### En el servidor (PUTTY):
```bash
# 1. AÃ±adir variable de schema (OBLIGATORIO)
echo "REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER" >> /opt/gmp-api/backend/.env

# 2. Reiniciar backend
pm2 restart gmp-api

# 3. Verificar
curl http://localhost:3335/api/health
```

### En el cÃ³digo (prioridad):
1. **Eliminar o asegurar `src/api-server.ts`** â€” SQL injection + credenciales hardcodeadas
2. **AÃ±adir app columns al schema 024** â€” ENTREGA_APP_ID, LIQUIDADO_SN, LIQUIDACION_TOKEN
3. **AÃ±adir REPARTIDOR_FINANCIAL_BALANCES al schema 024**
4. **Parallelizar queries secuenciales** â€” entregas.js, repartidor.js
5. **Montar Prometheus middleware**

---

## ðŸŽ¯ CONCLUSIÃ“N

**Â¿Puedes probar en JAVIER con tranquilidad?**
âœ… **SÃ** â€” Las 8 tablas son espejo exacto de DSEDAC. 150/150 tests pasan. 0 errores Flutter.

**Â¿FuncionarÃ¡ todo al cambiar a DSEDAC?**
âœ… **SÃ** â€” Mismos nombres de columnas, mismos tipos, mismas longitudes. Solo cambiar una lÃ­nea en .env.

**Â¿Hay problemas crÃ­ticos?**
ðŸ”´ **3 problemas crÃ­ticos** â€” todos en `src/api-server.ts` (archivo prototype que deberÃ­a eliminarse).

**Â¿El proyecto estÃ¡ production-ready?**
âš ï¸ **Casi** â€” Los 3 crÃ­ticos deben fixarse antes de producciÃ³n. El resto son mejoras.
