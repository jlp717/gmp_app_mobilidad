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

    test('buildClientVendorParamFilter checks CLP and transition-aware LACLAE vendor column', () => {
        process.env.VENDOR_COLUMN = 'R1_T8CDVD';
        jest.resetModules();

        const { buildClientVendorParamFilter } = require('../utils/common');
        const { clause, params } = buildClientVendorParamFilter(['02'], 'CLI');

        expect(clause).toMatch(/DSEDAC\.CLP/);
        expect(clause).toMatch(/VENDEDORCOMERCIAL/);
        expect(clause).toMatch(/DSED\.LACLAE/);
        // Product uses an explicit month-bound OR (bind-safe), not CASE WHEN.
        expect(clause).toMatch(/LAC\.LCMMDC\s*<\s*3/);
        expect(clause).toMatch(/LAC\.LCCDVD\s+IN/);
        expect(clause).toMatch(/LAC\.LCMMDC\s*>=\s*3/);
        expect(clause).toMatch(/LAC\.R1_T8CDVD\s+IN/);
        expect(clause).not.toMatch(/CLI\.CODIGOVENDEDOR/);
        expect(clause).not.toMatch(/CODIGOVENDEDOR/);
        expect(params).toEqual(['02', '02']);
    });

    test('buildLaclaeBoundedClientCodesSql scopes LACLAE via CLP without full scan', () => {
        const { buildClientListVendorSqlFilter, buildLaclaeBoundedClientCodesSql } = require('../utils/common');

        const cliFilter = buildClientListVendorSqlFilter('02', 'C');
        const laclaeFilter = buildLaclaeBoundedClientCodesSql('02');

        expect(cliFilter).toMatch(/DSEDAC\.CLP/);
        expect(cliFilter).toMatch(/FETCH FIRST 1 ROW ONLY/);
        expect(cliFilter).not.toMatch(/CODIGOVENDEDOR/);
        expect(laclaeFilter).toMatch(/LCCDCL IN/);
        expect(laclaeFilter).toMatch(/DSEDAC\.CLP/);
        expect(laclaeFilter).not.toMatch(/DSEDAC\.CLI.*CODIGOVENDEDOR/);
        expect(laclaeFilter).not.toMatch(/CODIGOVENDEDOR/);
    });

    test('client vendor SQL helpers never reference CLI.CODIGOVENDEDOR', () => {
        process.env.VENDOR_COLUMN = 'R1_T8CDVD';
        jest.resetModules();

        const {
            buildClientVendorParamFilter,
            buildClientListVendorSqlFilter,
            buildLaclaeBoundedClientCodesSql,
        } = require('../utils/common');

        const sqlFragments = [
            buildClientVendorParamFilter(['02', '98'], 'CLI').clause,
            buildClientListVendorSqlFilter('02,98', 'C'),
            buildLaclaeBoundedClientCodesSql('02,98'),
        ];

        for (const sql of sqlFragments) {
            expect(sql).not.toMatch(/CLI\.CODIGOVENDEDOR/);
            expect(sql).not.toMatch(/CODIGOVENDEDOR/);
        }
    });

    test('DDD client and dashboard repositories avoid CLI.CODIGOVENDEDOR', () => {
        const fs = require('fs');
        const path = require('path');
        const repoFiles = [
            '../src/modules/clients/infrastructure/db2-client-repository.js',
            '../src/modules/dashboard/infrastructure/db2-dashboard-repository.js',
        ];

        for (const relPath of repoFiles) {
            const source = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
            expect(source).toMatch(/buildClientListVendorSqlFilter/);
            expect(source).not.toMatch(/CLI\.CODIGOVENDEDOR/);
            expect(source).not.toMatch(/CODIGOVENDEDOR/);
        }
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
