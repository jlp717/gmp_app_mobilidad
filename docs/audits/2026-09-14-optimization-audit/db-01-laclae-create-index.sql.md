---
title: DB-01 CREATE INDEX LACLAE (solo Javier)
status: blocked
owner: Javier + proveedor ERP
created: 2026-09-16
---

# DB-01 — CREATE INDEX exacto para `DSED.LACLAE`

El ejecutor **no aplica este DDL**. Pegar en STRSQL / ACS fuera de horario comercial. Rollback: `DROP INDEX` a cargo de Javier.

La app ya usa SQL parametrizado sobre `DSED.LACLAE`. Sin este índice, historial ALL 3 años y by-client ALL siguen en rango 6–40 s en frío.

IBM i: **sin `INCLUDE`** (eso es DB2 LUW). Cubrir el `WHERE` de ventas/histórico.

```sql
-- Ventana: fuera de horario comercial. Confirmar que no exista el mismo nombre.
-- QSYS2.SYSTABLES: TABLE_SCHEMA='DSED' AND TABLE_NAME='LACLAE'

CREATE INDEX DSED.IX_LACLAE_YEAR_SALES
  ON DSED.LACLAE (LCAADC, TPDC, LCTPVT, LCCLLN);

CREATE INDEX DSED.IX_LACLAE_APP_HIST
  ON DSED.LACLAE (LCAADC, LCMMDC, LCDDDC, LCTPVT, LCCLLN, LCSRAB);
```

Comprobación post-DDL (solo lectura):

```sql
SELECT INDEX_NAME, COLUMN_NAME, ORDINAL_POSITION
  FROM QSYS2.SYSINDEXSTAT
  JOIN QSYS2.SYSKEYS ON 1=1
 WHERE 1=0;
-- Preferir:
SELECT INDEX_NAME, INDEX_SCHEMA
  FROM QSYS2.SYSTABLEINDEXSTAT
 WHERE TABLE_SCHEMA = 'DSED'
   AND TABLE_NAME = 'LACLAE'
   AND INDEX_NAME IN ('IX_LACLAE_YEAR_SALES', 'IX_LACLAE_APP_HIST');
```

No hay job ETL ni `JAVIER.LACLAE_MONTHLY` en este paquete (sigue BLOCKED spec).
