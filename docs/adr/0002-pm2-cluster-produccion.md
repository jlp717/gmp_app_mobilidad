# 0002 — PM2 en modo cluster para la API en producción

- Estado: Aceptada (retroactiva)
- Fecha: 2026-08-25
- Decisores: Javier (@jlp717)
- Etiquetas: producción, nodejs, pm2

## Contexto

La API Express sirve a los equipos de campo toda la jornada laboral. El proceso corre en el servidor `192.168.1.230` bajo PM2 como proceso `gmp-api`, escuchando en el puerto **3335**. Se necesita aprovechar los múltiples cores del servidor, reinicio automático ante fugas de memoria y arranque tras caída, sin introducir orquestadores más pesados (Docker/K8s) en un entorno Windows-oficina + Linux-servidor pequeño.

Variables observadas en el código que gobiernan este modo: `PM2_EXEC_MODE`, `PM2_INSTANCES`, `PM2_MAX_MEMORY_RESTART`, `PM2_KILL_TIMEOUT_MS`, `PM2_EXP_BACKOFF_RESTART_DELAY_MS`.

## Decisión

Ejecutar `gmp-api` bajo **PM2 cluster mode** con estas reglas operativas inmutables:

- Despliegue permitido **solo** vía: `git pull origin test` + `pm2 restart gmp-api`.
- Prohibido sin aprobación explícita de Javier: `pm2 set`, `pm2 save`, `pm2 start`, `pm2 reload` y cualquier edición del fichero de entorno del servidor.
- Liveness: `GET /api/health`. Readiness productiva: `GET /api/ready` con User-Agent `GMP-SRE-HealthCheck/1.0`, verificada por SSH local en el propio servidor.
- El puerto canónico es **3335**. El histórico 3197 quedó verificado sin escucha (2026-06-07) y no debe usarse.

## Consecuencias

**Positivas**
- Zero-downtime aproximado en `restart`; recuperación automática ante crashes (exp backoff configurable).
- Escalado vertical trivial (`instances: max`) sin cambiar código.

**Negativas / riesgos**
- Estado en memoria NO se comparte entre workers → todo estado de sesión/caché vive en Redis o DB2 (ver ADR 0003). Cualquier `Map` global por-worker es un bug latente.
- Persistir configuración de PM2 mal usada puede congelar una configuración divergente del entorno; por eso está vetado sin gate humano.

## Alternativas consideradas

1. **Fork mode single-process** — más simple, pero pierde cores y resiliencia; insuficiente para jornada completa con varios repartidores concurrentes.
2. **systemd + node directo** — sin métricas de proceso ni gestión de cluster nativa.
3. **Docker Compose/Swarm** — aislamiento mejor, pero sobrecarga operativa injustificada para un solo servicio en este servidor (se usa Docker solo para staging preview).
