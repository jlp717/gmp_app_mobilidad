# Garantías anti-regresión — Demo 2026-06-12

**Objetivo:** convertir hotfixes de demo en red verificable (tests + smoke + trazabilidad código).

---

## 1. Qué falló en demo y por qué

| # | Síntoma demo | Causa raíz | Fix aplicado |
|---|--------------|------------|--------------|
| 1 | **Products 403** — user 98, client `4300001091`, vendor 02 | Scope auth solo miraba `CLI.CODIGOVENDEDOR`; cliente asignado a vendedor 02 vía CLP/LACLAE | `buildClientVendorParamFilter` + retry JEFE con vendor real del cliente (`ddd-adapters.js`, `utils/common.js`) |
| 2 | **Recommendations 500** — ODBC 22001 | Params `clientCode`/`vendedorCode` sin truncar vs `VARCHAR(10)`/`VARCHAR(2)` en SQL | `truncate()` en `getRecommendations` + `CAST(? AS VARCHAR(n))` (`pedidos.service.js:3701-3792`) |
| 3 | **Clients timeout 50–120s** | `LATERAL JOIN` ejecutaba subquery por cada cliente (~2246×) | `ROW_NUMBER() OVER (PARTITION BY LCCDCL)` materializado una vez (`clients.js:116-138`, `ddd-adapters.js:2228-2244`) |
| 4 | **Cobros SQL HY000 -122** | `GROUP BY TRIM(CAST(...))` en `REPARTIDOR_COBROS` incompatible con DB2 prepare | `GROUP BY SERIEDOCUMENTO, NUMERODOCUMENTO` columnas raw (`db2-cobros-repository.js:722-726`) |
| 5 | **pending-summary B7** — ~7,36 M€ sin cliente | CVC global sin filtro vendedor incluía `CODIGOCLIENTEALBARAN` vacío | `emptyClientFilter` cuando `vendorCodes.length === 0` (`db2-cobros-repository.js:515-518`, `cobros.js:774-778`) |
| 6 | **Pedidos offline duplicados** | Replay sin idempotencia en `create` | Tabla `PEDIDO_IDEMPOTENCY` + replay 200 (`pedidos.service.js:2131-2146`, `pedidos_idempotency.test.js`) |

---

## 2. Tests que cubren cada bug

| Bug | Archivo:test |
|-----|--------------|
| Products 403 | `demo-regression-hotfixes.test.js` — *auth SQL checks CLP OR CLI…* + *JEFE_VENTAS retries…*; también `ddd_route_contracts.test.js` |
| Recommendations 22001 | `demo-regression-hotfixes.test.js` — *getRecommendations truncates long client/vendor params* |
| Clients LATERAL | `demo-regression-hotfixes.test.js` — *legacy/DDD clients route uses ROW_NUMBER…* |
| REPARTIDOR_COBROS -122 | `demo-regression-hotfixes.test.js` + `cobros-commercial.test.js` — *getAppSideCobrosByDoc groups REPARTIDOR_COBROS…* |
| pending-summary B7 | `demo-regression-hotfixes.test.js` + `cobros-legacy.test.js` + `cobros-commercial.test.js` |
| Idempotencia pedidos | `demo-regression-hotfixes.test.js` + `pedidos_idempotency.test.js` |

Ejecutar: `cd backend && npx jest`

---

## 3. Trazabilidad E2E (archivo:línea)

### Pedidos: crear → confirmar → estados → cliente/vendedor

| Paso | Ubicación |
|------|-----------|
| POST create (DDD) | `ddd-adapters.js` → `pedidos.service.js:2106` `createOrder` |
| Idempotencia replay | `pedidos.service.js:2131-2146` `resolveIdempotentCreateOrder` |
| Auth cliente/vendedor en rutas | `ddd-adapters.js` `assertClientVendorAccess` / `resolveAuthorizedVendorForClient` |
| PUT confirm | `ddd-adapters.js` → `pedidos.service.js:3022` `confirmOrder` |
| CAS estado BORRADOR→CONFIRMANDO | `pedidos.service.js:3030-3037` |
| Stock + bolsa en confirm | `pedidos.service.js:3145+` `bolsa-comercial.service` |
| PUT status | `ddd-adapters.js:1604` → `updateOrderStatus` |
| GET list/detail | `ddd-adapters.js` + `Db2PedidosRepository` |

### Cobros: pending-summary → cobro → saldo → REPARTIDOR_COBROS

| Paso | Ubicación |
|------|-----------|
| GET pending-summary | `ddd-adapters.js:1895` → `db2-cobros-repository.js` `getPendingSummary` |
| Filtro B7 cliente vacío | `db2-cobros-repository.js:515-518` |
| GET pendientes cliente | `db2-cobros-repository.js` `getPendientes` — CVC + resta app-side |
| POST registrar cobro | `ddd-adapters.js` → `registerPayment` `db2-cobros-repository.js:796+` |
| Cobro parcial/total | `registerPayment` — suma previa por referencia exacta |
| REPARTIDOR_COBROS prepare-safe | `db2-cobros-repository.js:722-726`, `843-851` |
| Impacto saldo UI | Flutter `cobros_provider` → `pending-summary` + `pendientes` |

