---
name: postgresql-advanced
description: Advanced PostgreSQL for production — indexes, window functions, CTEs, full-text search, transactions, JSONB, and performance tuning. Use when designing schemas, optimizing slow queries, or implementing complex SQL patterns.
---

# Advanced PostgreSQL — Professional Guide

## Overview
PostgreSQL is a feature-rich relational database. This guide covers production-grade patterns: choosing the right index type, writing analytical queries with window functions, safe transactions, JSONB document storage, and tuning for high-traffic workloads.

---

## When to Use
- Designing indexes for a new table or optimizing an existing slow query
- Writing complex analytical SQL (rankings, running totals, hierarchies)
- Implementing full-text search without an external search engine
- Building safe concurrent job queues
- Storing and querying semi-structured data in JSONB columns

## When NOT to Use
- Do NOT create indexes blindly on every column — measure first with `EXPLAIN ANALYZE`
- Do NOT use `SERIALIZABLE` isolation for all transactions — reserve it for financial operations
- Do NOT store access tokens or secrets in JSONB without encryption

---

## Step-by-Step Process

### 1. Indexes

```sql
-- B-tree (default): equality and range queries on scalar types
CREATE INDEX idx_orders_user_created
  ON orders (user_id, created_at DESC); -- composite: user_id first (higher cardinality used in WHERE)

-- Partial index: only index rows that match a condition (smaller, faster)
CREATE INDEX idx_orders_pending
  ON orders (created_at)
  WHERE status = 'pending';

-- GIN: multi-value types — arrays, JSONB, full-text tsvector
CREATE INDEX idx_products_tags ON products USING GIN (tags);

-- GiST: geometric/range types, nearest-neighbour
CREATE INDEX idx_locations_geo ON locations USING GIST (coordinates);

-- Verify index is used
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM orders WHERE user_id = 42 AND created_at > now() - interval '7 days';
-- Look for "Index Scan" not "Seq Scan". Check "Buffers: hit" vs "read".
```

**Composite index column order:** put the column used in `WHERE` equality first, range/sort column last.

### 2. Window Functions

```sql
-- Leaderboard: rank users by score, show previous score
SELECT
  user_id,
  username,
  score,
  RANK()        OVER (ORDER BY score DESC)                        AS rank,
  DENSE_RANK()  OVER (ORDER BY score DESC)                        AS dense_rank,
  ROW_NUMBER()  OVER (ORDER BY score DESC, user_id)               AS row_num,
  LAG(score, 1) OVER (PARTITION BY league_id ORDER BY week_num)   AS prev_week_score,
  score - LAG(score, 1) OVER (
    PARTITION BY league_id ORDER BY week_num
  )                                                                AS delta
FROM user_scores
WHERE season = 2025;
```

- `RANK()` leaves gaps after ties; `DENSE_RANK()` does not; `ROW_NUMBER()` is always unique.
- `PARTITION BY` resets the window per group (like GROUP BY but keeps all rows).

### 3. CTEs

```sql
-- Standard CTE (may be inlined by the planner)
WITH active_users AS (
  SELECT id, email FROM users WHERE last_login > now() - interval '30 days'
)
SELECT * FROM active_users WHERE email LIKE '%@corp.com';

-- Force materialisation (run once, result cached)
WITH MATERIALIZED expensive_agg AS (
  SELECT category_id, SUM(revenue) AS total FROM orders GROUP BY 1
)
SELECT c.name, e.total FROM categories c JOIN expensive_agg e ON c.id = e.category_id;

-- Recursive CTE: organisational hierarchy
WITH RECURSIVE org_tree AS (
  SELECT id, name, manager_id, 0 AS depth
  FROM employees WHERE manager_id IS NULL        -- anchor: root nodes
  UNION ALL
  SELECT e.id, e.name, e.manager_id, t.depth + 1
  FROM employees e
  JOIN org_tree t ON e.manager_id = t.id         -- recursive step
)
SELECT * FROM org_tree ORDER BY depth, name;
```

### 4. Full-Text Search

```sql
-- Store pre-computed tsvector (fast reads)
ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
  ) STORED;

CREATE INDEX idx_articles_fts ON articles USING GIN (search_vector);

-- Query with ranking
SELECT id, title,
  ts_rank(search_vector, query) AS rank
FROM articles,
     websearch_to_tsquery('english', 'postgresql performance') AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 20;
```

### 5. Transactions & Concurrency

```sql
-- SKIP LOCKED: reliable job queue (workers grab different rows)
BEGIN;
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;

UPDATE jobs SET status = 'processing', started_at = now() WHERE id = $1;
COMMIT;

-- Advisory lock: application-level mutex (no table row needed)
SELECT pg_advisory_xact_lock(hashtext('report_generation'));
-- lock released automatically at transaction end

-- Isolation levels: set per transaction
BEGIN ISOLATION LEVEL REPEATABLE READ;
-- reads see a consistent snapshot; no phantom reads within the transaction
```

### 6. JSONB

```sql
-- Operators: -> returns jsonb, ->> returns text
SELECT data -> 'address' ->> 'city' AS city FROM customers WHERE id = 1;

-- Containment: @> checks if left contains right
SELECT * FROM products WHERE attributes @> '{"color": "red", "in_stock": true}';

-- Update a nested key without overwriting the whole document
UPDATE products
SET attributes = jsonb_set(attributes, '{price}', '29.99')
WHERE id = 42;

-- GIN index for containment / key-exists queries
CREATE INDEX idx_products_attrs ON products USING GIN (attributes);
```

### 7. Performance

```sql
-- Identify slowest queries (requires pg_stat_statements extension)
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC LIMIT 10;

-- Manual VACUUM + ANALYZE after bulk loads
VACUUM ANALYZE orders;

-- Check table bloat
SELECT relname, n_dead_tup, n_live_tup,
  round(n_dead_tup::numeric / nullif(n_live_tup,0) * 100, 1) AS dead_pct
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;
```

**PgBouncer** (transaction mode): set `pool_mode = transaction`, `max_client_conn = 1000`, `default_pool_size = 20`.

---

## Verification Checklist

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` confirms "Index Scan" for hot queries
- [ ] Composite index columns ordered by query selectivity (equality first)
- [ ] Partial indexes used for filtered queries on large tables
- [ ] `tsvector` column is `GENERATED ALWAYS AS … STORED` with GIN index
- [ ] Job queue uses `FOR UPDATE SKIP LOCKED` to prevent double-processing
- [ ] JSONB queries use `@>` operator so GIN index is hit
- [ ] `pg_stat_statements` enabled in production for slow query detection
- [ ] `VACUUM ANALYZE` scheduled or autovacuum tuned for write-heavy tables
- [ ] Connection pooling (PgBouncer) sits between app and Postgres
- [ ] Sensitive data in JSONB is encrypted at the application layer
