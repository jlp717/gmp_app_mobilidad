'use strict';

const fs = require('fs');
const path = require('path');
const { createTwoFilesPatch } = require('diff');

const root = path.resolve(__dirname, '../../..');
const files = new Map();

function read(relative) {
  if (!files.has(relative)) {
    const original = fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
    files.set(relative, { original, next: original });
  }
  return files.get(relative);
}

function replaceOnce(relative, before, after) {
  const state = read(relative);
  const count = state.next.split(before).length - 1;
  if (count !== 1) throw new Error(`${relative}: expected one match, found ${count}`);
  state.next = state.next.replace(before, after);
}

function replaceBetween(relative, start, end, replacement) {
  const state = read(relative);
  const first = state.next.indexOf(start);
  const second = state.next.indexOf(end, first + start.length);
  if (first < 0 || second < 0) throw new Error(`${relative}: range anchors missing`);
  state.next = state.next.slice(0, first) + replacement + state.next.slice(second);
}

replaceOnce(
  'backend/src/modules/auth/domain/auth-repository.js',
  `  async findByCode(code) {\n    throw new Error('Method not implemented: findByCode');\n  }\n`,
  `  async findByCode(code) {\n    throw new Error('Method not implemented: findByCode');\n  }\n\n  async listRepartidorFleet() {\n    throw new Error('Method not implemented: listRepartidorFleet');\n  }\n`,
);

replaceOnce(
  'backend/src/modules/auth/infrastructure/db2-auth-repository.js',
  `const { getVendorVisibilityScope } = require('../../../../utils/common');\n`,
  `const { getVendorVisibilityScope } = require('../../../../utils/common');\nconst { createRepartidorFleetDirectory } = require('./repartidor-fleet-directory');\n`,
);
replaceOnce(
  'backend/src/modules/auth/infrastructure/db2-auth-repository.js',
  `  constructor(dbPool) {\n    super();\n    this._db = dbPool || new Db2ConnectionPool();\n  }\n`,
  `  constructor(dbPool, { repartidorFleetDirectory } = {}) {\n    super();\n    this._db = dbPool || new Db2ConnectionPool();\n    this._repartidorFleetDirectory = repartidorFleetDirectory\n      || createRepartidorFleetDirectory({ execute: (sql) => this._db.execute(sql) });\n  }\n`,
);
replaceOnce(
  'backend/src/modules/auth/infrastructure/db2-auth-repository.js',
  `  async getVendorVisibilityScope(code, { role } = {}) {\n`,
  `  async listRepartidorFleet() {\n    return this._repartidorFleetDirectory.list();\n  }\n\n  async getVendorVisibilityScope(code, { role } = {}) {\n`,
);

replaceOnce(
  'backend/src/modules/auth/index.js',
  `const { LoginUseCase, AuthError } = require('./application/login-usecase');\n`,
  `const { LoginUseCase, AuthError } = require('./application/login-usecase');\nconst {\n  canonicalRepartidorCode,\n  createRepartidorFleetDirectory,\n} = require('./infrastructure/repartidor-fleet-directory');\n`,
);
replaceOnce(
  'backend/src/modules/auth/index.js',
  `  LoginUseCase,\n  AuthError\n};\n`,
  `  LoginUseCase,\n  AuthError,\n  canonicalRepartidorCode,\n  createRepartidorFleetDirectory,\n};\n`,
);

