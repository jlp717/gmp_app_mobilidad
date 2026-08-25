# 0003 — Redis como capa de caché y KPIs de la API

- Estado: Aceptada (retroactiva)
- Fecha: 2026-08-25
- Decisores: Javier (@jlp717)
- Etiquetas: rendimiento, cache, redis

## Contexto

Los endpoints de dashboard/analytics ejecutan agregaciones costosas sobre DB2 for i. Con PM2 cluster (ADR 0002) ningún worker puede sostener cache en memoria propia. El backend ya integra `redis@^4` y mantiene lógica de KPIs en `backend/kpi/`, con variables dedicadas (`REDIS_COMMAND_TIMEOUT_MS`, `REDIS_DISABLE_OFFLINE_QUEUE`, `QUERY_CACHE_STALE_MS`, `HEALTH_DB_CACHE_MS`).

## Decisión

Redis es la **única** capa de caché compartida entre workers:

- Claves por request/endpoint con TTL corto; invalidación explícita en escrituras relacionadas.
- Toda llamada a Redis lleva timeout y comportamiento degradado definido: si Redis no responde, la petición sigue contra DB2 (fail-open controlado) o falla rápido según endpoint — nunca bloquea indefinidamente.
- Datos derivados/KPI precalculados viven en `backend/kpi/`; Redis guarda resultados, no lógica.
- Prohibido almacenar PII sensible o secretos en Redis sin TTL y justificación.

## Consecuencias

**Positivas**
- Latencias estables en dashboard/rutero; descarga real a DB2.
- Coherencia entre N workers del cluster.

**Negativas / riesgos**
- Nuevo componente operativo que vigilar (memoria, evictions); mitigado con `cache:cleanup` script y health checks.
- Riesgo de stale reads aceptado y acotado por TTL/stale windows documentados por endpoint.

## Alternativas consideradas

1. **Cache en memoria por worker** — rota con ADR 0002: cada worker duplicaría queries a DB2.
2. **Materialized tables en DB2** — útil para agregados muy estables, pero añade DDL/DML en producción (R4, gates duros) para casos que Redis resuelve sin tocar el ERP.
3. **node-cache + broadcast de invalidación** — complejidad de invalidación distribuida sin beneficio aquí.
