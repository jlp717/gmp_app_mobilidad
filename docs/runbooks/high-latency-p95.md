# Runbook: Latencia p95 fuera de SLO (> 800 ms en 5 min)

**Alerta**: `GmpHighLatencyP95` (Grafana → Telegram)

## Síntoma
`histogram_quantile(0.95, sum(rate(http_request_duration_ms_endpoint_bucket[5m])) by (le, path)) > 800`

## Diagnóstico
1. Grafana → panel *Duration p50/p95/p99 por endpoint*: ¿degradación gradual o escalón (cambio reciente)?
2. Escalón tras deploy → candidato a rollback.
3. Gradual → revisa `odbc_pool_utilization` (saturación = colas) y rate de `db_queries_total` (¿N+1 nuevo o query pesada?).
4. Traza un request lento: Loki `{service="gmp-api"} | json | duration_ms > 800` → copia el `request_id` → Tempo → span `db2.query` más largo.
5. Si el span DB2 domina → captura el SQL (atributo `db.statement`, recortado y sin parámetros) y pásalo a revisión de query.

## Mitigación
- Query lenta identificada → abre tarea para DB2-Query-Optimizer (índices/paginación). No optimices en caliente.
- Deploy culpable → rollback estándar con aprobación de Javier.

## Escalado
p95 > 2× SLO durante 15 min → escalar a Javier con evidencia de la traza.