replaceOnce(
  'backend/src/modules/auth/application/auth-claims-resolver.js',
  `const AUTH_CLAIMS_VERSION = 3;`,
  `const AUTH_CLAIMS_VERSION = 4;`,
);
replaceOnce(
  'backend/src/modules/auth/application/auth-claims-resolver.js',
  `function subjectInvalid() {\n`,
  `function codesMatch(left, right) {\n  const leftCode = normalizeCode(left);\n  const rightCode = normalizeCode(right);\n  if (leftCode === rightCode) return true;\n  if (!/^\\d+$/.test(leftCode) || !/^\\d+$/.test(rightCode)) return false;\n  return (leftCode.replace(/^0+/, '') || '0') === (rightCode.replace(/^0+/, '') || '0');\n}\n\nfunction subjectInvalid() {\n`,
);
replaceOnce(
  'backend/src/modules/auth/application/auth-claims-resolver.js',
  `      if (vendorCodes.length === 0) throw profileUnavailable();\n\n      const projectedDriver = role === REPARTIDOR;\n`,
  `      if (vendorCodes.length === 0) throw profileUnavailable();\n\n      let repartidorCodes = freezeList([]);\n      const repartoProfile = activeMode === REPARTIDOR\n        && [REPARTIDOR, JEFE_VENTAS, ADMIN].includes(role);\n      if (repartoProfile) {\n        if (typeof authRepository.listRepartidorFleet !== 'function') throw profileUnavailable();\n        let fleet;\n        try {\n          fleet = await authRepository.listRepartidorFleet();\n        } catch (_error) {\n          throw profileUnavailable();\n        }\n        const fleetCodes = freezeList((Array.isArray(fleet) ? fleet : [])\n          .map((entry) => entry?.code ?? entry?.CODE));\n        if (fleetCodes.length === 0) throw profileUnavailable();\n        if (role === REPARTIDOR) {\n          const verifiedSelf = fleetCodes.find((entry) => codesMatch(entry, canonicalCode));\n          if (!verifiedSelf) throw profileUnavailable();\n          repartidorCodes = freezeList([verifiedSelf]);\n        } else {\n          repartidorCodes = fleetCodes;\n        }\n      }\n\n      const projectedDriver = role === REPARTIDOR;\n`,
);
replaceOnce(
  'backend/src/modules/auth/application/auth-claims-resolver.js',
  `        vendedorCodes: freezeList(vendorCodes),\n        tipoVendedor:`,
  `        vendedorCodes: freezeList(vendorCodes),\n        repartidorCodes,\n        tipoVendedor:`,
);

replaceOnce(
  'backend/src/modules/auth/application/auth-claims-login-handler.js',
  `    vendedorCodes: [...claims.vendedorCodes],\n    tipoVendedor:`,
  `    vendedorCodes: [...claims.vendedorCodes],\n    repartidorCodes: Array.isArray(claims.repartidorCodes) ? [...claims.repartidorCodes] : [],\n    tipoVendedor:`,
);
replaceOnce(
  'backend/src/modules/auth/application/auth-claims-login-handler.js',
  `        vendedorCodes: [...resolvedClaims.vendedorCodes],\n        tipoVendedor:`,
  `        vendedorCodes: [...resolvedClaims.vendedorCodes],\n        repartidorCodes: Array.isArray(resolvedClaims.repartidorCodes) ? [...resolvedClaims.repartidorCodes] : [],\n        tipoVendedor:`,
);

replaceOnce(
  'backend/middleware/auth.js',
  `    const vendedorCodes = Array.isArray(payload.vendedorCodes) ? [...payload.vendedorCodes] : [];\n    return {`,
  `    const vendedorCodes = Array.isArray(payload.vendedorCodes) ? [...payload.vendedorCodes] : [];\n    const repartidorCodes = Array.isArray(payload.repartidorCodes) ? [...payload.repartidorCodes] : [];\n    return {`,
);
replaceOnce(
  'backend/middleware/auth.js',
  `        vendedorCodes,\n        tipoVendedor:`,
  `        vendedorCodes,\n        repartidorCodes,\n        tipoVendedor:`,
);
replaceOnce(
  'backend/middleware/auth.js',
  `        vendedorCodes: user.vendedorCodes,\n        tipoVendedor:`,
  `        vendedorCodes: user.vendedorCodes,\n        repartidorCodes: user.repartidorCodes,\n        tipoVendedor:`,
);

