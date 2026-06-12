# Auditoría pre-producción 2026-06-11 — Backend (Pedidos / Cobros / Bolsa)

- **Fecha de ejecución:** 2026-06-12, 00:45–01:00 (UTC+2)
- **Alcance:** backend Node.js — rutas y servicios de **Pedidos**, **Cobros** y **Bolsa comercial**, más `server.js`, middleware y adaptadores DDD
- **Referencia cruzada DB2:** `docs/audits/preprod-2026-06-11/pilar2-db2.md` (bugs B4–B6 con evidencia SQL)
- **Tests:** `cd backend && npx jest` — **323/323** antes y después de los fixes (35 suites, ~33–52 s)

---

## 1. Fixes aplicados (B4–B6)

| ID | Archivo:línea | Problema | Fix |
|---|---|---|---|
| **B4** | `backend/routes/pedidos.js:1669–1686` | `/debug/set-estado` escribía `PENDIENTE_APROBACION` (20 chars) en `ESTADO VARCHAR(12)` → SQL0404 | Valida con `canonicalOrderStatus()`, persiste con `storedOrderStatus()` (`PEND_APROB`). Respuesta incluye `estado` (canónico) y `storedEstado`. |
| **B5** | `backend/routes/pedidos.js:1708,1717` | `/debug/list-estados` seleccionaba columna inexistente `SERIE` → SQL0206 | `SERIE` → `SERIEPEDIDO` (columna real en `JAVIER.PEDIDOS_CAB`). |
| **B6** | `backend/routes/cobros.js:785` | Query legacy `pending-summary` usaba `CLI.DESCRIPCIONCLIENTE` (inexistente en `DSEDAC.CLI`) → SQL0205 | `DESCRIPCIONCLIENTE` → `NOMBRECLIENTE`, alineado con DDD (`db2-cobros-repository.js:505`). |

**Nota:** Los endpoints debug (B4/B5) están tras `debugMiddleware` (deshabilitados si `NODE_ENV=production`, `pedidos.js:1625–1629`). B6 afectaba el **fallback legacy** activado si DDD falla al arrancar (`server.js:615–628`).

---

## 2. Tests

| Momento | Comando | Resultado |
|---|---|---|
| Antes de fixes | `cd backend && npx jest` | **35 suites, 323 tests — todos PASS** |
| Después de fixes | `cd backend && npx jest` | **35 suites, 323 tests — todos PASS** |

Suites relevantes verificadas: `pedidos_contracts.test.js` (state machine `storedOrderStatus`), `cobros-legacy.test.js`, `cobros-commercial.test.js`, `bolsa-comercial.service.test.js`, `ddd_route_contracts.test.js`.

---

## 3. Rendimiento (endpoints críticos)

**Arranque local:** se intentó `node server.js` en puerto 3334; el warmup DB2 no completó escucha en &lt;90 s (ODBC/GMP lento en arranque frío). **No se midieron tiempos HTTP en vivo.**

**Evidencia SQL directa** (`backend/tmp/db-exploration/pilar2-perf-2026-06-11.json`, 3 repeticiones, 2026-06-11):

| Endpoint / query | ms (run1 / run2 / run3) | Notas |
|---|---|---|
| Pedidos `getOrders` (vendor 95, 50 filas) | 226 / 231 / 222 | OK |
| Pedidos `list-estados` (pre-fix) | **ERROR SQL0206** | Corregido B5 |
| Cobros `pendientes` CVC por cliente | 247 / 241 / 222 | OK |
| Cobros `pending-summary` global (pre-fix) | **ERROR SQL0205** | Corregido B6 |
| Bolsa status por vendedor/mes | 229 / 224 / 224 | OK |
| Bolsa historial 12 meses | 219 / 223 / 228 | OK |

Tiempos DB2 ~220–250 ms por query puntual; aceptable para demo con caché Redis (`cachedQuery`, TTL.SHORT en pending-summary).

---

## 4. Archivos revisados por pilar

### Pilar 1 — Flujos API y contratos de negocio

