# Database Schema — IBM Db2 for i

> Reference for all DB2 knowledge. Updated when schema changes or new tables discovered.

---

## Connection

| Parameter | Value |
|-----------|-------|
| DSN | GMP |
| Default Schema | JAVIER |
| Driver | ODBC (iSeries Access) |
| MCP | `ibm-db2-mcp` (custom wrapper) |

---

## Accessible Schemas

| Schema | Description |
|--------|-------------|
| `JAVIER` | Development/application schema (default) |
| `DSEDAC` | Sales/ventas tables |
| `DSEMAC` | Delivery/entregas tables |
| `DSEO` | Orders/pedidos tables |
| `CLI` | Clients/clientes |
| `LINDTO` | Routes/ruteros |
| `ART` | Products/artículos |
| `CVC` | Commissions/comisiones |
| `VDC` | VDC data |
| `RUT` | Route data |
| `APPUSUARIOS` | Application users |
| `QSYS2` | System catalog |
| `SYSIBM` | IBM catalog |
| `QGPL` | General purpose library |
| `UTID` | Utilities |

---

## Critical Query Rules

### 1. ALWAYS qualify schemas
```sql
-- CORRECT
SELECT * FROM JAVIER.COMMISSION_EXCEPTIONS

-- WRONG (unless schema is in library list)
SELECT * FROM COMMISSION_EXCEPTIONS
```

### 2. ALWAYS use parameterized queries
```sql
-- CORRECT
SELECT * FROM DSEDAC.FACTURA WHERE FACVEN = ?

-- WRONG (SQL injection risk)
SELECT * FROM DSEDAC.FACTURA WHERE FACVEN = '${vendorCode}'
```

### 3. NEVER use SELECT * in production code
```sql
-- CORRECT
SELECT FACVEN, FACFEC, FACIMP FROM DSEDAC.FACTURA

-- WRONG
SELECT * FROM DSEDAC.FACTURA
```

### 4. Vendor 'ALL' = NO WHERE clause
```sql
-- If vendorCode is 'ALL', do NOT add WHERE VENDOR = 'ALL'
-- Instead, query without vendor filter

-- CORRECT for ALL:
SELECT * FROM DSEDAC.FACTURA WHERE FACFEC >= ?

-- CORRECT for specific vendor:
SELECT * FROM DSEDAC.FACTURA WHERE FACVEN = ? AND FACFEC >= ?
```

### 5. RUTERO_CONFIG: ALWAYS filter ORDEN >= 0
```sql
-- CORRECT
SELECT * FROM JAVIER.RUTERO_CONFIG WHERE ORDEN >= 0

-- WRONG (includes deactivated entries)
SELECT * FROM JAVIER.RUTERO_CONFIG
```

---

## IBM i Quirks

| Quirk | Detail |
|-------|--------|
| CCSID | IBM i uses EBCDIC internally; ODBC converts to ASCII |
| Library lists | Schema search order affects unqualified name resolution |
| EVI indexes | Enterprise Vector Indexes available for optimization |
| SYSIXADV | System catalog for index suggestions |
| Naming mode | Use `*SQL` naming (`SCHEMA.TABLE`) over `*SYS` naming |
| Physical vs Logical | Prefer physical files over logical for CREATE VIEW |

---

## Key Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| `FACTURA` | DSEDAC | Sales invoices |
| `CLIENTES` | CLI | Customer master |
| `ARTICULOS` | ART | Product master |
| `RUTERO_CONFIG` | JAVIER | Route configuration |
| `COMMISSION_EXCEPTIONS` | JAVIER | Commission visibility control |