replaceOnce('backend/routes/auth.js', `const { query } = require('../config/db');\n`, '');
replaceOnce('backend/routes/auth.js', `const logger = require('../middleware/logger');\n`, '');
replaceBetween(
  'backend/routes/auth.js',
  `let _repartidoresCache = null;\n`,
  `router.repartidoresAccess = repartidoresAccess;`,
  `function repartoCodesMatch(left, right) {\n    const a = String(left || '').trim().toUpperCase();\n    const b = String(right || '').trim().toUpperCase();\n    if (a === b) return true;\n    if (!/^\\d+$/.test(a) || !/^\\d+$/.test(b)) return false;\n    return (a.replace(/^0+/, '') || '0') === (b.replace(/^0+/, '') || '0');\n}\n\nfunction repartidoresAccess(user = {}) {\n    const role = String(user.role || '').trim().toUpperCase();\n    const activeMode = String(user.activeMode || '').trim().toUpperCase();\n    if (role === 'REPARTIDOR') return 'SELF';\n    if ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR') return 'FLEET';\n    return 'DENIED';\n}\n\nrouter.get('/repartidores', verifyToken, async (req, res) => {\n    try {\n        const access = repartidoresAccess(req.user);\n        const signedCodes = [...new Set((Array.isArray(req.user?.repartidorCodes)\n            ? req.user.repartidorCodes : [])\n            .map((code) => String(code || '').trim().toUpperCase())\n            .filter(Boolean))];\n        if (access === 'SELF') {\n            const own = String(req.user?.code || '').trim().toUpperCase();\n            if (signedCodes.length !== 1 || !repartoCodesMatch(signedCodes[0], own)) {\n                return res.status(403).json({ error: 'Acceso restringido', code: 'REPARTIDOR_SCOPE_REQUIRED' });\n            }\n            return res.json([{ code: signedCodes[0], name: req.user.name || signedCodes[0] }]);\n        }\n        if (access !== 'FLEET') {\n            return res.status(403).json({ error: 'Acceso restringido', code: 'INSUFFICIENT_ROLE' });\n        }\n        if (signedCodes.length === 0) {\n            return res.status(403).json({ error: 'Acceso restringido', code: 'REPARTIDOR_SCOPE_REQUIRED' });\n        }\n\n        const directory = await authRepository.listRepartidorFleet();\n        const selected = signedCodes.map((signedCode) =>\n            directory.find((entry) => repartoCodesMatch(entry?.code, signedCode)));\n        if (selected.some((entry) => !entry)) {\n            return res.status(503).json({ error: 'Perfil de autorizacion no disponible', code: 'AUTH_PROFILE_UNAVAILABLE' });\n        }\n        return res.json(selected);\n    } catch (_error) {\n        return res.status(503).json({ error: 'Perfil de autorizacion no disponible', code: 'AUTH_PROFILE_UNAVAILABLE' });\n    }\n});\n\n`,
);

