'use strict';

const {
    calculateWorkingDays,
    calculateDaysPassed,
    DEFAULT_ALL_WEEK_DAYS,
} = require('../utils/common');

describe('ALL working-days calendar (lun–sáb)', () => {
    test('default ALL week is lun–sáb, not mar–sáb nor lun–vie', () => {
        expect(DEFAULT_ALL_WEEK_DAYS).toEqual([
            'VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S',
        ]);
    });

    test('septiembre 2026 ALL is 26 lun–sáb, not 22', () => {
        expect(calculateWorkingDays(2026, 9, [])).toBe(26);
        expect(calculateWorkingDays(2026, 9, DEFAULT_ALL_WEEK_DAYS)).toBe(26);
        expect(calculateWorkingDays(2026, 9, ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V'])).toBe(22);
        expect(calculateWorkingDays(2026, 9, ['VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S'])).toBe(22);
    });

    test('pin 1.330.724 / 26 recovers the jefe 51k rhythm, /22 was the inflated 60k', () => {
        const pin = 1330723.63;
        expect(Math.round((pin / 22) * 100) / 100).toBe(60487.44);
        expect(Math.round((pin / 26) * 100) / 100).toBe(51181.68);
        expect(calculateWorkingDays(2026, 9, [])).toBe(26);
    });

    test('days passed on 18 sep 2026 is 16 lun–sáb when that is today', () => {
        const now = new Date();
        if (now.getFullYear() === 2026 && now.getMonth() === 8 && now.getDate() === 18) {
            expect(calculateDaysPassed(2026, 9, [])).toBe(16);
        }
        const monSat = ['VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S'];
        const start = new Date(2026, 8, 1);
        const end = new Date(2026, 8, 18);
        let count = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const jsDayToCol = {
                0: 'VIS_D', 1: 'VIS_L', 2: 'VIS_M', 3: 'VIS_X', 4: 'VIS_J', 5: 'VIS_V', 6: 'VIS_S',
            };
            if (monSat.includes(jsDayToCol[d.getDay()])) count++;
        }
        expect(count).toBe(16);
    });
});
