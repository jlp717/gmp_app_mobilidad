# ADR-0030 — Outbox claim variance (paridad con liquidación)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Outbox de variance sin lease: dos workers podían procesar el mismo lote.

## Decisión

Claim+token con paridad exacta al mecanismo de liquidación + 5 tests de carrera. Endpoint de requeue/limpieza manual de claims huérfanos queda pendiente (B-P2-12).

## Consecuencias

Positivas: sin doble aplicación; carreras cubiertas por tests.
Negativas: claims huérfanos requieren intervención manual hasta B-P2-12.
