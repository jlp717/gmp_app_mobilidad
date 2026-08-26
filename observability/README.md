# Observabilidad self-hosted GMP — 192.168.1.230 (sin Docker, sin coste externo)

Stack: **Prometheus** (métricas) + **Loki** (logs) + **Tempo** (trazas OTLP)
+ **Grafana** (dashboards y alertas a Telegram). Todo co-ubicado en el propio
servidor de la API: 16 GB RAM con ~10 GB libres soporta los 4 binarios (~1 GB total).

## Por qué esta arquitectura
- Sin hardware adicional ni servicios gestionados de pago.
- Binarios nativos bajo PM2 (Docker no confirmado en .230).
- Alertas reutilizan el canal Telegram existente del equipo.
- Sentry sigue activo para errores gestionados (`backend/instrument.js`); este stack añade métricas/logs/trazas propios.

## Instalación manual (requiere aprobación de producción — production-approval-gate + `adelante`)

1. Crear `/opt/gmp-observability/bin/` y descargar ahí los binarios oficiales
   linux-amd64 de Prometheus, Loki, Tempo y Grafana OSS (páginas de releases).
   Darles permiso de ejecución.
2. Copiar las configs de este directorio a `/opt/gmp-observability/`
   (prometheus.yml, tempo.yaml, loki-config.yaml, grafana/).
3. Logs → Loki: promtail (o Alloy) leyendo los ficheros de log out de PM2
   (`gmp-api-out-*.log`) con label estático `service=gmp-api`.
4. Arrancar con `pm2 start observability/pm2-observability.config.cjs`.
   Persistir la lista de procesos PM2 solo con aprobación explícita de Javier.
5. Grafana: cambiar la clave admin en el primer arranque; configurar el
   contact point de Telegram desde la UI (credenciales nunca en el repo).

## Backend
- Métricas: `GET /metrics` en :3335 (ya expuesto por `prometheus-metrics.js`).
- Trazas: activar `OTEL_ENABLED=true` y `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` en el entorno de PM2 tras instalar las deps OTel (`npm install` en /opt/gmp-api).
- Health probes: `/health/live` y `/health/ready` (nuevos), alias legacy `/api/live`, `/api/health`, `/api/ready` intactos para Flutter.

## Alertas
1. Grafana → Alerting → Contact points → **Telegram**.
2. Reglas sugeridas (ver `docs/slo.md`): `GmpHighErrorRate`, `GmpHighLatencyP95`, `GmpReadyCheckFailed`, `GmpOdbcPoolSaturation` (>80% warn, >95% critical).
3. Cada alerta tiene runbook obligatorio en `docs/runbooks/`. Alerta sin runbook = no se crea.
4. Crash handlers del backend también alertan a Telegram directamente (variables `TELEGRAM_ALERT_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID`) con fallback JSONL local.
