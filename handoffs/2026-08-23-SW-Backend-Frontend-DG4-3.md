# D-G4-3 handoff 2026-08-23

## PASS
- Close de prueba escribe **solo** `JAVIER.LQD` (LIKE `DSEDAC.LQD`).
- Deuda se **lee** de `DSEDAC.LQD.IMPORTESALDOACTUAL` (ultima fila por `CODIGOVENDEDOR`).
- 0 INSERT/UPDATE `DSEDAC`. Smoke token `G4DG43SMOKE01` en DSEDAC.LQD = 0.
- `JAVIER.LQD` ya existia; no hizo falta CREATE LIKE.
- PDF: `buildLiquidacionPdfBuffer` (pdfkit, memoria). GET `/api/repartidor-finanzas/liquidaciones/:idempotencyToken/pdf?repartidorId=`.
- POST close `/api/repartidor-finanzas/liquidaciones` body `{ repartidorId, date, idempotencyToken }` (totals → 422).
- Token vive en `JAVIER.LQD.IDMARCALIQUIDACION` CHAR(30).
- `ID` en LQD **no es identity**: el INSERT pone `MAX(ID)+1`.
- Form lines: `DSEDAC.LQDL1` (no inventar LIQDIACUE).
- 0 TESTMOVIL. 0 Cloud. Local `gmp_app_mobilidad`.

## Paths
- `backend/config/reparto-runtime.js` (`liquidationOps: JAVIER.LQD`, `G4_DSEDAC_ERP_MAPPING`)
- `backend/repositories/repartidor-liquidacion-db2-repository.js`
- `backend/services/repartidor-finance-service.js` (`getSaldoActual`)
- `docs/repartidor-finance-production-mapping.md`

## Frontend
Replay PDF desde token en `JAVIER.LQD`. No pedir close sobre TESTMOVIL. No pintar deuda de VDD.
