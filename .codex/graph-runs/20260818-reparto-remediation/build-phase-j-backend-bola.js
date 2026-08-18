'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const files = new Map();

function load(name) {
  if (!files.has(name)) files.set(name, fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n'));
  return files.get(name);
}

function replaceOnce(name, before, after) {
  const source = load(name);
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`replacement must match exactly once: ${name}: ${before.slice(0, 80)}`);
  }
  files.set(name, source.slice(0, first) + after + source.slice(first + before.length));
}

const entregas = 'backend/routes/entregas.js';
replaceOnce(entregas, "const { sanitizeCodeListForParams } = require('../utils/common');\n", '');
replaceOnce(entregas,
`function isPrivilegedUser(req) {
    const user = req.user || {};
    return user.isJefeVentas === true || user.role === 'JEFE_VENTAS' || user.role === 'ADMIN';
}`,
`function canonicalRepartidorCode(value) {
    const raw = normalizeCode(value).toUpperCase();
    if (!/^[A-Z0-9]{1,2}$/.test(raw) || raw === 'ALL') return null;
    return /^\\d{1,2}$/.test(raw) ? raw.padStart(2, '0') : raw;
}

function parseRepartidorSelector(value, { single = false } = {}) {
    const raw = normalizeCode(value);
    if (!raw || raw.length > 500 || /^ALL$/i.test(raw)) return null;
    const parts = raw.split(',');
    if (single && parts.length !== 1) return null;
    const codes = parts.map(canonicalRepartidorCode);
    if (codes.some((code) => !code) || codes.length > 100) return null;
    return [...new Set(codes)];
}

function isPrivilegedUser(req) {
    const user = req.user || {};
    const role = normalizeCode(user.role).toUpperCase();
    const activeMode = normalizeCode(user.activeMode).toUpperCase();
    return role === 'ADMIN' || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');
}`);
replaceOnce(entregas,
`function ensureRepartidorAccess(req, res, repartidorId) {
    if (canAccessRepartidor(req, repartidorId)) return true;
    logger.warn(\`[ENTREGAS] Forbidden \${req.user?.code || 'unknown'} -> repartidor \${repartidorId}\`);
    res.status(403).json({ success: false, error: 'No tienes permisos para operar sobre este repartidor' });
    return false;
}`,
`function ensureRepartidorAccess(req, res, repartidorId) {
    if (canAccessRepartidor(req, repartidorId)) return true;
    logger.warn(\`[ENTREGAS] Forbidden \${req.user?.code || 'unknown'} -> repartidor \${repartidorId}\`);
    res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para operar sobre este repartidor' });
    return false;
}

function requireConcreteAlbaranOwner(req, res) {
    const role = normalizeCode(req.user?.role).toUpperCase();
    const activeMode = normalizeCode(req.user?.activeMode).toUpperCase();
    const rawHint = req.query?.repartidorId;
    if (role === 'ADMIN') return { allowed: true, hintedOwner: null };
    if (role === 'JEFE_VENTAS') {
        if (activeMode !== 'REPARTIDOR') {
            res.status(403).json({ success: false, code: 'REPARTO_MODE_REQUIRED', error: 'Activa el Perfil Reparto para consultar entregas' });
            return { allowed: false, hintedOwner: null };
        }
        const selected = parseRepartidorSelector(rawHint, { single: true });
        if (!selected) {
            res.status(422).json({ success: false, code: 'REPARTIDOR_ID_REQUIRED', error: 'Selecciona un unico repartidor concreto' });
            return { allowed: false, hintedOwner: null };
        }
        return { allowed: true, hintedOwner: selected[0] };
    }
    if (role !== 'REPARTIDOR') {
        res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para consultar entregas' });
        return { allowed: false, hintedOwner: null };
    }
    if (rawHint === undefined || rawHint === null || String(rawHint).trim() === '') {
        return { allowed: true, hintedOwner: null };
    }
    const selected = parseRepartidorSelector(rawHint, { single: true });
    if (!selected) {
        res.status(422).json({ success: false, code: 'REPARTIDOR_ID_INVALID', error: 'Selecciona un unico repartidor concreto' });
        return { allowed: false, hintedOwner: null };
    }
    if (!canAccessRepartidor(req, selected[0])) {
        res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para consultar este repartidor' });
        return { allowed: false, hintedOwner: null };
    }
    return { allowed: true, hintedOwner: selected[0] };
}`);
replaceOnce(entregas,
`        const idList = sanitizeCodeListForParams(repartidorId);
        if (!idList || idList.length === 0) {
            return res.status(400).json({ error: 'Invalid repartidor ID format' });
        }`,
`        const idList = parseRepartidorSelector(repartidorId);
        if (!idList || idList.length === 0) {
            return res.status(422).json({ success: false, code: 'REPARTIDOR_ID_INVALID', error: 'Selector de repartidor invalido' });
        }`);
