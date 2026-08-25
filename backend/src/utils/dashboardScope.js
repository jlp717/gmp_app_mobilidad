'use strict';

/**
 * Scoping de vendedor para dashboard. Movido verbatim desde routes/dashboard.js
 * (mismas funciones, misma semantica); el route file importa desde aqui.
 */
function normalizeVendorCode(value) { return String(value || '').trim(); }
function dashboardCodesMatch(left, right) {
    const a = normalizeVendorCode(left);
    const b = normalizeVendorCode(right);
    return a === b || (a.replace(/^0+/, '') && a.replace(/^0+/, '') === b.replace(/^0+/, ''));
}
function isDashboardManager(user) {
    const role = String(user?.role || '').trim().toUpperCase();
    return user?.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN';
}
function dashboardVisibleVendorCodes(user) {
    const values = user?.vendorCodes || user?.vendedorCodes;
    return Array.isArray(values) ? values.map(normalizeVendorCode).filter(Boolean) : [];
}
function resolveDashboardVendedorCodes(req, requested) {
    const user = req.user || {};
    const userCode = normalizeVendorCode(user.code || user.id || user.codigoVendedor || user.vendedorCode);
    const raw = normalizeVendorCode(requested);
    const requestedAll = !raw || raw.toUpperCase() === 'ALL' || (userCode && dashboardCodesMatch(raw, userCode));
    if (!isDashboardManager(user)) {
        if (!userCode) return { ok: false, status: 403, body: { success: false, code: 'FORBIDDEN_VENDOR', error: 'Usuario sin vendedor asignado' } };
        return { ok: true, vendedorCodes: userCode };
    }
    const visible = dashboardVisibleVendorCodes(user);
    if (requestedAll) return { ok: true, vendedorCodes: visible.length ? visible.join(',') : 'ALL' };
    const codes = raw.split(',').map(normalizeVendorCode).filter(Boolean);
    if (visible.length && codes.some(code => !visible.some(v => dashboardCodesMatch(v, code)))) {
        return { ok: false, status: 403, body: { success: false, code: 'FORBIDDEN_VENDOR', error: 'Vendedor fuera de alcance' } };
    }
    return { ok: true, vendedorCodes: codes.join(',') };
}

module.exports = {
    normalizeVendorCode,
    dashboardCodesMatch,
    isDashboardManager,
    dashboardVisibleVendorCodes,
    resolveDashboardVendedorCodes,
};
