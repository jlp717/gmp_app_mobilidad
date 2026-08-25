# GMP Backend — API Express/TypeScript

API única de datos para la app GMP Movilidad. Puerta exclusiva hacia IBM DB2 for i. Producción: PM2 cluster `gmp-api` en 192.168.1.230:3335.

> Setup completo, arquitectura y despliegue: [`README.md`](../README.md) raíz. Decisiones: [`docs/adr/`](../docs/adr/).

## Capas (src/)

```
src/
├── routes/        # 19 routers: validación de entrada + autorización. SIN SQL.
├── controllers/   # orquestan request/response
├── services/      # reglas de negocio
├── middleware/    # auth JWT, rate-limit, prometheus, http-cache, seguridad
├── config/        # carga de entorno fail-closed
├── cron/          # tareas programadas (CRON_ENABLED)
├── kpi/           # KPIs derivados + Redis
└── shared/, utils/, types/
```

Regla de dependencias: `routes → controllers → services → (repositorios/adapters ODBC)`; prohibido saltarse capas o poner SQL en routes nuevas.

## Scripts clave

```bash
npm ci                 # instalar
npm run start          # node server.js (:3335)
npm run test:ci        # suite rápida contratos/perf/idempotencia
npm test               # jest completo
npm run lint           # eslint (quiet)
npm run db2:audit-commercial-cobros   # audits read-only contra DB2
```

## Reglas DB2 (resumen operativo)

- Leer de `DSEDAC` (producción, read-only por defecto); escribir solo en `JAVIER` salvo gates explícitos de exportación ERP ([ADR 0004](../docs/adr/0004-esquema-db2-dsedac-javier.md)).
- Verificar tablas/columnas en `QSYS2.SYSTABLES/SYSCOLUMNS` antes de usarlas. `VISTA_DEUDA_BASE` preferida para deuda. `CPC` deduplicada con `ROW_NUMBER()`.
- SQL siempre parametrizado. Pool con timeouts (`DB_POOL_*`), presupuesto global de conexiones.

## Salud y observabilidad

- Liveness: `GET /api/health`
- Readiness productiva: `GET /api/ready` con User-Agent `GMP-SRE-HealthCheck/1.0`
- Sentry (`instrument.js`), Prometheus (`middleware/prometheus-metrics.js`), logs Winston.

## Despliegue

Solo: `git pull origin test` + `pm2 restart gmp-api` + check `/api/ready`. Resto de operaciones PM2/entorno requieren aprobación de Javier ([ADR 0002](../docs/adr/0002-pm2-cluster-produccion.md)).
