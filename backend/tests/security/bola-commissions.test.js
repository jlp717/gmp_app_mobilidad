// ASVS V8 / BOLA — regresión unitaria del middleware vendor-scope.
const { authorizeVendorScope, isFinancialRole } = require('../../middleware/vendor-scope');

describe('BOLA vendor-scope (ASVS V8)', () => {
    const comercialA = { code: 'A1', role: 'COMERCIAL', vendorCodes: ['A1'], vendedorCodes: [] };

    test('usuario autenticado NO accede a código ajeno (ataque IDOR)', () => {
        const res = authorizeVendorScope({ user: comercialA }, ['B2']);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('out_of_scope');
        expect(res.denied).toEqual(['B2']);
    });

    test('usuario accede a su propio código', () => {
        expect(authorizeVendorScope({ user: comercialA }, ['A1']).ok).toBe(true);
    });

    test('solicitud mixta propia+ajena denegada con lista de denegados', () => {
        const res = authorizeVendorScope({ user: comercialA }, ['A1', 'B2']);
        expect(res.ok).toBe(false);
        expect(res.denied).toEqual(['B2']);
    });

    test('ALL sin rol financiero denegado', () => {
        const res = authorizeVendorScope({ user: comercialA }, 'ALL');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('all_requires_financial_role');
    });

    test('JEFE_VENTAS puede ALL', () => {
        const jefe = { code: '98', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: [], vendedorCodes: [] };
        expect(authorizeVendorScope({ user: jefe }, 'ALL').ok).toBe(true);
    });

    test('sin usuario denegado', () => {
        expect(authorizeVendorScope({}, ['A1']).ok).toBe(false);
    });

    test('normalización de ceros: 080 equivale a 80', () => {
        const u = { code: '80', role: 'COMERCIAL', vendorCodes: ['080'] };
        expect(authorizeVendorScope({ user: u }, ['80']).ok).toBe(true);
    });

    test('alcance por claims múltiples (vendorCodes) permitido', () => {
        const u = { code: 'X9', role: 'COMERCIAL', vendorCodes: ['A1', 'B2'], vendedorCodes: [] };
        expect(authorizeVendorScope({ user: u }, ['B2']).ok).toBe(true);
    });

    test('isFinancialRole reconoce flag y roles verificados en la sesión', () => {
        expect(isFinancialRole({ role: 'COMERCIAL' })).toBe(false);
        expect(isFinancialRole({ role: 'ADMIN' })).toBe(true);
        expect(isFinancialRole({ role: 'otro', isJefeVentas: true })).toBe(true);
    });
});

const { applyAuthorizedVendedorCodes } = require('../../middleware/vendor-scope');

describe('SEC-02 applyAuthorizedVendedorCodes', () => {
    test('COMERCIAL with ALL → 403', () => {
        const res = applyAuthorizedVendedorCodes(
            { user: { code: '01', role: 'COMERCIAL', vendorCodes: ['01'] } },
            'ALL',
        );
        expect(res.ok).toBe(false);
        expect(res.status).toBe(403);
    });

    test('JEFE with ALL → 200 ALL', () => {
        const res = applyAuthorizedVendedorCodes(
            { user: { code: '98', role: 'JEFE_VENTAS', isJefeVentas: true, vendorCodes: [] } },
            'ALL',
        );
        expect(res.ok).toBe(true);
        expect(res.vendedorCodes).toBe('ALL');
    });

    test('comercial 80 ALL expands team scope, not global ALL', () => {
        const res = applyAuthorizedVendedorCodes(
            { user: { code: '80', role: 'COMERCIAL', vendorCodes: ['80', '72', '73', '81', '83'] } },
            'ALL',
        );
        expect(res.ok).toBe(true);
        expect(res.vendedorCodes.split(',')).toEqual(expect.arrayContaining(['80', '72', '73', '81', '83']));
        expect(res.vendedorCodes).not.toBe('ALL');
    });
});
