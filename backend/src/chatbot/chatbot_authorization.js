"use strict";
const logger = require("../../middleware/logger");
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
function isSupervisor(userContext = {}) {
  const role = normalizeCode(userContext.role);
  return (
    Boolean(userContext.isJefeVentas) ||
    role === "JEFE_VENTAS" ||
    role === "JEFE" ||
    role === "GERENTE" ||
    role === "ADMIN"
  );
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
    logger.warn(
      "[CHATBOT-AUTHZ] Client ownership lookup failed: " + error.message,
    );
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
  const supervisorRole =
    role === "JEFE_VENTAS" ||
    role === "JEFE" ||
    role === "GERENTE" ||
    role === "ADMIN";
  return {
    userCode: normalizeCode(
      user.code || user.userCode || user.vendedor || user.CODIGOVENDEDOR,
    ),
    role,
    isJefeVentas: Boolean(user.isJefeVentas) || supervisorRole,
  };
}
module.exports = {
  authorizeChatbotClientScope,
  authorizeResolvedClient,
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
