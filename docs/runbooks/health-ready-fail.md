# Runbook: /health/ready devuelve 503

**Alerta**: `GmpReadyCheckFailed` (Grafana → Telegram) o fallo directo del probe.

## Síntoma
`GET /health/ready` responde 503 con `checks.database` o `checks.redis` en error.

## Diagnóstico
1. Lee el JSON de la respuesta: indica qué check falla y el error exacto (timeout incluido).
2. `checks.database.status == "error"`:
   - `timeout after ...ms` → DB2 lento o pool agotado → mira `odbc_pool_utilization`; si > 95% ve a `odbc-pool-saturation.md`.
   - Error de conexión → verifica AS400 (192.168.1.22) accesible y estado de circuit breakers en `/api/health/circuit-breakers`.
3. `checks.redis.status == "error"`:
   - Redis caído → el backend tiene fallback L1; la app sigue sirviendo pero las sesiones compartidas entre workers se degradan. Reiniciar Redis solo con aprobación de Javier.
4. Logs: `pm2 logs gmp-api --lines 100 --nostream` filtrando `unhealthy`.

## Mitigación
- Transitorio (un check falla y el siguiente pasa) → observa 5 min; cada check tiene timeout propio de 2 s (HEALTH_CHECK_TIMEOUT_MS).
- Persistente en DB2 → escala a Javier antes de tocar PM2/pool.

## Nota importante
PM2 considera viva la instancia mientras `/health/live` responda: NO reinicies gmp-api por un ready 503 salvo orden expresa.