replaceOnce(entregas,
`        const serie = req.query.serie;
        const terminal = req.query.terminal;
        // Accept canonical`,
`        const serie = req.query.serie;
        const terminal = req.query.terminal;
        const ownerSelection = requireConcreteAlbaranOwner(req, res);
        if (!ownerSelection.allowed) return;
        // Accept canonical`);
replaceOnce(entregas,
`        const header = { ...headers[0] };
        if (!ensureRepartidorAccess(req, res, header.CODIGO_REPARTIDOR)) return;
`,
`        const header = { ...headers[0] };
        if (!ensureRepartidorAccess(req, res, header.CODIGO_REPARTIDOR)) return;
        if (ownerSelection.hintedOwner && !codesMatch(ownerSelection.hintedOwner, header.CODIGO_REPARTIDOR)) {
            return res.status(403).json({ success: false, code: 'DELIVERY_OWNERSHIP_REQUIRED', error: 'El albaran no pertenece al repartidor seleccionado' });
        }
`);

const repartidor = 'backend/routes/repartidor.js';
replaceOnce(repartidor,
`const PRIVILEGED_REPARTIDOR_ROLES = new Set(['ADMIN', 'JEFE_VENTAS']);
const REPARTIDOR_READ_PAGE_MAX = 100;`,
`const REPARTIDOR_READ_PAGE_MAX = 100;

function normalizedRole(user) {
    return String(user?.role || '').trim().toUpperCase();
}

function isRepartoPrivileged(user) {
    const role = normalizedRole(user);
    return role === 'ADMIN'
        || (role === 'JEFE_VENTAS'
            && String(user?.activeMode || '').trim().toUpperCase() === 'REPARTIDOR');
}

function canonicalRepartidorCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,2}$/.test(raw) || raw === 'ALL') return '';
    return /^\\d{1,2}$/.test(raw) ? raw.padStart(2, '0') : raw;
}`);
replaceOnce(repartidor,
`    const rawParts = String(rawIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    const ids = [...new Set(rawParts)];
    if (ids.length > REPARTIDOR_READ_PAGE_MAX || ids.some((id) => !/^[A-Za-z0-9]{1,2}$/.test(id))) {
        sendRouteError(res, 400, 'REPARTIDOR_ID_INVALID');`,
`    const rawParts = String(rawIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    const normalized = rawParts.map(canonicalRepartidorCode);
    const ids = [...new Set(normalized)];
    if (ids.length > REPARTIDOR_READ_PAGE_MAX || normalized.some((id) => !id)) {
        sendRouteError(res, 422, 'REPARTIDOR_ID_INVALID');`);
replaceOnce(repartidor,
`    const role = String(user.role || '').trim().toUpperCase();
    if (PRIVILEGED_REPARTIDOR_ROLES.has(role)) return ids;
    if (role !== 'REPARTIDOR') {`,
`    const role = normalizedRole(user);
    if (isRepartoPrivileged(user)) return ids;
    if (role === 'JEFE_VENTAS') {
        sendRouteError(res, 403, 'REPARTIDOR_MODE_REQUIRED');
        return null;
    }
    if (role !== 'REPARTIDOR') {`);
replaceOnce(repartidor,
`    const ownIds = String(user.code || user.id || '').trim();
    if (ids.length !== 1 || !/^[A-Za-z0-9]{1,2}$/.test(ownIds) || ids[0] !== ownIds) {`,
`    const ownId = canonicalRepartidorCode(user.code || user.id || '');
    if (ids.length !== 1 || !ownId || ids[0] !== ownId) {`);
replaceOnce(repartidor,
`function hintedRepartidorId(req) {
    const raw = rawRepartidorId(req);
    return /^[A-Za-z0-9]{1,2}$/.test(raw) ? raw : '';
}`,
`function hintedRepartidorId(req) {
    return canonicalRepartidorCode(rawRepartidorId(req));
}`);
replaceOnce(repartidor,
`        .map((value) => String(value || '').trim())
        .filter((value) => /^[A-Za-z0-9]{1,2}$/.test(value)))];`,
`        .map(canonicalRepartidorCode)
        .filter(Boolean))];`);
replaceOnce(repartidor,
`    const role = String(req.user?.role || '').trim().toUpperCase();
    const ownId = String(req.user?.code || req.user?.id || '').trim();`,
`    const role = normalizedRole(req.user);
    const ownId = canonicalRepartidorCode(req.user?.code || req.user?.id || '');`);
