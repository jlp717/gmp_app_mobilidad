# 0005 — Acceso a DB2 mediante ODBC (DSN GMP) en lugar de JDBC/JT400 u ORMs

- Estado: Aceptada (retroactiva)
- Fecha: 2026-08-25
- Decisores: Javier (@jlp717)
- Etiquetas: db2, conectividad, nodejs

## Contexto

Node.js necesita consultar DB2 for i. Opciones reales en el ecosistema: driver `odbc` (unixODBC/Windows ODBC con DSN), JT400 vía bridge Java, Mapepire (Db2 for i sobre sockets), o capas ORM (Sequelize ya aparece en scripts de migración legacy `db:migrate`). La operación corporativa ya dispone de un DSN ODBC `GMP` probado en los servidores implicados.

## Decisión

Usar el paquete **`odbc` (node-odbc) contra el DSN `GMP`**, con pool gestionado por la app:

- Credenciales fuera de código: `ODBC_DSN`, `ODBC_UID`, `ODBC_PWD` (ver `backend/.env.example`; valores vacíos = nunca commitear reales).
- Pool dimensionable por entorno: `DB_POOL_MIN/MAX`, `DB_POOL_ACQUIRE_MS`, `DB_POOL_FAST_FAIL_MS`, presupuesto global `DB_TOTAL_CONNECTION_BUDGET` y concurrencia de queries (`DB_QUERY_CONCURRENCY`, `DB_TOTAL_QUERY_CONCURRENCY`).
- SQL **siempre parametrizado** (bind parameters); concatenación de strings con input de usuario = defecto bloqueante.
- Repositorios/adapters concentran el SQL; routes/controllers no escriben queries.

## Consecuencias

**Positivas**
- Reutiliza el driver corporativo ya instalado y auditado; cero JVM/Java en el stack.
- Control total del SQL set-based (joins, paginación, `ROW_NUMBER()`), crítico contra el ERP.
- Pool y timeouts explícitos → fallos rápidos y medibles en vez de colas infinitas.

**Negativas / riesgos**
- Dependencia binaria del driver ODBC por plataforma (Windows dev / Linux server): instalar driver antes de `npm ci`.
- Sin tipos automáticos de DB2: el mapeo lo hacen los modelos; cambios de schema requieren verificación QSYS2 (ADR 0004).

## Alternativas consideradas

1. **JT400 (Java bridge)** — madurez alta pero introduce JVM + IPC; sobrecarga operativa innecesaria.
2. **Mapepire / idb-connector** — nativo IBM i moderno; buen candidato futuro, pero hoy el DSN ODBC ya opera en todos los entornos y cambiaría infraestructura sin dolor medible.
3. **ORM completo (Sequelize/Prisma)** — abstrae SQL justo lo que aquí necesitamos controlar (paginación CPC, VISTA_DEUDA_BASE); Sequelize queda relegado a scripts legacy.
