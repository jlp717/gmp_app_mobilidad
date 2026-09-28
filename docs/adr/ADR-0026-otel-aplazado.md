# ADR-0026 — OTEL aplazado (sin colector no hay tracing)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Sin colector OTEL no hay tracing real. Instalar dependencias sin backend de observabilidad es teatro.

## Decisión

OTEL aplazado. Cobertura actual: logs estructurados + requestId + 4 reglas Prometheus en `observability/`. Desplegar stack y dependencias entonces (B-P2-4).

## Consecuencias

Positivas: cero deps muertas; diagnóstico viable con lo existente.
Negativas: sin trazas distribuidas hasta desplegar stack.
