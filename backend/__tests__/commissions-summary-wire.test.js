'use strict';

const { slimGroupedSummaryForWire } = require('../services/commissions-summary-wire');

describe('commissions-summary-wire', () => {
  test('keeps commission amounts and drops diagnostic duplicates', () => {
    const slim = slimGroupedSummaryForWire({
      grandTotalCommission: 123.45,
      months: [{ month: 1, actual: 10, target: 8, liveMetrics: { actual: 99 } }],
      breakdown: [{
        vendedorCode: '15',
        vendorName: 'Alfonso',
        grandTotalCommission: 50.1,
        extraUnused: true,
        months: [{
          month: 1,
          actual: 20,
          target: 18,
          complianceCtx: { commission: 1.2 },
          liveMetrics: { actual: 999, target: 1, commission: 0 },
          historicalSnapshot: { actual: 1 },
          paymentSnapshot: { actual: 2 },
        }],
        payments: { total: 4, monthly: { 1: 4 } },
      }],
    });

    expect(slim.grandTotalCommission).toBe(123.45);
    expect(slim.breakdown[0].grandTotalCommission).toBe(50.1);
    expect(slim.breakdown[0].months[0].actual).toBe(20);
    expect(slim.breakdown[0].months[0].target).toBe(18);
    expect(slim.breakdown[0].months[0].complianceCtx.commission).toBe(1.2);
    expect(slim.breakdown[0].months[0].liveMetrics).toBeUndefined();
    expect(slim.breakdown[0].months[0].historicalSnapshot).toBeUndefined();
    expect(slim.breakdown[0].extraUnused).toBeUndefined();
    expect(slim.breakdown[0].payments.total).toBe(4);
  });
});