replaceOnce(
  'backend/routes/repartidor.js',
  `const { sanitizeCodeListForParams, sanitizeForSQL, getVendorVisibilityScope } = require('../utils/common');`,
  `const { sanitizeCodeListForParams, sanitizeForSQL } = require('../utils/common');`,
);
replaceOnce(
  'backend/routes/repartidor.js',
  `    return role === 'ADMIN'\n        || (role === 'JEFE_VENTAS'\n            && String(user?.activeMode || '').trim().toUpperCase() === 'REPARTIDOR');`,
  `    const activeMode = String(user?.activeMode || '').trim().toUpperCase();\n    return (role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR';`,
);
replaceOnce(
  'backend/routes/repartidor.js',
  `    const role = normalizedRole(user);\n    if (isRepartoPrivileged(user)) return ids;\n`,
  `    const role = normalizedRole(user);\n    const allowed = uniqueActorCodes(user.repartidorCodes);\n    if (isRepartoPrivileged(user)) {\n        if (allowed.length > 0 && ids.every((id) => allowed.some((code) =>\n            normalizeVendorCode(code) === normalizeVendorCode(id)))) return ids;\n        sendRouteError(res, 403, 'REPARTIDOR_ACCESS_DENIED');\n        return null;\n    }\n`,
);
replaceOnce(
  'backend/routes/repartidor.js',
  `    if (ids.length !== 1 || !ownId || ids[0] !== ownId) {`,
  `    if (ids.length !== 1 || !ownId || allowed.length !== 1\n        || normalizeVendorCode(ids[0]) !== normalizeVendorCode(allowed[0])\n        || normalizeVendorCode(ownId) !== normalizeVendorCode(allowed[0])) {`,
);
replaceOnce(
  'backend/routes/repartidor.js',
  `    const scoped = own ? getVendorVisibilityScope(own) : [];\n    return uniqueActorCodes([...tokenCodes, ...scoped]);`,
  `    return uniqueActorCodes(tokenCodes);`,
);
replaceBetween(
  'backend/routes/repartidor.js',
  `function authorizeResolvedOwner(req, res, rows, { requireRepartoOwnerHint = false } = {}) {`,
  `function documentOwnershipGuard(`,
  `function authorizeResolvedOwner(req, res, rows, { requireRepartoOwnerHint = false } = {}) {\n    const drivers = uniqueActorCodes((rows || []).map((row) => row.OWNER_ID));\n    const vendors = uniqueActorCodes((rows || []).map((row) => row.VENDOR_ID));\n    if (drivers.length === 0 && vendors.length === 0) {\n        sendRouteError(res, 404, 'DOCUMENT_NOT_FOUND');\n        return false;\n    }\n    const role = normalizedRole(req.user);\n    const hinted = hintedRepartidorId(req);\n    const repartoActor = role === 'REPARTIDOR' || isRepartoPrivileged(req.user);\n    if (requireRepartoOwnerHint && repartoActor) {\n        const authorized = authorizedRepartidorIds(req, res, hinted);\n        if (!authorized || authorized.length !== 1) return false;\n        const matchingDriver = drivers.find((driver) =>\n            normalizeVendorCode(driver) === normalizeVendorCode(authorized[0]));\n        if (!matchingDriver) {\n            sendRouteError(res, 403, 'DOCUMENT_ACCESS_DENIED');\n            return false;\n        }\n        req.documentOwnerId = matchingDriver;\n        return true;\n    }\n    if (role === 'COMERCIAL' && vendorCodesIntersect(actorVendorCodes(req.user), vendors)) {\n        req.documentOwnerId = vendors[0];\n        return true;\n    }\n    sendRouteError(res, 403, 'DOCUMENT_ACCESS_DENIED');\n    return false;\n}\n\n`,
);
replaceBetween(
  'backend/routes/repartidor.js',
  `function prevalidateStrictDocumentOwner(req, res) {`,
  `const strictRepartoDocumentOwner`,
  `function prevalidateStrictDocumentOwner(req, res) {\n    const role = normalizedRole(req.user);\n    const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();\n    const raw = rawRepartidorId(req);\n    const hint = hintedRepartidorId(req);\n    if ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode !== 'REPARTIDOR') {\n        sendRouteError(res, 403, 'DOCUMENT_REPARTO_MODE_REQUIRED');\n        return false;\n    }\n    if (role === 'REPARTIDOR' || role === 'JEFE_VENTAS' || role === 'ADMIN') {\n        if (!hint || raw.includes(',') || /^ALL$/i.test(raw)) {\n            sendRouteError(res, 422, 'DOCUMENT_OWNER_REQUIRED');\n            return false;\n        }\n        const authorized = authorizedRepartidorIds(req, res, hint);\n        return Boolean(authorized && authorized.length === 1);\n    }\n    return true;\n}\n\n`,
);
replaceBetween(
  'backend/routes/repartidor.js',
  `    const role = String(req.user?.role || '').trim().toUpperCase();\n`,
  `    req.documentEmail = { destinatario, asunto, cuerpo };`,
  `    if (!prevalidateStrictDocumentOwner(req, res)) return;\n`,
);

replaceBetween(
  'backend/routes/entregas.js',
  `function isPrivilegedUser(req) {`,
  `function ensureRepartidorAccess(`,
  `function actorRepartidorCodes(user) {\n    return [...new Set((Array.isArray(user?.repartidorCodes) ? user.repartidorCodes : [])\n        .map(canonicalRepartidorCode).filter(Boolean))];\n}\n\nfunction canAccessRepartidor(req, repartidorId) {\n    const user = req.user || {};\n    const role = normalizeCode(user.role).toUpperCase();\n    const activeMode = normalizeCode(user.activeMode).toUpperCase();\n    const repartoActor = role === 'REPARTIDOR'\n        || ((role === 'JEFE_VENTAS' || role === 'ADMIN') && activeMode === 'REPARTIDOR');\n    if (!repartoActor) return false;\n    const target = canonicalRepartidorCode(repartidorId);\n    const allowed = actorRepartidorCodes(user);\n    if (!target || allowed.length === 0 || !allowed.some((code) => codesMatch(code, target))) return false;\n    if (role !== 'REPARTIDOR') return true;\n    const own = canonicalRepartidorCode(user.code || user.id || user.user);\n    return allowed.length === 1 && codesMatch(own, target) && codesMatch(allowed[0], target);\n}\n\n`,
);
replaceBetween(
  'backend/routes/entregas.js',
  `function requireConcreteAlbaranOwner(req, res) {`,
  `function parseDeliveryItemId(`,
  `function requireConcreteAlbaranOwner(req, res) {\n    const role = normalizeCode(req.user?.role).toUpperCase();\n    const activeMode = normalizeCode(req.user?.activeMode).toUpperCase();\n    if (role !== 'REPARTIDOR' && role !== 'JEFE_VENTAS' && role !== 'ADMIN') {\n        res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para consultar entregas' });\n        return { allowed: false, hintedOwner: null };\n    }\n    if ((role === 'JEFE_VENTAS' || role === 'ADMIN') && activeMode !== 'REPARTIDOR') {\n        res.status(403).json({ success: false, code: 'REPARTO_MODE_REQUIRED', error: 'Activa el Perfil Reparto para consultar entregas' });\n        return { allowed: false, hintedOwner: null };\n    }\n    const selected = parseRepartidorSelector(req.query?.repartidorId, { single: true });\n    if (!selected) {\n        res.status(422).json({ success: false, code: 'REPARTIDOR_ID_REQUIRED', error: 'Selecciona un unico repartidor concreto' });\n        return { allowed: false, hintedOwner: null };\n    }\n    if (!canAccessRepartidor(req, selected[0])) {\n        res.status(403).json({ success: false, code: 'REPARTIDOR_ACCESS_DENIED', error: 'No tienes permisos para consultar este repartidor' });\n        return { allowed: false, hintedOwner: null };\n    }\n    return { allowed: true, hintedOwner: selected[0] };\n}\n\n`,
);

