'use strict';

const {
  isDashboardManager,
  resolveDashboardVendedorCodes,
} = require('../src/utils/dashboardScope');

describe('dashboardScope', () => {
  test('JEFE_VENTAS role is a manager even without the isJefeVentas flag', () => {
    expect(isDashboardManager({ role: 'JEFE_VENTAS' })).toBe(true);
    expect(isDashboardManager({ role: 'ADMIN' })).toBe(true);
    expect(isDashboardManager({ isJefeVentas: true, role: 'COMERCIAL' })).toBe(true);
    expect(isDashboardManager({ role: 'COMERCIAL' })).toBe(false);
  });

  test('comercial is vendor-only regardless of requested ALL', () => {
    const scoped = resolveDashboardVendedorCodes(
      { user: { code: '15', role: 'COMERCIAL' } },
      'ALL',
    );
    expect(scoped).toEqual({ ok: true, vendedorCodes: '15' });
  });

  test('JEFE ALL keeps the full visible set (or ALL when unrestricted)', () => {
    expect(resolveDashboardVendedorCodes(
      { user: { code: '98', role: 'JEFE_VENTAS', vendorCodes: ['80', '15'] } },
      'ALL',
    )).toEqual({ ok: true, vendedorCodes: '80,15' });

    expect(resolveDashboardVendedorCodes(
      { user: { code: '98', role: 'JEFE_VENTAS' } },
      'ALL',
    )).toEqual({ ok: true, vendedorCodes: 'ALL' });
  });

  test('JEFE ALL ignores warehouse A* codes and falls back to company ALL', () => {
    expect(resolveDashboardVendedorCodes(
      { user: { code: '98', role: 'JEFE_VENTAS', vendorCodes: ['A2', 'A3', 'A4'] } },
      'ALL',
    )).toEqual({ ok: true, vendedorCodes: 'ALL' });
  });

  test('JEFE cannot request a vendor outside visible scope', () => {
    const scoped = resolveDashboardVendedorCodes(
      { user: { code: '98', role: 'JEFE_VENTAS', vendorCodes: ['80', '15'] } },
      '72',
    );
    expect(scoped.ok).toBe(false);
    expect(scoped.status).toBe(403);
    expect(scoped.body.code).toBe('FORBIDDEN_VENDOR');
  });

  test('comercial without assigned vendor is forbidden', () => {
    const scoped = resolveDashboardVendedorCodes(
      { user: { role: 'COMERCIAL' } },
      'ALL',
    );
    expect(scoped).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'FORBIDDEN_VENDOR' },
    });
  });

  test('JEFE may request a single in-scope vendor including padded codes', () => {
    expect(resolveDashboardVendedorCodes(
      { user: { code: '98', role: 'JEFE_VENTAS', vendorCodes: ['80', '15'] } },
      '80',
    )).toEqual({ ok: true, vendedorCodes: '80' });

    expect(resolveDashboardVendedorCodes(
      { user: { code: '98', role: 'JEFE_VENTAS', vendorCodes: ['80', '15'] } },
      '080',
    )).toEqual({ ok: true, vendedorCodes: '080' });
  });
});
