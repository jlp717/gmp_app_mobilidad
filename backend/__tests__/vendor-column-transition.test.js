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

    test('commission columns split sales and objective by default', () => {
        delete process.env.COMMISSION_SALES_VENDOR_COLUMN;
        delete process.env.COMMISSION_OBJECTIVE_VENDOR_COLUMN;
        jest.resetModules();

        const { getCommissionVendorColumnExpr } = require('../utils/common');

        expect(getCommissionVendorColumnExpr('L', 'sales')).toBe('L.LCCDVD');
        expect(getCommissionVendorColumnExpr('L', 'objective')).toBe('L.R1_T8CDVD');
    });

    test('commission sales use LCC current year and transitioned prior-year baseline', () => {
        delete process.env.COMMISSION_SALES_VENDOR_COLUMN;
        delete process.env.COMMISSION_OBJECTIVE_VENDOR_COLUMN;
        jest.resetModules();

        const {
            getCommissionActualVendorColumnExprForYear,
            getCommissionActualVendorColumnExprForMonth,
        } = require('../utils/common');

        expect(getCommissionActualVendorColumnExprForYear(2026, 'L'))
            .toBe('CASE WHEN L.LCAADC = 2026 THEN L.LCCDVD WHEN L.LCMMDC < 3 THEN L.LCCDVD ELSE L.R1_T8CDVD END');
        expect(getCommissionActualVendorColumnExprForMonth(2026, 2, 'L')).toBe('L.LCCDVD');
        expect(getCommissionActualVendorColumnExprForMonth(2026, 3, 'L')).toBe('L.LCCDVD');
    });

    test('commission columns are configurable', () => {
        process.env.COMMISSION_SALES_VENDOR_COLUMN = 'R1_T8CDVD';
        process.env.COMMISSION_OBJECTIVE_VENDOR_COLUMN = 'LCCDVD';
        jest.resetModules();

        const { getCommissionVendorColumnExpr } = require('../utils/common');

        expect(getCommissionVendorColumnExpr('L', 'sales')).toBe('L.R1_T8CDVD');
        expect(getCommissionVendorColumnExpr('L', 'objective')).toBe('L.LCCDVD');
    });
});
