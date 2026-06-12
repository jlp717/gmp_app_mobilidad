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

    test('buildClientVendorParamFilter checks CLP, CLI and transition-aware LACLAE vendor column', () => {
        process.env.VENDOR_COLUMN = 'R1_T8CDVD';
        jest.resetModules();

        const { buildClientVendorParamFilter } = require('../utils/common');
        const { clause, params } = buildClientVendorParamFilter(['02'], 'CLI');

        expect(clause).toMatch(/DSEDAC\.CLP/);
        expect(clause).toMatch(/CLI\.CODIGOVENDEDOR/);
        expect(clause).toMatch(/DSED\.LACLAE/);
        expect(clause).toMatch(/CASE WHEN LAC\.LCMMDC/);
        expect(params).toEqual(['02', '02', '02']);
    });

    test('buildLaclaeBoundedClientCodesSql scopes LACLAE via CLP and CLI without full scan', () => {
        const { buildClientListVendorSqlFilter, buildLaclaeBoundedClientCodesSql } = require('../utils/common');

        const cliFilter = buildClientListVendorSqlFilter('02', 'C');
        const laclaeFilter = buildLaclaeBoundedClientCodesSql('02');

        expect(cliFilter).toMatch(/DSEDAC\.CLP/);
        expect(cliFilter).toMatch(/FETCH FIRST 1 ROW ONLY/);
        expect(laclaeFilter).toMatch(/LCCDCL IN/);
        expect(laclaeFilter).toMatch(/DSEDAC\.CLP/);
        expect(laclaeFilter).toMatch(/DSEDAC\.CLI/);
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

    test('commission columns are fixed for stability even when env vars are set', () => {
        process.env.COMMISSION_SALES_VENDOR_COLUMN = 'R1_T8CDVD';
        process.env.COMMISSION_OBJECTIVE_VENDOR_COLUMN = 'LCCDVD';
        jest.resetModules();

        const { getCommissionVendorColumnExpr } = require('../utils/common');

        expect(getCommissionVendorColumnExpr('L', 'sales')).toBe('L.LCCDVD');
        expect(getCommissionVendorColumnExpr('L', 'objective')).toBe('L.R1_T8CDVD');
    });
});
