---
name: db2-query-patterns
description: IBM Db2 for i query patterns for GMP project. Covers common queries, optimization, schema conventions, and ODBC best practices.
---

# DB2 for i Query Patterns — GMP Project

## Schema Conventions

All tables are qualified with schema:
- `JAVIER.` — Development tables
- `DSEDAC.` — Production sales data
- `DSEMAC.` — Production commercial data
- `DSEO.` — Production orders
- `CLI.` — Client data
- `ART.` — Article/product data

**NEVER** use unqualified table names. ALWAYS use `SCHEMA.TABLE`.

## Common Query Patterns

### Vendor Filter with 'ALL' Special Case
```sql
-- When vendedor = 'ALL', query ALL vendors (no WHERE filter)
-- When vendedor = specific code, filter by that vendor
-- WRONG: WHERE VENDEDOR = 'ALL' (this returns nothing)
-- CORRECT:
SELECT * FROM JAVIER.PEDIDOS
WHERE (:vendedor = 'ALL' OR VENDEDOR = :vendedor)
  AND ORDEN >= 0
```

### RUTERO_CONFIG — Filter Blocking Entries
```sql
-- ALWAYS filter ORDEN >= 0 to exclude blocking entries
SELECT * FROM JAVIER.RUTERO_CONFIG
WHERE ORDEN >= 0
  AND VENDEDOR = :vendedor
ORDER BY ORDEN
```

### Pagination (Db2 for i style)
```sql
-- Use FETCH FIRST, not LIMIT
SELECT * FROM JAVIER.PEDIDOS
WHERE VENDEDOR = :vendedor
ORDER BY FECHA DESC
FETCH FIRST 50 ROWS ONLY
```

### Date Filtering
```sql
-- Db2 for i date functions
SELECT * FROM JAVIER.PEDIDOS
WHERE YEAR(FECHA) = YEAR(CURRENT_DATE)
  AND MONTH(FECHA) = MONTH(CURRENT_DATE)

-- Date range
SELECT * FROM JAVIER.PEDIDOS
WHERE FECHA BETWEEN :startDate AND :endDate
```

### Aggregation with Vendor Grouping
```sql
SELECT
  VENDEDOR,
  COUNT(*) AS TOTAL_PEDIDOS,
  SUM(IMPORTE) AS TOTAL_IMPORTE,
  AVG(IMPORTE) AS PROMEDIO
FROM JAVIER.PEDIDOS
WHERE FECHA >= CURRENT_DATE - 30 DAYS
GROUP BY VENDEDOR
ORDER BY TOTAL_IMPORTE DESC
```

### JOIN Pattern
```sql
SELECT
  p.PEDIDO_ID,
  p.CLIENTE,
  c.NOMBRE AS CLIENTE_NOMBRE,
  p.IMPORTE,
  a.DESCRIPCION AS ARTICULO
FROM JAVIER.PEDIDOS p
LEFT JOIN CLI.CLIENTES c ON p.CLIENTE = c.CODIGO
LEFT JOIN ART.ARTICULOS a ON p.ARTICULO = a.CODIGO
WHERE p.VENDEDOR = :vendedor
ORDER BY p.FECHA DESC
```

## ODBC Best Practices

### Parameterized Queries (ALWAYS)
```javascript
// CORRECT
const result = await db.query(
  'SELECT * FROM JAVIER.PEDIDOS WHERE VENDEDOR = ? AND FECHA >= ?',
  [vendedor, startDate]
);

// WRONG - SQL injection risk
const result = await db.query(
  `SELECT * FROM JAVIER.PEDIDOS WHERE VENDEDOR = '${vendedor}'`
);
```

### Error Handling
```javascript
try {
  const result = await db.query(sql, params);
  return result;
} catch (error) {
  // Log with context
  logger.error('DB2 query failed', {
    sql: sql.substring(0, 100), // Don't log full SQL with params
    params: params.map(p => typeof p),
    error: error.message
  });
  throw new DatabaseError('Query failed', error);
}
```

## Performance Optimization

### Index Recommendations
```sql
-- For vendor + date queries
CREATE INDEX JAVIER.IDX_PEDIDOS_VENDEDOR_FECHA
ON JAVIER.PEDIDOS (VENDEDOR, FECHA DESC)

-- For client lookups
CREATE INDEX JAVIER.IDX_PEDIDOS_CLIENTE
ON JAVIER.PEDIDOS (CLIENTE)

-- Check index suggestions
CALL QSYS2.SYSIXADV('JAVIER', 'PEDIDOS')
```

### Avoid N+1 Queries
```javascript
// WRONG - N+1
const pedidos = await db.query('SELECT * FROM JAVIER.PEDIDOS');
for (const pedido of pedidos) {
  const cliente = await db.query(
    'SELECT * FROM CLI.CLIENTES WHERE CODIGO = ?',
    [pedido.CLIENTE]
  );
}

// CORRECT - Single query with JOIN
const result = await db.query(`
  SELECT p.*, c.NOMBRE AS CLIENTE_NOMBRE
  FROM JAVIER.PEDIDOS p
  LEFT JOIN CLI.CLIENTES c ON p.CLIENTE = c.CODIGO
`);
```

## Project-Specific Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| PEDIDOS | JAVIER | Orders |
| CLIENTES | CLI | Client master data |
| ARTICULOS | ART | Product catalog |
| RUTERO_CONFIG | JAVIER | Route configuration |
| COBROS | JAVIER | Payments/collections |
| ALBARANES | JAVIER | Delivery notes |
| VENDEDORES | JAVIER | Sales reps |

## CCSID Notes

- Db2 for i uses CCSID for character encoding
- If you see garbled text, check CCSID mismatch
- Use `CCSID(37)` for US English, `CCSID(284)` for Spanish
- Connection string should specify CCSID if needed
