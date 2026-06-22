'use strict';

const { genericAnalyticsTools } = require('../src/chatbot/chatbot_tools');

describe('chatbot generic analytics tools', () => {
  test('queryClientSales aggregates by month with totals', async () => {
    const conn = {
      query: jest.fn(async () => [
        { YEAR: 2026, MONTH: 1, SALES: 1000, COST: 600, UNITS: 50, LINES: 10 },
        { YEAR: 2026, MONTH: 2, SALES: 800, COST: 480, UNITS: 40, LINES: 8 },
      ]),
    };

    const result = await genericAnalyticsTools.queryClientSales(
      conn,
      'CLI-1',
      '2026-01-01',
      '2026-02-28',
      'month',
      null,
      '05',
      false,
      ['05']
    );

    expect(result.error).toBeUndefined();
    expect(result.clientCode).toBe('CLI-1');
    expect(result.totals.sales).toBe(1800);
    expect(result.groups).toHaveLength(2);
  });

  test('queryClientProfit calculates margin', async () => {
    const conn = {
      query: jest.fn(async () => [
        { YEAR: 2026, MONTH: 3, SALES: 2000, COST: 1200, UNITS: 100, LINES: 20 },
      ]),
    };

    const result = await genericAnalyticsTools.queryClientProfit(
      conn,
      'CLI-2',
      '2026-03-01',
      '2026-03-31',
      'month',
      '05',
      false,
      ['05']
    );

    expect(result.profit).toBe(800);
    expect(result.marginPercent).toBe(40);
  });

  test('comparePeriods returns sales delta', async () => {
    let call = 0;
    const conn = {
      query: jest.fn(async () => {
        call += 1;
        if (call === 1) {
          return [{ SALES: 1500, COST: 900, CLIENTS: 5 }];
        }
        return [{ SALES: 1000, COST: 700, CLIENTS: 4 }];
      }),
    };

    const result = await genericAnalyticsTools.comparePeriods(
      conn,
      '2026-01-01',
      '2026-01-31',
      'prior_year',
      'month',
      null,
      '05',
      false,
      ['05']
    );

    expect(result.salesDelta).toBe(500);
    expect(result.salesDeltaPercent).toBe(50);
  });

  test('queryClientProfile requires clientCode', async () => {
    const result = await genericAnalyticsTools.queryClientProfile({}, null, '05', false, ['05']);
    expect(result.error).toBe('clientCode requerido');
  });

  test('comparePeriods prior_period shifts to equal-length prior range', async () => {
    let call = 0;
    const conn = {
      query: jest.fn(async () => {
        call += 1;
        if (call === 1) {
          return [{ YEAR: 2026, MONTH: 2, SALES: 900, COST: 500, UNITS: 30, LINES: 6 }];
        }
        return [{ YEAR: 2026, MONTH: 1, SALES: 700, COST: 400, UNITS: 25, LINES: 5 }];
      }),
    };

    const result = await genericAnalyticsTools.comparePeriods(
      conn,
      '2026-02-01',
      '2026-02-28',
      'prior_period',
      'month',
      'CLI-3',
      '05',
      false,
      ['05']
    );

    expect(result.clientCode).toBe('CLI-3');
    expect(result.compareWith).toBe('prior_period');
    expect(result.salesDelta).toBe(200);
  });

  test('queryClientPurchases filters by familyCode', async () => {
    const conn = {
      query: jest.fn(async (sql, params) => {
        expect(sql).toMatch(/CODIGOFAMILIA/);
        expect(params).toContain('AVES');
        return [{
          CODE: 'P001',
          NAME: 'Pollo entero',
          FAMILY: 'AVES',
          YEAR: 2026,
          MONTH: 3,
          SALES: 500,
          UNITS: 20,
          LINES: 4,
        }];
      }),
    };

    const result = await genericAnalyticsTools.queryClientPurchases(
      conn,
      'CLI-4',
      '2026-03-01',
      '2026-03-31',
      'AVES',
      null,
      10,
      '05',
      false,
      ['05']
    );

    expect(result.familyCode).toBe('AVES');
    expect(result.purchases).toHaveLength(1);
    expect(result.totalSales).toBe(500);
  });
});
