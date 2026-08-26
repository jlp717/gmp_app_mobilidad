# Refactor Backend en Capas — Prompt 3 (2026-08-25)

Objetivo: cero logica de negocio ni SQL embebido en controllers; capas testeables.
Alcance migrado en este pase (endpoints nombrados por Javier): `/api/dashboard/metrics`,
`/api/dashboard/sales-evolution`, `/api/rutero/week`, y finanzas de repartidor
(`daily-summary`, `vencimientos`, `commissions/summary`).

## 1. Auditoria de complejidad (herramienta real)

Comando reproducible (ESLint core rule `complexity`, no estimacion visual):

```bash
cd backend
set ESLINT_USE_FLAT_CONFIG=false&& npx eslint -c .eslintrc-complexity.cjs --format json "routes/*.js"
```

Prioridad por maxima complejidad ciclomatica de funcion por fichero (pre-refactor):

| # | Fichero | max cx | Funcion mas compleja | Estado |
|---|---------|--------|----------------------|--------|
| 1 | objectives.js | 106 | anon@1584 | Pendiente (backlog) |
| 2 | repartidor.js | 78 | history/signature@1314 | Pendiente |
| 3 | commissions.js | 60 | calculateVendorData@1239 | Cubierto por DDD adapter (`/api/commissions`) |
| 4 | entregas.js | 53 | pendientes/:id@297 | Pendiente |
| 5 | pedidos.js | 49 | purchase-history-global@2047 | Cubierto por DDD routes |
| 6 | planner.js | 47 | rutero/day@641 | **Migrado /rutero/week**; resto backlog |
| 7 | warehouse.js | 45 | manual-layout@1639 | Pendiente |
| 8 | dashboard.js | 41 | metrics@155 | **Migrados metrics + sales-evolution** |
| 9 | cobros.js | 34 | — | Cubierto por DDD routes |
| ... | repartidor-finanzas.js | 22 | anon@1000 | **Migrados los 3 GET financieros** |

Post-refactor sobre handlers migrados: delegacion de 1 linea (`cx 1`);
logica vive en services aislados (`ruteroSemana.service` max cx 13,
`dashboard.service.getMetrics` cx 37 — densidad de negocio heredada del
handler original, ahora testeable con mocks; split opcional en backlog).

## 2. Arbol resultante

```
backend/src/
  config/index.js            seam unico hacia config/db
  errors/AppError.js         AppError, ValidationError, NotFoundError, DatabaseError, ForbiddenError
  middlewares/errorHandler.js errorHandler (Express) + respondError compartido
  models/response-contracts.js claves canonica de payloads observables
  repositories/dashboard.repository.js   SQL LACLAE/VentasB (solo lectura)
  repositories/rutero.repository.js      OPP+CPC, DELIVERY_STATUS, CDVI fallback
  routes/{dashboard,planner,repartidorFinanzas}.routes.js  factories canonicas (tests/wiring)
  services/dashboard.service.js          getMetrics / getSalesEvolution
  services/ruteroSemana.service.js       obtenerRuteroSemanal (cache→ERP+app→fallback)
  services/repartidorFinanzas.service.js DI sobre financeService canonico
  utils/dashboardScope.js                scoping vendedor (movido verbatim)
  utils/dashboardFilters.js              filtros IN parametrizados (movidos verbatim)
  validators/query.validators.js         coerciones legacy (sin endurecer)
  validators/repartidorFinanzas.validators.js esquemas zod relocados verbatim
backend/tests/               espejo: services/, repositories/, controllers via routes/, middlewares/
```

DI: constructor simple (repository/service/cache/financeService inyectados;
defaults de produccion dentro de controllers). Sin awilix — YAGNI.

## 3. Reglas verificadas

- Ningun service/controller importa `odbc`/`ibm_db`: `findstr /s /n /i "ibm_db odbc" src\services\*.js src\controllers\*.js` => 0 coincidencias.
- Escrituras DB2: ninguna. Todo el acceso nuevo es SELECT contra DSEDAC/DSED/JAVIER (lectura), igual que antes.
- Errores centralizados: `respondError` serializa; stack completo solo en log interno; `DB_CIRCUIT_OPEN|DB_QUERY_QUEUE_TIMEOUT|DB_QUERY_TIMEOUT` => 503; ZodError => 400 con details; typed statusCode respetado.
- Compatibilidad APK: defaults ±180 dias y clamp limit<=100 conservados en `vencimientosQuerySchema`.

## 4. Backlog priorizado (no tocado en este pase)

objectives.js (cx106), repartidor.js (78), entregas.js (53), warehouse.js (45),
resto de planner.js y dashboard.js (matrix-data, recent-sales...).
Misma receta: mover SQL a repositories, caso de uso a service, controller fino.

## 5. Cierre de WARNs de la entrega (2026-08-26)

Todos los WARN registrados en el informe del Prompt 3 quedan resueltos:

1. **Plugin `require-green-tests` v3** (`.opencode/plugins/require-green-tests.ts`):
   la lane Dart usaba `dart test`, estructuralmente incapaz de cargar Flutter
   (`dart:ui`) en Windows -> rojo permanente. Ahora detecta pubspec con
   `sdk: flutter` y ejecuta `flutter test`; si falta toolchain hace SKIP con
   aviso (WARN no bloqueante). Nota: el runtime carga plugins al arranque;
   requiere reinicio de OpenCode para que la v3 tome efecto.
2. **Schemas duplicados finanzas**: TODOS los esquemas zod y helpers de selector
   viven ahora en `src/validators/repartidorFinanzas.validators.js` (fuente unica,
   29 exports). El route file importa; bloque local eliminado (-203 lineas).
   Suite repartidor-finanzas: 61 tests verdes.
3. **Split `DashboardService.getMetrics` (cx37)**: descompuesto en
   `_resolvePeriod/_fetchPeriodAggregates/_computeTodaySales/_normalizeAggregates/
   _enrichWithBSales/_buildMetricsPayload/_fetchWeeklyEvolution/_fetchMonthlyEvolution`.
   Maximo ciclomatico resultante: cx12 (`_buildMetricsPayload`, calculo puro).
4. **`getBSalesByVendor` fuera de utils/common**: SQL + cache acotada viven en
   `src/repositories/bSales.repository.js` (`BSalesRepository`,
   query/cache inyectables). `utils/common` queda como delegador delgado
   (`getBSalesByVendor` y `getBSales`) para consumers legacy (objectives,
   commissions); helpers puros ahora exportados.

Regresion final: `npm run test:ci` => **143 passed / 7 suites** (identico a pre-cambios).

## 6. Comando de auditoria de complejidad (reproducible)

```bash
cd backend
$env:ESLINT_USE_FLAT_CONFIG='false'
npx eslint -c .eslintrc-complexity.cjs --format json "routes/*.js"
```
(El fichero `.eslintrc-complexity.cjs` se regenera on-demand; contenido en git history.)