replaceOnce(repartidor,
`    const ownIdValid = /^[A-Za-z0-9]{1,2}$/.test(ownId);`,
`    const ownIdValid = Boolean(ownId);`);
replaceOnce(repartidor,
`        && PRIVILEGED_REPARTIDOR_ROLES.has(role)
        && activeMode === 'REPARTIDOR') {`,
`        && role === 'JEFE_VENTAS'
        && activeMode === 'REPARTIDOR') {`);
replaceOnce(repartidor,
`    if (ownIdValid && drivers.includes(ownId) && (role === 'REPARTIDOR' || PRIVILEGED_REPARTIDOR_ROLES.has(role))) {
        req.documentOwnerId = ownId;`,
`    const ownDriver = drivers.find((driver) => normalizeVendorCode(driver) === normalizeVendorCode(ownId));
    if (ownIdValid && ownDriver && (role === 'REPARTIDOR' || isRepartoPrivileged(req.user))) {
        req.documentOwnerId = ownDriver;`);
replaceOnce(repartidor,
`    if (PRIVILEGED_REPARTIDOR_ROLES.has(role)) {
        if (hinted && drivers.includes(hinted)) {
            req.documentOwnerId = hinted;`,
`    if (isRepartoPrivileged(req.user)) {
        const hintedDriver = drivers.find((driver) => normalizeVendorCode(driver) === normalizeVendorCode(hinted));
        if (hintedDriver) {
            req.documentOwnerId = hintedDriver;`);
replaceOnce(repartidor,
`        const key = keyParser(sourceSelector(req));
        if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
        try {`,
`        const key = keyParser(sourceSelector(req));
        if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
        if (options?.requireRepartoOwnerHint && !prevalidateStrictDocumentOwner(req, res)) return;
        try {`);
replaceOnce(repartidor,
`}

const strictRepartoDocumentOwner = { requireRepartoOwnerHint: true };`,
`}

function prevalidateStrictDocumentOwner(req, res) {
    const role = normalizedRole(req.user);
    const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();
    const raw = rawRepartidorId(req);
    const hint = hintedRepartidorId(req);
    if (role === 'ADMIN') return true;
    if (role === 'JEFE_VENTAS') {
        if (activeMode !== 'REPARTIDOR') {
            sendRouteError(res, 403, 'DOCUMENT_REPARTO_MODE_REQUIRED');
            return false;
        }
        if (!hint || raw.includes(',') || /^ALL$/i.test(raw)) {
            sendRouteError(res, 422, 'DOCUMENT_OWNER_REQUIRED');
            return false;
        }
        return true;
    }
    if (role === 'REPARTIDOR' && raw) {
        const own = canonicalRepartidorCode(req.user?.code || req.user?.id || '');
        if (!hint || raw.includes(',') || /^ALL$/i.test(raw)) {
            sendRouteError(res, 422, 'DOCUMENT_OWNER_REQUIRED');
            return false;
        }
        if (hint !== own) {
            sendRouteError(res, 403, 'DOCUMENT_ACCESS_DENIED');
            return false;
        }
    }
    return true;
}

const strictRepartoDocumentOwner = { requireRepartoOwnerHint: true };`);
replaceOnce(repartidor,
`const albaranQueryOwnership = documentOwnershipGuard(parseAlbaranOwnershipKey, resolveAlbaranOwners, (req) => req.query);`,
`const albaranQueryOwnership = documentOwnershipGuard(parseAlbaranOwnershipKey, resolveAlbaranOwners, (req) => req.query, strictRepartoDocumentOwner);`);
replaceOnce(repartidor,
`async function deliveryOwnership(req, res, next) {
    const entregaId = String(req.params.entregaId || '').trim();
    if (!/^\\d{1,18}$/.test(entregaId)) return sendRouteError(res, 422, 'DELIVERY_ID_INVALID');
    try {`,
`async function deliveryOwnership(req, res, next) {
    const entregaId = String(req.params.entregaId || '').trim();
    if (!/^\\d{1,18}$/.test(entregaId)) return sendRouteError(res, 422, 'DELIVERY_ID_INVALID');
    if (!prevalidateStrictDocumentOwner(req, res)) return;
    try {`);
replaceOnce(repartidor,
`        if (!authorizeResolvedOwner(req, res, rows)) return;
        return next();
    } catch (_error) {
        logger.error('[REPARTIDOR] Delivery ownership lookup failed');`,
`        if (!authorizeResolvedOwner(req, res, rows, strictRepartoDocumentOwner)) return;
        return next();
    } catch (_error) {
        logger.error('[REPARTIDOR] Delivery ownership lookup failed');`);
