# Runbook: Crash loop de gmp-api (PM2 restarts repetidos)

**Alerta**: `[GMP-ALERT] uncaughtException` en Telegram o contador ↺ creciente en `pm2 list`.

## Síntoma
PM2 reinicia workers repetidamente; alertas Telegram de `uncaughtException`; `pm2 list` muestra ↺ alto.

## Diagnóstico
1. `ssh gmp@192.168.1.230 pm2 list` → confirma ↺ subiendo y workers flapping.
2. Log estructurado — último evento fatal con stack:
   - `pm2 logs gmp-api --err --lines 300 --nostream`
   - Loki: `{service="gmp-api"} | json | levelLabel="fatal"` — cada entrada lleva `err.stack` y `request_id` si aplica.
3. Clasifica el stack:
   - Error de código (TypeError en módulo propio tras deploy) → rollback inmediato.
   - `ERR_OUT_OF_MEMORY` → fuga de memoria; captura `process_memory_bytes` de Prometheus antes de reiniciar.
   - Error de arranque (config/env) → compara variables cargadas (sin imprimir valores) con el último deploy.

## Mitigación
- Rollback: `cd /opt/gmp-api && git log --oneline -5` para identificar commit bueno → revert + despliegue estándar (`git pull origin test` + `pm2 restart gmp-api`). Requiere palabra **adelante** de Javier.
- OOM: reinicio único controlado con aprobación; analiza el heap antes de otra iteración.

## Verificación post-mitigación
1. `pm2 list` → ↺ estable, 16 workers online.
2. `/health/live` 200 y `/health/ready` 200.
3. `http_requests_total` subiendo en Grafana sin 5xx.
