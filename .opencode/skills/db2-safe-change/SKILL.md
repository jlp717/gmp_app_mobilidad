---
name: db2-safe-change
description: Safely inspect, query, optimize, or migrate IBM DB2 for i / AS400 in GMP and Granja without hallucinating schema names.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  database: IBM DB2 for i
---

## Scope

Use this skill for every task involving DB2, AS400, SQL, ODBC, schema discovery, slow queries, migrations, or data fixes.

## Facts

- Host: 192.168.1.22.
- DSN: GMP.
- Main schemas: JAVIER and DSEDAC.
- Never introduce PostgreSQL, Supabase, or pgvector into GMP or Granja plans.

## Mandatory Verification

Before any query that references a table:

```sql
SELECT TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA IN ('JAVIER', 'DSEDAC')
  AND TABLE_NAME = ?
```

Before any query that references columns:

```sql
SELECT COLUMN_NAME, DATA_TYPE
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA = ?
  AND TABLE_NAME = ?
```

Only after tables and columns are confirmed may the agent write SQL.

## Optimization Flow

For "consulta lenta":

1. Locate the exact endpoint, route, provider, or SQL source in code.
2. Verify each DB2 table and column.
3. Capture baseline: query text, filters, expected row count, observed latency if available.
4. Run or request EXPLAIN / access-plan evidence where available.
5. Prefer narrowing predicates, indexes, materialized views, or existing views before rewriting business logic.
6. Re-run the same workload and compare before/after.

## Migration Flow

1. Generate forward SQL and rollback SQL.
2. Save under `backend/scripts/sql/migrations/`.
3. Require Javier approval before execution.
4. Never execute destructive DDL without a confirmed backup plan.
