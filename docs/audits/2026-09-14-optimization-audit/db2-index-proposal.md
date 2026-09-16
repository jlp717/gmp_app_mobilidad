---
title: Propuesta de índices DSEDAC (DB-02)
status: proposal
owner: Javier + proveedor ERP
created: 2026-09-15
---

# DB-02 — Índices DSEDAC (documento; DDL prohibido al ejecutor)

Este fichero es una propuesta para Javier y el proveedor del ERP. **No se ha ejecutado ningún `CREATE INDEX` ni ALTER.** Los objetos viven en `DSEDAC` (ERP). El ejecutor no puede aplicarlos.

Fuente: `QSYS2.SYSIXADV` (auditoría 2026-09-14). `SYSTABLEINDEXSTAT`: CAC hoy tiene `CACL1-4` (líder `SUBEMPRESA*`) + PK.

## Sentencias propuestas (revisar nombres/colisiones antes de aplicar)

```sql
-- SYSIXADV ~35.6M avisos. CAC ~750k filas. Ventana: fuera de horario comercial.
CREATE INDEX JAVIER_IX_CAC_ALB
  ON DSEDAC.CAC (EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN);

-- SYSIXADV ~84.5M avisos (EJERCICIOFACTURA, NUMEROFACTURA) — no incluido en las 4
-- sentencias mínimas del spec; registrar si el proveedor quiere un quinto índice.

CREATE INDEX JAVIER_IX_CPC_SIT_VEND
  ON DSEDAC.CPC (SITUACIONPEDIDO, CODIGOVENDEDOR);

CREATE INDEX JAVIER_IX_CPC_SIT
  ON DSEDAC.CPC (SITUACIONALBARAN, SITUACIONPEDIDO);

CREATE INDEX JAVIER_IX_LAC_CLI_ART
  ON DSEDAC.LAC (CODIGOCLIENTEALBARAN, CODIGOARTICULO);

-- 2026-09-16 [servidor]: GET /objectives/by-client ALL ~15 s
--   SELECT LCCDCL, SUM(LCIMVT), SUM(LCIMCT)
--   FROM DSED.LACLAE
--   WHERE LCAADC = ? AND TPDC='LAC' AND LCTPVT IN ('CC','VC')
--     AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z','G','D')
--   GROUP BY LCCDCL ORDER BY SUM(LCIMVT) DESC FETCH FIRST 100 ROWS ONLY
-- Cubrir año + filtros de venta. DSED.LACLAE es ERP; solo Javier/proveedor.
-- CREATE INDEX JAVIER_IX_LACLAE_YEAR_SALES
--   ON DSED.LACLAE (LCAADC, TPDC, LCTPVT, LCCLLN)
--   INCLUDE (LCCDCL, LCIMVT, LCIMCT, LCSRAB, LCMMDC);

```

Coste estimado: clave de 4 columnas CHAR/SMALLINT × ~750k filas en CAC ≈ minutos en AS400 fuera de pico. CPC/LAC dependen del volumen real; pedir `SYSTABLESTAT` al proveedor antes de go.

## Medición (antes/después, solo lectura)

Repetir en ventana nocturna, sin DDL desde la app:

1. Q7 (EXISTS a CAC, 1 mes) — baseline auditoría 0,9 s.
2. Conteos `SLOW_QUERY` 7 días: `/rutero/day`, `/facturas/summary` (1.008 SLOW sobre CAC), `/pedidos/*`.
3. No hay `EXPLAIN` útil en este entorno: timing directo + logs.

## Go / no-go

Pendiente de Javier + proveedor. Rollback: `DROP INDEX` a cargo del proveedor, no del ejecutor.

Índices de app (`JAVIER.*`) siguen en `backend/docs/recommended-indices.sql` y no sustituyen estos de ERP.
