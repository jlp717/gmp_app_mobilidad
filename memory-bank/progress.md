# Progress

## Funciona ✅
- Stack Flutter+Node+DB2 en producción (PM2 gmp-api :3335)
- Backlog de optimización 2026-09-14 **en rama `test`** (sin main, sin deploy)
- Informe: `docs/audits/2026-09-14-optimization-audit/04-execution-report.md`

## En construcción 🔧
- P0-03 campo, P0-05/SRV en 230, sonda túnel, DB-01 spec_approved, `SENTRY_DSN`, rotar PIN
- APP-04: logging listo; causa 401 espera 48 h de logs
- Workstream comercial en stash local (`wip-comercial-*`), no mezclado con perf
- P0-02: CI analyze fallará a propósito

## Conocidos/issues 🐞
- Disco C llenó (ENOSPC); se limpió solo `build/` de worktrees
- Jest/`flutter analyze` de paquetes grandes cuelgan (kill + chequeo de fuentes)
- `01-executor-tasks.md` ausente en `test`
