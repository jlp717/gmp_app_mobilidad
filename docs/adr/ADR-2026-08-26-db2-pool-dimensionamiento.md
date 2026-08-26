# ADR — Dimensionamiento del pool DB2 por proceso

- Estado: Aceptada
- Fecha: 2026-08-26
- Etiquetas: db2, odbc, pm2, rendimiento

## Contexto

PM2 ejecuta 8 instancias de `gmp-api`. Cada proceso mantiene pool ODBC independiente; sumar máximos por proceso define presión teórica sobre DB2.

## Decisión

Usar fórmula:

`max_per_process = floor(B_reservado / instancias)`

Con presupuesto reservado `B_reservado = 32` e `instancias = 8`:

`floor(32 / 8) = 4` conexiones máximas por proceso.

Resultado: `8 instancias × DB_POOL_MAX 4 = 32 conexiones` teóricas. Mantener además 20% de capacidad DB2 fuera de este presupuesto para administración, jobs ERP y picos no atribuibles a API. `DB_POOL_MAX` sigue configurable por entorno; default de código es 4.

## Validación y ajuste

Ejecutar prueba de carga staging con 50 VUs durante 30s. Medir p95, timeouts de adquisición, cola, conexiones activas y errores DB2. Subir o bajar `B_reservado` solo con evidencia, conservando reserva 20% y recalculando por número real de instancias.

## Consecuencias

- Límite determinista por proceso; evita 8 × 5 = 40 conexiones por defecto.
- Menor pool puede aumentar cola bajo picos; query gate y métricas muestran cuándo ajustar.
- Cambiar PM2/env o presupuesto productivo requiere gate operativo separado.
