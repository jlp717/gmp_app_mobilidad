---
name: sre-runbooks
description: Runbooks SRE para GMP y Granja: SLOs, error budget, alertas, diagnostico, rollback, post-mortems y comandos PM2.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
---

## SLOs

GMP API `192.168.1.230:3335/api/health`:
- Availability mensual: 99.5%.
- P95 latency: menor de 500 ms.
- Error rate: menor de 1%.

Granja web `mari-pepa.com`:
- Availability mensual: 99.9%.
- LCP menor de 2.5 s.
- CLS menor de 0.1.
- FID menor de 100 ms.

## Error Budget

Disponibilidad mensual permitida:
- GMP: 0.5% de 30 dias, 216 minutos.
- Granja: 0.1% de 30 dias, 43.2 minutos.

Prometheus:
```promql
1 - avg_over_time(up{job="gmp-api"}[30d])
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="gmp-api"}[5m]))
rate(http_requests_total{job="gmp-api",status=~"5.."}[5m])
```

Si budget restante baja del 20%, bloquear despliegues no urgentes. Si llega a cero, bloquear todo despliegue salvo hotfix.

## Runbook: API Backend Caida

1. Verificar health: `curl -sf -A GMP-SRE-HealthCheck/1.0 http://192.168.1.230:3335/api/health`.
2. Leer PM2: `ssh -o BatchMode=yes gmp@192.168.1.230 "pm2 list"`.
3. Leer logs: `ssh -o BatchMode=yes gmp@192.168.1.230 "pm2 logs gmp-api --lines 100"`.
4. Si el proceso esta caido, restart controlado: `pm2 restart gmp-api`.
5. Repetir health a los 10, 30 y 60 segundos.
6. Si sigue fallando, rollback con snapshot y notificar a Javier.

## Runbook: DB2 Connection Refused

1. Confirmar conectividad a `192.168.1.22`.
2. Verificar DSN `GMP` y schema `JAVIER` o `DSEDAC`.
3. Revisar logs backend para ODBC.
4. No ejecutar DML ni DDL.
5. Si DB2 no responde, enviar alerta manual con servidor, hora y endpoint afectado.

## Runbook: Servidor .230 No Responde

1. Confirmar ping o TCP desde red local.
2. No intentar deploy.
3. Notificar a Javier con impacto y servicios afectados.
4. Indicar comprobaciones manuales: energia, red, VPN, PM2 y Docker.

## Runbook: Deploy Falla En Staging

1. No promocionar a produccion.
2. Guardar logs de build y container.
3. Ejecutar smoke tests si el container levanto.
4. Si no levanto, devolver a DevOps con causa exacta.

## Post-Mortem

Plantilla:
```text
Fecha:
Duracion:
Servicios afectados:
Causa raiz con cinco porques:
Timeline:
Impacto:
Cambio aplicado:
Verificacion:
```

## Severidad

- P0: total down, respuesta inmediata.
- P1: servicio critico caido, respuesta menor de 15 min.
- P2: degradacion o error recurrente, respuesta menor de 1 h.
- P3: warning operativo, revisar en digest.

## PM2 Emergencia

```bash
pm2 list
pm2 logs gmp-api --lines 100
pm2 restart gmp-api
pm2 stop gmp-api
pm2 flush
```
