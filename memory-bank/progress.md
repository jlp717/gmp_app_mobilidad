# Progress

## Funciona ✅
- Stack Flutter+Node+DB2 en producción (PM2 gmp-api :3335)
- Plan 2026-09-14: DONE 18 / PARTIAL 18 / BLOCKED 5 / PENDIENTE código 0
- Informe: `docs/audits/2026-09-14-optimization-audit/04-execution-report.md`
- ALL JEFE no expande a IN ×80; login `diego` 200 `[servidor]`

## En construcción 🔧
- P0-03 campo, P0-05/SRV en 230, sonda túnel, DB-01 spec_approved, `SENTRY_DSN`, rotar PIN
- APP-04: logging listo; causa 401 espera 48 h de logs
- Workstream comercial en stash local (`wip-comercial-*`), no mezclado con perf
- P0-02: CI analyze fallará a propósito

## Conocidos/issues 🐞
- LACLAE frío by-client 7,7 s / evolution ~16 s / commissions ~15 s → DB-01
- Jest/`flutter analyze` de paquetes grandes cuelgan (kill + chequeo de fuentes)
