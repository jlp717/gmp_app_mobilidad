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
        getBSalesByVendor: jest.fn(),
    };
});

const { getBSalesByVendor } = require('../utils/common');
const { addBSalesToRows } = require('../services/objectives-service');
const {
    applyHybridMonthlyObjectives,
    applyMonthlyObjectiveRebalances,
    getAnnualObjectiveAdjustment,
    sumMonthlyObjectives,
} = require('../routes/objectives-hybrid-helpers');

describe('addBSalesToRows cache safety (V-20261124)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getBSalesByVendor.mockResolvedValue({ '01': { 1: 10, 3: 30 } });
    });

    test('does not mutate the rows received (redis L1 serves them by reference)', async () => {
        const cachedRows = [
            { YEAR: 2025, MONTH: 1, SALES: 100, COST: 0, CLIENTS: 1 },
            { YEAR: 2025, MONTH: 2, SALES: 200, COST: 0, CLIENTS: 1 },
        ];
        const snapshot = JSON.parse(JSON.stringify(cachedRows));

        const merged = await addBSalesToRows(cachedRows, [], [2025]);

        expect(cachedRows).toEqual(snapshot);
        expect(merged).not.toBe(cachedRows);
        expect(merged).toHaveLength(3);
        expect(merged.find((row) => row.MONTH === 1).SALES).toBe(110);
        expect(merged.find((row) => row.MONTH === 2).SALES).toBe(200);
        expect(merged.find((row) => row.MONTH === 3).SALES).toBe(30);
    });

    test('reading the same cached rows twice does not accumulate B-sales', async () => {
        const cachedRows = [
            { YEAR: 2025, MONTH: 1, SALES: 100, COST: 0, CLIENTS: 1 },
        ];

        const first = await addBSalesToRows(cachedRows, [], [2025]);
        const second = await addBSalesToRows(cachedRows, [], [2025]);

        expect(first.find((row) => row.MONTH === 1).SALES).toBe(110);
        expect(second.find((row) => row.MONTH === 1).SALES).toBe(110);
        expect(cachedRows[0].SALES).toBe(100);
    });

    test('creates the missing month without touching the input array', async () => {
        const emptyRows = [];

        const merged = await addBSalesToRows(emptyRows, [], [2025]);

        expect(emptyRows).toHaveLength(0);
        expect(merged).toHaveLength(2);
        expect(merged.find((row) => row.MONTH === 1).SALES).toBe(10);
        expect(merged.find((row) => row.MONTH === 3).SALES).toBe(30);
    });
    test('2026 company annual stays at 16,866,761.54 when cached rows are reused', async () => {
        const laclae2025 = {
            1: 698438.35, 2: 851065.26, 3: 919186.78, 4: 1458785.03,
            5: 1362621.65, 6: 1570911.09, 7: 1964072.28, 8: 2029829.83,
            9: 1196985.97, 10: 1100081.29, 11: 879717.89, 12: 1186783.58,
        };
        const bSales2025 = {
            1: 44191.46, 2: 25336.66, 3: 1681.64, 4: 2806.08,
            5: 10863.23, 6: 7583.48, 7: -222.72, 8: 10998.83,
            9: 11316.24, 10: 19709.53, 11: 23893.34, 12: 47691.91,
        };
        getBSalesByVendor.mockResolvedValue({ '01': bSales2025 });

        const cachedRows = Object.entries(laclae2025).map(([month, sales]) => ({
            YEAR: 2025,
            MONTH: Number(month),
            SALES: sales,
            COST: 0,
            CLIENTS: 1,
        }));

        // Same cached array read twice: before the fix the second read added
        // VENTAS_B again and the company annual jumped to 17,093,196.20.
        await addBSalesToRows(cachedRows, [], [2025]);
        const rows = await addBSalesToRows(cachedRows, [], [2025]);

        const prevMonthly = {};
        let combinedPrevTotal = 0;
        for (let month = 1; month <= 12; month += 1) {
            const row = rows.find((item) => item.MONTH === month);
            prevMonthly[month] = row ? row.SALES : 0;
            combinedPrevTotal += prevMonthly[month];
        }

        const pins = {
            5: 1410000, 8: 2135000, 9: 1330723.63,
            10: 1205412.28, 11: 1004999.33, 12: 1334703.20,
        };
        const hybrid = applyHybridMonthlyObjectives(
            prevMonthly,
            combinedPrevTotal,
            10,
            pins,
            { annualAdjustment: getAnnualObjectiveAdjustment(2026) },
        );
        const rebalanced = applyMonthlyObjectiveRebalances(hybrid.monthly, 2026, {});

        expect(combinedPrevTotal).toBeCloseTo(15424328.68, 2);
        expect(sumMonthlyObjectives(rebalanced)).toBeCloseTo(16866761.54, 2);
    });
});