| Archivo | Hallazgo |
|---|---|
| `backend/routes/pedidos.js` | CRUD pedidos, confirmación, ownership COMERCIAL/JEFE, sanitización por rol (`sanitizeOrderForRole`). State machine delegada a `pedidos.service.js` (`canonicalOrderStatus` / `storedOrderStatus`). **FIX B4/B5** en debug. |
| `backend/services/pedidos.service.js` | `VALID_ORDER_STATES`, mapa `PENDIENTE_APROBACION` ↔ `PEND_APROB` para VARCHAR(12). Confirmación con bolsa, stock, export DSEDAC con approval gate. |
| `backend/routes/cobros.js` | `pendientes`, `estado`, `registrar`, `pending-summary`. CVC como fuente de deuda; resta cobros app-side por documento. Idempotency en registrar. |
| `backend/routes/bolsa.js` | `status`, `movements`, `history`, `config` (solo JEFE). Autorización por vendedor (`authorizeVendorScope`). |
| `backend/services/bolsa-comercial.service.js` | Ledger inmutable, idempotency keys, reglas 300€ under-min, sin escritura DSEDAC. |
| `backend/src/shared/routes/ddd-adapters.js` | Rutas DDD equivalentes con caché por TTL; pending-summary DDD ya usa `NOMBRECLIENTE`. |
| `backend/src/modules/cobros/infrastructure/db2-cobros-repository.js` | Implementación DDD correcta para pending-summary (referencia B6). |

### Pilar 3 — Seguridad (auth, scopes, límites)

| Archivo | Hallazgo |
|---|---|
| `backend/server.js:457` | `app.use('/api', verifyToken)` — auth global en rutas API (incluye cobros legacy). |
| `backend/routes/pedidos.js:52` | `router.use(verifyToken)` adicional en pedidos. |
| `backend/routes/bolsa.js:4,55+` | `verifyToken` + `requireRoles` en config; `bolsaLimiter`. |
| `backend/routes/cobros.js:47–57` | Rate limit 10 POST/min en registrar por IP+usuario. |
| `backend/routes/cobros.js:182–205` | Scope cliente COMERCIAL (`FORBIDDEN_CLIENT_VENDOR`). |
| `backend/routes/cobros.js:718+` | pending-summary: rechaza COMERCIAL+ALL, valida vendor seleccionado vs scope visible. |
| `backend/middleware/security.js` | SQL injection detection, scanners, rate limiters (`pedidosLimiter`, `cobrosLimiter`). |
| `backend/middleware/auth.js` | HMAC tokens; tests en `security-middleware.test.js`, `auth-middleware.test.js`. |
| `backend/routes/pedidos.js:1625` | Debug endpoints bloqueados en producción. |

### Pilar 5 — Rendimiento

| Archivo | Hallazgo |
|---|---|
| `backend/services/query-optimizer.js` | `cachedQuery` con claves por vendor/rol; invalidación cobros tras mutación. |
| `backend/services/redis-cache.js` | TTL.SHORT/MEDIUM; fallback sin Redis. |
| `backend/services/pedidos.service.js` | `getStockBatch` en chunk único; `getOrders` con JOIN agregado líneas (evita N+1 en listado). |
| `backend/src/core/infrastructure/cache/performance-cache.js` | Caché optimizada queries ALL (DDD). |
| `backend/services/cache-preloader.js` | Warmup LACLAE/metadata al arranque. |

### Pilar 7 — Resiliencia y errores

| Archivo | Hallazgo |
|---|---|
| `backend/routes/cobros.js:85–90` | `isColumnNotFound` para degradación si columna ERP falta. |
| `backend/routes/cobros.js:30–40` | Invalidación caché best-effort (no throw). |
| `backend/routes/cobros.js:900` | pending-summary: log + 500 genérico (no filtra stack al cliente). |
| `backend/services/bolsa-comercial.service.js` | Rollback transaccional si falla insert ledger; `confirmOrder` propaga `BOLSA_INSUFICIENTE`. |
| `backend/services/pedidos.service.js` | Rollback cabecera+líneas si falla update totales. |
| `backend/server.js:600–611` | Init pedidos/KPI non-fatal (warn, no abort). |

