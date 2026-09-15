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

function isCommercial80User(userCode) {
    return normalizeCode(userCode) === '80';
}

function parseRequestedVendorCodes(raw) {
    if (raw == null || String(raw).trim() === '' || String(raw).trim().toUpperCase() === 'ALL') {
        return 'ALL';
    }
    const codes = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    return codes.length ? codes : 'ALL';
}

/**
 * COMERCIAL + ALL → 403; JEFE + ALL → ALL; comercial 80 + ALL → alcance de equipo.
 */
function applyAuthorizedVendedorCodes(req, rawVendedorCodes) {
    const requested = parseRequestedVendorCodes(rawVendedorCodes);
    const userCode = req.user && (req.user.code || req.user.id);
    if (requested === 'ALL' && isCommercial80User(userCode)) {
        const codes = [...userScopeCodes(req.user)];
        if (!codes.length) {
            return { ok: false, status: 403, body: { error: 'Forbidden', code: 'FORBIDDEN_VENDOR' } };
        }
        return { ok: true, vendedorCodes: codes.join(',') };
    }
    const check = authorizeVendorScope(req, requested);
    if (!check.ok) {
        return {
            ok: false,
            status: 403,
            body: {
                error: 'Forbidden',
                code: 'FORBIDDEN_VENDOR',
                reason: check.reason,
                denied: check.denied,
            },
        };
    }
    return { ok: true, vendedorCodes: requested === 'ALL' ? 'ALL' : requested.join(',') };
}

function requireVendorQueryScope(req, res, next) {
    const scoped = applyAuthorizedVendedorCodes(req, req.query && req.query.vendedorCodes);
    if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
    req.query.vendedorCodes = scoped.vendedorCodes;
    return next();
}

module.exports = {
    authorizeVendorScope,
    applyAuthorizedVendedorCodes,
    requireVendorQueryScope,
    isFinancialRole,
    userScopeCodes,
    normalizeCode,
};
