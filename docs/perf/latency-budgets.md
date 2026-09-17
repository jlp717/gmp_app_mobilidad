# Presupuestos de latencia API GMP

Estado global 2026-09-17 22:07: **VALIDADO_SERVIDOR + VALIDADO_TUNEL**. `[LAN]` **NO** (timeout 12 s). `[campo]` **NO**. Cloudflare **sí responde**. No afirmar 100% percibido.

Remida completa (cada endpoint, antes vs ahora): `docs/audits/2026-09-17-reparto-almacen-opt/06-before-after-endpoints.md`. SHA 230 = `5f030da`. 7 flujos: **56126 ms** `[servidor]` frío canónico → **71 ms** `[servidor]` 40 s (**−99,87 %**). Pendientes ALL first-open **2303 ms** `[servidor]` / HIT 40 s **104 ms**. Articles **4223 → 4 ms** 40 s.

Estado 08:00 (histórico): VALIDADO_EMULADOR wall UI. El bloque de abajo conserva esa tanda.

Etiquetas: `[servidor]` = localhost:3335 en 192.168.1.230. `[túnel]` = SSH `-L` PC→230:3335. `[emulador]` = Pixel 5 API 35 (wall UI). `[LAN]` = curl PC→192.168.1.230:3335. `[campo]` = teléfono físico de Javier.

SHA previo `c046c69` en 230 = `origin/test` (antes de este fix de `/api/ready`). LACLAE_MONTHLY JAVIER DONE. APK **52.653.774 bytes**. `[LAN]` timeout 8 s exit 28 (3335 LISTEN 0.0.0.0; iptables/ufw **sudo password** → BLOCKED). Cloudflare `api.mari-pepa.com`: vivo (login 401 INVALID_CREDENTIALS con PIN dummy + UA `GMP-App`; `/api/app/version` 200). `/api/ready` público era 403 `METRICS_FORBIDDEN` (gate de métricas + `CF-Connecting-IP`); parche: liveness público sin pool/PIN.

APK release arm64: `flutter build apk --release --target-platform android-arm64` **exit 0**, `build/app/outputs/flutter-apk/app-release.apk` **52.653.774 bytes** (50,2 MB Flutter).

| Endpoint | Tipo | Objetivo p95 | `[servidor]` 22:07 | `[túnel]` 22:07 | Estado | Justificación |
|---|---|---:|---:|---:|---|---|
| `POST /api/auth/login` diego | autenticación | <800 ms | 913 ms | 997 ms | PARCIAL (objetivo 800; nombre OK) | Antes 1168 / 1395. |
| `POST /api/auth/login` 98 | autenticación | <800 ms | 248 ms | 316 ms | VALIDADO | Antes 180 / 378. |
| `GET /api/dashboard/metrics?ALL` | interacción | <500 ms | 5 / 40s 20 / hot 1 | 142 / 264 / 135 | VALIDADO | Antes frío 3690. |
| `GET /api/objectives/evolution?ALL` | analítica | <1.500 ms | 4 / 7 / 3 (HIT Redis; no LACLAE frío) | 138 / 142 / 136 | VALIDADO HIT | Antes frío 12205–16586. |
| `GET /api/objectives/by-client?ALL` | analítica | <1.500 ms | 32 / 4 / 3 | 142 / 206 / 136 | VALIDADO HIT | Antes frío 19526. |
| `GET /api/facturas?ALL` | interacción | <500 ms | 39 / 6 / 4 | 254 / 321 / 257 | VALIDADO | Antes 309–570; JWT-IN 1–4 s. |
| `GET /api/facturas/summary?ALL` | interacción | <500 ms | 373 / 2 / 3 | 147 / 137 / 141 | VALIDADO | Antes 285–380. |
| `GET /api/pedidos/purchase-history-global` | analítica | <1.500 ms | 811 / 7 / 3 | 320 / 318 / 317 | VALIDADO HIT | Antes fill 5529. |
| `GET /api/commissions/summary?ALL` | analítica | <1.500 ms | 1652 / 15 / 6 | 488 / 488 / 481 | VALIDADO HIT 40s | Antes frío 14591. |
| `GET /api/clients/list?ALL` | interacción | <500 ms | 34 / 3 / 2 | 138 / 137 / 138 | VALIDADO | Primera medida saga. |
| `GET /api/dashboard/matrix-data?ALL` | analítica | <1.500 ms | 21 / 5 / 2 | 141 / 145 / 140 | VALIDADO | Primera medida saga. |
| `GET /api/notifications/snapshot` | interacción | <500 ms | 2278 / 3 / 3 | 258 / 414 / 247 | PARCIAL frío | 10 loaders; 40 s HIT. |
| `GET /api/rutero/week` | interacción | <500 ms | 24 / 12 / 0 | 132 / 144 / 135 | VALIDADO | Antes 15 / 156. |
| `GET /api/rutero/day/:day` | interacción | <500 ms | 915 / 11 / 4 | 545 / 626 / 553 | PARCIAL payload 247 KB | Primera medida. |
| `GET /api/entregas/pendientes` ALL | interacción | <500 ms | **2303** / **104** / 36 | 1197 / 618 / 373 | PARCIAL first-open | JOIN ×42; HIT 40 s. |
| `GET /api/warehouse/articles` | interacción | <500 ms | 158 / 4 / 1 | 142 / 248 / 147 | VALIDADO | Antes 4223. |
| `GET /api/comercial-liquidacion/resumen-diario` | interacción | <500 ms | — | **152 ms** 200 (08:00) | VALIDADO_TUNEL | Lectura; sin POST guardar. |
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
- `[LAN]` directo a `:3335`: timeout 12 s (22:03). Puerto en LISTEN 0.0.0.0; iptables/ufw exige sudo de Javier.
- `[túnel]` SÍ: SSH `-L 18080:127.0.0.1:3335`, `/api/ready` 200 en 277–301 ms.
- Pendientes ALL first-open ~2303 ms `[servidor]`; 40 s HIT 104 ms. Sin DDL no baja el JOIN.
- LACLAE GROUP BY frío: no re-medido (Redis no flushed).
- p95 percibido en dispositivo real: no medido.
- curl sin UA / UA `curl/x`: 403 Forbidden (lista de agentes; la app usa `GMP-App`/`Dart`).
