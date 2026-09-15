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

const CATALOG_TTL_MS = 60 * 60 * 1000;
const GMP_SUBEMPRESA = 'GMP';

let catalogCache = { codes: null, at: 0 };
let catalogLoader = null;
let catalogLoadPromise = null;

function isSalesVendorCode(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.toUpperCase() === 'ALL' || raw.toUpperCase() === 'UNK') return false;
    const stripped = raw.replace(/^0+/, '') || raw;
    return /^\d{1,2}$/.test(stripped);
}

function salesVendorCodesFrom(values) {
    const source = Array.isArray(values) ? values : [];
    const codes = [];
    const seen = new Set();
    for (const entry of source) {
        if (!isSalesVendorCode(entry)) continue;
        const key = normalizeCode(entry);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        codes.push(String(entry).trim());
    }
    return codes;
}

function isLiteralAllFlagEnabled() {
    return String(process.env.VENDOR_SCOPE_LITERAL_ALL || 'true').trim().toLowerCase() !== 'false';
}

function getCachedActiveGmpVendorCatalog() {
    if (!catalogCache.codes || !catalogCache.at) return [];
    if ((Date.now() - catalogCache.at) >= CATALOG_TTL_MS) return [];
    return catalogCache.codes;
}

function setActiveVendorCatalogForTests(codes) {
    catalogCache = {
        codes: salesVendorCodesFrom(codes),
        at: Date.now(),
    };
    catalogLoadPromise = null;
}

function resetVendorCatalogCache() {
    catalogCache = { codes: null, at: 0 };
    catalogLoadPromise = null;
}

function setActiveVendorCatalogLoader(loader) {
    catalogLoader = typeof loader === 'function' ? loader : null;
    resetVendorCatalogCache();
}

async function defaultCatalogLoader() {
    const { queryWithParams } = require('../config/db');
    const rows = await queryWithParams(
        `SELECT DISTINCT TRIM(CODIGOVENDEDOR) AS CODE
           FROM DSEDAC.VDC
          WHERE SUBEMPRESA = ?`,
        [GMP_SUBEMPRESA],
        false
    );
    return salesVendorCodesFrom((Array.isArray(rows) ? rows : []).map((row) => row.CODE || row.code));
}

async function refreshActiveGmpVendorCatalog() {
    const loader = catalogLoader || defaultCatalogLoader;
    const codes = salesVendorCodesFrom(await loader());
    catalogCache = { codes, at: Date.now() };
    return codes;
}

function ensureActiveGmpVendorCatalogLoad() {
    if (getCachedActiveGmpVendorCatalog().length > 0) return catalogLoadPromise;
    if (catalogLoadPromise) return catalogLoadPromise;
    if (process.env.JEST_WORKER_ID && !catalogLoader) return null;
    catalogLoadPromise = refreshActiveGmpVendorCatalog()
        .catch(() => [])
        .finally(() => {
            catalogLoadPromise = null;
        });
    return catalogLoadPromise;
}

function visibleContainsCatalog(visibleCodes, catalog) {
    if (!Array.isArray(catalog) || catalog.length === 0) return false;
    const visible = new Set(salesVendorCodesFrom(visibleCodes).map(normalizeCode));
    return catalog.every((code) => visible.has(normalizeCode(code)));
}

function requestedIsAll(requested) {
    if (requested == null) return true;
    if (Array.isArray(requested)) {
        if (requested.length === 0) return true;
        return requested.some((code) => String(code || '').trim().toUpperCase() === 'ALL');
    }
    const raw = String(requested).trim();
    if (!raw) return true;
    return raw.split(',').some((code) => code.trim().toUpperCase() === 'ALL');
}

function requestedCodeList(requested) {
    if (Array.isArray(requested)) return salesVendorCodesFrom(requested);
    return salesVendorCodesFrom(String(requested || '').split(','));
}

/**
 * Alcance efectivo de vendedor. COMERCIAL nunca recibe literalAll.
 * JEFE recibe { literalAll: true } solo si su conjunto visible contiene
 * todos los vendedores activos GMP (catalogo VDC cacheado 1 h).
 * @returns {{ ok: boolean, literalAll: boolean, codes: string[], reason?: string }}
 */
function resolveVendorScope(user, requested, options = {}) {
    ensureActiveGmpVendorCatalogLoad();
    if (!user) {
        return { ok: false, literalAll: false, codes: [], reason: 'unauthenticated' };
    }

    const catalog = Array.isArray(options.catalog)
        ? salesVendorCodesFrom(options.catalog)
        : getCachedActiveGmpVendorCatalog();
    const visible = Array.isArray(options.visibleCodes)
        ? salesVendorCodesFrom(options.visibleCodes)
        : salesVendorCodesFrom([
            ...(user.vendorCodes || []),
            ...(user.vendedorCodes || []),
        ]);

    if (!isFinancialRole(user)) {
        const own = isSalesVendorCode(user.code)
            ? [String(user.code).trim()]
            : salesVendorCodesFrom([...(user.vendorCodes || []), ...(user.vendedorCodes || [])]);
        if (own.length === 0) {
            return { ok: false, literalAll: false, codes: [], reason: 'empty_scope' };
        }
        if (requestedIsAll(requested)) {
            return { ok: true, literalAll: false, codes: own };
        }
        const requestedCodes = requestedCodeList(requested);
        const denied = requestedCodes.filter((code) => !own.some((allowed) => normalizeCode(allowed) === normalizeCode(code)));
        if (denied.length) {
            return { ok: false, literalAll: false, codes: own, reason: 'out_of_scope' };
        }
        return { ok: true, literalAll: false, codes: requestedCodes.length ? requestedCodes : own };
    }

    if (requestedIsAll(requested)) {
        if (visible.length === 0) {
            return { ok: true, literalAll: true, codes: [] };
        }
        if (isLiteralAllFlagEnabled() && visibleContainsCatalog(visible, catalog)) {
            return { ok: true, literalAll: true, codes: [] };
        }
        return { ok: true, literalAll: false, codes: visible };
    }

    const requestedCodes = requestedCodeList(requested);
    if (requestedCodes.length === 0) {
        return { ok: false, literalAll: false, codes: [], reason: 'empty_request' };
    }
    if (visible.length === 0) {
        return { ok: true, literalAll: false, codes: requestedCodes };
    }
    const allowed = requestedCodes.filter((code) =>
        visible.some((entry) => normalizeCode(entry) === normalizeCode(code)));
    if (allowed.length === 0) {
        return { ok: false, literalAll: false, codes: [], reason: 'out_of_scope' };
    }
    return { ok: true, literalAll: false, codes: allowed };
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
    resolveVendorScope,
    isSalesVendorCode,
    getCachedActiveGmpVendorCatalog,
    setActiveVendorCatalogForTests,
    resetVendorCatalogCache,
    setActiveVendorCatalogLoader,
    refreshActiveGmpVendorCatalog,
    ensureActiveGmpVendorCatalogLoad,
};
