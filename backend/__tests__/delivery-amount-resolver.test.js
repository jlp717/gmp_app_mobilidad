'use strict';

const {
  resolveDeliveryAmount,
  allowsEmptyPlannedLines,
  sanitizeErpAmount,
  PRICING_STATE,
  AMOUNT_SOURCE,
} = require('../services/delivery-amount-resolver');
const {
  loadDeliveryLineAmountStats,
} = require('../services/delivery-line-amount-stats');
const { documentAmountKey: keyFromResolver } = require('../services/delivery-amount-resolver');

describe('delivery-amount-resolver', () => {
  test('prefers CPC gross total when present', () => {
    const resolved = resolveDeliveryAmount({
      cpcTotal: 132.07,
      cacTotal: 99,
      cpcNetoSum: 120.06,
      cpcIvaSum: 12.01,
      qtyLines: 1,
      zeroPriceQtyLines: 0,
    });
    expect(resolved.amount).toBe(132.07);
    expect(resolved.source).toBe(AMOUNT_SOURCE.CPC_IMPORTETOTAL);
    expect(resolved.pricingState).toBe(PRICING_STATE.READY);
  });

  test('falls back to CAC when CPC is still zero after weighing/pricing lag', () => {
    const resolved = resolveDeliveryAmount({
      cpcTotal: 0,
      cacTotal: 132.07,
      qtyLines: 1,
      zeroPriceQtyLines: 0,
      lacLineSum: 120.06,
    });
    expect(resolved.amount).toBe(132.07);
    expect(resolved.source).toBe(AMOUNT_SOURCE.CAC_IMPORTETOTAL);
    expect(resolved.pricingState).toBe(PRICING_STATE.READY);
  });

  test('marks catch-weight qty without sale amount as PENDING_PRICE', () => {
    const resolved = resolveDeliveryAmount({
      cpcTotal: 0,
      cacTotal: 0,
      qtyLines: 1,
      zeroPriceQtyLines: 1,
      lacLineSum: 0,
    });
    expect(resolved.amount).toBe(0);
    expect(resolved.pricingState).toBe(PRICING_STATE.PENDING_PRICE);
    expect(resolved.isPendingPrice).toBe(true);
    expect(allowsEmptyPlannedLines({
      importeTotal: 0,
      qtyLines: 1,
      pricingState: resolved.pricingState,
    })).toBe(false);
  });

  test('true empty/prepaid zero only when no qty lines', () => {
    const resolved = resolveDeliveryAmount({
      cpcTotal: 0,
      cacTotal: 0,
      qtyLines: 0,
      zeroPriceQtyLines: 0,
    });
    expect(resolved.pricingState).toBe(PRICING_STATE.ZERO_EMPTY);
    expect(allowsEmptyPlannedLines({
      importeTotal: 0,
      qtyLines: 0,
      pricingState: resolved.pricingState,
    })).toBe(true);
  });

  test('sanitizes sentinel ERP amounts', () => {
    expect(sanitizeErpAmount(-9999999)).toBe(0);
    expect(sanitizeErpAmount('1.234,56')).toBe(1234.56);
  });

  test('uses CPC tax stack before inventing LAC net as cobro', () => {
    const resolved = resolveDeliveryAmount({
      cpcTotal: 0,
      cacTotal: 0,
      cpcNetoSum: 120.06,
      cpcIvaSum: 12.01,
      lacLineSum: 120.06,
      qtyLines: 1,
      zeroPriceQtyLines: 0,
    });
    expect(resolved.amount).toBe(132.07);
    expect(resolved.source).toBe(AMOUNT_SOURCE.CPC_TAX_STACK);
  });
});

describe('delivery-line-amount-stats', () => {
  test('batches identities without N+1 and maps stats by document key', async () => {
    const calls = [];
    const queryFn = async (sql, params) => {
      calls.push({ sql, params });
      return [{
        EJERCICIOALBARAN: 2026,
        SERIEALBARAN: 'I',
        TERMINALALBARAN: 2,
        NUMEROALBARAN: 1,
        CLIENTE: '4300008058',
        LINE_SUM: 0,
        ZERO_PRICE_QTY_LINES: 1,
        QTY_LINES: 1,
      }];
    };

    const stats = await loadDeliveryLineAmountStats([
      {
        ejercicio: 2026, serie: 'I', terminal: 2, numero: 1, cliente: '4300008058',
      },
      {
        ejercicio: 2026, serie: 'I', terminal: 2, numero: 1, cliente: '4300008058',
      },
    ], queryFn);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('FROM DSEDAC.LAC L');
    expect(calls[0].params).toEqual([2026, 'I', 2, 1, '4300008058']);
    const key = keyFromResolver({
      ejercicio: 2026, serie: 'I', terminal: 2, numero: 1, cliente: '4300008058',
    });
    expect(stats.get(key)).toEqual({
      lineSum: 0,
      qtyLines: 1,
      zeroPriceQtyLines: 1,
    });
  });
});
