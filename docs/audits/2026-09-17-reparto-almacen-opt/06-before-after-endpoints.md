# Antes vs ahora — cada endpoint (2026-09-17 22:07)

Playbook BUILD. Un writer. Intocables no tocados. Cero secretos. Redis **no se flushed** (flush agresivo: vaciaría LACLAE/HIT y reabriría 12–20 s). Cifras **AHORA** = sonda `backend/scripts/hit-reparto-almacen-latency.js` timeout 60 s. JEFE 98 + login nombre `diego` + raso `05` isolated_test. Flota 42. `tableSet=isolated_test`. `queryGate.max=4`.

**LAN: NO.** PC → `192.168.1.230:3335/api/ready` UA `GMP-SRE-HealthCheck/1.0`: timeout **12098 ms**.

**Túnel: SÍ.** SSH `-N -L 18080:127.0.0.1:3335` → `127.0.0.1:18080/api/ready` **200** en **277–301 ms**.

**SHA 230** `/opt/gmp-api`: `5f030da7695cfdd449d065dea7167023e6b33a9e` (`5f030da`). Deploy: `git pull origin test && pm2 restart gmp-api`. Cluster `gmp-api` online. **No** `pm2 save`.

Ningún número es **`[campo]`**. No se afirma 100 % percibido.

Etiquetas: `[servidor]` = localhost:3335 en 230. `[túnel]` = PC vía 18080. `[LAN]` = fallo. Antes = saga ya medida (`latency-budgets.md`, `04-execution-report`, `05-full-app-gaps`, 09-14).

Δ% = `(ahora − antes) / antes`. Negativo = más rápido.

---

## 1. Los 7 flujos comerciales (suma + p95)

Antes frío canónico `[servidor]`: metrics **3690** + evolution **12205** + by-client **19526** + facturas lista **570** + purchase-history fill **5529** + commissions **14591** + planner week **15**.

| Agregado | Antes | Ahora | Δ% |
|---|---:|---:|---:|
| TOTAL 7 flujos (suma) | **56126 ms** `[servidor]` frío | **71 ms** `[servidor]` 40 s | **−99,87 %** |
| TOTAL 7 flujos (suma) | 56126 ms `[servidor]` frío | **2567 ms** `[servidor]` 1.ª ola (Redis no flushed) | **−95,43 %** |
| TOTAL 7 flujos (suma) | 56126 ms `[servidor]` frío | **1883 ms** `[túnel]` 40 s (payload + RTT ~130 ms) | **−96,65 %** |
| p95 de los 7 | **19526 ms** `[servidor]` (by-client) | **20 ms** `[servidor]` 40 s (metrics) | **−99,90 %** |
| p95 de los 7 | 19526 ms `[servidor]` | **488 ms** `[túnel]` 40 s (commissions 211 KB) | **−97,50 %** |

Antes túnel HIT (09-14, Redis ya caliente): 132+132+281+132+306+476+156 = **1615 ms**. Ahora túnel 40 s **1883 ms** = mismo orden (transferencia, no SQL).

---

## 2. Tabla por endpoint

`Ahora frío` `[servidor]` = primera GET tras `pm2 restart` **sin** flush Redis. Evolution 4 ms = HIT L2, **no** LACLAE GROUP BY. `Ahora 40s` = 40 s post-login/switch. `Ahora hot` = inmediata siguiente.

