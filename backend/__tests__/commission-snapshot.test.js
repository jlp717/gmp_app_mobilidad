'use strict';

const {
    resolveCommissionTarget,
    resolveHistoricalCommissionMonth,
    resolvePaymentSnapshotMonth,
} = require('../utils/commission-snapshot');

describe('commission historical snapshot handling', () => {
    const liveMetrics = {
        actual: 65492.70,
        target: 49444.55,
        commission: 320.96,
    };

    test('covered Jan/Feb month with no snapshot row keeps historical figures but zero commission', () => {
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
        expect(result.actual).toBe(liveMetrics.actual);
        expect(result.target).toBe(liveMetrics.target);
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

    test('fixed commission targets do not roll forward to later months', () => {
        const fixedTargets = [
            { mes: 5, importe: 78157.46 },
            { mes: 9, importe: 82940.69 },
        ];

        const may = resolveCommissionTarget({
            month: 5,
            fixedTargets,
            prevSales: 81788.47,
            ipc: 3,
        });
        const june = resolveCommissionTarget({
            month: 6,
            fixedTargets,
            prevSales: 131017.70,
            ipc: 3,
        });

        expect(may.target).toBe(78157.46);
        expect(may.source).toBe('commercial_targets_exact');
        expect(june.target).toBeCloseTo(134948.231, 3);
        expect(june.source).toBe('previous_year_plus_ipc');
    });

    test('payment snapshot overrides live month metrics when month is paid', () => {
        const result = resolvePaymentSnapshotMonth({
            paymentDetail: {
                ventaComision: 72869.35,
                objetivoReal: 42208.99,
                comisionGeneradaSnapshot: 613.21,
                ultimaFecha: '2026-04-26 21:13:01.755947',
            },
            liveMetrics: {
                actual: 70069.52,
                target: 42208.99,
                commission: 557.21,
            },
            isExcluded: false,
        });

        expect(result.isPaymentSnapshot).toBe(true);
        expect(result.actual).toBe(72869.35);
        expect(result.target).toBe(42208.99);
        expect(result.commission).toBe(613.21);
        expect(result.status).toBe('payment_recorded');
    });
});
