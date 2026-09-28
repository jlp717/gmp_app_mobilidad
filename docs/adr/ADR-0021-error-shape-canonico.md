# ADR-0021 — Shape de error API canónico

- Estado: Aceptado
- Fecha: 2026-09-28
- Decisor: Javier

## Contexto

3 shapes de error distintos en la API. Cliente mapea a 4 estados UI; sin contrato único el diagnóstico con requestId es frágil.

## Decisión

Shape único aditivo `{success:false,code,error,requestId}`. Se conserva el campo `error` por compatibilidad. 5xx opacos (sin stacktrace al cliente).

## Consecuencias

Positivas: contrato único documentado en tablas; correlación por `X-Request-ID` vía `addRequestId`.
Negativas: TS legacy con generador propio documentado para retirada (no duplicar generadores nuevos).
