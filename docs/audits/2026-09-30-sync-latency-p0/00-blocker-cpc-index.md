---
title: BLOCKER — índice CPC order-status (rutero/day)
status: BLOCKER
owner: Javier + proveedor ERP
created: 2026-09-30
---

# BLOCKER · índice DB2 para order-status sargable

**Causa:** `GET /rutero/day` (overlay CPC + `PEDIDOS_CAB`) ya usa predicados sargables
(`CODIGOCLIENTEALBARAN IN (CAST(? AS CHAR(10)))` + `ANO/MES/DIA DOCUMENTO`, sin `TRIM`
en WHERE de claves). Sin índice alineado, DB2 puede seguir haciendo table/index scan
sobre CPC en flotas grandes (jefe ALL / día denso).

**REQUIERE:** Javier + proveedor ERP. **PROHIBIDO** `CREATE INDEX` / ALTER desde el
ejecutor o contra prod sin aprobación.

## Índice candidato (solo propuesta)

```sql
-- Revisar nombre/colisión en QSYS2.SYSINDEXES antes de aplicar.
-- Ventana: fuera de horario comercial. Rollback: DROP INDEX a cargo del proveedor.
CREATE INDEX JAVIER_IX_CPC_CLI_DOC
  ON DSEDAC.CPC (
    CODIGOCLIENTEALBARAN,
    ANODOCUMENTO,
    MESDOCUMENTO,
    DIADOCUMENTO
  );
```

Opcional (overlay app, schema escritura):

```sql
-- Solo JAVIER / TEST — no DSEDAC. Pedir confirmación de volumen TEST_PEDIDOS_CAB.
CREATE INDEX JAVIER_IX_PEDIDOS_CAB_CLI_DOC
  ON JAVIER.PEDIDOS_CAB (
    CODIGOCLIENTE,
    ANODOCUMENTO,
    MESDOCUMENTO,
    DIADOCUMENTO
  );
```

## Verificación (solo lectura)

1. `QSYS2.SYSINDEXES` / `SYSTABLEINDEXSTAT` sobre `DSEDAC.CPC` — ¿existe ya un índice
   líder por `CODIGOCLIENTEALBARAN` + fecha?
2. Tras DDL aprobado: medir `[servidor]` `GET /rutero/day/:day` jefe + comercial
   (cold/warm Redis). No afirmar `[campo]`.
3. Confirmar que objetivos/comisiones/LY siguen en frontera PROD intacta (este índice
   no cambia semántica).

## Go / no-go

Pendiente de Javier. Código app (UNION + sargable + cache v4) puede desplegarse sin
el índice; el índice es la mitigación DB2 residual.
