# Runbook: Tasa de error alta (5xx > 1% en 5 min)

**Alerta**: `GmpHighErrorRate` (Grafana → Telegram)

## Síntoma
`sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01`

## Diagnóstico (en este orden)
1. Grafana → dashboard **GMP API RED** → panel *Errors by endpoint*: ¿error concentrado en un endpoint o global?
2. Un solo endpoint → coge el request_id de una respuesta 5xx reciente en Loki (`{service="gmp-api"} | json | status >= 500`) y sigue su traza en Tempo.
3. Global → revisa `odbc_pool_utilization` y `/health/ready`:
   - Pool saturado → runbook `odbc-pool-saturation.md`
   - Ready 503 → runbook `health-ready-fail.md`
4. Logs PM2: `ssh gmp@192.168.1.230 pm2 logs gmp-api --lines 200 --nostream`.

## Mitigación
- Endpoint concreto tras deploy reciente → rollback: `git revert <commit>` + despliegue estándar (`git pull origin test` + `pm2 restart gmp-api`, requiere aprobación de Javier).
- DB2 caído → avisa a Javier; no reinicies el pool manualmente sin diagnóstico.

## Escalado
Si a los 15 min el error rate sigue > 1%, notifica a Javier con: endpoint afectado, request_id de ejemplo, causa sospechada, acción propuesta.
