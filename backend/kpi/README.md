# KPI Glacius — Módulo de Alertas para Distribuidores

Sistema ETL + API para integrar KPIs semanales (CSV vía SFTP) en la app de ventas GMP,
mostrando alertas en tiempo real durante las visitas a clientes.

## Arquitectura

```
SFTP (CSV semanal) → ETL Orchestrator → PostgreSQL → Redis Cache → API REST → Flutter App
                          │                                              │
                    node-schedule                                   WebSocket/Polling
                    (lunes 06:00)                                  (cada 2 min)
```

- **ETL**: Descarga CSVs del SFTP, parsea con detección automática de headers/delimitadores,
  aplica reglas de negocio por tipo de CSV, inserta alertas en PostgreSQL.
- **Cache**: Redis como L1 por clientId con TTL 7 días. Se invalida en cada carga.
- **API**: Endpoints REST paginados con filtros por clientId, tipo, severidad.
- **Idempotencia**: Cada ejecución semanal usa un `load_id` (YYYY-WNN). Si ya existe, se omite.

## Archivos CSV procesados

| CSV | Regla | Mensaje |
|-----|-------|---------|
| `Desviacion_Ventas.csv` | Cuota > 1000€ y Desv. < -250€ | `Desviado en Ventas: -751.92€ / 52%` |
| `Clientes_ConCuotaSinCompra.csv` | Cuota > 400€, sin compra | `Con cuota sin compra.` |
| `Desviacion_Referenciacion.csv` | 3+ refs impulso, desv. negativa | `Desviado en referencias: 6 menos` + refs |
| `Mensaje_Promociones.csv` | Siempre (col O) | Texto directo de Msg.Marketing |
| `Altas_Clientes.csv` | Clientes nuevos con desviación | `Evolución Captación: -358.67€ / 39%` |
| `Mensajes_Clientes.csv` | Siempre (col N/O) | Texto directo del aviso |
| `Medios_Clientes.csv` | Total medios > 0 (col G/N) | `Cliente con 4 medios` |

## Ejecución local

### Requisitos
- Node.js >= 18
- PostgreSQL >= 14
- Redis >= 7 (opcional, funciona sin él en modo degradado)

### Con Docker Compose
```bash
cd backend/kpi
docker-compose up -d

# Ejecutar migraciones
docker-compose exec backend node kpi/migrations/migrate.js up

# Ejecutar ETL con CSVs de ejemplo
curl -X POST http://localhost:3334/api/kpi/etl/run \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"localDir": "kpi/csv_samples", "force": true}'
```

### Sin Docker
```bash
# 1. Crear base de datos
createdb kpi_glacius
psql -d kpi_glacius -f backend/kpi/schema.sql

# 2. Configurar variables de entorno
export KPI_DATABASE_URL=postgresql://user:pass@localhost:5432/kpi_glacius
export REDIS_URL=redis://localhost:6379
export KPI_SCHEDULER_ENABLED=true

# 3. Instalar dependencias
cd backend && npm install csv-parse ssh2-sftp-client pg

# 4. Ejecutar migraciones
node kpi/migrations/migrate.js up

# 5. Iniciar servidor
npm start
```

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `KPI_DATABASE_URL` | URL PostgreSQL | `postgresql://kpi_user:kpi_pass@localhost:5432/kpi_glacius` |
| `KPI_DB_SSL` | Activar SSL para PostgreSQL | `false` |
| `KPI_DB_POOL_MAX` | Conexiones máximas al pool | `10` |
| `REDIS_URL` | URL Redis | `redis://localhost:6379` |
| `KPI_CACHE_TTL` | TTL cache Redis (segundos) | `604800` (7 días) |
| `KPI_SCHEDULER_ENABLED` | Activar scheduler ETL | `false` |
| `KPI_ETL_CRON` | Cron del ETL | `0 6 * * 1` (lunes 6:00) |
| `KPI_SFTP_HOST` | Host SFTP | — |
| `KPI_SFTP_PORT` | Puerto SFTP | `990` |
| `KPI_SFTP_USER` | Usuario SFTP | — |
| `KPI_SFTP_PASS` | Contraseña SFTP (usar vault) | — |
| `KPI_SFTP_FOLDER` | Carpeta remota | `/IN` |
| `KPI_TEMP_DIR` | Directorio temporal para CSVs | `backend/kpi/tmp` |

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/kpi/alerts?clientId=&type=&severity=&since=&page=&limit=` | Alertas con filtros y paginación |
| `GET` | `/api/kpi/alerts/client/:clientId` | Alertas de un cliente (cache-first) |
| `GET` | `/api/kpi/alerts/summary` | Resumen por tipo y severidad |
| `POST` | `/api/kpi/etl/run` | Ejecutar ETL manualmente (admin) |
| `GET` | `/api/kpi/etl/status` | Estado de cargas y scheduler |
| `GET` | `/api/kpi/health` | Health check del módulo |
| `GET` | `/api/kpi/loads/:loadId/audit` | Auditoría de una carga |

## Tests

```bash
cd backend
npx jest kpi/__tests__/ --verbose
```

## Seguridad (Producción)

- Credenciales SFTP en **vault** o **secret manager** (no en .env)
- PostgreSQL con SSL (`KPI_DB_SSL=true`) y usuario con permisos mínimos
- API protegida por JWT (mismo token del backend principal)
- PII en raw_data enmascarada si se activa `KPI_MASK_PII=true`
- Rotación de credenciales SFTP cada 90 días (política documentada)
- Logs sin datos sensibles (contraseñas, tokens)

## Monitorización

- **Métricas Prometheus**: endpoint `/api/kpi/metrics` (formato text exposition)
- **Logs estructurados**: Winston con niveles info/warn/error
- **Alerting**: configurar en Prometheus/Grafana para `kpi_glacius_etl_runs_failed > 0`
