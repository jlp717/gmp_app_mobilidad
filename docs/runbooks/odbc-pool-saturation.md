# Runbook: Saturación del pool ODBC (utilización > 80%)

**Alerta**: `GmpOdbcPoolSaturation` warn > 80%, critical > 95% (Grafana → Telegram)

## Síntoma
`odbc_pool_utilization > 0.80` durante 5 min (warn) o `> 0.95` (critical).

## Diagnóstico
1. Grafana → panel *ODBC Pool*: ¿subida sostenida o pico puntual?
2. Correlaciona con tráfico: `sum(rate(http_requests_total[5m]))`. Pico de tráfico legítimo → problema de capacidad, no de bug.
3. Tráfico normal + pool alto → queries lentas retienen conexiones:
   - Tempo: spans `db2.query` con mayor duración en la última hora.
   - Logs: entradas `Query (...)` con duraciones anómalas.
4. Circuit breakers: `/api/health/circuit-breakers` (estado open degrada latencia y retiene conexiones).

## Mitigación
- Warn (>80%): vigilancia activa cada 5 min; identifica la query dominante; NO toques configuración del pool en caliente.
- Critical (>95%) o errores `DB_QUERY_QUEUE_TIMEOUT`: propone a Javier reinicio controlado `pm2 restart gmp-api` (recupera conexiones zombis). Única mitigación permitida sin cambio de código.
- Causa estructural (pool pequeño para el tráfico real) → tarea de dimensionamiento con los datos de esta incidencia.

## Post-incidencia
Registra duración, causa raíz y query dominante en la retro del equipo.
