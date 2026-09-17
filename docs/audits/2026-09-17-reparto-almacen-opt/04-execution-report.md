# Informe de ejecución — REPARTO + ALMACÉN 2026-09-17

Fecha: **2026-09-17**. Playbook BUILD. Comercial no tocado. Intocables no tocados (`backend/config/db.js`, `backend/middleware/auth.js`, `albaran_detail_page.dart`). Cero secretos.

Plan: `00-plan.md` · tareas: `01-executor-tasks.md`.

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
| P1-01 | DONE | Artículos default 80 |
| P1-02 | DONE | Expediciones `LazyIndexedStack` |
| P1-03 | DONE | Modal rutero `LazyIndexedStack` |
| P1-04 | DONE | Cobros primera página 40 |
| P1-05 | DONE | Truck orders / LAC JOIN sin TRIM |
| P1-06 | DONE | Lista pendientes sin `observaciones`/`firma` |
| P2-* | abierto | queryGate, fotos/mapas, Hive campo, dayMove TRIM |

Jest `[lab]`: `entregas-contract-hardening` 16/16 · `entregas-bola-security` PASS · `repartidor-route-week-sargable` PASS. Exit 0.

No se reabrió LACLAE. No se editó workstream comercial.

## 2. Latencia

Sin `[campo]`. Cifras post-deploy van etiquetadas `[servidor]` cuando el probe corre en 230.

Sonda: `backend/scripts/hit-reparto-almacen-latency.js` (PIN solo env).

## 3. SHA

Rellenar tras `git pull origin test && pm2 restart gmp-api` en 230.

## 4. Gaps abiertos (imposibles aquí)

- `[campo]` teléfono / APK — Javier
- `[LAN]` PC → :3335 si firewall
- `[túnel]` si Cloudflare no alcanza
- P2 queryGate max=4 — solo Javier