replaceOnce(repartidor,
`    if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
    try {
        const rows = await resolveAlbaranOwners(key);
        if (!authorizeResolvedOwner(req, res, rows)) return;`,
`    if (!key) return sendRouteError(res, 422, 'DOCUMENT_KEY_INVALID');
    if (!prevalidateStrictDocumentOwner(req, res)) return;
    try {
        const rows = await resolveAlbaranOwners(key);
        if (!authorizeResolvedOwner(req, res, rows, strictRepartoDocumentOwner)) return;`);
replaceOnce(repartidor,
`        // Deduplicate by client ID (a client may appear with different repartidors)
        const seen = new Map();
        rows.forEach(r => {
            const id = (r.ID || '').trim();
            if (!id) return;
            const existing = seen.get(id);`,
`        // A fleet client card is owner-specific. The same ERP client assigned
        // to two drivers must remain two isolated drill-down targets.
        const seen = new Map();
        rows.forEach(r => {
            const id = (r.ID || '').trim();
            const owner = canonicalRepartidorCode(r.OWNER_ID);
            if (!id || !owner) return;
            const cardKey = \`${'${owner}:${id}'}\`;
            const existing = seen.get(cardKey);`);
replaceOnce(repartidor, `                seen.set(id, r);`, `                seen.set(cardKey, r);`);
replaceOnce(repartidor,
`                repCode: null,
                repName: null`,
`                repCode: canonicalRepartidorCode(r.OWNER_ID),
                repName: null`);

const finance = 'backend/routes/repartidor-finanzas.js';
replaceOnce(finance,
`function hasFinanceListRole(user) {
  const role = String(user?.role || '').trim().toUpperCase();
  return role === 'ADMIN' || role === 'JEFE_VENTAS';
}`,
`function hasFinanceListRole(user) {
  const role = String(user?.role || '').trim().toUpperCase();
  const activeMode = String(user?.activeMode || '').trim().toUpperCase();
  return role === 'ADMIN' || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');
}`);
replaceOnce(finance,
`function canAccessRepartidor(req, repartidorId) {
  const user = req.user || {};
  if (user.isJefeVentas || user.role === 'JEFE_VENTAS' || user.role === 'ADMIN') {
    return true;
  }
  if (user.role !== 'REPARTIDOR') return false;`,
`function canAccessRepartidor(req, repartidorId) {
  const user = req.user || {};
  const role = String(user.role || '').trim().toUpperCase();
  if (hasFinanceListRole(user)) return true;
  if (role !== 'REPARTIDOR') return false;`);
replaceOnce(finance,
`function requireRepartidorAccess(resolveRepartidorId) {
  return (req, res, next) => {
    const repartidorId = resolveRepartidorId(req);
    if (canAccessRepartidor(req, repartidorId)) return next();
    logger.warn('[REPARTIDOR_FINANZAS] Access denied', {
      code: 'REPARTIDOR_ACCESS_DENIED',
    });
    return res.status(403).json({
      success: false,
      error: 'No tienes permisos para operar sobre este repartidor',
    });
  };
}`,
`function requireRepartidorAccess(resolveRepartidorId) {
  return (req, res, next) => {
    const repartidorId = resolveRepartidorId(req);
    if (canAccessRepartidor(req, repartidorId)) return next();
    logger.warn('[REPARTIDOR_FINANZAS] Access denied', {
      code: 'REPARTIDOR_ACCESS_DENIED',
    });
    return res.status(403).json({
      success: false,
      code: 'REPARTIDOR_ACCESS_DENIED',
      error: 'No tienes permisos para operar sobre este repartidor',
    });
  };
}

function requireSingleFinanceRepartidorSelector(req, res, next) {
  const raw = String(req.params?.repartidorId || '').trim();
  if (!raw || raw.includes(',') || /^ALL$/i.test(raw)) {
    return res.status(422).json({
      success: false,
      code: 'REPARTIDOR_ID_MULTI_NOT_ALLOWED',
      error: 'Selecciona un unico repartidor concreto',
    });
  }
  return next();
}`);
replaceOnce(finance,
`router.get('/vencimientos/:repartidorId/:docId/detalle', verifyToken, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {`,
`router.get('/vencimientos/:repartidorId/:docId/detalle', verifyToken, requireSingleFinanceRepartidorSelector, requireRepartidorAccess((req) => req.params.repartidorId), async (req, res) => {`);
replaceOnce(finance,
`  const supervisor = role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR';
  if (target && (target.toUpperCase() === 'ALL'`,
`  const supervisor = role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR';
  if (role === 'JEFE_VENTAS' && !supervisor) {
    throw new EvidenceError('EVIDENCE_REPARTO_MODE_REQUIRED', 'Activa el Perfil Reparto', 403);
  }
  if (target && (target.toUpperCase() === 'ALL'`);

