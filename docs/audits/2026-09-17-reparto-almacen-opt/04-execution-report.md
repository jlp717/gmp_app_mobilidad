# Informe de ejecución — REPARTO + ALMACÉN 2026-09-17

Fecha: **2026-09-17**. Playbook BUILD. Comercial no tocado. Intocables no tocados (`backend/config/db.js`, `backend/middleware/auth.js`, `albaran_detail_page.dart`). Cero secretos.

Plan: `00-plan.md` · tareas: `01-executor-tasks.md`.

SHA **test = 230**: `b8e957f2b71042c9aec010261de100b10c60795e` (`b8e957f`). Health `/api/ready` 200, `status=ready`, `tableSet=isolated_test`, cluster `gmp-api` online. Deploy whitelist: `git pull origin test && pm2 restart gmp-api`.

## 1. Código en `test`

| ID | Estado | Notas |
|---|---|---|
| P0-01 | DONE | `/entregas/pendientes` sargable: `OPP.CODIGOREPARTIDOR IN (?)`, JOINs CLI/CAC/VDD sin TRIM |
| P0-02 | DONE | GPS dead code eliminado del listado |
| P0-03 | DONE | CVC-documento + overlay canónico **después** de paginar. CLX/CLP/CVC-SUM siguen para `esCTR`/riesgo. Saldo cobrable sigue `resolveDocumentCollectable` (CPC cap). |
| P0-04 | DONE | First paint `limit=80`; background pages solo id único (no ALL) |
| P0-05 | DONE | `/rutero/week` cache 60 s |
| P0-06 | DONE | Liquidación: no `forceRefresh` inmediato en ALL; delay 12 s en raso |
| P0-07 | DONE | Dashboard almacén JOINs sargables |
| P0-08 | DONE | `/warehouse/articles` no espera LAC 7 días; caché 5 min; FETCH 400; catálogo ART en paralelo |
| P1-01 | DONE | Artículos default 80 |
| P1-02 | DONE | Expediciones `LazyIndexedStack` |
| P1-03 | DONE | Modal rutero `LazyIndexedStack` |
| P1-04 | DONE | Cobros primera página 40 |
| P1-05 | DONE | Truck orders / LAC JOIN sin TRIM |
| P1-06 | DONE | Lista pendientes sin `observaciones`/`firma` |
| P2-* | abierto | queryGate, fotos/mapas, Hive campo, dayMove TRIM |

Jest `[lab]`: `entregas-contract-hardening` 16/16 · `entregas-bola-security` PASS · `repartidor-route-week-sargable` PASS. Exit 0.

No se reabrió LACLAE. No se editó workstream comercial. No se cambiaron importes CPC/liquidación.

## 2. Latencia `[servidor]`

Sonda: `backend/scripts/hit-reparto-almacen-latency.js` en 230 contra `127.0.0.1:3335`. PIN VDPL1, nunca impreso. JEFE `98` → `switch-role` `activeMode=REPARTIDOR` (flota 42). Raso: código `05` login COMERCIAL + switch `REPARTIDOR` (isolated_test).

Sin baseline HTTP previo al primer deploy (`f2309bb` → `e591161`) en esta sesión. Cifras **antes** de P0-08 (SHA `e591161`, Redis aún caliente salvo articles): articles **4223 ms**. Tras P0-08 (`b8e957f`, restart): articles **158 ms**.

### Post-restart `b8e957f` (Redis de proceso vacío; Redis compartido puede HIT dashboard)

| Endpoint | Frío ms | Caliente ms | Bytes | Filas |
|---|---:|---:|---:|---:|
| jefe week ALL (42 ids) | 79 | 2 | 652 | 7 |
| jefe week 1 | 53 | 5 | 646 | 7 |
| jefe pendientes ALL `limit=80` | **1988** | 5 | 88211 | 80 |
| jefe pendientes 1 | 269 | 5 | 1439 | 1 |
| jefe daily-summary 1 | 461 | 2 | 1096 | 0 |
| jefe vencimientos `limit=40` | 298 | 2 | 1690 | 3 |
| warehouse dashboard | 5 | 2 | 8397 | — |
| warehouse articles `limit=80` | **158** | 1 | 21064 | — |
| raso 05 week | 7 | 1 | 646 | 7 |
| raso 05 pendientes | 77 | 3 | 1439 | 1 |
| raso 05 daily-summary | 936 | 3 | 1096 | 0 |
| raso 05 vencimientos | 179 | 1 | 1690 | 3 |

Segunda pasada (caché de dataset): pendientes ALL 128/6 ms; week ALL 6/1 ms; articles 157/3 ms; raso daily-summary 36/3 ms.

Lista pendientes ALL: **88 KB** (histórico de plan ~294 KB). Warm HTTP ~1–6 ms.

`[LAN]` PC → `192.168.1.230:3335/api/ready`: timeout 8 s, **exit 28** (firewall). `[túnel]` no medido (mismo bloqueo LAN; SSH local ya es `[servidor]`). **Ningún número es `[campo]`.**

## 3. SHA

| Sitio | SHA |
|---|---|
| `origin/test` / 230 `/opt/gmp-api` | `b8e957f2b71042c9aec010261de100b10c60795e` |
| Commit P0/P1 first paint | `e591161d974d8f71bc2952677109fa8645f80977` |
| Commit articles LAC | `b8e957f2b71042c9aec010261de100b10c60795e` |

## 4. Gaps abiertos (imposibles aquí)

- `[campo]` teléfono / APK — Javier
- `[LAN]` PC → :3335 firewall (exit 28); iptables/ufw pide sudo
- P2 queryGate max=4 — solo Javier
- Pendientes ALL frío post-restart ~2 s: sigue FETCH 501 del dataset de flota (página 80). Caliente 5–128 ms. Tercer ciclo SQL sobre ese 501 exigiría honrar `limit` en SQL y cambiar filtro `esCTR`/riesgo — no tocado (semántica).
- Filtro UI «solo recientes» en artículos puede ir vacío los primeros ~150 ms de un miss de caché LAC; a los 5 min el badge vuelve.
