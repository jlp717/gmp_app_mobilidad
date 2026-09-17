# Plan — latencia REPARTO + ALMACÉN (2026-09-17)

PLAYBOOK=BUILD — no es rediseño de producto. Comercial (pedidos/objetivos/comisiones) no se toca salvo regresión. UI viva del rutero = `rutero_detail_modal.dart` desde `repartidor_rutero_page.dart`. Prohibido editar `albaran_detail_page.dart`. Intocables: `backend/config/db.js`, `backend/middleware/auth.js`.

Dinero: saldo cobrable = CPC del documento (`resolveDocumentCollectable`); liquidación no se genera sin cobros del periodo; no se cambian importes. LACLAE mensual ya existe — no reabrir objetivos.

Etiquetas de latencia: `[servidor]` localhost:3335 en 230 · `[túnel]` si hay VPN · **prohibido afirmar 100% percibido sin `[campo]`**.

---

## Diagnóstico (código en `test`, 2026-09-17)

El plan 2026-09-14 aceleró el perfil **COMERCIAL** (ALL literal, LACLAE_MONTHLY, facturas). El perfil **REPARTIDOR** — sobre todo **jefe_ventas en modo REPARTO** con selector `ALL` — sigue el camino caro:

1. Flutter (`main_shell.dart`) resuelve `ALL` a `codes.join(',')` (toda la flota, hasta 100 ids).
2. `/entregas/pendientes` siempre hace `FETCH 501` (no honra `limit` en SQL), con `TRIM(OPP.CODIGOREPARTIDOR) IN (...)` + JOINs `TRIM(CLI)`/`TRIM(CAC)`/`TRIM(VDD)`.
3. Sobre esas ~500 filas corre, **antes** de paginar: GPS (resultado **no se usa**), CLX/CLP/CVC-SUM, CVC por documento, LAC de líneas a 0, overlay canónico de confirmaciones.
4. Recién entonces filtra/ordena y corta la página. Flutter pide `limit=500` y además dispara hasta 5 páginas extra en background — también con `ALL`.
5. `/repartidor/rutero/week` es sargable pero **sin caché** (comentario: “siempre fresco”). Calendario de puntos no es dinero.
6. Liquidación: primer GET cacheado + `_kickSoftRefresh` con `forceRefresh: true` al pintar → doble golpe DB2, peor en ALL (cobros en batches de 5 ids, concurrencia 2).
7. Cobros/vencimientos: primera página 100. ALL = flota entera.
8. Almacén: dashboard/artículos/órdenes con `TRIM` en JOIN/WHERE; artículos `defaultLimit=500` (Flutter 200); `TabBarView` construye las 3 pestañas.

`/planner/rutero/day` es rutero **comercial**. Fuera de este workstream.

---

## Backlog priorizado

### P0 — percibido (first paint jefe ALL + raso)

| ID | Hallazgo | Target |
|---|---|---|
| P0-01 | `TRIM` en WHERE/JOIN de `/entregas/pendientes` | `OPP.CODIGOREPARTIDOR IN (?)` + igualdad CLI/CAC/VDD sin TRIM (códigos ya `padStart(2)`) |
| P0-02 | GPS `fetchClientGeo` en pendientes: dead code | Eliminar del listado |
| P0-03 | CVC-documento + overlay canónico **antes** de paginar | Calcularlos solo sobre la página visible; CLX/CLP/CVC-SUM se quedan (filtro `esCTR` / riesgo) |
| P0-04 | First paint pide 500 + 5 páginas extra, también en ALL | Primera página 80; background solo repartidor único |
| P0-05 | Week sin caché | `TTL.SHORT` (60 s) sobre agregados de calendario |
| P0-06 | Liquidación `forceRefresh` al primer frame | No stampede; ALL no revalida en caliente |
| P0-07 | Almacén dashboard TRIM + scan OPP del día | JOINs sargables + `queryWithParams` |
| P0-08 | Artículos espera LAC 7 días DISTINCT FETCH 2000 | No bloquear first paint; caché 5 min; FETCH 400 |

### P1

| ID | Hallazgo | Target |
|---|---|---|
| P1-01 | Artículos almacén default 500/200 | 80 |
| P1-02 | `TabBarView` eager en Expediciones | `LazyIndexedStack` |
| P1-03 | Modal rutero `IndexedStack` monta 3 tabs | `LazyIndexedStack` |
| P1-04 | Cobros primera página 100 en ALL | 40 |
| P1-05 | Truck orders + articles recent: TRIM JOIN LAC | igualdad de claves |
| P1-06 | Lista pendientes: `observaciones`/`firma` | quitar del list payload; el detalle las pide |

### P2 (no este PR salvo tiempo)

| ID | Nota |
|---|---|
| P2-01 | `queryGate` max=4 — no subir sin Javier |
| P2-02 | Fotos/mapas: cacheWidth / diferir mapa |
| P2-03 | Hive índices — ya hay SWR; medir en campo |
| P2-04 | `dayMoveJoin` TRIM del document-id — riesgo semántico |
| P2-05 | Collections ALL 16 olas × CVC — producto ALL; no cambiar importes |

---

## Invariantes

- Vendor `ALL` nunca `WHERE VENDEDOR='ALL'`. Flota = lista de códigos JWT / `repartidorCodes`.
- `RUTERO_CONFIG.ORDEN >= 0` (no aplica a pendientes OPP; sí al planner comercial, intocable aquí).
- SQL siempre `?`.
- Tabs `_getNavItems` + `_buildCurrentPage` sincronizados (no se cambia el mapa de tabs).
- Tests de cobros/liquidación que fallen y no sean de este diff → `BLOCKED` aserción, no “arreglarlos”.

---

## Medición

Antes y después, mismo comando, token JEFE modo REPARTIDOR + un REPARTIDOR isolated_test:

- `GET /repartidor/rutero/week/:id`
- `GET /entregas/pendientes/:id?date=YYYY-MM-DD&limit=80&offset=0`
- `GET /repartidor-finanzas/daily-summary/:id` (o el GET de liquidación real)
- `GET /repartidor-finanzas/vencimientos/:id?limit=40`
- `GET /warehouse/dashboard`

Si LAN/túnel no abre: `[servidor]` via SSH whitelist health + script contra localhost:3335. Gaps de teléfono/firewall = abiertos, no inventados.
