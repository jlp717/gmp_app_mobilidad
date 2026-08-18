---
name: db2-ibm-i-quirks
description: IBM i (AS/400) Db2 quirks — CCSID, library lists, system naming, EVI indexes, JT400/Mapepire, RRN, DDS legacy.
---

# Skill: db2-ibm-i-quirks — Particularidades de Db2 for i

Complemento al skill `db2-odbc` (que cubre conexion ODBC + Node.js). Aqui se documentan los **comportamientos especificos de IBM i** que no aplican a Db2 LUW ni a Postgres/MySQL.

## CCSID (Coded Character Set ID)

| CCSID | Significado | Cuando aparece |
|---|---|---|
| **1208** | UTF-8 | Conexion DSN GMP la usa. Recomendado para nuevas tablas. |
| **65535** | Binary, sin traduccion | Tablas legacy. Caracteres acentuados pueden venir corruptos. |
| **37** | EBCDIC US | Tablas DDS antiguas. Default en muchos sistemas IBM i. |
| **1141** | EBCDIC Espana | Vista nacional. Frecuente en gmp si hay tablas legacy. |

### Forzar conversion en query
```sql
-- Forzar UTF-8 al leer columna con CCSID 65535
SELECT CAST(NOMBRE AS VARCHAR(50) CCSID 1208) AS NOMBRE
FROM JAVIER.CLIENTES;
```

### Detectar CCSID de columna
```sql
SELECT COLUMN_NAME, CCSID, DATA_TYPE
FROM SYSIBM.SQLCOLUMNS
WHERE TABLE_SCHEM = 'JAVIER' AND TABLE_NAME = 'CLIENTES';
```

## Library List (`*LIBL`)

IBM i tiene un concepto que NO existe en otras BDs: la **library list** asociada al job. Tablas no calificadas se buscan en orden por las librerias del list.

DSN GMP default: `DSEDAC DSEMAC DSEO QTEMP UTID SYSIBM QGPL JAVIER`

### Implicaciones
- `SELECT * FROM CLIENTES` (sin schema) busca `CLIENTES` en cada lib del list, primera coincidencia gana
- Para queries de produccion: SIEMPRE calificar (`JAVIER.CLIENTES`)
- Cambiar el library list afecta **a todas las queries del job**: `CALL QSYS2.QCMDEXC('CHGLIBL LIBL(NEWLIB JAVIER QGPL)')`

## System Naming vs SQL Naming

| Caracteristica | System (`/`) | SQL (`.`) |
|---|---|---|
| Separador | `JAVIER/CLIENTES` | `JAVIER.CLIENTES` |
| Library list | Usada para resolver objetos | Ignorada (calificacion explicita o `CURRENT SCHEMA`) |
| Default schema | Library list activa | Usuario actual o `SET SCHEMA` |
| Driver actual | DSN GMP usa System (`Naming=1`) | JT400 JDBC default es SQL |

**Regla pragmatica**: en codigo de aplicacion siempre `JAVIER.TABLA` (SQL naming). Funciona en ambos modos.

## Encoded Vector Index (EVI) — Especifico IBM i

IBM i tiene un tipo de indice unico: **EVI**. No existe en Postgres ni Db2 LUW.

### Cuando usar EVI
- Columnas con **baja cardinalidad** (status, tipo, vendedor en tabla de >100k filas)
- Reemplaza B-tree en muchos casos: ocupa menos, es mas rapido en COUNT/GROUP BY
- Soporta query "starjoin" — multiples EVIs combinables eficientemente

```sql
-- B-tree tradicional (default CREATE INDEX)
CREATE INDEX JAVIER.IDX_PED_VENDEDOR ON JAVIER.PEDIDOS (VENDEDOR);

-- EVI (mucho mejor para baja cardinalidad)
CREATE ENCODED VECTOR INDEX JAVIER.EVI_PED_VENDEDOR
ON JAVIER.PEDIDOS (VENDEDOR);

-- EVI con WITH n DISTINCT VALUES (hint para optimizer)
CREATE ENCODED VECTOR INDEX JAVIER.EVI_PED_ESTADO
ON JAVIER.PEDIDOS (ESTADO)
WITH 5 DISTINCT VALUES;
```

### Index Advisor (sugiere indices el sistema)
```sql
SELECT TABLE_NAME, KEY_COLUMNS_ADVISED, INDEX_TYPE, TIMES_ADVISED
FROM SYSIXADV
WHERE TABLE_SCHEMA = 'JAVIER'
ORDER BY TIMES_ADVISED DESC
FETCH FIRST 20 ROWS ONLY;
```

## RRN — Relative Record Number

Numero unico interno por registro fisico. Util para deduplicar o referenciar filas exactas sin PK.

```sql
-- Eliminar duplicados conservando el primero (RRN mas bajo)
DELETE FROM JAVIER.CLIENTES C1
WHERE RRN(C1) > (
  SELECT MIN(RRN(C2)) FROM JAVIER.CLIENTES C2
  WHERE C2.CODIGO = C1.CODIGO
);

-- RRN como tiebreaker en SELECT
SELECT *, RRN(T) AS RRN
FROM JAVIER.PEDIDOS T
ORDER BY FECHA, RRN(T);
```

