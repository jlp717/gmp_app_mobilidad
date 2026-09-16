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
  cvcCliJoin,
  formaPagoLabel,
  boundDebtFetchFirst,
  minCobroAmount,
  isBelowMinCobro,
};
