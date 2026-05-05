'use strict';

const {
    resolveHistoricalCommissionMonth,
} = require('../utils/commission-snapshot');

describe('commission historical snapshot handling', () => {
    const liveMetrics = {
        actual: 65492.70,
        target: 49444.55,
        commission: 320.96,
    };

    test('covered Jan/Feb month with no snapshot row is treated as no generated commission', () => {
        const result = resolveHistoricalCommissionMonth({
            year: 2026,
            month: 1,
            snapshotUntilMonth: 2,
            monthsWithSnapshotData: new Set([1, 2]),
            snapshotEntry: null,
            liveMetrics,
            isExcluded: false,
        });

        expect(result.isHistoricalSnapshot).toBe(true);
        expect(result.status).toBe('not_commissioned');
        expect(result.actual).toBe(0);
        expect(result.target).toBe(0);
        expect(result.commission).toBe(0);
    });

    test('covered month with snapshot row uses stored values even when live calculation differs', () => {
        const result = resolveHistoricalCommissionMonth({
            year: 2026,
            month: 2,
            snapshotUntilMonth: 2,
            monthsWithSnapshotData: new Set([1, 2]),
            snapshotEntry: {
                ventasTotales: 103103.36,
                objetivo: 74766.33,
                comisionGenerada: 570.74,
            },
            liveMetrics,
            isExcluded: false,
        });

        expect(result.isHistoricalSnapshot).toBe(true);
        expect(result.status).toBe('recorded');
        expect(result.actual).toBe(103103.36);
        expect(result.target).toBe(74766.33);
        expect(result.commission).toBe(570.74);
    });

    test('months outside snapshot coverage keep live metrics', () => {
        const result = resolveHistoricalCommissionMonth({
            year: 2026,
            month: 3,
            snapshotUntilMonth: 2,
            monthsWithSnapshotData: new Set([1, 2]),
            snapshotEntry: null,
            liveMetrics,
            isExcluded: false,
        });

        expect(result.isHistoricalSnapshot).toBe(false);
        expect(result.status).toBe('live');
        expect(result.actual).toBe(liveMetrics.actual);
        expect(result.target).toBe(liveMetrics.target);
        expect(result.commission).toBe(liveMetrics.commission);
    });
});