## DDS vs SQL DDL

Tablas legacy IBM i suelen estar definidas en **DDS** (`*FILE`/`PF`/`LF`). Tienen quirks:
- Sin keys SQL formales (constraint definido en DDS, no en catalogo SQL)
- Pueden tener formatos multiples (LF = logical file = vista)
- `ALTER TABLE` puede fallar — usar `CHGPF` (Change Physical File) desde CL
- `DSPFD` (Display File Description) muestra estructura real

**Regla**: nuevas tablas SIEMPRE con `CREATE TABLE` SQL, NO DDS.

## Journaling y Locks

Db2 for i usa **journals** (parecido a WAL Postgres) por defecto en `SYSIBM` libraries. Tablas en JAVIER suelen estar journaled en `QSQJRN`.

### Ver journal de tabla
```sql
SELECT JOURNALED, JOURNAL_NAME, JOURNAL_LIBRARY
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'PEDIDOS';
```

### Lectura sin commit (reportes)
```sql
-- Para reportes read-only en tablas con escritura concurrente
SELECT * FROM JAVIER.PEDIDOS
WITH UR;  -- Uncommitted Read (mas rapido, puede ver datos no commiteados)

-- Sin journaling activo
SELECT * FROM JAVIER.STAT_TABLE WITH NC;  -- No Commit
```

## Connectors Comparados

| Connector | Driver | Para que | Pros | Contras |
|---|---|---|---|---|
| **ODBC iSeries Access** | iSeries Access | Backend Node.js (`odbc` package) | Estable, soporta Kerberos | Requiere driver Windows; no portable |
| **JT400 JDBC** | Java pure | `mcp-server-db2i`, apps Java | Cero install IBM i; cross-platform | Requiere Java 11+; un poco mas lento |
| **Mapepire** | Java daemon en IBM i + WS | `@ibm/ibmi-mcp-server`, modernos | Mas rapido, observabilidad | Requiere instalar daemon en IBM i |
| **DRDA (`db2connect`)** | IBM Db2 client | Apps Db2 LUW que conectan a Db2 i | Compat con tooling Db2 | Licencia IBM Db2 Connect |

## Comandos CL utiles desde SQL
```sql
-- Ejecutar comando CL desde SQL
CALL QSYS2.QCMDEXC('CHGCURLIB CURLIB(JAVIER)');
CALL QSYS2.QCMDEXC('DSPFD FILE(JAVIER/PEDIDOS) OUTPUT(*PRINT)');

-- Listar jobs activos (util para debugging connections)
SELECT JOB_NAME, JOB_USER, SUBSYSTEM, STATUS
FROM TABLE(QSYS2.ACTIVE_JOB_INFO()) X
WHERE JOB_USER = 'JAVIER';

-- Ver locks actuales
SELECT * FROM QSYS2.RECORD_LOCK_INFO
WHERE TABLE_SCHEMA = 'JAVIER';
```

## Fechas Legacy (DECIMAL(8) YYYYMMDD)

Tablas viejas guardan fechas como `DECIMAL(8,0)` en formato YYYYMMDD. Conversion:

```sql
-- DECIMAL(8) → DATE
SELECT DATE(
  SUBSTR(DIGITS(FECHADEC), 1, 4) || '-' ||
  SUBSTR(DIGITS(FECHADEC), 5, 2) || '-' ||
  SUBSTR(DIGITS(FECHADEC), 7, 2)
) AS FECHA_REAL
FROM JAVIER.PEDIDOS_LEGACY;

-- DATE → DECIMAL(8) para insertar en tabla legacy
INSERT INTO JAVIER.PEDIDOS_LEGACY (FECHA)
VALUES (DEC(REPLACE(CHAR(CURRENT_DATE), '-', ''), 8, 0));
```

## Troubleshooting Especifico IBM i

| Error | Causa | Solucion |
|---|---|---|
| `SQL0901` reason 67 | Tabla bloqueada por journal | Verificar transacciones largas; `WITH UR` para read-only |
| `CPF4131` levels list mismatch | DDS file recompilado, app vieja | Recompilar, o regenerar SQL package |
| `SQL0666` query exceeds resource limit | Query timeout (QAQQINI) | Ajustar `QUERY_TIME_LIMIT` o `SET QUERY_TIMEOUT` |
| Caracteres acentuados rotos | CCSID mismatch | Forzar `CAST AS VARCHAR(n) CCSID 1208` |
| Performance pobre tras ALTER | Estadisticas desactualizadas | `RGZPFM` (REORG), `UPDDB STATS` |

## Referencias internas
- DSN GMP attributes: ver memoria `reference_opencode_paths.md`
- Backend connection: `backend/config/db.js` (NO modificar segun reglas proyecto)
- Schema list: ver skill `db2-odbc`
