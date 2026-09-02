'use strict';

const DEBT_VIEW = 'JAVIER.VISTA_DEUDA_BASE';
const DEBT_FETCH_FIRST_MAX = 500;

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

function debtViewFrom(alias = 'CVC') {
  return `FROM ${DEBT_VIEW} ${alias}`;
}

function boundDebtFetchFirst(limit, fallback = DEBT_FETCH_FIRST_MAX) {
  const parsed = Number.parseInt(limit, 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(DEBT_FETCH_FIRST_MAX, Math.max(1, safe));
}

module.exports = {
  DEBT_VIEW,
  DEBT_FETCH_FIRST_MAX,
  DEBT_COLUMNS,
  debtViewFrom,
  boundDebtFetchFirst,
};
