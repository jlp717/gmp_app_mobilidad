# Presupuestos de latencia API GMP

Estado global: **PENDIENTE_VALIDAR_CON_BASELINE**. Objetivos p95 iniciales; no describen rendimiento medido.

| Endpoint | Tipo | Objetivo p95 | Baseline p95 | Estado | Justificación |
|---|---|---:|---:|---|---|
| `GET /api/rutero/week` | interacción comercial | <500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Resumen al abrir jornada. |
| `GET /api/dashboard/metrics` | interacción comercial/cacheable | <500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | KPIs no deben bloquear navegación. |
| `GET /api/dashboard/sales-evolution` | analítica pesada | <1.500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Agregación histórica. |
| `GET /api/analytics/trends` | analítica pesada | <1.500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Serie histórica y predicción. |
| `GET /api/analytics/top-clients` | analítica pesada | <1.500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Ranking agregado con join. |
| `GET /api/cobros/pending-summary/:vendedorCode` | interacción comercial | <500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Decisión de cobro frente al cliente. |
| `GET /api/pedidos` | interacción comercial | <500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Lista paginada de trabajo. |
| `POST /api/auth/login` | autenticación | <800 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Verificación segura puede costar más que lectura cacheada. |
| `GET /api/analytics/sales-history` | analítica pesada paginada | <1.500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | Filtros variables; normalmente sin caché query. |

## Actualización tras baseline

1. Ejecutar `backend/perf/k6/load-test.js` según README con token y vendedor representativos.
2. Leer `metrics["http_req_duration{endpoint:<ruta>}"]` en `baseline.json` y copiar `values["p(95)"]` a **Baseline p95**.
3. Cambiar estado a `VALIDADO` si cumple y tasa de error es <1%; si no, mantener pendiente y enlazar acción concreta.
4. Repetir mismas variables, duración y servidor para `after.json`; registrar delta porcentual. No relajar objetivo para hacer verde test.
5. Añadir `sales-history` a perfil separado cuando exista caso representativo; no mezclarlo sin peso móvil verificado.
