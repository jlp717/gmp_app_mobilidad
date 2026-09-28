# ADR-0022 — Sentry obligatorio en prod (fail-fast)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Sentry era opcional; errores de prod sin telemetría obligatoria. L10 introduce arranque fail-fast.

## Decisión

Sentry obligatorio en producción: sin DSN el arranque falla a propósito. Fijar variable en servidor prod ANTES del próximo deploy (B-P0-1).

## Consecuencias

Positivas: ningún deploy prod corre ciego.
Negativas: deploy sin DSN tumba el arranque por diseño; runbook 06 documenta verificación y recuperación.
