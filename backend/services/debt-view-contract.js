'use strict';

const { comercialErpTable } = require('../utils/comercial-erp-tables');

const DEBT_FETCH_FIRST_MAX = 500;
const CVC_LIVE_TYPES = Object.freeze(['COB', 'CAC', 'PGC', 'PGP', 'PAG', 'CNP', 'DEV']);

const DEBT_COLUMNS = Object.freeze({
  clientCode: 'CODIGOCLIENTEALBARAN',
  pendingAmount: 'IMPORTEPENDIENTE',
  dueYear: 'ANOVENCIMIENTO',
  dueMonth: 'MESVENCIMIENTO',
  dueDay: 'DIAVENCIMIENTO',
  cancelled: 'ANULADOSN',
  clientName: 'NOMBRECLIENTE',
  clientAltName: 'NOMBREALTERNATIVO',
  vendorCode: 'CODIGOVENDEDOR',
  documentSeries: 'SERIEDOCUMENTO',
  documentNumber: 'NUMERODOCUMENTO',
});

function getDebtView() {
  return comercialErpTable('CVC');
}

function debtViewFrom(alias = 'CVC') {
  return `FROM ${getDebtView()} ${alias}`;
}

function cvcPendingPredicate(alias = 'CVC') {
  return `${alias}.IMPORTEPENDIENTE <> 0 AND (${alias}.ANULADOSN IS NULL OR ${alias}.ANULADOSN <> 'S')`;
}

function cvcLiveTypeSql(alias = 'CVC') {
  return `AND TRIM(${alias}.TIPODOCUMENTO) IN (${CVC_LIVE_TYPES.map((type) => `'${type}'`).join(', ')})`;
}

function cvcPendientesJoins(alias = 'C') {
  const fpg = comercialErpTable('FPG');
  return `
            LEFT JOIN ${fpg} FPG
              ON FPG.CODIGOFORMAPAGO = ${alias}.CODIGOFORMAPAGO`;
}

// QSYS2 verified: CPC identifies an albaran; CAC rows aggregate an invoice.
// Complete identities and one CPC revision prevent join multiplication.
function cvcDocumentAmountJoins(alias = 'C', { clientScoped = false, scopeCte = false } = {}) {
  const cpc = comercialErpTable('CPC');
  const cac = comercialErpTable('CAC');
  const cvc = getDebtView();
  return `
    LEFT JOIN (
      SELECT * FROM (
        SELECT P.SUBEMPRESAALBARAN, P.EJERCICIOALBARAN, P.SERIEALBARAN,
               P.TERMINALALBARAN, P.NUMEROALBARAN, P.CODIGOCLIENTEALBARAN, P.IMPORTETOTAL,
               ROW_NUMBER() OVER (PARTITION BY P.SUBEMPRESAALBARAN, P.EJERCICIOALBARAN,
                 P.SERIEALBARAN, P.TERMINALALBARAN, P.NUMEROALBARAN, P.CODIGOCLIENTEALBARAN
                 ORDER BY P.ID DESC) AS RN
          FROM ${cpc} P
          ${clientScoped ? 'WHERE P.CODIGOCLIENTEALBARAN = CAST(? AS CHAR(10))' : scopeCte ? `WHERE EXISTS (
            SELECT 1 FROM CVC_SCOPE S WHERE S.ORIGENDOCUMENTO = 'B'
              AND S.SUBEMPRESADOCUMENTO=P.SUBEMPRESAALBARAN AND S.EJERCICIODOCUMENTO=P.EJERCICIOALBARAN
              AND S.SERIEDOCUMENTO=P.SERIEALBARAN AND S.TERMINALDOCUMENTO=P.TERMINALALBARAN
              AND S.NUMERODOCUMENTO=P.NUMEROALBARAN AND S.CODIGOCLIENTEALBARAN=P.CODIGOCLIENTEALBARAN)` : ''}
      ) R WHERE RN = 1
    ) CPC_DOC
      ON CPC_DOC.SUBEMPRESAALBARAN = ${alias}.SUBEMPRESADOCUMENTO
     AND CPC_DOC.EJERCICIOALBARAN = ${alias}.EJERCICIODOCUMENTO
     AND CPC_DOC.SERIEALBARAN = ${alias}.SERIEDOCUMENTO
     AND CPC_DOC.TERMINALALBARAN = ${alias}.TERMINALDOCUMENTO
     AND CPC_DOC.NUMEROALBARAN = ${alias}.NUMERODOCUMENTO
     AND CPC_DOC.CODIGOCLIENTEALBARAN = ${alias}.CODIGOCLIENTEALBARAN
     AND ${alias}.ORIGENDOCUMENTO = 'B'
    LEFT JOIN (
      SELECT F.SUBEMPRESAFACTURA, F.EJERCICIOFACTURA, F.SERIEFACTURA,
             F.TERMINALFACTURA, F.NUMEROFACTURA, F.CODIGOCLIENTEFACTURA,
             SUM(F.IMPORTETOTAL) AS IMPORTETOTAL
        FROM ${cac} F
        ${clientScoped ? `WHERE F.CODIGOCLIENTEFACTURA IN (
          SELECT COALESCE(NULLIF(V.CODIGOCLIENTEFACTURA, ''), V.CODIGOCLIENTEALBARAN)
            FROM ${cvc} V WHERE V.CODIGOCLIENTEALBARAN = CAST(? AS CHAR(10)))` : scopeCte ? `WHERE EXISTS (
          SELECT 1 FROM CVC_SCOPE S WHERE S.ORIGENDOCUMENTO <> 'B'
            AND S.SUBEMPRESADOCUMENTO=F.SUBEMPRESAFACTURA AND S.EJERCICIODOCUMENTO=F.EJERCICIOFACTURA
            AND S.SERIEDOCUMENTO=F.SERIEFACTURA AND S.TERMINALDOCUMENTO=F.TERMINALFACTURA
            AND S.NUMERODOCUMENTO=F.NUMEROFACTURA
            AND COALESCE(NULLIF(S.CODIGOCLIENTEFACTURA, ''), S.CODIGOCLIENTEALBARAN)=F.CODIGOCLIENTEFACTURA)` : ''}
       GROUP BY F.SUBEMPRESAFACTURA, F.EJERCICIOFACTURA, F.SERIEFACTURA,
                F.TERMINALFACTURA, F.NUMEROFACTURA, F.CODIGOCLIENTEFACTURA
    ) CAC_DOC
      ON CAC_DOC.SUBEMPRESAFACTURA = ${alias}.SUBEMPRESADOCUMENTO
     AND CAC_DOC.EJERCICIOFACTURA = ${alias}.EJERCICIODOCUMENTO
     AND CAC_DOC.SERIEFACTURA = ${alias}.SERIEDOCUMENTO
     AND CAC_DOC.TERMINALFACTURA = ${alias}.TERMINALDOCUMENTO
     AND CAC_DOC.NUMEROFACTURA = ${alias}.NUMERODOCUMENTO
     AND CAC_DOC.CODIGOCLIENTEFACTURA = COALESCE(NULLIF(${alias}.CODIGOCLIENTEFACTURA, ''), ${alias}.CODIGOCLIENTEALBARAN)
     AND ${alias}.ORIGENDOCUMENTO <> 'B'`;
}

