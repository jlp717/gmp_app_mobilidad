# ADR-0025 — Engines Node 20 (se mantiene)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Prod corre Node v20.19.6. Bump a 24 sin alinear servidor rompe paridad local/prod (FND-02 original).

## Decisión

Se mantiene `engines` Node 20. Bump a 24 LTS junto con el servidor, con lockfiles (B-P2-5).

## Consecuencias

Positivas: paridad garantizada hoy.
Negativas: deuda de versión viva hasta ventana con Javier.
