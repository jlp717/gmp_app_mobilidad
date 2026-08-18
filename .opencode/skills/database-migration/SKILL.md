---
name: database-migration
description: Migraciones de base de datos seguras — incrementales, reversibles, zero-downtime y con backup verificado.
---

## Overview

Every database migration carries risk. This skill enforces the discipline that keeps production safe: one change per file, always reversible, always tested on a staging copy of production data, and always preceded by a verified backup. Zero-downtime deployments require the Expand/Contract pattern.

---

## When to Use

- Adding, renaming, or removing columns or tables
- Changing column types or constraints
- Adding or removing indexes
- Seeding reference data as part of a schema change

## When NOT to Use

- For application-level data transformations that don't touch the schema — use a one-off script instead, tracked separately
- For emergency hotfixes — even then, follow the backup step; skip nothing

---

## Step-by-Step Process

### 1. Backup First — Always

```bash
# PostgreSQL full dump
pg_dump \
  --host=$DB_HOST \
  --username=$DB_USER \
  --format=custom \
  --file="backup_$(date +%Y%m%d_%H%M%S).dump" \
  $DB_NAME

# Verify the backup is readable
pg_restore --list backup_*.dump | head -20
```

Never proceed without a backup whose restore has been spot-checked.

### 2. File Naming Convention

```
migrations/
  20240315_143000_add_users_email_verified.sql
  20240316_090000_create_sessions_table.sql
  20240317_120000_rename_user_name_to_full_name.sql
```

Format: `YYYYMMDD_HHMMSS_description.sql`. One logical change per file.

### 3. node-pg-migrate — Up and Down

```ts
// migrations/20240315_143000_add_email_verified.ts
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("users", {
    email_verified: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("users", "email_verified");
}
```

Run:
```bash
# Apply pending migrations
DATABASE_URL=$DATABASE_URL node-pg-migrate up

# Rollback last migration
DATABASE_URL=$DATABASE_URL node-pg-migrate down
```

### 4. Expand/Contract Pattern (Zero-Downtime Column Rename)

Renaming `user.name` → `user.full_name` without downtime:

**Phase 1 — Expand:** Add the new column. Both old and new are written.
```sql
-- migration: 001_expand_add_full_name.sql
ALTER TABLE users ADD COLUMN full_name TEXT;
UPDATE users SET full_name = name WHERE full_name IS NULL;
```
Deploy application code that reads `full_name` if present, falls back to `name`, and writes to both.

**Phase 2 — Contract:** Once all app instances use `full_name`, drop the old column.
```sql
-- migration: 002_contract_drop_name.sql  (separate deploy)
ALTER TABLE users DROP COLUMN name;
```

Never combine Phase 1 and Phase 2 in the same migration file.

### 5. Adding NOT NULL Without Downtime

Naively adding `NOT NULL` locks the table while PostgreSQL checks every row.

```sql
-- WRONG on large tables — full table scan + lock
ALTER TABLE orders ADD COLUMN confirmed BOOLEAN NOT NULL DEFAULT false;

-- CORRECT — three separate migrations
-- Step 1: Add nullable column
ALTER TABLE orders ADD COLUMN confirmed BOOLEAN;

-- Step 2: Backfill in batches (run as one-off script, not migration)
UPDATE orders SET confirmed = false WHERE confirmed IS NULL AND id BETWEEN 0 AND 10000;
-- ... repeat in batches

-- Step 3: Apply NOT NULL after backfill complete
ALTER TABLE orders ALTER COLUMN confirmed SET NOT NULL;
ALTER TABLE orders ALTER COLUMN confirmed SET DEFAULT false;
```

### 6. Index Creation Without Locking

```sql
-- Creates index without holding exclusive lock on the table
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);

-- In node-pg-migrate
pgm.createIndex("orders", "user_id", { concurrent: true });
```

Never create an index in a transaction block — `CONCURRENTLY` is incompatible with transactions. Wrap non-concurrent DDL in transactions; run concurrent index creation outside.

### 7. Dangerous Operations Checklist

| Operation | Risk | Mitigation |
|-----------|------|------------|
| `ALTER TABLE` on large table | Exclusive lock blocks reads/writes | Use `CONCURRENTLY`, batched updates |
| `DROP COLUMN` | Permanent data loss | Contract phase only after code no longer reads column |
| `ADD NOT NULL` | Lock + scan | Three-step pattern above |
| `DROP TABLE` | Catastrophic | Rename first (`_deprecated`), keep one full sprint, then drop |
| Adding foreign key | Full table scan + lock | `NOT VALID` first, then `VALIDATE CONSTRAINT` separately |

```sql
-- Safe FK addition
ALTER TABLE orders ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
-- Later (separate migration):
ALTER TABLE orders VALIDATE CONSTRAINT fk_user_id;
```

### 8. Testing Migrations

```bash
# Restore staging from production backup
pg_restore --host=staging-db --dbname=app_staging backup_latest.dump

# Apply migration on staging
DATABASE_URL=$STAGING_DATABASE_URL node-pg-migrate up

# Verify data integrity
psql $STAGING_DATABASE_URL -c "SELECT COUNT(*) FROM users WHERE full_name IS NULL;"

# Test rollback
DATABASE_URL=$STAGING_DATABASE_URL node-pg-migrate down
# Verify state matches pre-migration snapshot
```

---

## Verification Checklist

- [ ] Backup created and restore spot-checked before any migration
- [ ] Migration file named with timestamp + description
- [ ] Every `up` has a corresponding `down` that fully reverses the change
- [ ] Tested on a staging copy of production data (not on a tiny dev seed)
- [ ] Rollback tested — confirms pre-migration state
- [ ] No `ALTER TABLE` without `CONCURRENTLY` or batching on tables > 1M rows
- [ ] `DROP COLUMN` / `DROP TABLE` only after Expand phase confirmed stable
- [ ] `NOT NULL` constraint added via three-step pattern (add nullable → backfill → constrain)
- [ ] Foreign keys added with `NOT VALID` + separate `VALIDATE` migration
- [ ] Migration included in the same PR as the application code that uses it
