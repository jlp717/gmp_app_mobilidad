# ADR-0024 — Idempotency autodispose (tokens fuera del notifier)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Tokens de idempotencia dentro de notifiers con autodispose se pierden al descartar el provider; reintento genera duplicado.

## Decisión

Tokens en store static fuera del notifier, ciclo de vida independiente del widget/provider.

## Consecuencias

Positivas: reintentos idempotentes aunque el provider se descarte.
Negativas: el store exige limpieza explícita; documentar TTL del token.
