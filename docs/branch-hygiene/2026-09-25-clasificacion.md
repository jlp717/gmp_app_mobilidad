# Clasificación 18 ramas — 2026-09-25

> SNAPSHOT 2026-09-25: HEAD=`test` (`7239f17`), `origin/test`=`7239f17`, `origin/main`=`d0d471d`. Sin push/delete/cherry-pick.
> LOCK (denylist): **`main`, `test`, `PR#42`**. PR#42 sin evidencia esta sesión (API 403) → ninguna rama vinculada se toca hasta verificar con `gh`.

Formato vs: `behind,ahead` (`rev-list --left-right --count`, cálculo local). PR = DESCONOCIDO en las 18 (rate-limit 403; WS-2 tuvo 200 OK antes).

## KEEP (3) — protegidas, jamás borrar

| Rama | SHA | Fecha | PR | vs test | vs main | Motivo |
|---|---|---|---|---|---|---|
| origin/test | 7239f17 | 2026-09-23 | DESCONOCIDO | 0,0 | 0,420 | Rama trabajo referencia |
| origin/main | d0d471d | 2026-06-27 | DESCONOCIDO | 420,0 | 0,0 | Denylist |
| origin/pre | d0d471d | 2026-06-27 | DESCONOCIDO | 420,0 | 0,0 | Espejo main, entorno PRE |

## NEEDS RESCUE (4) — NO borrar; rescate vía BUILD/PR, nunca cherry-pick directo

| Rama | SHA | Fecha | PR | vs test | vs main | Motivo |
|---|---|---|---|---|---|---|
| origin/codex/professionalization-implementation-20260918 | fdd6f8c | 2026-09-18 | DESCONOCIDO | 36,14 | 0,398 | 14 commits únicos Sep (CI/lint/OpenAPI/contratos). Detalle en rescue-runbook |
| origin/codex/professionalization-plan-20260918 | 6cb77ba | 2026-09-18 | DESCONOCIDO | 40,1 | 0,381 | 1 commit docs: plan profesionalización |
| origin/fix/kpi-schema-interpolation | 27ce951 | 2026-05-18 | DESCONOCIDO | 558,51 | 138,51 | Top útil (fix SCHEMA + ETL catch-up); resto historia mayo superada por test |
| origin/pre-new-logic | c880fde | 2026-02-24 | DESCONOCIDO | 926,15 | 506,15 | Lógica PRE viva (VENDOR_COLUMN date-aware, puerto 3002, túnel) |

## SAFE provisional (11) — candidatas a borrado MANUAL verificado (runbook), una por una

| Rama | SHA | Fecha | PR | vs test | vs main | Motivo |
|---|---|---|---|---|---|---|
| origin/codex/repartidor-preserve-2026-08-10 | 7b8fd47 | 2026-08-10 | DESCONOCIDO | 354,1 | 0,67 | 1 commit park cert; verificar integrado en test antes de borrar |
| origin/cursor/fix-github-actions-d9cf | 9052aea | 2026-08-22 | DESCONOCIDO | 316,0 | 0,104 | 0 ahead test → absorbida |
| origin/feat/load-planner-v2 | 7029bbe | 2026-03-03 | DESCONOCIDO | 865,0 | 445,0 | 0 ahead, historia vieja |
| origin/feature/backend-modularization | 014ea80 | 2025-12-30 | DESCONOCIDO | 1355,0 | 935,0 | 0 ahead |
| origin/feature/final-optimizations | a2000a7 | 2026-01-08 | DESCONOCIDO | 1344,0 | 924,0 | 0 ahead |
| origin/fix/orchestrator-delegation-pipeline | 9a50120 | 2026-05-20 | DESCONOCIDO | 558,57 | 138,57 | STOP: top commit es proceso (no producto) + historia vieja; si `git log` muestra valor → reclasificar NEEDS RESCUE, no borrar |
| origin/master | 1563d10 | 2026-01-20 | DESCONOCIDO | 1153,0 | 733,0 | 0 ahead, legacy ene |
| origin/optimization-phase-1 | a274793 | 2025-12-30 | DESCONOCIDO | 1360,0 | 940,0 | 0 ahead |
| origin/original-working-version | 5b2e9a1 | 2025-12-30 | DESCONOCIDO | 1364,0 | 944,0 | 0 ahead, snapshot inicial |
| origin/regression-blockers-tests-20260613 | 6a98914 | 2026-06-15 | DESCONOCIDO | 452,0 | 32,0 | 0 ahead |
| origin/security-sql-parameterization | de0cb06 | 2025-12-30 | DESCONOCIDO | 1357,0 | 937,0 | 0 ahead |

Totales: KEEP 3 + RESCUE 4 + SAFE 11 = 18. Regla parada: ante duda → NEEDS RESCUE. Ningún ahead/behind nuevo fuera del cálculo local.
