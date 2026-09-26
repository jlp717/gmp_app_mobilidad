# ADRs GMP — índice

Esquema único `ADR-NNNN`, orden cronológico por fecha de creación (más antigua = 0001).
Renumerado 2026-09-26 (auditoría Tier-1 P12): solo nombres + índice + links internos.
Contenido de decisiones intacto. H1 de cada fichero = número nuevo.

| Número | Título | Fecha | Estado | Decisión (1 línea) |
|---|---|---|---|---|
| ADR-0001 | Monorepo único con dos unidades desplegables | 2026-08-25 | Aceptada (retroactiva) | Monorepo único: `lib/` Flutter + `backend/` Express, `package.json` raíz solo tooling. |
| ADR-0002 | PM2 en modo cluster para la API en producción | 2026-08-25 | Aceptada (retroactiva) | `gmp-api` en PM2 cluster puerto 3335; deploy solo `git pull origin test` + `pm2 restart gmp-api`. |
| ADR-0003 | Redis como capa de caché y KPIs de la API | 2026-08-25 | Aceptada (retroactiva) | Redis única caché compartida entre workers, TTL corto, degradado definido. |
| ADR-0004 | Esquemas DB2: DSEDAC solo-lectura vs JAVIER pruebas/escritura | 2026-08-25 | Aceptada (retroactiva) | DSEDAC producción solo-lectura; escrituras/pruebas en JAVIER. |
| ADR-0005 | Acceso a DB2 mediante ODBC (DSN GMP) | 2026-08-25 | Aceptada (retroactiva) | `node-odbc` contra DSN `GMP` con pool en app; sin JT400 ni ORM nuevo. |
| ADR-0006 | Cliente-servidor estricto; offline-first en cliente | 2026-08-25 | Aceptada (retroactiva) | Flutter solo habla con la API; prohibido cliente→DB2; offline-first. |
| ADR-0007 | Riverpod para estado de aplicación | 2026-08-26 | — (sin estado declarado) | Riverpod 2.5 único para estado nuevo; `ChangeNotifier` congelado. |
| ADR-0008 | Firebase App Distribution como canal primario Android | 2026-08-26 | Propuesto | APK firmado vía App Distribution al grupo `comerciales`. |
| ADR-0009 | Versionado de la API por URI | 2026-08-26 | Aceptado | Nuevos endpoints `/api/v1`; `/api` legacy congelado compatible. |
| ADR-0010 | Estrategia de caché Redis GMP | 2026-08-26 | accepted | Caché multinivel L1/L2 cache-aside + anti-stampede; refina ADR-0003. |
| ADR-0011 | Gestión de claves y accesos del backend GMP | 2026-08-26* | sin verificar (guardrail secretos) | No leída: bloqueada por guardrail de secretos; revisar manual antes de citar. |
| ADR-0012 | Acceso seguro y resiliente a DB2 | 2026-08-26 | Aceptada | Conexión dedicada por llamada, binding `?`, breaker 50%/30s. |
| ADR-0013 | Dimensionamiento del pool DB2 por proceso | 2026-08-26 | Aceptada | `max_per_process = floor(B_reservado / instancias)` (8 workers PM2). |
| ADR-0014 | Pinning TLS: no activar hasta tener kill switch | 2026-09-15 | Propuesta | Sin pinning efectivo hasta kill switch remoto; PKI pública + Cloudflare. |
| ADR-0015 | Riverpod único — Notifier/AsyncNotifier + Provider/FutureProvider | 2026-09-25 | Aceptado | Patrón canónico Riverpod; suplementa ADR-0007; prohíbe GetIt/`ChangeNotifierProvider` nuevo. |
| ADR-0016 | Vendor-scope canónico | 2026-09-25 | Aceptada | Un solo filtro de alcance vendedor; `ALL` nunca es código real. |
| ADR-0017 | Caché TTL por dominio | 2026-09-25 | Aceptada | TTL por dominio; dinero sin caché HTTP; ETag barato. |
| ADR-0018 | Evolution live sin rollup snapshot | 2026-09-25 | Aceptada | Evolución de objetivos en vivo; mes abierto no se congela a snapshot. |
| ADR-0019 | Vendor-col LACLAE: objetivos vs comisiones | 2026-09-25 | Aceptada con deuda conocida | Objetivos = `R1_T8CDVD`, comisiones = `LCCDVD`. |

\* Fecha de ADR-0011 = primer commit que la añade (contenido no leído por bloqueo de secretos).

## Correspondencia viejo → nuevo

| Antes | Ahora |
|---|---|
| `0001-monorepo-dos-unidades-desplegables.md` | `ADR-0001-monorepo-dos-unidades-desplegables.md` |
| `0002-pm2-cluster-produccion.md` | `ADR-0002-pm2-cluster-produccion.md` |
| `0003-redis-cache-kpi.md` | `ADR-0003-redis-cache-kpi.md` |
| `0004-esquema-db2-dsedac-javier.md` | `ADR-0004-esquema-db2-dsedac-javier.md` |
| `0005-acceso-db2-via-odbc.md` | `ADR-0005-acceso-db2-via-odbc.md` |
| `0006-cliente-servidor-offline-first.md` | `ADR-0006-cliente-servidor-offline-first.md` |
| `0001-state-management-riverpod.md` | `ADR-0007-state-management-riverpod.md` |
| `0007-canal-distribucion.md` | `ADR-0008-canal-distribucion.md` |
| `ADR-0001-versionado-api.md` | `ADR-0009-versionado-api.md` |
| `ADR-001-cache-redis-gmp.md` | `ADR-0010-cache-redis-gmp.md` |
| `ADR-001-gestion-credenciales.md` | `ADR-0011-gestion-credenciales.md` |
| `ADR-2026-08-26-db2-acceso-seguro.md` | `ADR-0012-db2-acceso-seguro.md` |
| `ADR-2026-08-26-db2-pool-dimensionamiento.md` | `ADR-0013-db2-pool-dimensionamiento.md` |
| `0008-tls-pinning.md` | `ADR-0014-tls-pinning.md` |
| `0002-riverpod-unico.md` | `ADR-0015-riverpod-unico.md` |
| `ADR-001-vendor-scope.md` | `ADR-0016-vendor-scope.md` |
| `ADR-002-cache-ttl-dominio.md` | `ADR-0017-cache-ttl-dominio.md` |
| `ADR-003-evolution-live.md` | `ADR-0018-evolution-live.md` |
| `ADR-004-vendor-col-laclae.md` | `ADR-0019-vendor-col-laclae.md` |