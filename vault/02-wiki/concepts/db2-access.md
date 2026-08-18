---
type: concept
status: active
summary: Como el equipo toca DB2/AS400. Schema-first, SQL parametrizado, DSEDAC protegido.
tags: [db2, as400, sql, security]
---

# DB2 access

The DB2 for i server is 192.168.1.22. ODBC DSN is `GMP`. Primary schemas are JAVIER and DSEDAC. Before any table or column name is used, verify with `QSYS2.SYSTABLES` and `QSYS2.SYSCOLUMNS`. Prefer `VISTA_DEUDA_BASE` for debt. CPC duplicates need `ROW_NUMBER()`.

Reads are default. Writes (INSERT/UPDATE/DELETE/DDL) need explicit approval, rollback SQL, and an `idempotency_key` or documented `no_retry_reason`. Schema JAVIER test writes may proceed with plan approval and `no-DSEDAC-DDL-DML`. DSEDAC or production writes are R4.

Never concatenate SQL. Never put SQL in new Express routes. N+1 against DB2 is BLOCK. Commercial targets use column `R1_T8CDVD` (who owns the client), not `LCCDVD` (who sold). Flutter never talks to DB2 directly.

Related: [[gmp-stack]] [[deploy-policy]] [[code-quality-contract]]