replaceOnce(
  'backend/routes/repartidor-finanzas.js',
  `  const allowed = role === 'REPARTIDOR'\n    || role === 'ADMIN'\n    || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');`,
  `  const allowed = role === 'REPARTIDOR'\n    || ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR');`,
);
replaceBetween(
  'backend/routes/repartidor-finanzas.js',
  `function evidenceRepartidorId(req, requested) {`,
  `function artifactActor(`,
  `function evidenceRepartidorId(req, requested) {\n  const role = String(req.user?.role || '').trim().toUpperCase();\n  const activeMode = String(req.user?.activeMode || '').trim().toUpperCase();\n  const authenticated = actorCode(req.user);\n  const target = String(requested || '').trim();\n  if (target && (target.toUpperCase() === 'ALL'\n      || target.includes(',') || !/^[A-Za-z0-9_-]{1,20}$/.test(target))) {\n    throw new EvidenceError('EVIDENCE_REPARTIDOR_REQUIRED', 'Debe seleccionarse un unico repartidor concreto', 422);\n  }\n  const visible = financeFleetCodes(req.user);\n  if (role === 'REPARTIDOR') {\n    if (visible.length !== 1 || !codesMatch(visible[0], authenticated)) {\n      throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);\n    }\n    if (target && !codesMatch(visible[0], target)) {\n      throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);\n    }\n    return visible[0];\n  }\n  if ((role !== 'JEFE_VENTAS' && role !== 'ADMIN') || activeMode !== 'REPARTIDOR') {\n    throw new EvidenceError('EVIDENCE_REPARTO_MODE_REQUIRED', 'Activa el Perfil Reparto', 403);\n  }\n  if (!target) {\n    throw new EvidenceError('EVIDENCE_REPARTIDOR_REQUIRED', 'Debe seleccionarse un unico repartidor concreto', 422);\n  }\n  const selected = visible.find((code) => codesMatch(code, target));\n  if (!selected) {\n    throw new EvidenceError('EVIDENCE_OWNERSHIP_REQUIRED', 'No tienes permisos para esta entrega', 403);\n  }\n  return selected;\n}\n\n`,
);
replaceOnce(
  'backend/routes/repartidor-finanzas.js',
  `  return role === 'ADMIN' || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');`,
  `  return (role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR';`,
);
replaceBetween(
  'backend/routes/repartidor-finanzas.js',
  `function financeFleetCodes(user) {`,
  `function requireFinanceRepartidorSelector(`,
  `function financeFleetCodes(user) {\n  return (Array.isArray(user?.repartidorCodes) ? user.repartidorCodes : [])\n    .filter((code) => typeof code === 'string' || typeof code === 'number')\n    .map(normalizeCode).filter(Boolean);\n}\n\n`,
);
replaceOnce(
  'backend/routes/repartidor-finanzas.js',
  `  if (role === 'ADMIN') return true;\n  if (role === 'JEFE_VENTAS') {`,
  `  if (role === 'ADMIN' || role === 'JEFE_VENTAS') {`,
);
replaceOnce(
  'backend/routes/repartidor-finanzas.js',
  `  const userCode = normalizeCode(user.code || user.id || user.user);\n  return codesMatch(userCode, selected[0]);`,
  `  const userCode = normalizeCode(user.code || user.id || user.user);\n  const visible = financeFleetCodes(user);\n  return visible.length === 1 && codesMatch(userCode, selected[0])\n    && codesMatch(visible[0], selected[0]);`,
);

