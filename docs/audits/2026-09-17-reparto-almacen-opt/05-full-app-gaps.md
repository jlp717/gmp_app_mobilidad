# Inventario full-app y gaps que siguen (2026-09-17)

Fecha: **2026-09-17**. Playbook BUILD. Un writer. Intocables no tocados (`backend/config/db.js`, `backend/middleware/auth.js`, `albaran_detail_page.dart`). Cero secretos. SHA **test = 230**: `1db8a160d871a6960ff37139ef1d46ea8a0a53f2` (`1db8a16`). Health `/api/ready` 200, `status=ready`, `tableSet=isolated_test`, `queryGate.max=4`, cluster `gmp-api` online.

Ningún número de este informe es **`[campo]`**. `[LAN]` PC → `192.168.1.230:3335` timeout 8 s, **curl exit 28**. Cifras de producto = **`[servidor]`** (localhost:3335 en 230).

No se afirma 100 % percibido.

---

## 1. Inventario por perfil / pantalla

Lo ya verde **no se reabre**: ALL literal (nunca `WHERE VENDEDOR='ALL'`), `LACLAE_MONTHLY`, prewarm comercial JEFE, `flutter analyze` 0 errors, P0/P1 de `00-plan.md` (sargable pendientes, GPS fuera, CVC-doc tras paginar, week cache, liquidación sin stampede, almacén articles).

| Superficie | Estado código | Gap que sigue |
|---|---|---|
| Comercial raso (pedidos, facturas, objetivos, comisiones, historial, rutero planner) | Prewarm inmediato + ALL no aplica | LACLAE frío GROUP BY si Redis vacío. **No medido** pedidos/devoluciones/historial en esta sonda |
| JEFE `COMERCIAL` dashboard/facturas/objetivos | BE-01 literalAll, warmer secuencial | Evolution/by-client **HIT Redis** tras restart (4–128 ms). Frío LACLAE real **no** re-medido (haría falta vaciar Redis; no se toca) |
| JEFE `REPARTO` week | Cache 60 s | Frío 221 ms / 40 s 31 ms / hot 4 ms. Aceptable `[servidor]` |
| JEFE `REPARTO` pendientes ALL | First page SQL `FETCH 81` si no hay filtro | **Frío 2445 ms** (JOIN flota 42). HIT 25–61 ms. Semántica esCTR/CPC intacta |
| JEFE `REPARTO` cobros/liquidación | Página 40; no `forceRefresh` ALL | daily-summary frío 314 ms; vencimientos 455 ms. HIT <150 ms |
| Repartidor raso | Sin prewarm comercial | Pendientes 171 ms; week 41 ms |
| Almacén artículos/dashboard | P0-08 | articles 164 → 1 ms; dashboard 96 → 2 ms |
| queryGate | `db.js:66` max=4 **intocable** | 503 + Retry-After en entregas; warmer comercial ya no lanza 2× LACLAE en paralelo |
| Notificaciones snapshot | `notifications.js:27-34` | Loaders baratos primero; LACLAE/dashboard después. **No medido** tamaño payload |
| Campo / LAN / firewall | — | **BLOCKED** Javier |

Hueco JEFE COMERCIAL vs REPARTO (prewarm): **cerrado en código**. `switch-role` dispara warmer de flota (códigos JWT, nunca `ALL`). Flutter `CachePreWarmer` en JEFE+REPARTO calienta week+pendientes; `switchRole` vuelve a llamar `preWarmAuthenticatedSession`.

---

## 2. P0/P1 que SIGUEN en código (fichero:línea)

### P0 — no cerrados aquí

| ID | Sitio | Qué queda |
|---|---|---|
| P0-CAMPO | — | Baseline móvil. Javier + APK |
| P0-LAN | — | Firewall :3335. curl exit 28 |
| P0-LACLAE | `backend/services/laclae.js` + `backend/routes/objectives.js` | GROUP BY LACLAE en frío >5 s si Redis vacío. Índice/DDL Javier. No reabrir `LACLAE_MONTHLY` |
| P0-GATE | `backend/config/db.js:66` | `queryGate` max=4. No se edita. Warmer ahora **secuencial** |
| P0-PEND-ALL | `backend/routes/entregas.js:553` (`sqlPaged`) + CTE OPP→CPC→CAC ~624 | Ciclo 1: FETCH `pageLimit+1` en ALL sin filtro. **No bajó** el join de 42 ids (~2.4 s). Ciclo 2/3 = índice OPP/CPC o snapshot diario = Javier. **PARA** |

### P1 — abiertos, no P0 de first paint

