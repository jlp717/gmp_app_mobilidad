---
name: db2-odbc
description: IBM DB2, ODBC, stored procedures.
---

# Skill: db2-odbc — IBM DB2 con ODBC

Guía de trabajo con IBM DB2 en gmp_app_mobilidad. Esquemas, queries seguras, patrones Node.js.

## Configuración ODBC

### DSN y Schemas
- **DSN**: `'GMP'` (datasource name en ODBC.ini)
- **Schema principal**: `JAVIER`
- **Schemas de referencia**:
  | Schema | Contenido |
  |--------|-----------|
  | `JAVIER` | Tablas principales de la app |
  | `CLI` | Clientes |
  | `LINDTO` | Líneas de pedido / DTOs |
  | `ART` | Artículos / productos |
  | `CVC` | Cabeceras de pedido |
  | `VDC` | Vendedores |
  | `RUT` | Rutas de reparto |
  | `APPUSUARIOS` | Usuarios de la aplicación |

### Conexión ODBC (Node.js)
```javascript
const odbc = require('odbc');

// Pool de conexiones (no crear nuevas conexiones por request)
const pool = await odbc.pool({
  connectionString: 'DSN=GMP;',
  initialSize: 5,
  maxSize: 20,
  connectionTimeout: 10,
  loginTimeout: 10,
});

// Uso correcto con release
const connection = await pool.connect();
try {
  const result = await connection.query('SELECT * FROM JAVIER.TABLA WHERE ID = ?', [id]);
  return result;
} finally {
  await connection.close(); // liberar al pool SIEMPRE
}
```

## Reglas de Seguridad (CRÍTICAS)

### Queries SIEMPRE parametrizadas
```javascript
// ✅ CORRECTO
const rows = await conn.query(
  'SELECT CODIGO, NOMBRE FROM JAVIER.CLI WHERE VENDEDOR = ?',
  [vendedorId]
);

// 🚫 PROHIBIDO — SQL Injection
const rows = await conn.query(
  `SELECT * FROM JAVIER.CLI WHERE VENDEDOR = '${vendedorId}'`
);
```

### Vendor code 'ALL'
```javascript
// ✅ CORRECTO: 'ALL' significa todos los vendedores
const query = vendedor === 'ALL'
  ? 'SELECT * FROM JAVIER.VDC'                      // sin filtro
  : 'SELECT * FROM JAVIER.VDC WHERE VENDEDOR = ?';  // con filtro

// 🚫 PROHIBIDO
WHERE VENDEDOR = 'ALL'  // Esta condición no retorna nada útil
```

## Patrones Comunes

### Paginación en DB2
```sql
SELECT * FROM JAVIER.CLI
ORDER BY CODIGO
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
-- params: [offset, pageSize]
```

### Transacciones
```javascript
const conn = await pool.connect();
try {
  await conn.beginTransaction();
  await conn.query('UPDATE JAVIER.CVC SET ESTADO = ? WHERE ID = ?', ['CONFIRMADO', id]);
  await conn.query('INSERT INTO JAVIER.LINDTO ...', [...params]);
  await conn.commit();
} catch (err) {
  await conn.rollback();
  throw err;
} finally {
  await conn.close();
}
```

### Stored Procedures
```javascript
// Llamada a stored procedure
const result = await conn.callProcedure('JAVIER', 'SP_CONFIRMAR_PEDIDO', [pedidoId, userId]);
```

## Operaciones DDL — Protocolo de Seguridad
1. **Backup verificado** ANTES de cualquier ALTER/CREATE/DROP
2. **Script de rollback** preparado y validado
3. **Test en entorno de desarrollo** primero
4. **REORG TABLE** tras ALTER TABLE en tablas grandes
5. **RUNSTATS** para actualizar estadísticas de índices
6. **NUNCA DROP TABLE** sin autorización explícita del propietario del sistema

## Troubleshooting Frecuente
| Error | Causa | Solución |
|-------|-------|---------|
| `SQL0204N` | Tabla/objeto no existe | Verificar schema correcto (JAVIER.) |
| `SQL0803N` | Duplicate key | Verificar unicidad antes de INSERT |
| `SQL0911N` | Deadlock/timeout | Revisar transacciones largas, REORG |
| `ODBC connection timeout` | Pool agotado | Aumentar maxSize o revisar leaks de conexiones |