const chatbotAuth = 'backend/src/chatbot/chatbot_authorization.js';
replaceOnce(chatbotAuth,
`function authorizeChatbotRepartoScope(userContext = {}, requestedScope) {
  if (requestedScope === null || requestedScope === undefined || requestedScope === "") {
    return { allowed: true, code: "NO_REPARTO_SCOPE", driverCodes: [] };
  }`,
`function authorizeChatbotRepartoScope(userContext = {}, requestedScope) {
  const role = normalizeCode(userContext.role || userContext.rol);
  const activeMode = normalizeCode(userContext.activeMode);
  const repartoProfile = role === "REPARTIDOR"
    || (role === "JEFE_VENTAS" && activeMode === "REPARTIDOR");
  if (requestedScope === null || requestedScope === undefined || requestedScope === "") {
    return repartoProfile
      ? { allowed: false, code: "REPARTO_SCOPE_REQUIRED", driverCodes: [] }
      : { allowed: true, code: "NO_REPARTO_SCOPE", driverCodes: [] };
  }`);
replaceOnce(chatbotAuth,
`  const role = normalizeCode(userContext.role || userContext.rol);
  const activeMode = normalizeCode(userContext.activeMode);
  if (role === "REPARTIDOR") {`,
`  if (role === "REPARTIDOR") {`);
replaceOnce(chatbotAuth,
`  const unauthorized = requested.codes.some((requestedCode) =>
    !visibleCodes.some((visibleCode) => codesMatch(requestedCode, visibleCode))
  );
  if (unauthorized) {`,
`  const resolvedCodes = requested.codes.map((requestedCode) =>
    visibleCodes.find((visibleCode) => codesMatch(requestedCode, visibleCode)) || ""
  );
  if (resolvedCodes.some((code) => !code)) {`);
replaceOnce(chatbotAuth, `    driverCodes: requested.codes,`, `    driverCodes: [...new Set(resolvedCodes)],`);
replaceOnce(chatbotAuth,
`function isSupervisor(userContext = {}) {
  const role = normalizeCode(userContext.role);
  if (SUPERVISOR_ROLES.has(role)) return true;`,
`function isSupervisor(userContext = {}) {
  const role = normalizeCode(userContext.role);
  if (role === "JEFE_VENTAS" && normalizeCode(userContext.activeMode) === "REPARTIDOR") return false;
  if (SUPERVISOR_ROLES.has(role)) return true;`);
replaceOnce(chatbotAuth,
`    userCode: normalizeCode(
      user.code || user.userCode || user.vendedor || user.CODIGOVENDEDOR,
    ),
    role,`,
`    userCode: normalizeCode(
      user.code || user.userCode || user.vendedor || user.CODIGOVENDEDOR,
    ),
    role,
    activeMode: normalizeCode(user.activeMode),`);

const orchestrator = 'backend/src/chatbot/llm-orchestrator.js';
replaceOnce(orchestrator,
`      statusCode: 403,
      error: repartoAuthorization.code,`,
`      statusCode: ['REPARTO_SCOPE_REQUIRED', 'REPARTO_SCOPE_INVALID'].includes(repartoAuthorization.code) ? 422 : 403,
      error: repartoAuthorization.code,`);
replaceOnce(orchestrator,
`  context.repartidorScope = repartoAuthorization.driverCodes;

  const moderation`,
`  context.repartidorScope = repartoAuthorization.driverCodes;
  const role = normalizeCode(context.role);
  const repartoProfile = role === 'REPARTIDOR'
    || (role === 'JEFE_VENTAS' && normalizeCode(context.activeMode) === 'REPARTIDOR');
  if (repartoProfile) context.vendorScope = [...repartoAuthorization.driverCodes];

  const moderation`);

const handler = 'backend/src/chatbot/chatbot_handler.js';
replaceOnce(handler,
`    const repartidorScope = Array.isArray(context.repartidorScope) && context.repartidorScope.length
        ? context.repartidorScope
        : (userCode ? [userCode] : []);
`,
`    const repartidorScope = Array.isArray(context.repartidorScope) && context.repartidorScope.length
        ? context.repartidorScope
        : (userCode ? [userCode] : []);
    const repartoProfile = context.role === 'REPARTIDOR'
        || (context.role === 'JEFE_VENTAS' && context.activeMode === 'REPARTIDOR');
    if (repartoProfile && (!context.repartidorScope?.length
        || vendorScope.some((code) => !repartidorScope.includes(code)))) {
        throw new Error('CHATBOT_REPARTO_SCOPE_INVARIANT');
    }
`);

