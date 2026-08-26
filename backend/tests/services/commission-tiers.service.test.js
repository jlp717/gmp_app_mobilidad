'use strict';

Object.assign(process.env, {
  NODE_ENV: 'test',
  REPARTO_ENVIRONMENT: 'test',
  REPARTO_TABLE_SET: 'isolated_test',
  REPARTO_EVIDENCE_PENDING_TTL_HOURS: '24',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
  ODBC_DSN: 'GMP',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
});

const financeService = require('../../services/repartidor-finance-service');

const APRIL_2026_TIERS = [
  { thresholdPct: 30, commissionPct: 0.7, sortOrder: 1 },
  { thresholdPct: 50, commissionPct: 0.8, sortOrder: 2 },
  { thresholdPct: 70, commissionPct: 1, sortOrder: 3 },
];

describe('repartidor commission tiers', () => {
  test.each([
    [30, null],
    [50, 30],
    [70, 50],
  ])('at exact %s%% boundary does not apply that tier until excess exists', (collectedPct, expectedTier) => {
    const result = financeService.calculateCommission({
      deliveredAmount: 1000,
      collectedAmount: collectedPct * 10,
      tiers: APRIL_2026_TIERS,
    });

    expect(result.reached[0]?.thresholdPct ?? null).toBe(expectedTier);
  });

  test('one cent above highest boundary applies commission only to excess', () => {
    expect(financeService.calculateCommission({
      deliveredAmount: 1000,
      collectedAmount: 700.01,
      tiers: APRIL_2026_TIERS,
    })).toMatchObject({
      collectedPct: 70,
      commission: 0,
      reached: [{ thresholdPct: 70, thresholdAmount: 700, excess: 0.01, commission: 0 }],
    });
  });

  test('rejects configuration whose first tier is below 30 percent', async () => {
    await expect(financeService.saveCommissionTiers({
      tiers: [{ thresholdPct: 29.99, commissionPct: 1, sortOrder: 1 }],
      updatedBy: 'TEST_P8_UNIT',
    })).rejects.toMatchObject({
      code: 'COMMISSION_THRESHOLD_MINIMUM_REQUIRED',
      statusCode: 422,
    });
  });

  test('zero increment at first threshold yields no commission', () => {
    expect(financeService.calculateCommission({
      deliveredAmount: 1000,
      collectedAmount: 300,
      tiers: APRIL_2026_TIERS,
    })).toMatchObject({ commission: 0, reached: [] });
  });

  test('collection below 100 percent still uses highest reached configured tier', () => {
    expect(financeService.calculateCommission({
      deliveredAmount: 1000,
      collectedAmount: 800,
      tiers: APRIL_2026_TIERS,
    })).toMatchObject({
      collectedPct: 80,
      commission: 1,
      reached: [{ thresholdPct: 70, thresholdAmount: 700, excess: 100, commission: 1 }],
    });
  });

  test('rounds threshold, excess and commission to cents', () => {
    expect(financeService.calculateCommission({
      deliveredAmount: 333.33,
      collectedAmount: 100.41,
      tiers: [{ thresholdPct: 30, commissionPct: 1.25, sortOrder: 1 }],
    })).toMatchObject({
      commission: 0.01,
      reached: [{ thresholdAmount: 100, excess: 0.41, commission: 0.01 }],
    });
  });
});
