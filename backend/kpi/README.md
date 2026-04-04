# KPI Glacius — Alertas para Distribuidores

Sistema ETL + API que integra KPIs semanales (CSV vía FTPS) en la app GMP,
mostrando alertas en tiempo real durante las visitas a clientes.

## Arquitectura

```
FTPS (CSV semanal) → ETL Orchestrator → DB2 (ODBC) → Redis Cache → API REST → Flutter App
       │                                                                │
  basic-ftp                                                       Polling (2 min)
  (puerto 990)
```

- **ETL**: Descarga CSVs del FTPS (puerto 990, TLS implícito), parsea con detección automática
  de headers/delimitadores, aplica reglas de negocio, inserta alertas en DB2.
- **Cache**: Redis como L1 por clientId con TTL 7 días. Se invalida en cada carga.
- **API**: Endpoints REST con filtros por clientId, tipo, severidad.
- **Scheduler**: node-schedule, L-V 7:00 AM Europe/Madrid (habilitado por defecto).

## Archivos CSV procesados

| CSV | Regla | Mensaje |
|-----|-------|---------|
| `Desviacion_Ventas.csv` | Cuota > 1000€ y Desv. < -250€ | `Desviado en Ventas: -751.92€ / 52%` |
| `Clientes_ConCuotaSinCompra.csv` | Cuota > 400€, sin compra | `Con cuota sin compra.` |
| `Desviacion_Referenciacion.csv` | 3+ refs impulso, desv. negativa | `Desviado en referencias: 6 menos` |
| `Mensaje_Promociones.csv` | Siempre (col O) | Texto directo de Msg.Marketing |
| `Altas_Clientes.csv` | Clientes nuevos con desviación | `Evolución Captación: -358.67€ / 39%` |
| `Mensajes_Clientes.csv` | Siempre (col N/O) | Texto directo del aviso |
| `Medios_Clientes.csv` | Total medios > 0 (col G/N) | `Cliente con 4 medios` |

## Requisitos

- Node.js >= 18
- DB2 accesible vía ODBC (DSN='GMP', schema JAVIER)
- Redis >= 7 (opcional, funciona sin él en modo degradado)
- `basic-ftp` para conexión FTPS

## Instalación

```bash
cd backend
npm install basic-ftp csv-parse ioredis node-schedule
```

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `REDIS_URL` | URL Redis | `redis://localhost:6379` |
| `KPI_CACHE_TTL` | TTL cache Redis (segundos) | `604800` (7 días) |
| `KPI_SCHEDULER_ENABLED` | Activar scheduler ETL | `true` (desactivar con `false`) |
| `KPI_SFTP_HOST` | Host FTPS | — |
| `KPI_SFTP_PORT` | Puerto FTPS | `990` |
| `KPI_SFTP_USER` | Usuario FTPS | — |
| `KPI_SFTP_PASS` | Contraseña FTPS | — |
| `KPI_SFTP_FOLDER` | Carpeta remota | `/IN` |
| `KPI_SFTP_TIMEOUT` | Timeout conexión (ms) | `30000` |
| `KPI_TEMP_DIR` | Directorio temporal para CSVs | `backend/kpi/tmp` |

## API Endpoints

| Ruta | Descripción |
|------|-------------|
| `GET /api/kpi/alerts?clientId=&type=&severity=` | Alertas con filtros |
| `GET /api/kpi/alerts/client/:clientId` | Alertas de un cliente (cache-first) |
| `GET /api/kpi/alerts/summary` | Resumen por tipo y severidad |
| `POST /api/kpi/etl/run` | Ejecutar ETL manualmente |
| `GET /api/kpi/etl/status` | Estado de cargas y scheduler |
| `GET /api/kpi/health` | Health check del módulo |

## Despliegue (servidor)

```bash
# En /opt/gmp-api/backend/
npm install basic-ftp
pm2 restart gmp-api
```
