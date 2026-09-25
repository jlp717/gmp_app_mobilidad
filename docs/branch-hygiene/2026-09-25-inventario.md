# Inventario ramas — 2026-09-25 (BRANCH-HYGIENE DOCS-CLOSE)

> SNAPSHOT 2026-09-25: repo `gmp_app_mobilidad`, HEAD=`test` (`7239f17`), `origin/test`=`7239f17`, `origin/main`=`d0d471d`, origin=`https://github.com/jlp717/gmp_app_mobilidad.git`. Cero push/delete/cherry-pick/force-push/rewrite. Solo escritura en `docs/branch-hygiene/`.
> LOCK (denylist): `main`, `test`, `PR#42`. Prohibido: push, borrado local/remoto, cherry-pick a test, tocar main/test, prod/secretos/DB2.

## Verificado base

| Fichero | Dato |
|---|---|
| `.git/config:12` | `url = https://github.com/jlp717/gmp_app_mobilidad.git` |
| `.git/HEAD:1` | `ref: refs/heads/test` |
| `refs/heads/test` live | `7239f17` 2026-09-23 jlp717 = `origin/test` → sincronizado |
| `refs/remotes/origin/main` | `d0d471d` 2026-06-27 jlp717 |
| `refs/remotes/origin/pre` | `d0d471d` = main (espejo) |
| `.git/FETCH_HEAD` | `97eaa32` branch test (fetch previo; test ya avanzó a `7239f17`; fecha fetch DESCONOCIDA) |

## packed-refs (rancio, verificado línea a línea)

Total: 21 refs + 1 peeled. Remotos: **11** (no 12).

| Grupo | Entradas |
|---|---|
| `refs/heads` | 7 (kpi, pedidos-cobros-critical, main, pre, pre-new-logic, test, test-repartidor-fixes) |
| `refs/remotes/origin` | 11 (feat/load-planner-v2, feature/x2, fix/kpi, main, master, optimization-phase-1, original-working-version, pre, pre-new-logic, security-sql-parameterization) |
| `refs/stash` + `refs/tags` | 1 + 2 (pre-optimization-backup, v1.0.0) |

Stale confirmado: `heads/test`→`27ce951` (live `7239f17`), `heads/main`→`7ca3883` (loose `f5d7387`, origin `d0d471d`), `origin/test`→`deac560` (live `7239f17`), `origin/main`→`7ca3883` (live `d0d471d`). Discrepancia: WS-2 citaba 12 remotos en packed-refs; verificado 11. No se inventa el 12.

## Remotos live: 18 (`refs/remotes/origin`)

9 top-level (main, master, optimization-phase-1, original-working-version, pre, pre-new-logic, regression-blockers-tests-20260613, security-sql-parameterization, test) + subdirs codex(3) cursor(1) feat(1) feature(2) fix(2).

| Rama | SHA | Fecha | Autor | Subject |
|---|---|---|---|---|
| test | 7239f17 | 2026-09-23 | jlp717 | fix(cobros-pedidos-repartidor): review PASS 14, jest 52/52 |
| main | d0d471d | 2026-06-27 | jlp717 | fix(facturas): fallback albaran pdf lookup |
| pre | d0d471d | 2026-06-27 | jlp717 | = main |
| pre-new-logic | c880fde | 2026-02-24 | jlp717 | feat: desbloquear meses futuros en PRE |
| master | 1563d10 | 2026-01-20 | jlp717 | Chore: Sync verification scripts |
| regression-blockers-tests-20260613 | 6a98914 | 2026-06-15 | jlp717 | fix: stabilize opencode and regression blockers |
| fix/kpi-schema-interpolation | 27ce951 | 2026-05-18 | jlp717 | fix(kpi): interpolate SCHEMA in safeCreateIndex |
| fix/orchestrator-delegation-pipeline | 9a50120 | 2026-05-20 | jlp717 | fix(orchestrator): enforce CTO delegation pipeline |
| feat/load-planner-v2 | 7029bbe | 2026-03-03 | jlp717 | Fix UTF-8 encoding for ODBC connections |
| feature/backend-modularization | 014ea80 | 2025-12-30 | jlp717 | Refactor: Backend modularization + hardening |
| feature/final-optimizations | a2000a7 | 2026-01-08 | jlp717 | fix: navbar 16 chars, commission text |
| optimization-phase-1 | a274793 | 2025-12-30 | jlp717 | Phase 2 Security: dotenv credentials |
| original-working-version | 5b2e9a1 | 2025-12-30 | jlp717 | Initial commit v3.0.0 |
| security-sql-parameterization | de0cb06 | 2025-12-30 | jlp717 | Fix: node-odbc parameterized queries |
| codex/professionalization-implementation-20260918 | fdd6f8c | 2026-09-18 | jlp717 | fix(flutter): restore closed receipt recovery |
| codex/professionalization-plan-20260918 | 6cb77ba | 2026-09-18 | jlp717 | docs(audit): executable professionalization plan |
| codex/repartidor-preserve-2026-08-10 | 7b8fd47 | 2026-08-10 | jlp717 | chore(preserve): park Flutter test updates |
| cursor/fix-github-actions-d9cf | 9052aea | 2026-08-22 | Cursor Agent | fix(ci): repair workflow YAML + Telegram guards |

Locales: 27 ramas en `refs/heads`. Stash: 41 entradas (no se tocan).

## Limitaciones sesión

- API GitHub: 403 rate-limit 0 actual (WS-2 tuvo 200 OK antes). Columna PR = DESCONOCIDA salvo denylist PR#42.
- Shell: PowerShell sin `head`/`sed` (fallan); `git for-each-ref/rev-list/log` OK. `permission.rejected` heredado de WS-2; en esta sesión git readonly funcionó.
- Ahead/behind: cálculo local `rev-list --count` (ver clasificacion.md). Nada nuevo inventado fuera de eso.
- Dirs huérfanos `feat/` `feature/` vacíos: riesgo WS-2 sin verificación esta sesión → PENDIENTE.

## Worktree (criterio "limpio salvo docs" NO cumplido por estado previo)

`git status --short`: 417 líneas (89 `??` untracked, resto M/R pre-existentes). Estos docs solo añaden `docs/branch-hygiene/`; no modifican nada existente.
