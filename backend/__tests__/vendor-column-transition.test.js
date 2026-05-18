'use strict';

describe('vendor column transition filter', () => {
    afterEach(() => {
        delete process.env.VENDOR_COLUMN;
        jest.resetModules();
    });

    test('multi-year filter applies the month-based LCC/R1 transition to every year', () => {
        process.env.VENDOR_COLUMN = 'R1_T8CDVD';
        jest.resetModules();

        const { buildColumnaVendedorFilter } = require('../utils/common');

        const filter = buildColumnaVendedorFilter('05', [2025, 2026], 'L');

        expect(filter).toBe("AND TRIM(CASE WHEN L.LCMMDC < 3 THEN L.LCCDVD ELSE L.R1_T8CDVD END) IN ('05')");
    });

    test('default vendor column uses assignment-based R1 transition', () => {
        delete process.env.VENDOR_COLUMN;
        jest.resetModules();

        const { buildColumnaVendedorFilter } = require('../utils/common');

        const filter = buildColumnaVendedorFilter('35', [2026], 'L');

        expect(filter).toBe("AND TRIM(CASE WHEN L.LCMMDC < 3 THEN L.LCCDVD ELSE L.R1_T8CDVD END) IN ('35')");
    });

    test('commercial 80 has scoped visibility without manager role', () => {
        const { getVendorVisibilityScope } = require('../utils/common');

        expect(getVendorVisibilityScope('80')).toEqual(['80', '72', '73', '81', '83']);
        expect(getVendorVisibilityScope('35')).toEqual(['35']);
    });
});