replaceBetween(
  'backend/services/reparto-confirmation-contract.js',
  `function actorFleetCodes(user) {`,
  `function ownershipError(`,
  `function actorFleetCodes(user) {\n  return (Array.isArray(user?.repartidorCodes) ? user.repartidorCodes : [])\n    .filter((code) => typeof code === 'string' || typeof code === 'number')\n    .map(canonicalRepartidorCode).filter(Boolean);\n}\n\n`,
);
replaceBetween(
  'backend/services/reparto-confirmation-contract.js',
  `  let repartidorId;\n  let privileged = false;\n`,
  `  return Object.freeze({ userId, repartidorId, role, privileged });`,
  `  let repartidorId;\n  let privileged = false;\n  const fleet = actorFleetCodes(current);\n  if (role === 'REPARTIDOR') {\n    const requested = explicit || ownRepartidorId;\n    if (fleet.length !== 1 || !codesMatch(ownRepartidorId, requested)\n      || !codesMatch(fleet[0], requested)) throw ownershipError();\n    repartidorId = fleet[0];\n  } else if ((role === 'ADMIN' || role === 'JEFE_VENTAS') && activeMode === 'REPARTIDOR') {\n    if (!explicit) {\n      throw new RepartoContractError('Debe seleccionarse un repartidor concreto', {\n        code: 'DELIVERY_REPARTIDOR_REQUIRED', statusCode: 422,\n      });\n    }\n    const selected = fleet.find((code) => codesMatch(code, explicit));\n    if (!selected) throw ownershipError();\n    repartidorId = selected;\n    privileged = true;\n  } else {\n    throw ownershipError();\n  }\n\n`,
);

replaceOnce(
  'backend/src/chatbot/chatbot_authorization.js',
  `  const repartoProfile = role === "REPARTIDOR"\n    || (role === "JEFE_VENTAS" && activeMode === "REPARTIDOR");`,
  `  const repartoProfile = role === "REPARTIDOR"\n    || (["JEFE_VENTAS", "ADMIN"].includes(role) && activeMode === "REPARTIDOR");`,
);
replaceOnce(
  'backend/src/chatbot/chatbot_authorization.js',
  `    const allowed = requested.codes.length === 1\n      && ownCode\n      && codesMatch(requested.codes[0], ownCode);`,
  `    const signedCodes = Array.isArray(userContext.repartidorCodes)\n      ? userContext.repartidorCodes.map(normalizeCode).filter(Boolean) : [];\n    const allowed = requested.codes.length === 1\n      && ownCode\n      && signedCodes.length === 1\n      && codesMatch(requested.codes[0], ownCode)\n      && codesMatch(requested.codes[0], signedCodes[0]);`,
);
replaceOnce(
  'backend/src/chatbot/chatbot_authorization.js',
  `  if (role !== "JEFE_VENTAS" || activeMode !== "REPARTIDOR") {`,
  `  if (!["JEFE_VENTAS", "ADMIN"].includes(role) || activeMode !== "REPARTIDOR") {`,
);
replaceBetween(
  'backend/src/chatbot/chatbot_authorization.js',
  `  const visibleValues = Array.isArray(userContext.vendorCodes)`,
  `  const visibleCodes =`,
  `  const visibleValues = Array.isArray(userContext.repartidorCodes)\n    ? userContext.repartidorCodes\n    : [];\n`,
);
replaceOnce(
  'backend/src/chatbot/chatbot_authorization.js',
  `  if (role === "JEFE_VENTAS" && normalizeCode(userContext.activeMode) === "REPARTIDOR") return false;`,
  `  if (["JEFE_VENTAS", "ADMIN"].includes(role)\n    && normalizeCode(userContext.activeMode) === "REPARTIDOR") return false;`,
);

