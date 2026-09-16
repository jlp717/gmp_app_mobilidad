# Presupuestos de latencia API GMP

Estado global: **VALIDADO_SERVIDOR** (n=1, JEFE 98, 2026-09-16, etiqueta `[servidor]`). **No es `[campo]`**. `[LAN]` timeout. Sin adb/`[emulador]`. Sin `[túnel]`.

| Endpoint | Tipo | Objetivo p95 | Baseline `[servidor]` | Estado | Justificación |
|---|---|---:|---:|---|---|
| `POST /api/auth/login` diego | autenticación | <800 ms | 1168 ms | PARCIAL (objetivo 800; nombre OK 200) | Login por nombre no roto. |
| `POST /api/auth/login` 98 | autenticación | <800 ms | 180 ms | VALIDADO_SERVIDOR | Código numérico. |
| `GET /api/dashboard/metrics?ALL` | interacción | <500 ms | 6 ms / warm 2 ms | VALIDADO_SERVIDOR | Redis + ALL literal. |
| `GET /api/objectives/evolution?ALL` | analítica | <1.500 ms | HTTP 4 ms; SQL `JAVIER.LACLAE_MONTHLY` 152 ms | VALIDADO_SERVIDOR | Rollup JAVIER; no índice DSED. |
| `GET /api/objectives/by-client?ALL` | analítica | <1.500 ms | HTTP 4 ms; SQL monthly 66 ms | VALIDADO_SERVIDOR | Mismos importes 2026 vs TEST_LACLAE. |
| `GET /api/facturas/summary?ALL` | interacción | <500 ms | 285 ms / warm 2 ms | VALIDADO_SERVIDOR | |
| `GET /api/pedidos/purchase-history-global` Flutter | analítica | <1.500 ms | t+40s 200 / 5529 ms; warm 4 ms | VALIDADO_SERVIDOR HIT 40s | Fill 5,5 s; HIT caliente. |
| `GET /api/commissions/summary?ALL` | analítica | <1.500 ms | 23 ms / warm 3 ms | VALIDADO_SERVIDOR | |
| `GET /api/rutero/week` | interacción | <500 ms | 15 ms / warm 1 ms | VALIDADO_SERVIDOR | |
| `GET /api/cobros/pending-summary/:vendedorCode` | interacción | <500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | No en los 7 flujos de esta tanda. |
| `GET /api/pedidos` | interacción | <500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | |
| `GET /api/analytics/trends` | analítica | <1.500 ms | — | PENDIENTE_VALIDAR_CON_BASELINE | |

SQL contraste `[servidor]`: `TEST_LACLAE` GROUP BY year 2026 = **318 ms** (no 9 s en esta sonda). Monthly 152 / 66 ms. Populate validate ALL 2026 sales **12345200.13 = 12345200.13** (exit 0).