function cvcDocumentAmountSql(alias = 'C') {
  // QSYS2/live CVC verified: PGC/F is a portfolio effect, with its own face value.
  // Its reference is not a CAC invoice identity. Unknown origins remain non-payable.
  return `(CASE
    WHEN ${alias}.TIPODOCUMENTO = 'CAC' AND ${alias}.ORIGENDOCUMENTO = 'B' THEN CPC_DOC.IMPORTETOTAL
    WHEN ${alias}.TIPODOCUMENTO = 'COB' AND ${alias}.ORIGENDOCUMENTO = 'F' THEN CAC_DOC.IMPORTETOTAL
    WHEN ${alias}.TIPODOCUMENTO = 'PGC' AND ${alias}.ORIGENDOCUMENTO = 'F' THEN ${alias}.IMPORTEVENCIMIENTO
    ELSE NULL END)`;
}

function cvcDocumentJoins(alias = 'C') {
  const cac = comercialErpTable('CAC');
  const cpc = comercialErpTable('CPC');
  const fpg = comercialErpTable('FPG');
  return `
            LEFT JOIN ${cac} CAC
              ON ${alias}.EJERCICIODOCUMENTO = CAC.EJERCICIOFACTURA
             AND TRIM(${alias}.SERIEDOCUMENTO) = TRIM(CAC.SERIEFACTURA)
             AND ${alias}.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            LEFT JOIN ${cpc} CPC
              ON ${alias}.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
             AND TRIM(${alias}.SERIEDOCUMENTO) = TRIM(CPC.SERIEALBARAN)
             AND ${alias}.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
             AND ${alias}.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            LEFT JOIN ${fpg} FPG
              ON FPG.CODIGOFORMAPAGO = ${alias}.CODIGOFORMAPAGO`;
}

function cvcCliJoin(alias = 'CVC') {
  const cli = comercialErpTable('CLI');
  return `LEFT JOIN ${cli} CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(${alias}.CODIGOCLIENTEALBARAN)`;
}

function formaPagoLabel(code, fpgDescription) {
  const description = String(fpgDescription || '').trim();
  if (description) return description;
  const normalized = String(code || '').trim().toUpperCase();
  if (normalized === 'PG') return 'PAGARE';
  return String(code || '').trim() || null;
}

function boundDebtFetchFirst(limit, fallback = DEBT_FETCH_FIRST_MAX) {
  const parsed = Number.parseInt(limit, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(DEBT_FETCH_FIRST_MAX, Math.max(1, safe));
}

function minCobroAmount(pendingAmount, porcentaje) {
  const pending = Number(pendingAmount) || 0;
  const pct = Number(porcentaje) || 0;
  if (pending <= 0 || pct <= 0) return 0;
  return Math.round(pending * pct) / 100;
}

function capPendingToDocument(pendingAmount, documentAmount) {
  const pending = Number(pendingAmount) || 0;
  const document = Number(documentAmount) || 0;
  if (document <= 0) return Math.max(0, pending);
  return Math.max(0, Math.min(pending, document));
}

function isBelowMinCobro({ cobroRiguroso, porcentajeMinimoCobro, pendingAmount, amount }) {
  if (cobroRiguroso !== true) return false;
  const min = minCobroAmount(pendingAmount, porcentajeMinimoCobro);
  if (min <= 0) return false;
  const paid = Number(amount) || 0;
  const pending = Number(pendingAmount) || 0;
  if (paid + 0.0001 >= pending) return false;
  return paid + 0.0001 < min;
}

module.exports = {
  get DEBT_VIEW() {
    return getDebtView();
  },
  getDebtView,
  DEBT_FETCH_FIRST_MAX,
  CVC_LIVE_TYPES,
  DEBT_COLUMNS,
  debtViewFrom,
  cvcPendingPredicate,
  cvcLiveTypeSql,
  cvcDocumentJoins,
  cvcPendientesJoins,
  cvcDocumentAmountJoins,
  cvcDocumentAmountSql,
  cvcCliJoin,
  formaPagoLabel,
  boundDebtFetchFirst,
  minCobroAmount,
  capPendingToDocument,
  isBelowMinCobro,
};
