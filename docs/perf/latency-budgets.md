# Presupuestos de latencia API GMP

Estado global 2026-09-17 08:00: **VALIDADO_SERVIDOR + VALIDADO_TUNEL + VALIDADO_EMULADOR**. Cloudflare **sí responde**. **No es `[campo]`**. No afirmar 100% percibido.

Etiquetas: `[servidor]` = localhost:3335 en 192.168.1.230. `[túnel]` = SSH `-L` PC→230:3335. `[emulador]` = Pixel 5 API 35 (wall UI). `[LAN]` = curl PC→192.168.1.230:3335. `[campo]` = teléfono físico de Javier.

SHA previo `c046c69` en 230 = `origin/test` (antes de este fix de `/api/ready`). LACLAE_MONTHLY JAVIER DONE. APK **52.653.774 bytes**. `[LAN]` timeout 8 s exit 28 (3335 LISTEN 0.0.0.0; iptables/ufw **sudo password** → BLOCKED). Cloudflare `api.mari-pepa.com`: vivo (login 401 INVALID_CREDENTIALS con PIN dummy + UA `GMP-App`; `/api/app/version` 200). `/api/ready` público era 403 `METRICS_FORBIDDEN` (gate de métricas + `CF-Connecting-IP`); parche: liveness público sin pool/PIN.

APK release arm64: `flutter build apk --release --target-platform android-arm64` **exit 0**, `build/app/outputs/flutter-apk/app-release.apk` **52.653.774 bytes** (50,2 MB Flutter).

| Endpoint | Tipo | Objetivo p95 | `[servidor]` | `[túnel]` | Estado | Justificación |
|---|---|---:|---:|---:|---|---|
| `POST /api/auth/login` diego | autenticación | <800 ms | 1168 ms | **1395 ms** 200 user=98 | PARCIAL (objetivo 800; nombre OK) | Login por nombre no roto. |
| `POST /api/auth/login` 98 | autenticación | <800 ms | 180 ms | **378 ms** 200 | VALIDADO_SERVIDOR / TUNEL | Código numérico. |
| `GET /api/dashboard/metrics?ALL` | interacción | <500 ms | 6 ms / warm 2 ms | **132 ms** HIT | VALIDADO | Redis + ALL literal. |
| `GET /api/objectives/evolution?ALL` | analítica | <1.500 ms | HTTP 4 ms; SQL monthly 152 ms | **132 ms** | VALIDADO | `JAVIER.LACLAE_MONTHLY`; no índice DSED. |
| `GET /api/objectives/by-client?ALL` | analítica | <1.500 ms | HTTP 4 ms; SQL monthly 66 ms | **281 ms** | VALIDADO | Mismos importes 2026 vs TEST_LACLAE. |
| `GET /api/facturas/summary?ALL` | interacción | <500 ms | 285 ms / warm 2 ms | **132 ms** | VALIDADO | |
| `GET /api/pedidos/purchase-history-global` | analítica | <1.500 ms | t+40s 200 / 5529 ms; warm 4 ms | **306 ms HIT redis**; warm 302 ms | VALIDADO HIT | Fill frío `[servidor]` 5,5 s; túnel ya caliente. |
| `GET /api/commissions/summary?ALL` | analítica | <1.500 ms | 23 ms / warm 3 ms | **476 ms** | VALIDADO | |
| `GET /api/rutero/week` | interacción | <500 ms | 15 ms / warm 1 ms | **156 ms** | VALIDADO | |
| `GET /api/comercial-liquidacion/resumen-diario` | interacción | <500 ms | — | **152 ms** 200 | VALIDADO_TUNEL | Lectura; sin POST guardar. |
| `GET /api/cobros/pending-summary/:vendedorCode` | interacción | <500 ms | — | — | PENDIENTE_VALIDAR_CON_BASELINE | No en los 7 flujos. |
| `GET /api/pedidos` | interacción | <500 ms | — | — | PENDIENTE_VALIDAR_CON_BASELINE | |
| `GET /api/analytics/trends` | analítica | <1.500 ms | — | — | PENDIENTE_VALIDAR_CON_BASELINE | |

SQL contraste `[servidor]`: `TEST_LACLAE` GROUP BY year 2026 = **318 ms**. Monthly 152 / 66 ms. Populate validate ALL 2026 sales **12345200.13 = 12345200.13** (exit 0).

## `[emulador]` wall UI (Pixel 5, fail=0)

Tiempos de navegación + dump uiautomator, **no** latencia HTTP. App 4.1.28+84 DESARROLLO → `10.0.2.2:3335` vía el mismo SSH `-L 3335`.

| Flujo | Wall | Evidencia UI |
|---|---:|---|
| login diego | 18074 ms | KPIs del periodo / Actividad comercial |
| dashboard jefe | 3501 ms | Panel; 805.017,98 € |
| objetivos | 10102 ms | 12.527.802 € de 13.201.647 € |
| facturas | 14699 ms | Facturas y albaranes; totales € |
| historial | 14834 ms | Pedidos pestaña 2/4 |
| rutero | 8712 ms | Rutero Comercial; paradas + € 2026/2025 |
| liquidación | 12077 ms | Liquidación diaria; 29.002,97 € |

## Huecos que siguen abiertos

- `[campo]`: **IMPOSIBLE** sin el teléfono de Javier.
- `[LAN]` directo a `:3335`: timeout 8 s exit 28. Puerto en LISTEN 0.0.0.0; cambiar firewall exige sudo de Javier.
- p95 percibido en dispositivo real: no medido.
- curl sin UA / UA `curl/x`: 403 Forbidden (lista de agentes; la app usa `GMP-App`/`Dart`).
