'use strict';

describe('vendor column transition filter', () => {
    afterEach(() => {
        delete process.env.VENDOR_COLUMN;
        jest.resetModules();
    });

    test('multi-year filter keeps the old vendor column before March 2026', () => {
        process.env.VENDOR_COLUMN = 'R1_T8CDVD';
        jest.resetModules();

        const { buildColumnaVendedorFilter } = require('../utils/common');

        const filter = buildColumnaVendedorFilter('05', [2025, 2026], 'L');

        expect(filter).toContain("L.LCAADC < 2026 AND L.LCCDVD IN ('05')");
        expect(filter).toContain("L.LCAADC = 2026 AND L.LCMMDC < 3 AND L.LCCDVD IN ('05')");
        expect(filter).toContain("L.LCAADC = 2026 AND L.LCMMDC >= 3 AND L.R1_T8CDVD IN ('05')");
        expect(filter).not.toBe("AND ((L.LCMMDC < 3 AND L.LCCDVD IN ('05')) OR (L.LCMMDC >= 3 AND L.R1_T8CDVD IN ('05')))");
    });
});
