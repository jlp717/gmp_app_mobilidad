'use strict';

/**
 * Canonical resolver for collectable delivery amounts in the repartidor rutero.
 *
 * ERP timing (catch-weight / variable price):
 * - OPP → CPC/LAC may land with qty before CPC.IMPORTETOTAL / LAC.IMPORTEVENTA are closed.
 * - CAC often receives the priced header later (PDF path already prefers CAC tax stack).
 *
 * Rules:
 * - Prefer gross-with-IVA headers: CPC.IMPORTETOTAL → CAC.IMPORTETOTAL → CPC tax stack → CAC tax stack.
 * - Never treat LAC.IMPORTEVENTA as cobro total (net of VAT) except as PROVISIONAL_NET diagnostic.
 * - PENDING_PRICE: qty lines exist while all gross sources are ~0 and lines still lack sale amount.
 * - ZERO_EMPTY: no qty lines and amount ~0 (true empty / prepaid-zero path).
 */

const MONEY_EPS = 0.005;
const SENTINEL_ABS = 900000;

const PRICING_STATE = Object.freeze({
  READY: 'READY',
  PENDING_PRICE: 'PENDING_PRICE',
  ZERO_EMPTY: 'ZERO_EMPTY',
  PROVISIONAL_NET: 'PROVISIONAL_NET',
});

const AMOUNT_SOURCE = Object.freeze({
  NONE: 'NONE',
  CPC_IMPORTETOTAL: 'CPC_IMPORTETOTAL',
  CAC_IMPORTETOTAL: 'CAC_IMPORTETOTAL',
  CPC_TAX_STACK: 'CPC_TAX_STACK',
  CAC_TAX_STACK: 'CAC_TAX_STACK',
  LAC_LINE_SUM_NET: 'LAC_LINE_SUM_NET',
});

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function sanitizeErpAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  let parsed;
  if (typeof value === 'number') {
    parsed = value;
  } else {
    const str = String(value).trim();
    if (!str) return 0;
    if (str.includes(',') && str.includes('.')) {
      parsed = str.indexOf('.') < str.indexOf(',')
        ? Number(str.replace(/\./g, '').replace(',', '.'))
        : Number(str.replace(/,/g, ''));
    } else if (str.includes(',') && !str.includes('.')) {
      parsed = Number(str.replace(',', '.'));
    } else {
      parsed = Number(str);
    }
  }
  if (!Number.isFinite(parsed) || Object.is(parsed, -0)) return 0;
  if (Math.abs(parsed) >= SENTINEL_ABS) return 0;
  return roundMoney(parsed);
}

function hasMoney(value) {
  return Math.abs(sanitizeErpAmount(value)) >= MONEY_EPS;
}

function resolveDeliveryAmount({
  cpcTotal = 0,
  cacTotal = 0,
  cpcNetoSum = 0,
  cpcIvaSum = 0,
  cacNetoSum = 0,
  cacIvaSum = 0,
  lacLineSum = 0,
  qtyLines = 0,
  zeroPriceQtyLines = 0,
} = {}) {
  const safeCpcTotal = sanitizeErpAmount(cpcTotal);
  const safeCacTotal = sanitizeErpAmount(cacTotal);
  const cpcStack = sanitizeErpAmount(
    sanitizeErpAmount(cpcNetoSum) + sanitizeErpAmount(cpcIvaSum),
  );
  const cacStack = sanitizeErpAmount(
    sanitizeErpAmount(cacNetoSum) + sanitizeErpAmount(cacIvaSum),
  );
  const safeLineSum = sanitizeErpAmount(lacLineSum);
  const safeQtyLines = Number.isFinite(Number(qtyLines)) ? Math.max(0, Number(qtyLines)) : 0;
  const safeZeroPriceQtyLines = Number.isFinite(Number(zeroPriceQtyLines))
    ? Math.max(0, Number(zeroPriceQtyLines))
    : 0;

  let amount = 0;
  let source = AMOUNT_SOURCE.NONE;

  if (hasMoney(safeCpcTotal)) {
    amount = safeCpcTotal;
    source = AMOUNT_SOURCE.CPC_IMPORTETOTAL;
  } else if (hasMoney(safeCacTotal)) {
    amount = safeCacTotal;
    source = AMOUNT_SOURCE.CAC_IMPORTETOTAL;
  } else if (hasMoney(cpcStack)) {
    amount = cpcStack;
    source = AMOUNT_SOURCE.CPC_TAX_STACK;
  } else if (hasMoney(cacStack)) {
    amount = cacStack;
    source = AMOUNT_SOURCE.CAC_TAX_STACK;
  }

  let pricingState = PRICING_STATE.READY;
  if (!hasMoney(amount)) {
    if (safeQtyLines <= 0) {
      pricingState = PRICING_STATE.ZERO_EMPTY;
    } else if (safeZeroPriceQtyLines > 0 || !hasMoney(safeLineSum)) {
      pricingState = PRICING_STATE.PENDING_PRICE;
    } else {
      // Lines carry net sale amount but headers still empty — never invent IVA.
      amount = safeLineSum;
      source = AMOUNT_SOURCE.LAC_LINE_SUM_NET;
      pricingState = PRICING_STATE.PROVISIONAL_NET;
    }
  }

  return Object.freeze({
    amount,
    source,
    pricingState,
    lineSum: safeLineSum,
    qtyLines: safeQtyLines,
    zeroPriceQtyLines: safeZeroPriceQtyLines,
    discrepancy: hasMoney(safeCpcTotal)
      && hasMoney(safeCacTotal)
      && Math.abs(safeCpcTotal - safeCacTotal) > 0.01,
    isPendingPrice: pricingState === PRICING_STATE.PENDING_PRICE,
    isCollectable: hasMoney(amount) && pricingState !== PRICING_STATE.PENDING_PRICE,
  });
}

/**
 * Empty-delivery / prepaid-zero is valid only when there are no qty lines.
 * Header amount == 0 with catch-weight lines is NOT empty.
 */
function allowsEmptyPlannedLines({ importeTotal = 0, qtyLines = 0, pricingState } = {}) {
  const state = pricingState
    || resolveDeliveryAmount({ cpcTotal: importeTotal, qtyLines }).pricingState;
  return state === PRICING_STATE.ZERO_EMPTY && Number(qtyLines) <= 0;
}

function documentAmountKey({ ejercicio, serie, terminal, numero, cliente }) {
  return [
    Number(ejercicio),
    String(serie || '').trim(),
    Number(terminal),
    Number(numero),
    String(cliente || '').trim(),
  ].join('|');
}

module.exports = {
  MONEY_EPS,
  SENTINEL_ABS,
  PRICING_STATE,
  AMOUNT_SOURCE,
  sanitizeErpAmount,
  hasMoney,
  resolveDeliveryAmount,
  allowsEmptyPlannedLines,
  documentAmountKey,
};