### Pilar 8 — Infraestructura y routing

| Archivo | Hallazgo |
|---|---|
| `backend/server.js:58–63` | `USE_DDD_ROUTES` default true (`!== 'false'`). |
| `backend/server.js:156–169` | Fallback a legacy si falla carga módulos DDD. |
| `backend/server.js:479–499` | Montaje DDD o legacy para `/api/pedidos` y `/api/cobros` con rate limiters. |
| `backend/server.js:615–628` | Si init pool DDD falla → `USE_DDD_ROUTES='false'` → **legacy cobros activo** (B6 era crítico aquí). |
| `backend/.env.example` | Documenta ODBC, schemas JAVIER/DSEDAC, approval gates. |

### Pilar 9 — Alineación SQL / DB2

| Archivo | Hallazgo |
|---|---|
| `backend/routes/pedidos.js` | **FIX B5** `SERIEPEDIDO`; **FIX B4** estado almacenado ≤12 chars. |
| `backend/routes/cobros.js` | **FIX B6** `NOMBRECLIENTE`; queries CVC con nombres largos verificados (no aliases CV*). |
| `backend/utils/db2-identifiers.js` | Schema/table helpers para inserts parametrizados. |
| `backend/services/dsedac-exports.service.js` | Gate explícito antes de escritura DSEDAC. |

### Pilar 10 — Tests y contratos

| Archivo | Hallazgo |
|---|---|
| `backend/__tests__/pedidos_contracts.test.js` | State machine, ownership, bolsa en confirm, purchase-history scope. |
| `backend/__tests__/cobros-legacy.test.js` | pending-summary scopes, semi-join, app-side subtraction, client scope AppSec. |
| `backend/__tests__/cobros-commercial.test.js` | DDD repository pending-summary (16 tests). |
| `backend/__tests__/bolsa-comercial.service.test.js` | Reglas negocio, idempotency, ledger. |
| `backend/__tests__/ddd_route_contracts.test.js` | Contratos rutas DDD. |
| `backend/__tests__/cobros_route_contracts.test.js` | Contratos rutas cobros. |
| `backend/__tests__/bolsa_route_contracts.test.js` | Single GET movements route. |
| `backend/__tests__/pedidos_stock_route_contracts.test.js` | Stock batch. |
| `backend/__tests__/cache_preloader_contracts.test.js` | Columnas LACLAE reales. |

---

## 5. Bloqueos pendientes (no corregidos en esta sesión)

| ID | Severidad | Descripción |
|---|---|---|
| **B1–B3, B7** | Ver `pilar2-db2.md` §9 | DDL pendiente, defaults additive, índices — fuera de scope backend código (sin DDL). |
| **DDD fallback silencioso** | Medio | Si init DDD falla, server cae a legacy sin alerta al cliente (`server.js:628`). B6 ya no rompe pending-summary legacy; conviene monitorizar `Route Mode: Legacy` en logs de arranque. |
| **Idempotency pedidos offline** | Medio | `syncPendingOrders` sin clave extremo a extremo (anotado en flutter-audit). Requiere cambio API + app. |
| **npm audit** | Bajo | 19 vulnerabilidades reportadas en fase0-2; no abordadas aquí. |
| **Benchmark HTTP local** | Info | No medido — arranque ODBC &gt;90 s en entorno auditoría. Usar producción `192.168.1.230:3335/api/health` para smoke pre-demo. |

---

## 6. Veredicto demo (jefe de ventas)

- **Flujo comercial normal (DDD activo):** pedidos, cobros y bolsa — **OK** (tests + contratos + SQL perf).
- **Endpoints debug:** **OK tras B4/B5** (solo dev/staging).
- **Fallback legacy cobros:** **OK tras B6** si DDD cae en arranque.
- **Recomendación pre-demo:** verificar log `Route Mode: DDD Routes ✅` en PM2; ejecutar smoke `GET /api/cobros/pending-summary/ALL` y `GET /api/bolsa/{code}/status` con token JEFE_VENTAS.