| ID | Sitio | Nota |
|---|---|---|
| P1-SNAP | `backend/routes/notifications.js:27-34` | Snapshot 10 loaders; prioridad sin LACLAE. Payload no medido |
| P1-WH-500 | `backend/routes/warehouse.js:1201` | `FETCH FIRST 500` en estimación dimensiones (no first paint artículos) |
| P1-OBJ-500 | `backend/repositories/repartidor-route-db2-repository.js:1466` | Objetivos repartidor `FETCH FIRST 500` |
| P1-DAYMOVE | `backend/routes/entregas.js:530-535` | JOIN day-move con `TRIM` (P2 semántico; no tocado) |
| P1-88KB | lista pendientes ALL | 88246 bytes / 80 filas. Igual orden de magnitud que el informe anterior |
| P1-HIST | historial/pedidos/devoluciones JEFE | **No medidos** `[servidor]` esta sesión |

### Hecho esta tanda (código)

| Cambio | Sitio |
|---|---|
| ALL unfiltered: SQL `OFFSET/FETCH` de página, no 501 | `entregas.js:553-680` |
| Filtros/sort/raso: dataset 501 intacto | tests hardening |
| Stampede + 503 Retry-After | `entregas.js` + `sendEntregasUnavailable` |
| Warmer REPARTO con códigos de flota, nunca `ALL` | `jefe-hot-route-warmer.js:71-79` |
| Warmer comercial secuencial (no 2× LACLAE) | `jefe-hot-route-warmer.js:169-174` |
| `switch-role` agenda warmer del modo | `backend/routes/auth.js` (no `middleware/auth.js`) |
| Flutter prewarm JEFE+REPARTO + tras switch | `cache_prewarmer.dart`, `auth_notifier.dart` |

Dinero: `importeDisponibleCobro` sigue `resolveDocumentCollectable` (CPC). Tests de cobro WIP **no** se mezclaron en este commit.

---

## 3. Latencia `[servidor]` JEFE 98

Sonda: `backend/scripts/hit-reparto-almacen-latency.js` en 230 → `127.0.0.1:3335`. PIN VDPL1, nunca impreso. Flota **42**. Redis de proceso vacío tras `pm2 restart`; **Redis compartido no se flushed** (evolution 4 ms = HIT previo, no frío LACLAE).

| Endpoint | Frío ms | 40 s ms | Caliente ms | Bytes |
|---|---:|---:|---:|---:|
| comercial metrics ALL | 89 | 20 | 0 | 547 |
| comercial facturas ALL | 306 | 8 | 2 | 84958 |
| comercial objectives/evolution ALL | **4** (HIT Redis) | 3 | 1 | 1983 |
| comercial objectives/by-client ALL | 128 | 3 | 1 | 7871 |
| reparto week ALL (42) | 221 | 31 | 4 | 652 |
| reparto week 1 | 196 | 4 | 7 | 646 |
| **reparto pendientes ALL limit=80** | **2445** | 61 | 25 | 88246 |
| reparto pendientes 1 | 453 | 53 | 42 | 1439 |
| reparto daily-summary 1 | 314 | 107 | 34 | 1096 |
| reparto vencimientos 1 | 455 | 148 | 44 | 1690 |
| almacén dashboard | 96 | 14 | 2 | 8397 |
| almacén articles limit=80 | 164 | 11 | 1 | 21064 |
| raso 05 week | 41 | 11 | 3 | 646 |
| raso 05 pendientes | 171 | 28 | 35 | 1439 |
| raso 05 daily-summary | 72 | 215 | 33 | 1096 |
| raso 05 vencimientos | 263 | 66 | 32 | 1690 |

Login JEFE 269 ms. Switch COMERCIAL 11 ms / REPARTO 77 ms / ALMACÉN 65 ms.

Pendientes ALL: informe anterior `b8e957f` frío **1988** ms (FETCH 501). Ahora **2445** ms (FETCH 81, clave caché `v5` miss). El cuello es el JOIN flota, no el tope 501. **Ciclo 1/3.** Sin DDL no hay ciclo 2 útil. HIT 25 ms.

---

## 4. BLOCKED reales

| Ítem | Causa | Requiere |
|---|---|---|
| `[campo]` | Sin APK/teléfono en esta sesión | Javier |
| `[LAN]` :3335 | curl exit 28, 8 s | iptables/ufw (sudo, Javier) |
| LACLAE frío | Redis no flushed; DDL índice | Javier |
| queryGate max=4 | `db.js` intocable | Javier si se sube |
| Pendientes ALL ~2.4 s frío | JOIN OPP/CPC/CAC × 42 | Índice/DDL o snapshot diario |

---

## 5. SHA

| Sitio | SHA |
|---|---|
| `origin/test` / `/opt/gmp-api` | `1db8a160d871a6960ff37139ef1d46ea8a0a53f2` |
| Deploy | `git pull origin test && pm2 restart gmp-api` |
| Health | `/api/ready` 200, `queryTime=3ms`, Redis connected |
