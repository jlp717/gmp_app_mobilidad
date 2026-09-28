# ADR-0023 — Runtime C5 CommonJS (PM2 solo CommonJS)

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

Runtime PM2 solo CommonJS. Directorio `src/` TS parcialmente zombie (~90 ficheros) con riesgo de doble runtime.

## Decisión

Backend canónico en `backend/` CommonJS. `src/` TS declarado zombie parcial: 22 borrados verificados (matriz handoff L5a); resto referenciado por runtime/jest, documentado sin reescritura.

## Consecuencias

Positivas: sin ambigüedad de runtime; 22 ficheros menos.
Negativas: resto zombie referenciado sigue vivo hasta retirada documentada; no tocar sin verificar referencias.
