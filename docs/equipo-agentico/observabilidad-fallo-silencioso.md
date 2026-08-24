# G — Observabilidad y fallo silencioso

## Traza/métrica/alerta real si agente reporta éxito pero resultado incorrecto
**Ejemplo no hipotético gmp**: backend `/api/cobros` devuelve 200 pero no crea registro DB2 por `VENDEDOR='ALL'` mal manejado (AGENTS.md regla). Detección:
- Traza: `backend/middleware/prometheus-metrics.js:1` + OTEL gen_ai.* (versión fijada, capa `lib/core/observability/otel-mapper.js:1` pendiente si no existe) captura `tool_calls, tokens, coste, error` por tarea (5.8 https://testguild.com/load-testing-tools/).
- Métrica: `cobros_created_total` Prometheus counter + `cobros_failed_total` (no solo http 200). Alerta `rate(cobros_failed_total[5m]) > 0` dispara aunque http 200.
- Verificación determinista (5.9): test e2e `npm --prefix backend test -- cobros.idempotent` aplica `POST /api/cobros` y comprueba `SELECT COUNT(*) FROM JAVIER.CVC WHERE id=?` → 1, no solo status. Si agente dice "exito" pero COUNT 0 → test falla y Stop hook bloquea (`require-green-tests.sh:4`).

Si respuesta es vaga, mecanismo no existe — arriba es concreto y reproducible: `curl -X POST localhost:3335/api/cobros -H "Idempotency-Key: ..." && db2 query COUNT`.

## Percentiles p95/p99 (no media)
Backend `prometheus-metrics.js:1` debe exponer histogram `http_request_duration_seconds{quantile=0.5,0.95,0.99}` no solo `avg`. Evidencia actual: middleware existe pero expone `avg` — GAP: añadir `histogram` y Grafana dashboard antes de prod. Estado: ❌ parcial (avg existe, p95/p99 pendiente implementar).
