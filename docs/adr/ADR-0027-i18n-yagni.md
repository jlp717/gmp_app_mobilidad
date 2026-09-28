# ADR-0027 — i18n YAGNI (ES-only B2B)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

App B2B ES-only. Introducir ARB/i18n sin cliente que lo pida es coste sin retorno.

## Decisión

Sin ARB. ES hardcodeado con constantes centralizadas mínimas; i18n solo cuando llegue el primer requisito real.

## Consecuencias

Positivas: cero infraestructura de localización que mantener.
Negativas: si entra otro idioma, barrido de strings pendiente.
