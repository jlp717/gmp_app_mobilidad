"use strict";
const {
  CHATBOT_LOG_EVENTS,
  emitChatbotLog,
} = require("./chatbot_log");
const SAFE_SCOPE_DENIED_RESPONSE =
  "No tengo acceso a esa informacion. Solo puedes consultar tus propios datos o los de tus clientes asignados.";
const SAFE_SCOPE_UNVERIFIED_RESPONSE =
  "No puedo verificar que ese cliente pertenezca a tu ambito autorizado. No se consultaran datos.";
function normalizeCode(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}
function numericVariants(value) {
  const raw = normalizeCode(value);
  if (!raw) return [];
  const unpadded = raw.replace(/^0+/, "") || raw;
  const padded = /^\d{1,2}$/.test(unpadded)
    ? unpadded.padStart(2, "0")
    : unpadded;
  return [...new Set([raw, unpadded, padded])];
}
function codesMatch(left, right) {
  const leftVariants = numericVariants(left);
  const rightVariants = numericVariants(right);
  return leftVariants.some((code) => rightVariants.includes(code));
}
function normalizeRequestedRepartidorCodes(value) {
  if (value === null || value === undefined || value === "") {
    return { valid: true, codes: [] };
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return { valid: false, codes: [] };
  }
  const raw = String(value).trim();
  if (!raw || raw.length > 1000) return { valid: false, codes: [] };
  const parts = raw.split(",").map(normalizeCode);
  if (parts.some((code) => !/^[A-Z0-9]{1,10}$/.test(code))) {
    return { valid: false, codes: [] };
  }
  const codes = [...new Set(parts)];
  if (codes.length === 0 || codes.length > 100 || codes.includes("ALL")) {
    return { valid: false, codes: [] };
  }
  return { valid: true, codes };
}
function authorizeChatbotRepartoScope(userContext = {}, requestedScope) {
  const role = normalizeCode(userContext.role || userContext.rol);
  const activeMode = normalizeCode(userContext.activeMode);
  const repartoProfile = role === "REPARTIDOR"
    || (["JEFE_VENTAS", "ADMIN"].includes(role) && activeMode === "REPARTIDOR");
  if (requestedScope === null || requestedScope === undefined || requestedScope === "") {
    return repartoProfile
      ? { allowed: false, code: "REPARTO_SCOPE_REQUIRED", driverCodes: [] }
      : { allowed: true, code: "NO_REPARTO_SCOPE", driverCodes: [] };
  }
  const requested = normalizeRequestedRepartidorCodes(requestedScope);
  if (!requested.valid) {
    return { allowed: false, code: "REPARTO_SCOPE_INVALID", driverCodes: [] };
  }
  if (role === "REPARTIDOR") {
    const ownCode = normalizeCode(
      userContext.codigoConductor || userContext.code || userContext.userCode,
    );
    const signedCodes = Array.isArray(userContext.repartidorCodes)
      ? userContext.repartidorCodes.map(normalizeCode).filter(Boolean) : [];
    const allowed = requested.codes.length === 1
      && ownCode
      && signedCodes.length === 1
      && codesMatch(requested.codes[0], ownCode)
      && codesMatch(requested.codes[0], signedCodes[0]);
    return allowed
      ? { allowed: true, code: "REPARTO_SCOPE_SELF", driverCodes: [ownCode] }
      : { allowed: false, code: "REPARTO_SCOPE_FORBIDDEN", driverCodes: [] };
  }
  if (!["JEFE_VENTAS", "ADMIN"].includes(role) || activeMode !== "REPARTIDOR") {
    return { allowed: false, code: "REPARTO_SCOPE_FORBIDDEN", driverCodes: [] };
  }
  const visibleValues = Array.isArray(userContext.repartidorCodes)
    ? userContext.repartidorCodes
    : [];
  const visibleCodes = [...new Set(visibleValues.map(normalizeCode).filter(Boolean))]
    .filter((code) => code !== "ALL");
  if (visibleCodes.length === 0) {
    return { allowed: false, code: "REPARTO_SCOPE_UNVERIFIED", driverCodes: [] };
  }
  const resolvedCodes = requested.codes.map((requestedCode) =>
    visibleCodes.find((visibleCode) => codesMatch(requestedCode, visibleCode)) || ""
  );
  if (resolvedCodes.some((code) => !code)) {
    return { allowed: false, code: "REPARTO_SCOPE_FORBIDDEN", driverCodes: [] };
  }
  return {
    allowed: true,
    code: requested.codes.length === 1
      ? "REPARTO_SCOPE_SELECTED"
      : "REPARTO_SCOPE_FLEET",
    driverCodes: [...new Set(resolvedCodes)],
  };
}
const SUPERVISOR_ROLES = new Set(["JEFE_VENTAS", "JEFE", "GERENTE", "ADMIN"]);
const EXPLICIT_NON_SUPERVISOR_ROLES = new Set([
  "COMERCIAL",
  "REPARTIDOR",
  "ALMACEN",
]);
function isSupervisor(userContext = {}) {
  const role = normalizeCode(userContext.role);
  if (["JEFE_VENTAS", "ADMIN"].includes(role)
    && normalizeCode(userContext.activeMode) === "REPARTIDOR") return false;
  if (SUPERVISOR_ROLES.has(role)) return true;
  if (EXPLICIT_NON_SUPERVISOR_ROLES.has(role)) return false;
  return false;
}
function getAllowedVendorCodes(userContext = {}) {
  if (isSupervisor(userContext)) return ["ALL"];
  const fromScope = Array.isArray(userContext.vendorScope)
    ? userContext.vendorScope
    : [];
  const base = fromScope.length ? fromScope : [userContext.userCode];
  return [...new Set(base.flatMap(numericVariants))];
}
function authorizeChatbotClientScope(userContext = {}, clientContext = {}) {
  const clientCode = normalizeCode(clientContext.clientCode);
  if (!clientCode) return { allowed: true, code: "NO_CLIENT_SCOPE" };
  if (isSupervisor(userContext))
    return { allowed: true, code: "ALLOWED_SUPERVISOR" };
  const vendorCode = normalizeCode(
    clientContext.vendorCode ||
      clientContext.ownerVendorCode ||
      clientContext.vendedor ||
      clientContext.VENDEDOR,
  );
  if (!vendorCode)
    return {
      allowed: false,
      code: "CLIENT_SCOPE_UNVERIFIED",
      response: SAFE_SCOPE_UNVERIFIED_RESPONSE,
    };
  const allowedVendors = getAllowedVendorCodes(userContext);
  const allowed = numericVariants(vendorCode).some((code) =>
    allowedVendors.includes(code),
  );
  if (!allowed)
    return {
      allowed: false,
      code: "FORBIDDEN_CLIENT_SCOPE",
      response: SAFE_SCOPE_DENIED_RESPONSE,
    };
  return { allowed: true, code: "ALLOWED_OWNER" };
}
function extractRequestedClientCode(message) {
  const text = normalizeCode(message);
  if (!text || /\bBUSCAR\s+CLIENTE\b/.test(text)) return null;
  const patterns = [
    /\bCLIENTE\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,20})\b/i,
    /\b(?:DEUDA|FACTURAS?|COBROS?|PEDIDOS?|MARGEN|RIESGO|BLOQUEAD[OA]|HISTORIAL)\s+(?:DEL\s+)?(?:CLIENTE\s+)?([A-Z0-9][A-Z0-9-]{1,20})\b/i,
  ];
  for (const pattern of patterns) {
    const match = String(message || "").match(pattern);
    if (match && match[1]) return normalizeCode(match[1]);
  }
  return null;
}
async function resolveChatbotClientOwner(conn, clientCode) {
  const normalizedClient = normalizeCode(clientCode);
  if (!normalizedClient || !conn || typeof conn.query !== "function")
    return { clientCode: normalizedClient, vendorCode: null, verified: false };
  try {
    const sql = `SELECT TRIM(VENDEDOR) AS VENDEDOR
FROM (
  SELECT TRIM(CLP.VENDEDORCOMERCIAL) AS VENDEDOR, 1 AS PRIORIDAD
    FROM DSEDAC.CLP CLP
   WHERE TRIM(CLP.CODIGOCLIENTE) = ?
     AND CLP.VENDEDORCOMERCIAL IS NOT NULL
  UNION ALL
  SELECT TRIM(L.CODIGOVENDEDOR) AS VENDEDOR, 2 AS PRIORIDAD
    FROM DSEDAC.LAC L
   WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
     AND L.CODIGOVENDEDOR IS NOT NULL
  UNION ALL
  SELECT TRIM(L.LCCDVD) AS VENDEDOR, 3 AS PRIORIDAD
    FROM DSED.LACLAE L
   WHERE TRIM(L.LCCDCL) = ?
     AND L.LCCDVD IS NOT NULL
     AND L.LCAADC >= 2018
) OWNERS
WHERE VENDEDOR IS NOT NULL AND TRIM(VENDEDOR) <> ''
ORDER BY PRIORIDAD
FETCH FIRST 1 ROWS ONLY`;
    const rows = await conn.query(sql, [
      normalizedClient,
      normalizedClient,
      normalizedClient,
    ]);
    const vendorCode = normalizeCode(rows?.[0]?.VENDEDOR);
    return {
      clientCode: normalizedClient,
      vendorCode,
      verified: Boolean(vendorCode),
    };
  } catch (error) {
    emitChatbotLog("warn", CHATBOT_LOG_EVENTS.authorizationLookupFailed);
    return { clientCode: normalizedClient, vendorCode: null, verified: false };
  }
}
async function authorizeResolvedClient(conn, userContext, clientCode) {
  const owner = await resolveChatbotClientOwner(conn, clientCode);
  return {
    owner,
    authorization: authorizeChatbotClientScope(userContext, owner),
  };
}
function buildAuthorizationSafeResponse(code) {
  return code === "CLIENT_SCOPE_UNVERIFIED"
    ? SAFE_SCOPE_UNVERIFIED_RESPONSE
    : SAFE_SCOPE_DENIED_RESPONSE;
}
function createChatbotUserContext(user = {}) {
  const role = normalizeCode(user.role || user.rol);
  const supervisorRole = SUPERVISOR_ROLES.has(role);
  const explicitNonSupervisor = EXPLICIT_NON_SUPERVISOR_ROLES.has(role);
  return {
    userCode: normalizeCode(
      user.code || user.userCode || user.vendedor || user.CODIGOVENDEDOR,
    ),
    role,
    activeMode: normalizeCode(user.activeMode),
    isJefeVentas: isSupervisor({
      role,
      activeMode: user.activeMode,
      isJefeVentas: Boolean(user.isJefeVentas) && !explicitNonSupervisor,
    }),
  };
}
module.exports = {
  authorizeChatbotClientScope,
  authorizeResolvedClient,
  authorizeChatbotRepartoScope,
  buildAuthorizationSafeResponse,
  createChatbotUserContext,
  extractRequestedClientCode,
  getAllowedVendorCodes,
  isSupervisor,
  normalizeCode,
  resolveChatbotClientOwner,
  SAFE_SCOPE_DENIED_RESPONSE,
  SAFE_SCOPE_UNVERIFIED_RESPONSE,
};