replaceOnce(
  'backend/src/chatbot/llm-orchestrator.js',
  `  const tokenScope = normalizeVendorScope(user.vendorCodes || user.vendedorCodes);`,
  `  const repartoProfile = base.role === 'REPARTIDOR'\n    || (['JEFE_VENTAS', 'ADMIN'].includes(base.role) && base.activeMode === 'REPARTIDOR');\n  const tokenScope = normalizeVendorScope(repartoProfile\n    ? user.repartidorCodes\n    : (user.vendorCodes || user.vendedorCodes));`,
);
replaceOnce(
  'backend/src/chatbot/llm-orchestrator.js',
  `  const repartoProfile = role === 'REPARTIDOR'\n    || (role === 'JEFE_VENTAS' && normalizeCode(context.activeMode) === 'REPARTIDOR');`,
  `  const repartoProfile = role === 'REPARTIDOR'\n    || (['JEFE_VENTAS', 'ADMIN'].includes(role) && normalizeCode(context.activeMode) === 'REPARTIDOR');`,
);
replaceOnce(
  'backend/src/chatbot/chatbot_handler.js',
  `    const repartoProfile = context.role === 'REPARTIDOR'\n        || (context.role === 'JEFE_VENTAS' && context.activeMode === 'REPARTIDOR');`,
  `    const repartoProfile = context.role === 'REPARTIDOR'\n        || (['JEFE_VENTAS', 'ADMIN'].includes(context.role) && context.activeMode === 'REPARTIDOR');`,
);

replaceOnce(
  'backend/__tests__/auth-claims-resolver.test.js',
  `    getVendorVisibilityScope: jest.fn(async (code, { role }) => (\n      role === 'JEFE_VENTAS' ? [code, '051', 'UNK'] : [code]\n    )),`,
  `    getVendorVisibilityScope: jest.fn(async (code, { role }) => (\n      role === 'JEFE_VENTAS' ? [code, '051', 'UNK'] : [code]\n    )),\n    listRepartidorFleet: jest.fn(async () => [\n      { code: String(user?.code || '050').trim().toUpperCase(), name: 'Repartidor' },\n      { code: '051', name: 'Otro' },\n    ]),`,
);
replaceOnce('backend/__tests__/auth-claims-resolver.test.js', `targets claims version 3`, `targets claims version 4`);
replaceOnce('backend/__tests__/auth-claims-resolver.test.js', `expect(AUTH_CLAIMS_VERSION).toBe(3);`, `expect(AUTH_CLAIMS_VERSION).toBe(4);`);
replaceOnce(
  'backend/__tests__/auth-claims-resolver.test.js',
  `      vendedorCodes: ['050'],\n      tipoVendedor:`,
  `      vendedorCodes: ['050'],\n      repartidorCodes: [],\n      tipoVendedor:`,
);
replaceOnce(
  'backend/__tests__/auth-claims-resolver.test.js',
  `    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);`,
  `    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);\n    expect(Object.isFrozen(claims.repartidorCodes)).toBe(true);`,
);

replaceOnce(
  'backend/__tests__/auth-claims-login-handler.test.js',
  `    vendorCodes: Object.freeze(['050']), vendedorCodes: Object.freeze(['050']),`,
  `    vendorCodes: Object.freeze(['050']), vendedorCodes: Object.freeze(['050']),\n    repartidorCodes: Object.freeze(['050']),`,
);
replaceOnce(
  'backend/__tests__/auth-claims-login-handler.test.js',
  `        vendorCodes: ['050'], vendedorCodes: ['050'],\n        tipoVendedor:`,
  `        vendorCodes: ['050'], vendedorCodes: ['050'], repartidorCodes: ['050'],\n        tipoVendedor:`,
);
replaceOnce(
  'backend/__tests__/auth-claims-login-handler.test.js',
  `      vendedorCodes: ['050'],\n      tipoVendedor:`,
  `      vendedorCodes: ['050'],\n      repartidorCodes: ['050'],\n      tipoVendedor:`,
);

replaceOnce(
  'backend/__tests__/auth.test.js',
  `    getVendorVisibilityScope: jest.fn(),\n    logLoginAttempt: jest.fn(),`,
  `    getVendorVisibilityScope: jest.fn(),\n    listRepartidorFleet: jest.fn(),\n    logLoginAttempt: jest.fn(),`,
);
replaceOnce(
  'backend/__tests__/auth.test.js',
  `            expect(authRoutes.repartidoresAccess({ role: 'ADMIN' })).toBe('FLEET');`,
  `            expect(authRoutes.repartidoresAccess({ role: 'ADMIN' })).toBe('DENIED');\n            expect(authRoutes.repartidoresAccess({ role: 'ADMIN', activeMode: 'REPARTIDOR' })).toBe('FLEET');`,
);
replaceOnce(
  'backend/__tests__/middleware/auth-middleware.test.js',
  `expect(req.user.claimsVersion).toBe(3);`,
  `expect(req.user.claimsVersion).toBe(4);`,
);

