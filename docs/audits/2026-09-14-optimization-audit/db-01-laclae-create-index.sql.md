---
title: DB-01 JAVIER.LACLAE_MONTHLY (no DDL ERP)
status: active
owner: ejecutor
created: 2026-09-16
---

# DB-01 — Agregado mensual en `JAVIER` (DSED/DSEDAC solo lectura)

**PROHIBIDO** `CREATE INDEX` / `ALTER` sobre `DSED.LACLAE` o cualquier tabla ERP.

Solución: tabla `JAVIER.LACLAE_MONTHLY` poblada con `INSERT … SELECT` desde `comercialErpTable('LACLAE')` (`JAVIER.TEST_LACLAE` en isolated_test; `DSED.LACLAE` en prod, solo SELECT).

- DDL: `backend/migrations/047_javier_laclae_monthly.sql`
- Apply: `DB_QUERY_TIMEOUT_MS=3600000 node backend/scripts/apply-laclae-monthly.js --apply`
- Rollback: `DROP TABLE JAVIER.LACLAE_MONTHLY`
- Flag: `LACLAE_MONTHLY_ENABLED` (default true). Si el validate de importes no cuadra, el script hace DROP y la app sigue leyendo LACLAE.

App: `GET /objectives/evolution?ALL` y `GET /objectives/by-client?ALL` leen el mensual cuando QSYS2 ve la tabla con filas.