const authRoute = 'backend/routes/auth.js';
replaceOnce(authRoute,
`        if (req.user?.role === 'REPARTIDOR' && !req.user?.isJefeVentas) {
            const code = (req.user.code || req.user.id || '').toString().trim();
            return res.json(code ? [{ code, name: req.user.name || code }] : []);
        }
        if (req.user?.role !== 'JEFE_VENTAS' && req.user?.role !== 'ADMIN' && !req.user?.isJefeVentas) {
            return res.status(403).json({ error: 'Acceso restringido', code: 'INSUFFICIENT_ROLE' });
        }`,
`        const role = String(req.user?.role || '').trim().toUpperCase();
        const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();
        if (role === 'REPARTIDOR') {
            const code = (req.user.code || req.user.id || '').toString().trim();
            return res.json(code ? [{ code, name: req.user.name || code }] : []);
        }
        const canListFleet = role === 'ADMIN'
            || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');
        if (!canListFleet) {
            return res.status(403).json({ error: 'Acceso restringido', code: 'INSUFFICIENT_ROLE' });
        }`);

const authMiddleware = 'backend/middleware/auth.js';
replaceOnce(authMiddleware,
`function projectAuthenticatedUser(payload) {
    const role = payload.role || 'COMERCIAL';`,
`function projectAuthenticatedUser(payload) {
    const role = String(payload.role || 'COMERCIAL').trim().toUpperCase();`);
replaceOnce(authMiddleware,
`        isJefeVentas: payload.isJefeVentas === true,`,
`        isJefeVentas: role === 'JEFE_VENTAS' || role === 'ADMIN',`);
replaceOnce(authMiddleware,
`exports.requireJefeVentas = (req, res, next) => {
    if (!req.user?.isJefeVentas) {`,
`exports.requireJefeVentas = (req, res, next) => {
    const role = String(req.user?.role || '').trim().toUpperCase();
    if (role !== 'JEFE_VENTAS' && role !== 'ADMIN') {`);

const repo = 'backend/repositories/repartidor-route-db2-repository.js';
replaceOnce(repo,
`const CANONICAL_CONFIRMATION_STATUSES = Object.freeze([
  'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO',
]);`,
`const CANONICAL_CONFIRMATION_STATUSES = Object.freeze([
  'ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO',
]);

const LEGACY_ROUTE_READ_TABLES = Object.freeze({
  isolated_test: Object.freeze({
    deliveries: 'JAVIER.TEST_REPARTIDOR_ENTREGAS',
    signatures: 'JAVIER.TEST_REPARTIDOR_FIRMAS',
  }),
  production: Object.freeze({
    deliveries: 'JAVIER.REPARTIDOR_ENTREGAS',
    signatures: 'JAVIER.REPARTIDOR_FIRMAS',
  }),
});

function resolveRouteTableSet() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.valid && Object.hasOwn(LEGACY_ROUTE_READ_TABLES, runtime.tableSet)) return runtime.tableSet;
  } catch (_error) { /* fail closed below */ }
  const explicit = String(process.env.REPARTO_TABLE_SET || '').trim().toLowerCase();
  return explicit === 'isolated_test' ? explicit : null;
}

function resolveLegacyRouteReadTable(kind) {
  return LEGACY_ROUTE_READ_TABLES[resolveRouteTableSet()]?.[kind] || null;
}

function resolveDeliveryStatusReadTable() {
  const tableSet = resolveRouteTableSet();
  const expected = TABLE_MAPPINGS[tableSet]?.notifications?.deliveryStatus;
  if (!expected) return null;
  return getDeliveryStatusTable() === expected ? expected : null;
}`);
replaceOnce(repo,
`/// History reads ERP (DSEDAC) documents and overlays confirmations.
/// Isolated_test writes go to TEST_*; still overlay those onto production docs,
/// and also read production confirmation tables for older signatures.
function resolveConfirmationReadTables() {
  const primary = resolveConfirmationTables();
  const list = [];
  const seen = new Set();
  const push = (table) => {
    if (!table?.confirmations || seen.has(table.confirmations)) return;
    seen.add(table.confirmations);
    list.push(table);
  };
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.tableSet === 'isolated_test') {
      push(TABLE_MAPPINGS.production.confirmation);
      push(TABLE_MAPPINGS.isolated_test.confirmation);
    }
  } catch (_error) {
    // Keep the primary mapping only.
  }
  push(primary);
  return list;
}`,
`/// History reads ERP documents and overlays the single selected app table-set.
function resolveConfirmationReadTables() {
  const primary = resolveConfirmationTables();
  return primary ? [primary] : [];
}`);
replaceOnce(repo,
`async function resolveDeliveryOwners(entregaId) {
  return runQueryWithParams(\`
        SELECT DISTINCT TRIM(CODIGOREPARTIDOR) AS OWNER_ID
        FROM JAVIER.REPARTIDOR_ENTREGAS`,
`async function resolveDeliveryOwners(entregaId) {
  const table = resolveLegacyRouteReadTable('deliveries');
  if (!table) return [];
  return runQueryWithParams(\`
        SELECT DISTINCT TRIM(CODIGOREPARTIDOR) AS OWNER_ID
        FROM \${table}`);
