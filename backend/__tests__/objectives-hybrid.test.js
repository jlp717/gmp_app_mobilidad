/**
 * Hybrid objective redistribution: May pinned, remainder to other months.
 */
const {
    applyHybridMonthlyObjectives,
    combineGrowthPercentages,
    computeSeasonalWeightTargets,
} = require('../routes/objectives-hybrid-helpers');

describe('objectives hybrid redistribution', () => {
    test('May stays pinned; ~86k remainder spreads to non-pinned months (Almería case)', () => {
        // Prev year total ~1.453M → annual objective ~1.497M (3% IPC); May pinned 1.41M
        const combinedPrevTotal = 1453263;
        const prevYearMonthlySales = {
            1: 110000, 2: 115000, 3: 120000, 4: 118000,
            5: 130000, 6: 125000, 7: 128000, 8: 122000,
            9: 119000, 10: 121000, 11: 127000, 12: 118263,
        };
        const targetPct = 3;
        const exactFixedByMonth = { 5: 1410000 };

        const { monthly, annual } = applyHybridMonthlyObjectives(
            prevYearMonthlySales,
            combinedPrevTotal,
            targetPct,
            exactFixedByMonth,
        );

        expect(monthly[5]).toBe(1410000);
        const nonMaySum = Object.entries(monthly)
            .filter(([m]) => parseInt(m, 10) !== 5)
            .reduce((s, [, v]) => s + v, 0);
        const expectedAnnual = combinedPrevTotal * 1.03;
        expect(annual).toBeCloseTo(expectedAnnual, -2);
        expect(monthly[5] + nonMaySum).toBeCloseTo(expectedAnnual, -2);
        // ~1.497M - 1.41M ≈ 87k distributed outside May
        expect(nonMaySum).toBeGreaterThan(80000);
        expect(nonMaySum).toBeLessThan(95000);
    });

    test('no pinned months uses full seasonal weights', () => {
        const prev = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100, 9: 100, 10: 100, 11: 100, 12: 100 };
        const weights = computeSeasonalWeightTargets(prev, 1200, 3);
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1200 * 1.03, 0);
    });

    test('combines IPC and improvement multiplicatively', () => {
        expect(combineGrowthPercentages(3, 10)).toBeCloseTo(13.3, 5);
        expect(15424328.68 * (1 + (combineGrowthPercentages(3, 10) / 100)))
            .toBeCloseTo(17475764.39, 0);
    });

    test('2026 global objective uses 2025 real plus B, IPC, improvement, and pinned months', () => {
        const combinedPrevTotal = 15424328.68;
        const prevYearMonthlySales = {
            1: 742629.81, 2: 876401.92, 3: 920868.42, 4: 1461591.11,
            5: 1373484.88, 6: 1578494.57, 7: 1963849.56, 8: 2040828.66,
            9: 1208302.21, 10: 1119790.82, 11: 903611.23, 12: 1234475.49,
        };
        const exactFixedByMonth = {
            5: 1410000,
            9: 1330723.63,
            10: 1205412.28,
            11: 969999.33,
            12: 1269703.20,
        };

        const growthPct = combineGrowthPercentages(3, 10);
        const { monthly, annual } = applyHybridMonthlyObjectives(
            prevYearMonthlySales,
            combinedPrevTotal,
            growthPct,
            exactFixedByMonth,
        );

        expect(annual).toBeCloseTo(17475764.39, 0);
        expect(monthly[5]).toBe(1410000);
        expect(monthly[9]).toBe(1330723.63);
        expect(Math.round(monthly[6])).toBe(1862066);
        expect(Math.round(monthly[8])).toBe(2457611);
    });
});
