/**
 * G4 DSEDAC ERP mapping (D-G4-2, 2026-08-23).
 *
 * Founder canceló TESTMOVIL: los nombres largos LIQUIDIARI/VENDEDORES/LIQDIACUE
 * no existen en DSEDAC. Catalog (DSN=GMP): DSEDAC.LQD, DSEDAC.VDD (sin SALDOACTUAL),
 * sin LIQDIACUE. Vive en modulo propio para que el runtime de reparto quede libre
 * de identificadores LQD (contrato repartidor-finance-schema-fail-closed).
 */
const G4_DSEDAC_ERP_MAPPING = Object.freeze({
  tableSet: 'production',
  testmovil: 'ANULADO',
  deudaRead: 'DSEDAC.LQD.IMPORTESALDOACTUAL',
  closeWrite: 'JAVIER.LQD',
  vendedores: 'DSEDAC.VDD',
  vendedoresSaldoColumn: null,
  formLines: 'DSEDAC.LQDL1',
  liqdiacue: null,
});

module.exports = { G4_DSEDAC_ERP_MAPPING };