### Bolsa: status/history/movements → consumo tras pedido → race

| Paso | Ubicación |
|------|-----------|
| GET status | `routes/bolsa.js:60` → `getOrCreateBolsa` `bolsa-comercial.service.js:150` |
| GET history/movements | `routes/bolsa.js:109` → `getHistorialMensual` / `getMovimientos` |
| Consumo en confirm pedido | `pedidos.service.js:3145` → `consumirBolsa` `bolsa-comercial.service.js:186` |
| Acumulación margen | `acumularBolsa` `bolsa-comercial.service.js:156` |
| Race INSERT bolsa | `getOrCreateBolsaWith` `bolsa-comercial.service.js:98-119` (catch 23505/-803) |
| Idempotencia movimientos | `filterPendingBolsaMovements` + `IDEMPOTENCY_KEY` |

### Saldo cliente (`client-balance`)

| Fuente | Query | Archivo |
|--------|-------|---------|
| **Facturado anual** | `DSED.LACLAE` — `LCIMVT` ventas CC/VC, líneas AB/VT | `pedidos.service.js:4266-4276` |
| **Cobrado anual** | `DSEDAC.CVC.IMPORTECANCELADO` por `ANOEMISION` | `pedidos.service.js:4287-4294` |
| **Saldo pendiente** | `max(0, facturado - cobrado)` | `pedidos.service.js:4309-4313` |
| Ruta HTTP | GET `/api/pedidos/client-balance/:clientCode` | `ddd-adapters.js:690-705` |

Deuda operativa (cobros tab) viene de **CVC.IMPORTEPENDIENTE** vía `getPendientes` / `getPendingSummary`, no del mismo cálculo que `client-balance`.

---

## 4. Checklist pre-demo (5 minutos)

```bash
# 1. Tests backend (objetivo: 0 failures)
cd backend && npx jest --testPathPattern="demo-regression|cobros-commercial|cobros-legacy|ddd_route|pedidos_idempotency"

# 2. Smoke DB read-only (requiere ODBC GMP)
cd backend && node scripts/demo-smoke-pedidos-cobros-bolsa.js

# 3. Flutter pedidos/cobros/bolsa
flutter test test/features/pedidos/ test/features/cobros/ test/features/bolsa/

# 4. En servidor post-deploy: health
curl -s -H "User-Agent: GMP-SRE-HealthCheck/1.0" http://192.168.1.230:3335/api/health

# 5. Log arranque: "Route Mode: DDD Routes ✅"
```

Criterios smoke PASS: `clients_list_query` < 5000 ms, `products_client_vendor_scope` PASS, `recommendations_history_query` sin error, `cobros_pending_summary_vendor` PASS, `bolsa_status_read` PASS.

---

## 5. Archivos a desplegar (hotfixes demo)

```
backend/utils/common.js
backend/src/shared/routes/ddd-adapters.js
backend/routes/clients.js
backend/services/pedidos.service.js
backend/src/modules/cobros/infrastructure/db2-cobros-repository.js
backend/routes/cobros.js
backend/services/bolsa-comercial.service.js
backend/__tests__/demo-regression-hotfixes.test.js
backend/scripts/demo-smoke-pedidos-cobros-bolsa.js
```

---

## 6. Veredicto de confianza

| Área | ¿Confiar tras deploy? | Evidencia |
|------|----------------------|-----------|
| **Pedidos** (crear/confirmar/idempotencia) | **SÍ** (código) | Tests `pedidos_idempotency`, `demo-regression`, `pedidos_contracts`; trazabilidad confirm CAS + bolsa |
| **Cobros** (pending-summary, cobrar pedidos/CVC) | **SÍ** (código) | Tests `cobros-commercial`, `cobros-legacy`, `demo-regression`; GROUP BY fix verificado |
| **Bolsa** (status/consumo/race) | **SÍ** (código) | `bolsa-comercial.service.test.js`, `bolsa_route_contracts`; race handler en getOrCreate |
| **Lista clientes** (latencia) | **SÍ** (código) | ROW_NUMBER en legacy + DDD; smoke mide < 5s si DB accesible |
| **Producción en vivo** | **CONDICIONAL** | Smoke HTTP/ODBC desde PC auditoría puede fallar por red; **obligatorio** ejecutar `demo-smoke-pedidos-cobros-bolsa.js` en servidor con DSN GMP antes de demo |

**Veredicto global honesto:** **SÍ en lógica y tests automatizados** — los 6 bugs de demo tienen fix + test dedicado. **NO al 100% en producción** hasta: (1) `git pull` en `192.168.1.230:/opt/gmp-api`, (2) `pm2 restart`, (3) smoke script verde en red servidor, (4) prueba manual user 98 + client `4300001091` en app.

**Evidencia ejecución 2026-06-12:** `npx jest` → **362/362 PASS** (+8 `demo-regression-hotfixes`); `flutter test test/features/pedidos| cobros| bolsa` → **31/31 PASS**.

---

*Generado: 2026-06-12 — suite `demo-regression-hotfixes.test.js` + smoke `backend/scripts/demo-smoke-pedidos-cobros-bolsa.js`*