replaceOnce(repo,
`function appFirmasTable() {
  try {
    const runtime = resolveRepartoRuntime(process.env);
    if (runtime?.tableSet === 'isolated_test') return 'JAVIER.TEST_REPARTIDOR_FIRMAS';
  } catch (_) { /* fall through */ }
  return 'JAVIER.REPARTIDOR_FIRMAS';
}`,
`function appFirmasTable() {
  return resolveLegacyRouteReadTable('signatures');
}`);
replaceOnce(repo,
`  const table = getDeliveryStatusTable();
  return runQueryWithParams(`,
`  const table = resolveDeliveryStatusReadTable();
  if (!table) return [];
  return runQueryWithParams(`);
replaceOnce(repo,
`async function getRepartidorFirmasByAlbaran(numero, ejercicio, serie, terminal) {
  const table = appFirmasTable();
  return runQueryWithParams(`,
`async function getRepartidorFirmasByAlbaran(numero, ejercicio, serie, terminal) {
  const table = appFirmasTable();
  if (!table) return [];
  return runQueryWithParams(`);
replaceOnce(repo,
`async function getEntregaFirma(entregaId) {
  return runQueryWithParams(\`
            SELECT FIRMABASE64, FIRMANOMBRE, DIA, MES, ANO, HORA
            FROM JAVIER.REPARTIDOR_FIRMAS `,
`async function getEntregaFirma(entregaId) {
  const table = appFirmasTable();
  if (!table) return [];
  return runQueryWithParams(\`
            SELECT FIRMABASE64, FIRMANOMBRE, DIA, MES, ANO, HORA
            FROM \${table} `);
replaceOnce(repo,
`async function getRepartidorFirmaBase64ByAlbaran(numero, year, serie, terminal) {
  const table = appFirmasTable();
  return runQueryWithParams(`,
`async function getRepartidorFirmaBase64ByAlbaran(numero, year, serie, terminal) {
  const table = appFirmasTable();
  if (!table) return [];
  return runQueryWithParams(`);
replaceOnce(repo,
`  const canonicalOnly = isIsolatedTestTableSet();
const dsAvail = isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();`,
`  const canonicalOnly = isIsolatedTestTableSet();
  const deliveryStatusTable = resolveDeliveryStatusReadTable();
  const dsAvail = Boolean(deliveryStatusTable) && isDeliveryStatusAvailable() && isDeliveryStatusNewSchema();`);
replaceOnce(repo, `            LEFT JOIN JAVIER.DELIVERY_STATUS DS`, `            LEFT JOIN \${deliveryStatusTable} DS`);
replaceOnce(repo,
`                    CPC.DIADOCUMENTO AS DIA,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,`,
`                    CPC.DIADOCUMENTO AS DIA,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,
                    TRIM(OPP.CODIGOREPARTIDOR) AS DELIVERY_REPARTIDOR,`);
replaceOnce(repo,
`            SELECT
                TRIM(UNIQ.CODIGOCLIENTEALBARAN) as ID,`,
`            SELECT
                TRIM(UNIQ.CODIGOCLIENTEALBARAN) as ID,
                    TRIM(UNIQ.CODIGOREPARTIDOR) as OWNER_ID,`);
replaceOnce(repo,
`                SELECT DISTINCT
                    CPC.CODIGOCLIENTEALBARAN,`,
`                SELECT DISTINCT
                    CPC.CODIGOCLIENTEALBARAN,
                    OPP.CODIGOREPARTIDOR,`);
replaceOnce(repo,
`            GROUP BY TRIM(UNIQ.CODIGOCLIENTEALBARAN), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))`,
`            GROUP BY TRIM(UNIQ.CODIGOCLIENTEALBARAN), TRIM(UNIQ.CODIGOREPARTIDOR), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))`);

