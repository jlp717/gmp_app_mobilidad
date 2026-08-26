# Recomendaciones PM2 ecosystem GMP

Solo evaluación. `backend/ecosystem.config.js` no fue modificado.

## Evidencia actual

- Config versionada: default `PM2_INSTANCES=8`, cluster con más de una instancia, presupuesto total DB2 de 40 conexiones y 32 queries concurrentes.
- Runtime leído 2026-08-26: **16 workers `gmp-api` online**, ~109–120 MiB RSS por worker; servidor con 15 GiB RAM y 11 GiB disponibles en ese instante.
- Conteo CPU no pudo obtenerse: `nproc` está fuera del allowlist SSH read-only. Javier debe ejecutarlo antes de cambiar instancias.
- `server.js` envía `process.send('ready')` después de escuchar y precalentar cachés; `wait_ready: true` tiene soporte real.
- Request timeout: 30 s. Acquire DB2: 15 s. `kill_timeout`: 5 s.

## Recomendaciones

| Ajuste | Actual | Propuesta | Justificación |
|---|---:|---:|---|
| `instances` | código 8; runtime 16 | `min(núcleos lógicos verificados, 8)` como baseline; subir solo con k6+DB2 estable | Con 8: 5 conexiones y 4 queries/worker. Con 16: 2 y 2; más procesos pueden aumentar colas/cachés L1 sin ampliar DB2. Si `nproc < 16`, runtime está sobredimensionado. |
| `max_memory_restart` | 512M/worker | mantener 512M; alertar RSS 350–400M | RSS observado ~110M. Deja margen a heap+ODBC; con 16, techo agregado teórico 8 GiB. |
| `exp_backoff_restart_delay` | 500 ms | 1.000 ms | Alinea `restart_delay`, reduce churn ante fallo persistente. Revisar causa de restart antes. |
| `wait_ready` | true | mantener | Ready real se emite tras escucha/warmup. |
| `listen_timeout` | 120.000 ms | mantener hasta medir arranque p95; 60.000 ms si hay margen | DB2 y precarga pueden tardar; evita matar arranque válido. |
| `kill_timeout` | 5.000 ms | **35.000 ms** | Cubre request timeout 30 s más 5 s para cerrar HTTP, ODBC y Redis. |

## Aplicación segura

1. Javier ejecuta `nproc` y registra núcleos lógicos.
2. Comparar k6 con 8 y, si CPU/DB2 lo soportan, 16 workers; vigilar p95/p99, errores, cola DB2, conexiones y RSS.
3. Mantener presupuesto DB2 total constante.
4. Probar señal ready y cierre con requests lentas en staging.
5. `wait_ready` + `listen_timeout` preparan reload gradual, pero `pm2 reload` sigue prohibido por runbook sin aprobación explícita. No cambiar despliegue desde este documento.
