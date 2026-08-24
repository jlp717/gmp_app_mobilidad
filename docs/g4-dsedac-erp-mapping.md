# D-G4-2 DSEDAC ERP mapping

TESTMOVIL G4: ANULADO (fundador 2026-08-23 03:06).

Catalog DSN=GMP:

- Liquidacion: `DSEDAC.LQD` (long name LIQUIDIARI does not exist here)
- Vendedores: `DSEDAC.VDD` (no SALDOACTUAL column)
- LIQDIACUE: absent in DSEDAC

Runtime: `G4_DSEDAC_ERP_MAPPING` in `backend/config/reparto-runtime.js`.
Production `liquidationOps` = `DSEDAC.LQD`.
No bulk saldo UPDATE.
