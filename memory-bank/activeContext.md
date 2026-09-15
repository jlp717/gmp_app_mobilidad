# Active Context — actualizado 2026-09-15

## Foco actual
Backlog de optimización 2026-09-14 **integrado en `test`**. Sin merge a `main`. Sin deploy. Informe: `docs/audits/2026-09-14-optimization-audit/04-execution-report.md`.

Código cerrado en `test` incluye P0-01/02/04, APP-01–10, BE-01–14, DB-02, REL-03, SEC-01/02/04/05/06/07, SEC-03 (probe por env). SEC-06 `b23aa20` conservado.

Latencias de producto: **no verificado en campo**.

## BLOCKED (solo Javier)
- P0-03 campo, P0-05/SRV-01/SRV-02 en 230, `SENTRY_DSN`, DB-01 `spec_approved`+DDL, rotar PIN ERP, 48 h logs APP-04.

## Decisiones vivas
- DINERO: saldo cobrable = CPC del documento; no cachear POST de liquidación.
- Comercial 80 ALL = equipo, no 403.
- P0-02 en `test` hará fallar `flutter analyze` (target).
