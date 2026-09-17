# Executor tasks — 2026-09-17 REPARTO + ALMACÉN

Spec viva: `00-plan.md`. Un solo writer. Rollback = revert del commit en `test` (no `pm2 save` / no DDL).

## P0

| ID | Fichero:línea (pre-diff) | Cambio | Aceptación | Rollback |
|---|---|---|---|---|
| P0-01 | `backend/routes/entregas.js:588-586` JOIN/WHERE TRIM | `OPP.CODIGOREPARTIDOR IN (?)`; CLI/CAC/VDD sin TRIM en JOIN | Jest: SQL no contiene `TRIM(OPP.CODIGOREPARTIDOR)`; params siguen `?` | revert hunk |
| P0-02 | `backend/routes/entregas.js:724-736` | Borrar GPS no usado | grep `geoByClient` = 0 en pendientes | revert hunk |
| P0-03 | `backend/routes/entregas.js:769-1042` + paginación `1123+` | CVC-documento + overlay canónico **después** de `slice` de página | Contrato: 501 dataset cacheado; página enriquecida; `importeDisponibleCobro` sigue CPC/CVC del documento | revert hunk; tests cobros no se “arreglan” |
| P0-04 | `lib/features/entregas/providers/entregas_provider.dart:976` · `repartidor_rutero_page.dart:191-206` | limit 80; background pages solo si id único | analyze rutas tocadas; no pide 500 en first paint | revert hunk |
| P0-05 | `backend/repositories/repartidor-route-db2-repository.js:1907-1955` | `runCached` TTL.SHORT week | test sargable sigue verde; cache key incluye ids+rango | revert hunk |
| P0-06 | `lib/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart:69-88` | no `forceRefresh` inmediato; skip ALL (comma) | primer frame 1 GET | revert hunk |
| P0-07 | `backend/routes/warehouse.js:309-336` | JOINs sargables + `queryWithParams` | SQL sin TRIM en JOIN/WHERE vehículo | revert hunk |

## P1

| ID | Fichero:línea | Cambio | Aceptación | Rollback |
|---|---|---|---|---|
| P1-01 | `warehouse.js:839` · `warehouse_data_service.dart:713` | default 80 | no fetch 500 al abrir Artículos | revert |
| P1-02 | `lib/features/warehouse/presentation/widgets/orders_panel_v2.dart:185` | `LazyIndexedStack` | 1 tab montada al abrir | revert |
| P1-03 | `rutero_detail_modal.dart:852` | `LazyIndexedStack` | pago/fotos no se construyen en tab productos | revert |
| P1-04 | `vencimientos_page.dart:313` | `_pageSize = 40` | primera página 40 | revert |
| P1-05 | `warehouse.js:887-890, 1264-1275` | JOIN LAC/ART/CLI/VEH sin TRIM | `?` binds | revert |
| P1-06 | `entregas.js:1018-1019` | no mandar firma/obs en lista | detalle sigue trayéndolas | revert |

## Verificación

- `node` jest: `entregas-contract-hardening`, `repartidor-route-week-sargable`, warehouse si hay.
- `flutter analyze` de rutas tocadas (si cuelga → kill + chequeo de fuente).
- Sonda `[servidor]`: script `backend/scripts/hit-reparto-almacen-latency.js` (PIN solo env, nunca impreso).
- Deploy 230: `git pull origin test && pm2 restart gmp-api`. Health: `curl -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/ready`.
- Informe: `04-execution-report.md` + SHA test=230.