for (const relative of [
  'backend/__tests__/reparto-finance-fleet-authorization.test.js',
  'backend/__tests__/chatbot_reparto_scope.test.js',
]) {
  const state = read(relative);
  state.next = state.next.replace(/vendorCodes:/g, 'repartidorCodes:');
}
replaceOnce(
  'backend/__tests__/reparto-finance-fleet-authorization.test.js',
  `let mockUser = { id: 'V08', code: '08', role: 'REPARTIDOR' };`,
  `let mockUser = { id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] };`,
);
replaceOnce(
  'backend/__tests__/reparto-finance-fleet-authorization.test.js',
  `    mockUser = { id: 'V08', code: '08', role: 'REPARTIDOR' };`,
  `    mockUser = { id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] };`,
);
{
  const state = read('backend/__tests__/reparto-finance-fleet-authorization.test.js');
  state.next = state.next.replace(
    /\{ id: 'A1', code: '1', role: 'ADMIN' \}/g,
    `{ id: 'A1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['77'] }`,
  );
  state.next = state.next.replace(
    /\{ id: 'V08', code: '08', role: 'REPARTIDOR' \}/g,
    `{ id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] }`,
  );
}

const directoryTest = `'use strict';\n\nconst {\n  REPARTIDOR_FLEET_SQL,\n  canonicalRepartidorCode,\n  createRepartidorFleetDirectory,\n  normalizeFleetRows,\n} = require('../src/modules/auth/infrastructure/repartidor-fleet-directory');\n\ndescribe('signed repartidor fleet directory', () => {\n  test('uses one set-based VEH plus current-year OPP read and no mutation', () => {\n    expect(REPARTIDOR_FLEET_SQL).toMatch(/DSEDAC\\.VEH/);\n    expect(REPARTIDOR_FLEET_SQL).toMatch(/DSEDAC\\.OPP/);\n    expect(REPARTIDOR_FLEET_SQL).toMatch(/YEAR\\(CURRENT_DATE\\)/);\n    expect(REPARTIDOR_FLEET_SQL).not.toMatch(/\\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\\b/i);\n  });\n\n  test('canonicalizes numeric codes and excludes sentinels', () => {\n    expect(canonicalRepartidorCode('8')).toBe('08');\n    expect(normalizeFleetRows([\n      { CODE: '8', NAME: 'Ocho' },\n      { CODE: '08', NAME: 'Ocho definitivo' },\n      { CODE: '98', NAME: 'Jefe' },\n      { CODE: 'ZZ', NAME: 'ZZ Test' },\n    ])).toEqual([{ code: '08', name: 'Ocho definitivo' }]);\n  });\n\n  test('coalesces concurrent reads and caches for five minutes', async () => {\n    let now = 1_000;\n    const execute = jest.fn(async () => [{ CODE: '8', NAME: 'Ocho' }]);\n    const directory = createRepartidorFleetDirectory({ execute, now: () => now });\n    const [first, second] = await Promise.all([directory.list(), directory.list()]);\n    expect(first).toBe(second);\n    expect(execute).toHaveBeenCalledTimes(1);\n    now += 299_999;\n    await directory.list();\n    expect(execute).toHaveBeenCalledTimes(1);\n    now += 2;\n    await directory.list();\n    expect(execute).toHaveBeenCalledTimes(2);\n  });\n});\n`;
files.set('backend/__tests__/repartidor-fleet-directory.test.js', { original: '', next: directoryTest });

let output = '';
for (const [relative, state] of files) {
  if (state.original === state.next) continue;
  const oldName = state.original ? `a/${relative}` : '/dev/null';
  const newName = `b/${relative}`;
  output += `diff --git a/${relative} b/${relative}\n`;
  output += createTwoFilesPatch(oldName, newName, state.original, state.next, '', '', { context: 4 })
    .replace(/^={67}\n/, '');
}
process.stdout.write(output);
