# SLOs — GMP API (golden signals por endpoint crítico)

Fuente de métricas: `/metrics` (Prometheus scrape desde 192.168.1.230).
Dashboards: Grafana **GMP API RED** (`observability/grafana/`).

## Convención
- Ventana de evaluación: 5 min (rolling).
- Error budget mensual: 99% disponibilidad → 43 min/mes de presupuesto.
- Latencias medidas por endpoint con `http_request_duration_ms_endpoint`.

## Endpoints críticos

| Endpoint | Tráfico baseline | p95 | Tasa error | Notas |
|---|---|---|---|---|
| GET /api/rutero/week | medir semana 1 | < 800 ms | < 1% | listado diario del rutero |
| GET /api/repartidor/rutero/order/:id | medir semana 1 | < 800 ms | < 1% | detalle pedido repartidor |
| GET albarán PDF | medir semana 1 | < 2000 ms | < 2% | generación PDF pesada |
| GET /api/cobros/:codigoCliente/pendientes | medir semana 1 | < 800 ms | < 1% | negocio crítico cobros |
| GET /api/facturas | medir semana 1 | < 800 ms | < 1% | listado paginado |
| GET /health/ready | n/a | < 2500 ms | n/a | probe: timeout propio 2 s/check |

> Baseline de tráfico: los primeros 7 días tras activar el dashboard se miden
> requests/min reales por endpoint y se fijan aquí. Sin baseline no hay alerta
> de tráfico útil — solo de error y latencia.

## Golden signals globales

| Signal | Métrica | Umbral warn | Umbral critical |
|---|---|---|---|
| Errores | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` | > 1% | > 5% |
| Latencia | `histogram_quantile(0.95, sum(rate(http_request_duration_ms_endpoint_bucket[5m])) by (le, path))` | > 800 ms | > 1600 ms |
| Tráfico | `sum(rate(http_requests_total[1m]))` | caída > 50% vs baseline | caída > 80% |
| Saturación pool ODBC | `odbc_pool_utilization` | > 0.80 | > 0.95 |
| Memoria worker | `process_memory_bytes{type="rss"}` | > 300 MB | > 450 MB |

## Alertas → canal
Todas las alertas llegan a Telegram (contact point de Grafana) y cada una
tiene runbook en `docs/runbooks/`. Una alerta sin siguiente paso es ruido:
si un runbook no funciona al probarlo, se corrige el mismo día.
