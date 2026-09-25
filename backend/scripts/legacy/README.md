# Legacy VISTA_DEUDA_BASE scripts (archivados F4-02)

Estos scripts recreaban la vista muerta `VISTA_DEUDA_BASE`. Estan archivados
aqui solo como referencia historica. NO ejecutarlos contra DB2 sin cadena
PROD completa y aprobacion explicita de Javier.

Fuente canon de deuda: `DSEDAC.CVC` en lectura via
`backend/services/debt-view-contract.js`:

- `getDebtView()` / `debtViewFrom()` — `FROM DSEDAC.CVC`.
- `cvcDocumentAmountJoins()` — identidad completa CAC/CPC con dedup CPC por
  `ROW_NUMBER()` (usar siempre en lugar del deprecated `cvcDocumentJoins`).
- `cvcDocumentAmountSql()` — importe cobrable del documento.
- `cvcPendientesJoins()` / `cvcCliJoin()` — FPG/CLI.

Cero `require` hacia estos scripts desde codigo productivo (verificado
2026-09-24 via `Select-String require.*create_view` sin resultados).
