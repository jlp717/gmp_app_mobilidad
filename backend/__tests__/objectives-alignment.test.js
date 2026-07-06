'use strict';

jest.mock('../config/db', () => ({
    query: jest.fn(),
    queryWithParams: jest.fn(),
}));

jest.mock('../services/laclae', () => ({
    getClientCodesFromCache: jest.fn(() => null),
}));

jest.mock('../utils/common', () => {
    const actual = jest.requireActual('../utils/common');
    return {
        ...actual,
        getBSales: jest.fn(async () => ({})),
    };
});

const { queryWithParams } = require('../config/db');
const { getClientCodesFromCache } = require('../services/laclae');
const {
    DEFAULT_PORCENTAJE_MEJORA,
    getAlignedVendorSalesForObjectives,
    resolveObjectiveSalesTarget,
} = require('../utils/objectives-source');

describe('objectives alignment with commissions sales source', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getClientCodesFromCache.mockReturnValue(null);
    });

    test('live client-scope sales take priority over stored snapshots', async () => {
        getClientCodesFromCache.mockReturnValue(['C0001']);
        queryWithParams.mockImplementation(async (sql) => {
            if (sql.includes('COMMERCIAL_TARGETS')) return [];
            if (sql.includes('COMMISSION_SNAPSHOT_2026_0102')) {
                return [{ SALES: 46849.80 }];
            }
            if (sql.includes('DSED.LACLAE')) return [{ SALES: 52347.18 }];
            return [];
        });

        const result = await getAlignedVendorSalesForObjectives('35', 2026, 1);

        expect(result.sales).toBe(52347.18);
        expect(result.source).toBe('live_client_scope');
    });

    test('test_commercial_targets_takes_priority_for_target', async () => {
        const target = resolveObjectiveSalesTarget(41000, 95182.52);

        expect(target).toBe(95182.52);
    });

    test('test_default_10_percent_when_no_commercial_targets', async () => {
        queryWithParams.mockImplementation(async (sql) => {
            if (sql.includes('COMMERCIAL_TARGETS')) return [];
            if (sql.includes('COMMISSION_SNAPSHOT_2026_0102')) return [];
            if (sql.includes('DSED.LACLAE')) return [{ SALES: 41000 }];
            if (sql.includes('DSEDAC.LAC')) return [{ SALES: 41000 }];
            return [];
        });

        const aligned = await getAlignedVendorSalesForObjectives('35', 2026, 5);
        const target = resolveObjectiveSalesTarget(aligned.sales, aligned.rawTarget);

        expect(aligned.rawTarget).toBeNull();
        expect(target).toBeCloseTo(45100, 2);
    });

    test('test_default_porcentaje_is_configurable', () => {
        expect(DEFAULT_PORCENTAJE_MEJORA).toBe(10);
        expect(resolveObjectiveSalesTarget(1000, null, DEFAULT_PORCENTAJE_MEJORA)).toBe(1100);
    });
});