| Endpoint | Antes | Ahora frío | Ahora 40 s | Ahora caliente | Δ% (40 s vs antes) |
|---|---|---:|---:|---:|---:|
| `POST /auth/login` diego | 1168 ms `[servidor]` / 1395 `[túnel]` | 913 `[servidor]` / 997 `[túnel]` | — | — | **−21,8 %** vs 1168 |
| `POST /auth/login` 98 | 180 `[servidor]` / 378 `[túnel]` | 248 `[servidor]` / 316 `[túnel]` | — | — | **+37,8 %** vs 180 (sigue <800) |
| `GET /dashboard/metrics?ALL` | 3690 → 2176 frío; HIT 6 `[servidor]` / 132 `[túnel]` | 5 / 142 | 20 / 264 | 1 / 135 | **−99,46 %** vs 3690 |
| `GET /objectives/evolution?ALL` | **12205 → 16586** frío; HIT 4 `[servidor]` / 132 `[túnel]` | 4 / 138 | 7 / 142 | 3 / 136 | **−99,94 %** vs 12205 |
| `GET /objectives/by-client?ALL` | **19526 → 7701** frío; HIT 6 `[servidor]` / 281 `[túnel]` | 32 / 142 | 4 / 206 | 3 / 136 | **−99,98 %** vs 19526 |
| `GET /facturas?ALL` | 309–570 `[servidor]` (join JWT 1–4 s en mensajes) | 39 / 254 | 6 / 321 | 4 / 257 | **−98,95 %** vs 570 |
| `GET /facturas/summary?ALL` | 285–380 `[servidor]` / 132 `[túnel]` | 373 / 147 | 2 / 137 | 3 / 141 | **−99,47 %** vs 380 |
| `GET /commissions/summary?ALL` | **14591** frío; HIT 6 `[servidor]` / 476 `[túnel]` | 1652 / 488 | 15 / 488 | 6 / 481 | **−99,90 %** vs 14591 |
| `GET /pedidos/purchase-history-global` ALL limit=300 | **5529** fill; HIT 4 `[servidor]` / 306 `[túnel]` | 811 / 320 | 7 / 318 | 3 / 317 | **−99,87 %** vs 5529 |
| `GET /clients/list?ALL` | — (no medido saga) | 34 / 138 | 3 / 137 | 2 / 138 | n/a |
| `GET /dashboard/matrix-data?ALL` | — | 21 / 141 | 5 / 145 | 2 / 140 | n/a |
| `GET /notifications/snapshot` | — | 2278 / 258 | 3 / 414 | 3 / 247 | n/a (1.ª medida 2278) |
| `GET /rutero/week?ALL` | 15 `[servidor]` / 156 `[túnel]` | 24 / 132 | 12 / 144 | 0 / 135 | **−20,0 %** vs 15 (HIT) |
| `GET /rutero/day/:weekday?ALL` | — | 915 / 545 | 11 / 626 | 4 / 553 | n/a (247 KB) |
| `GET /entregas/pendientes` ALL flota limit=80 | **1988 → 2445** `[servidor]` | **2303** / 1197 | **104** / 618 | 36 / 373 | **−95,74 %** vs 2445 |
| `GET /entregas/pendientes` 1 código | 269–453 `[servidor]` | 316 / 180 | 108 / 715 | 46 / 194 | **−76,2 %** vs 453 |
| `GET /repartidor/rutero/week` ALL | 79–221 `[servidor]` | 15 / 222 | 19 / 150 | 10 / 140 | **−91,4 %** vs 221 |
| `GET /repartidor/rutero/week` 1 | 53–196 `[servidor]` | 49 / 144 | 3 / 183 | 4 / 137 | **−98,5 %** vs 196 |
| `GET /repartidor-finanzas/daily-summary` 1 | 314–461 `[servidor]` | 256 / 163 | 294 / 195 | 30 / 345 | **−36,2 %** vs 461 (40 s aún SQL) |
| `GET /repartidor-finanzas/vencimientos` 1 | 298–455 `[servidor]` | 168 / 217 | 489 / 399 | 28 / 182 | **+7,5 %** vs 455 (40 s miss) |
| `GET /warehouse/dashboard` | 5–96 `[servidor]` | 115 / 138 | 10 / 339 | 1 / 142 | **−89,6 %** vs 96 |
| `GET /warehouse/articles?limit=80` | **4223 → 158** `[servidor]` | 158 / 142 | 4 / 248 | 1 / 147 | **−99,91 %** vs 4223 |
| raso 05 week | 7–41 `[servidor]` | 47 / 143 | 23 / 268 | 5 / 135 | vs 41 **−43,9 %** |
| raso 05 pendientes | 77–171 `[servidor]` | 177 / 204 | 56 / 172 | 61 / 156 | **−67,3 %** vs 171 |
| raso 05 daily-summary | 72–936 `[servidor]` | 70 / 215 | 91 / 161 | 36 / 157 | **−90,3 %** vs 936 |
| raso 05 vencimientos | 179–263 `[servidor]` | 181 / 406 | 178 / 214 | 60 / 153 | **−32,3 %** vs 263 |
| `GET /api/ready` | `[LAN]` exit 28 | `[LAN]` timeout 12098 | — | `[túnel]` 277–301; `[servidor]` 36 | LAN **BLOCKED** |

Celdas `frío/40s/hot` con un solo número son `[servidor]`. Donde hay `a / b`, **a = `[servidor]`**, **b = `[túnel]`**.

---

## 3. Totales por perfil (suma de la sonda)

| Bloque | Antes (frío saga, donde había cifra) | Ahora frío `[servidor]` | Ahora 40 s `[servidor]` | Δ% 40 s vs antes |
|---|---:|---:|---:|---:|
| 7 flujos comercial | 56126 | 2567 | **71** | **−99,87 %** |
| Comercial lista completa (12 GET) | — | 6188 | **95** | n/a (antes incompleto) |
| REPARTO JEFE (6 GET) | 2445+453+221+196+461+455 = **4229** | 3107 | **1017** | **−75,95 %** |
| ALMACÉN (2 GET) | 96+4223 = **4319** | 273 | **14** | **−99,68 %** |
| Raso 05 (4 GET) | 41+171+936+263 = **1411** | 475 | **348** | **−75,34 %** |
| **TOTAL 7+REPARTO6+ALMACÉN2** | **64674** | 5947 | **1102** | **−98,30 %** |

REPARTO 40 s **1017 ms** no es todo HIT: `daily-summary` 294 y `vencimientos` 489 no están en el warmer (solo pendientes+week). Pendientes ALL 40 s **104 ms** `[servidor]` (HIT). First-open pendientes ALL **2303 ms** `[servidor]` (JOIN flota 42; sin DDL).

---

## 4. Qué se hizo esta tanda

- LAN timeout → medida `[túnel]` + `[servidor]`.
- Warmer JEFE REPARTO: **pendientes ALL primero**, luego week. Flutter `CachePreWarmer` igual.
- No flush Redis. No `db.js`. No DDL.
- First-open pendientes: el token COMERCIAL sigue 403 (`activeMode !== REPARTIDOR`). El fill arranca en `switch-role`. A 40 s es HIT. El primer GET inmediato sigue ~2,3 s.

---

## 5. BLOCKED

| Ítem | Hecho medido | Requiere |
|---|---|---|
| `[LAN]` :3335 | timeout 12 s | iptables/ufw sudo Javier |
| `[campo]` | 0 muestras | teléfono + APK Javier |
| LACLAE GROUP BY frío | no re-medido (Redis L2 vivo) | flush explícito o índice DSED Javier |
| Pendientes ALL first-open ~2303 ms | JOIN OPP/CPC/CAC × 42 | índice/DDL o snapshot; ciclo SQL **STOP** |
| queryGate max=4 | intocable `db.js` | Javier |
| 100 % percibido móvil | no medido | `[campo]` |

Health `/api/ready` 200, Redis connected, `queryTime` 2–6 ms, SHA `5f030da`.
