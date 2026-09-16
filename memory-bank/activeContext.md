# Active Context — actualizado 2026-09-16

## Foco actual
Plan de optimización 2026-09-14: **PENDIENTE código ejecutor = 0**. Informe: `docs/audits/2026-09-14-optimization-audit/04-execution-report.md`. Índice IDs: `01-executor-tasks.md`.

Código en `origin/test` (PRs #3–#41 + login `711449a` + ALL `ee1f01a` + SEC-05 analytics params). Latencias de producto: **no verificado en campo**.

## BLOCKED (solo Javier)
- P0-03 campo, P0-05/SRV-01/SRV-02 en 230, `SENTRY_DSN`, DB-01 `spec_approved`+DDL, rotar PIN ERP, 48 h logs APP-04.

## Decisiones vivas
- DINERO: saldo cobrable = CPC del documento; no cachear POST de liquidación.
- Comercial 80 ALL = equipo, no 403.
- P0-02 en `test` hará fallar `flutter analyze` (target).
- JEFE ALL = `literalAll` (≥20 códigos JWT); nunca `WHERE VENDEDOR='ALL'`.