const testLegacy = 'backend/__tests__/repartidor-legacy-read-security.test.js';
replaceOnce(testLegacy,
`  test('allows explicit ADMIN and JEFE_VENTAS roles to use multi-id scope', async () => {
    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      mockUser = { id: '90', code: '90', role };`,
`  test('allows ADMIN and JEFE_VENTAS in reparto mode to use multi-id scope', async () => {
    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      mockUser = { id: '90', code: '90', role, ...(role === 'JEFE_VENTAS' ? { activeMode: 'REPARTIDOR' } : {}) };`);
replaceOnce(testLegacy,
`    expect(response.status).toBe(400);
    expect(response.body.code).toBe('REPARTIDOR_ID_INVALID');`,
`    expect(response.status).toBe(422);
    expect(response.body.code).toBe('REPARTIDOR_ID_INVALID');`);
replaceOnce(testLegacy,
`    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      jest.clearAllMocks();
      mockUser = { id: '90', code: '90', role };
      mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06' }]);
      const privileged = await authenticatedGet(
        '/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1',
      );`,
`    for (const role of ['ADMIN', 'JEFE_VENTAS']) {
      jest.clearAllMocks();
      mockUser = { id: '90', code: '90', role, ...(role === 'JEFE_VENTAS' ? { activeMode: 'REPARTIDOR' } : {}) };
      mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '06' }]);
      const suffix = role === 'JEFE_VENTAS' ? '&repartidorId=06' : '';
      const privileged = await authenticatedGet(
        \`/repartidor/history/signature?ejercicio=2026&serie=A&terminal=0&numero=1\${suffix}\`,
      );`);
replaceOnce(testLegacy,
`    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }, { OWNER_ID: '06' }]);

    const response = await authenticatedGet(
      '/repartidor/document/invoice/2026/F/7/pdf',
    );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DOCUMENT_OWNER_AMBIGUOUS');`,
`    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };

    const response = await authenticatedGet(
      '/repartidor/document/invoice/2026/F/7/pdf',
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('DOCUMENT_OWNER_REQUIRED');
    expect(mockQueryWithParams).not.toHaveBeenCalled();`);
replaceOnce(testLegacy,
`    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }, { OWNER_ID: '06' }]);`,
`    mockUser = { id: '90', code: '90', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };
    mockQueryWithParams.mockResolvedValue([{ OWNER_ID: '05' }, { OWNER_ID: '06' }]);`);

const chatbotScopeTest = 'backend/__tests__/chatbot_reparto_scope.test.js';
replaceOnce(chatbotScopeTest,
`  test('validated fleet reaches the handler without changing commercial vendor scope', async () => {`,
`  test('validated fleet restricts both reparto and vendor scope', async () => {`);
replaceOnce(chatbotScopeTest,
`    expect(context.vendorScope).toEqual(['ALL']);
    expect(context.repartidorScope).toEqual(['03', '05']);`,
`    expect(context.vendorScope).toEqual(['03', '05']);
    expect(context.repartidorScope).toEqual(['03', '05']);
    expect(context.isJefeVentas).toBe(false);`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmp-phase-j-'));
const oldRoot = path.join(tmp, 'old');
const newRoot = path.join(tmp, 'new');
for (const [name, modified] of files) {
  const oldPath = path.join(oldRoot, name);
  const newPath = path.join(newRoot, name);
  fs.mkdirSync(path.dirname(oldPath), { recursive: true });
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.copyFileSync(path.join(root, name), oldPath);
  fs.writeFileSync(newPath, modified, 'utf8');
}
const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', 'old', 'new'], {
  cwd: tmp, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
});
if (![0, 1].includes(diff.status)) throw new Error(diff.stderr || `git diff exited ${diff.status}`);
let output = diff.stdout.replaceAll('a/old/', 'a/').replaceAll('b/new/', 'b/')
  .replaceAll('a/' + oldRoot.replaceAll('\\\\', '/') + '/', 'a/')
  .replaceAll('b/' + newRoot.replaceAll('\\\\', '/') + '/', 'b/');
// git-for-Windows may emit absolute drive paths without the a/ prefix.
output = output.replaceAll(oldRoot.replaceAll('\\\\', '/') + '/', 'a/')
  .replaceAll(newRoot.replaceAll('\\\\', '/') + '/', 'b/');
fs.writeFileSync(path.join(root, '.codex/graph-runs/20260818-reparto-remediation/phase-j-backend-bola.generated.patch'), output, 'utf8');
console.log(`generated ${files.size} files, ${output.length} bytes`);

