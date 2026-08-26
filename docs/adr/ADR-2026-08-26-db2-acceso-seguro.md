# ADR — Acceso seguro y resiliente a DB2

- Estado: Aceptada
- Fecha: 2026-08-26
- Etiquetas: db2, seguridad, resiliencia, migraciones

## Contexto

API accede a AS400 mediante `backend/config/db.js`. Auditoría confirmó conexión dedicada por llamada mediante acquire/release y cero casos de `Promise.all` compartiendo handle. No existe problema estructural de thread-safety que requiera serializar toda actividad.

## Decisión

1. Mantener conexión dedicada por llamada y liberación en `finally`; no compartir handles entre promesas.
2. Parametrizar valores con `?` y arrays del driver, incluidos `IN` dinámicos.
3. Extender breaker existente, sin dependencia nueva: timeout por llamada, umbral de error 50% y reset 30s configurables.
4. Envolver `query` y `queryWithParams` en ejecutor central con breaker, timeout ODBC y cancelación best-effort.
5. Bloquear de forma tipada mutaciones dirigidas a `DSEDAC`, incluido `SET SCHEMA DSEDAC`, antes de tocar conexión.
6. Registrar queries sobre `SLOW_QUERY_MS` (default 2000 ms) con SQL de placeholders y duración, nunca valores de parámetros.
7. Ejecutar migraciones numeradas solo mediante runner explícito `--apply`; registrar nombre + SHA-256 abreviado dentro de `JAVIER.KPI_MIGRATIONS.NAME`.

## Consecuencias

- Lecturas DSEDAC siguen permitidas; escrituras DSEDAC fallan antes de ODBC.
- Breaker reduce cascadas y conserva errores al caller; no convierte fallos DB2 en resultados nulos.
- Checksums detectan edición de historial sin alterar tabla de control existente.
- Transacciones/raw handles fuera de APIs centrales siguen requiriendo disciplina de repositorio; moverlos al executor cuando se modifiquen esos flujos.

## Evidencia operativa

Pruebas unitarias verifican comandos DSEDAC bloqueados y wiring del guard. Prueba k6 queda preparada contra `GET /api/clients`; ejecución y ajuste productivo quedan fuera de este ADR.
