'use strict';

const {
    resolveVendorScope,
    authorizeVendorScope,
    setActiveVendorCatalogForTests,
    resetVendorCatalogCache,
} = require('../middleware/vendor-scope');
const { resolveDashboardVendedorCodes } = require('../src/utils/dashboardScope');
const { buildVendedorFilterParameterized } = require('../src/utils/dashboardFilters');

const CATALOG = ['01', '02', '15', '72', '73', '80', '81', '83'];

describe('resolveVendorScope literal ALL', () => {
    const prevFlag = process.env.VENDOR_SCOPE_LITERAL_ALL;

    beforeEach(() => {
        process.env.VENDOR_SCOPE_LITERAL_ALL = 'true';
        setActiveVendorCatalogForTests(CATALOG);
    });

    afterEach(() => {
        resetVendorCatalogCache();
        if (prevFlag === undefined) delete process.env.VENDOR_SCOPE_LITERAL_ALL;
        else process.env.VENDOR_SCOPE_LITERAL_ALL = prevFlag;
    });

    test('COMERCIAL never gets literalAll even when requesting ALL', () => {
        const scope = resolveVendorScope(
            { code: '15', role: 'COMERCIAL', vendorCodes: ['15'] },
            'ALL',
        );
        expect(scope).toEqual({ ok: true, literalAll: false, codes: ['15'] });
        const filter = buildVendedorFilterParameterized(scope.codes.join(','));
        expect(filter.filter).toMatch(/IN \(\?\)/);
        expect(filter.params).toEqual(['15']);
        expect(filter.filter).not.toMatch(/VENDEDOR\s*=\s*'ALL'/i);
    });

    test('JEFE whose visible set contains the GMP catalog gets literalAll', () => {
        const jefe = {
            code: '98',
            role: 'JEFE_VENTAS',
            isJefeVentas: true,
            vendorCodes: [...CATALOG, 'UNK', 'A2'],
        };
        const scope = resolveVendorScope(jefe, 'ALL');
        expect(scope.ok).toBe(true);
        expect(scope.literalAll).toBe(true);
        expect(scope.codes).toEqual([]);
        const filter = buildVendedorFilterParameterized(scope.literalAll ? 'ALL' : scope.codes.join(','));
        expect(filter).toEqual({ filter: '', params: [] });
        expect(filter.filter).not.toMatch(/IN \(/);
    });

    test('team leader 80 does not get company-wide literalAll', () => {
        const scope = resolveVendorScope(
            {
                code: '80',
                role: 'JEFE_VENTAS',
                isJefeVentas: true,
                vendorCodes: ['80', '72', '73', '81', '83'],
            },
            'ALL',
        );
        expect(scope.literalAll).toBe(false);
        expect(scope.codes).toEqual(['80', '72', '73', '81', '83']);
        const filter = buildVendedorFilterParameterized(scope.codes.join(','));
        expect(filter.params).toEqual(['80', '72', '73', '81', '83']);
        expect(filter.filter).toMatch(/IN \(\?,\?,\?,\?,\?\)/);
    });

    test('VENDOR_SCOPE_LITERAL_ALL=false keeps the expanded visible list', () => {
        process.env.VENDOR_SCOPE_LITERAL_ALL = 'false';
        const scope = resolveVendorScope(
            {
                code: '98',
                role: 'JEFE_VENTAS',
                vendorCodes: CATALOG,
            },
            'ALL',
        );
        expect(scope.literalAll).toBe(false);
        expect(scope.codes).toEqual(CATALOG);
    });

    test('commercial leader keeps only his signed team after ALL expansion', () => {
        const leader = { code: '80', role: 'COMERCIAL', vendorCodes: ['80', '72', '73', '81', '83'] };
        const team = ['80', '72', '73', '81', '83'];
        expect(resolveVendorScope(leader, 'ALL')).toEqual({ ok: true, literalAll: false, codes: team });
        expect(resolveVendorScope(leader, team.join(','))).toEqual({ ok: true, literalAll: false, codes: team });
        expect(resolveVendorScope(leader, '72')).toEqual({ ok: true, literalAll: false, codes: ['72'] });
        expect(resolveVendorScope(leader, '01').ok).toBe(false);
        expect(resolveVendorScope({ code: '35', role: 'COMERCIAL', vendorCodes: ['35', '80'] }, '80').ok).toBe(false);
    });

    test('COMERCIAL cannot authorize ALL via authorizeVendorScope', () => {
        expect(authorizeVendorScope(
            { user: { code: '15', role: 'COMERCIAL' } },
            'ALL',
        ).ok).toBe(false);
        expect(authorizeVendorScope(
            { user: { code: '98', role: 'JEFE_VENTAS' } },
            'ALL',
        ).ok).toBe(true);
    });

    test('JEFE with a company-wide JWT gets literal ALL even when VDC catalog is empty', () => {
        resetVendorCatalogCache();
        const codes = Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, '0'));
        const jefe = {
            code: '98',
            role: 'JEFE_VENTAS',
            isJefeVentas: true,
            vendorCodes: codes,
        };
        const scope = resolveVendorScope(jefe, 'ALL');
        expect(scope).toEqual({ ok: true, literalAll: true, codes: [] });
        const scoped = resolveDashboardVendedorCodes({ user: jefe }, 'ALL');
        expect(scoped).toEqual({ ok: true, vendedorCodes: 'ALL' });
        expect(buildVendedorFilterParameterized(scoped.vendedorCodes)).toEqual({ filter: '', params: [] });
    });

    test('dashboard JEFE with full catalog uses cache key ALL and SQL without IN', () => {
        const scoped = resolveDashboardVendedorCodes(
            { user: { code: '98', role: 'JEFE_VENTAS', vendorCodes: CATALOG } },
            'ALL',
        );
        expect(scoped).toEqual({ ok: true, vendedorCodes: 'ALL' });
        const filter = buildVendedorFilterParameterized(scoped.vendedorCodes);
        expect(filter).toEqual({ filter: '', params: [] });
    });

    test('dashboard COMERCIAL stays on a single bound code', () => {
        const scoped = resolveDashboardVendedorCodes(
            { user: { code: '15', role: 'COMERCIAL' } },
            'ALL',
        );
        expect(scoped).toEqual({ ok: true, vendedorCodes: '15' });
        const filter = buildVendedorFilterParameterized(scoped.vendedorCodes);
        expect(filter.params).toEqual(['15']);
    });

    test('applyAuthorizedVendedorCodes coerces COMERCIAL ALL to own code', () => {
        const { applyAuthorizedVendedorCodes } = require('../middleware/vendor-scope');
        expect(applyAuthorizedVendedorCodes(
            { user: { code: '05', role: 'COMERCIAL', vendorCodes: ['05'] } },
            undefined,
        )).toEqual({ ok: true, vendedorCodes: '05' });
        expect(applyAuthorizedVendedorCodes(
            { user: { code: '05', role: 'COMERCIAL', vendorCodes: ['05'] } },
            'ALL',
        )).toEqual({ ok: true, vendedorCodes: '05' });
    });
});
