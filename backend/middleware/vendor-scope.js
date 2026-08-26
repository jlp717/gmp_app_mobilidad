// ASVS V8 / BOLA — autorizacion por objeto sobre codigos de vendedor.
// El token firmado trae el alcance del comercial (code, vendorCodes, vendedorCodes);
// ningun endpoint debe devolver datos economicos de un codigo fuera de ese alcance.
const FINANCIAL_ROLES = new Set(['ADMIN', 'JEFE_VENTAS']);

function normalizeCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    return raw.replace(/^0+/, '') || raw;
}

function isFinancialRole(user) {
    if (!user) return false;
    if (user.isJefeVentas === true) return true;
    return FINANCIAL_ROLES.has(String(user.role || '').trim().toUpperCase());
}

function userScopeCodes(user) {
    const codes = new Set();
    if (user && user.code) codes.add(normalizeCode(user.code));
    for (const list of [user && user.vendorCodes, user && user.vendedorCodes]) {
        if (Array.isArray(list)) {
            for (const entry of list) {
                const norm = normalizeCode(entry);
                if (norm && norm !== 'ALL') codes.add(norm);
            }
        }
    }
    return codes;
}

/**
 * Comprueba que los codigos solicitados esten dentro del alcance firmado del usuario.
 * @param {import('express').Request} req
 * @param {string[]|'ALL'} requestedCodes
 * @returns {{ok: boolean, reason?: string, denied?: string[]}}
 */
function authorizeVendorScope(req, requestedCodes) {
    const user = req.user;
    if (!user) return { ok: false, reason: 'unauthenticated' };
    if (requestedCodes === 'ALL') {
        return { ok: isFinancialRole(user), reason: 'all_requires_financial_role' };
    }
    if (!Array.isArray(requestedCodes) || requestedCodes.length === 0) {
        return { ok: false, reason: 'empty_request' };
    }
    const allowed = userScopeCodes(user);
    const denied = requestedCodes.filter((code) => !allowed.has(normalizeCode(code)));
    return denied.length ? { ok: false, reason: 'out_of_scope', denied } : { ok: true };
}

module.exports = { authorizeVendorScope, isFinancialRole, userScopeCodes, normalizeCode };
