---
name: api-spec-first
description: Contratos API como codigo. OpenAPI como fuente de verdad para backend y Flutter; tests de contrato automaticos en CI.
---
# API Spec First

## Principios
- OpenAPI (docs/spec/<app>/openapi.yaml) define request/response, errores tipados, paginacion.
- Backend y Flutter se generan/validan contra la misma spec: cero drift.
- Tests de contrato (Pact o validacion de schema) corren en CI.

## Flujo
1. API-Contract-Specialist define/actualiza openapi.yaml.
2. Backend valida rutas contra spec (middleware o test de schema).
3. Flutter usa tipos/contratos generados desde la spec.
4. CI ejecuta contract tests; drift = BLOCK.

## Reglas
- Errores tipados, timeouts, paginacion y orden explicito.
- Sin N+1; batch/join/prefetch en listados DB2.
- Compatibilidad Flutter-backend verificada por tests de contrato.
