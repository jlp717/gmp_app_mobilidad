/**
 * DDD Route Adapters
 * Bridges DDD modules to Express routes with feature toggle support
 * 
 * Usage: Set USE_DDD_ROUTES=true to enable these routes instead of legacy routes
 * 
 * Caching Strategy:
 * - Product catalog: 5 min (prices/stock change)
 * - Product detail: 2 min (stock changes frequently)
 * - Promotions: 30 min (rarely change)
 * - Order history: 1 min (user-specific)
 * - Albaranes: 2 min (delivery status changes)
 * - Ruta config: 15 min (rarely changes during day)
 * - Commissions: 30 min (calculated data)
 */

const express = require('express');
const logger = require('../../../middleware/logger');
const { Db2PedidosRepository } = require('../../modules/pedidos');
const { Db2CobrosRepository } = require('../../modules/cobros');
const { Db2EntregasRepository } = require('../../modules/entregas');
const { Db2RuteroRepository } = require('../../modules/rutero');
const { Db2AuthRepository } = require('../../modules/auth');
const { Db2ClientRepository } = require('../../modules/clients/infrastructure/db2-client-repository');
const { Db2ConnectionPool } = require('../../core/infrastructure/database/db2-connection-pool');
const { ResponseCache } = require('../../core/infrastructure/cache/response-cache');
const { performanceCache } = require('../../core/infrastructure/cache/performance-cache');
const { cachedQuery } = require('../../../services/query-optimizer');
const { query, queryWithParams } = require('../../../config/db');
const { TTL: RedisTTL } = require('../../../services/redis-cache');
const {
  loginLimiter,
  sanitizeInput,
  bruteForceIpTracker,
} = require('../../../middleware/security');
const {
  buildClientVendorParamFilter,
  buildCvcVendorScopeFilter,
  buildVendedorFilterLACLAE,
  sanitizeForSQL,
  MIN_YEAR,
  getVendorVisibilityScope,
  getVendorColumnExpr,
  buildClientListVendorSqlFilter,
  buildLaclaeBoundedClientCodesSql,
  lookupClientAssignedVendorCodes,
  sanitizeCodeListForParams,
  normalizeCvcTipoDocumentoFilter,
} = require('../../../utils/common');
const { getClientCodesFromCache } = require('../../../services/laclae');
const { verifyVendorPin } = require('../../../services/vendor-pin-auth');

// TTL constants (milliseconds)
const INTERNAL_SERVER_ERROR_MESSAGE = 'Error interno del servidor';

function publicErrorMessageForStatus(error, status, fallbackMessage = INTERNAL_SERVER_ERROR_MESSAGE) {
  return Number(status) >= 500 ? fallbackMessage : (error?.message || fallbackMessage);
}

function sendInternalServerError(res, fallbackMessage = INTERNAL_SERVER_ERROR_MESSAGE) {
  return res.status(500).json({ success: false, code: 'INTERNAL_SERVER_ERROR', error: fallbackMessage });
}

const TTL_MS = {
  PRODUCT_CATALOG: 5 * 60 * 1000,
  PRODUCT_DETAIL: 2 * 60 * 1000,
  PROMOTIONS: 30 * 60 * 1000,
  CLIENT_EVOLUTION: 5 * 60 * 1000,
  ORDER_HISTORY: 1 * 60 * 1000,
  ORDER_STATS: 5 * 60 * 1000,
  ALBARANES: 2 * 60 * 1000,
  ALBARAN_DETAIL: 5 * 60 * 1000,
  GAMIFICATION: 5 * 60 * 1000,
  ROUTE_SUMMARY: 2 * 60 * 1000,
  RUTA_CONFIG: 15 * 60 * 1000,
  COMMISSIONS: 30 * 60 * 1000,
  PENDIENTES: 2 * 60 * 1000,
  COBROS_HISTORICO: 5 * 60 * 1000
};
const BROAD_PEDIDO_VENDOR_SCOPE_THRESHOLD = 50;

// Shared instances
let dbPool = null;
let responseCache = null;

function getDbPool() {
  if (!dbPool) {
    dbPool = new Db2ConnectionPool();
  }
  return dbPool;
}

function getCache() {
  if (!responseCache) {
    responseCache = new ResponseCache();
  }
  return responseCache;
}

function isForceRefreshRequest(req) {
  return req?.query?.forceRefresh != null ||
    req?.query?.refresh != null ||
    req?.query?._ts != null;
}

function boundedInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSearchTerm(value) {
  return String(value || '')
    .trim()
    .replace(/[%_]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 80)
    .toUpperCase();
}

function buildLaclaeDateRangeFilter(alias, from, to) {
  const prefix = alias ? `${alias}.` : '';
  const fromYear = from.getFullYear();
  const fromMonth = from.getMonth() + 1;
  const fromDay = from.getDate();
  const toYear = to.getFullYear();
  const toMonth = to.getMonth() + 1;
  const toDay = to.getDate();
  const startClause = `(${prefix}LCMMDC > ? OR (${prefix}LCMMDC = ? AND ${prefix}LCDDDC >= ?))`;
  const endClause = `(${prefix}LCMMDC < ? OR (${prefix}LCMMDC = ? AND ${prefix}LCDDDC <= ?))`;

  if (fromYear === toYear) {
    return {
      sql: `${prefix}LCAADC = ? AND ${startClause} AND ${endClause}`,
      params: [fromYear, fromMonth, fromMonth, fromDay, toMonth, toMonth, toDay],
    };
  }

  return {
    sql: `(${prefix}LCAADC > ? OR (${prefix}LCAADC = ? AND ${startClause})) AND (${prefix}LCAADC < ? OR (${prefix}LCAADC = ? AND ${endClause}))`,
    params: [fromYear, fromYear, fromMonth, fromMonth, fromDay, toYear, toYear, toMonth, toMonth, toDay],
  };
}

function buildClientSearchFilter(safeSearch, alias = 'C') {
  if (!safeSearch) return { clause: '', params: [] };

  const prefix = `${safeSearch}%`;
  if (/^\d+$/.test(safeSearch)) {
    return {
      clause: `AND(TRIM(${alias}.CODIGOCLIENTE) LIKE ?
                  OR UPPER(COALESCE(${alias}.NIF, '')) LIKE ?
                  OR TRIM(COALESCE(${alias}.TELEFONO1, '')) LIKE ?
                  OR TRIM(COALESCE(${alias}.TELEFONO2, '')) LIKE ?)`,
      params: [prefix, prefix, prefix, prefix],
    };
  }

  const textPattern = safeSearch.length < 3 ? prefix : `%${safeSearch}%`;
  return {
    clause: `AND(UPPER(COALESCE(${alias}.NOMBRECLIENTE, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.NOMBREALTERNATIVO, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.POBLACION, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.NIF, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.CODIGORUTA, '')) LIKE ?
                OR TRIM(${alias}.CODIGOCLIENTE) LIKE ?)`,
    params: [textPattern, textPattern, textPattern, prefix, prefix, prefix],
  };
}

function buildChunkedClientCodeFilter(column, codes) {
  const cleanCodes = (Array.isArray(codes) ? codes : [])
    .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (!cleanCodes.length) return '';

  const CHUNK_SIZE = 1000;
  const chunks = [];
  for (let i = 0; i < cleanCodes.length; i += CHUNK_SIZE) {
    const chunk = cleanCodes.slice(i, i + CHUNK_SIZE).map(code => `'${code}'`).join(',');
    chunks.push(`${column} IN (${chunk})`);
  }
  return `AND (${chunks.join(' OR ')})`;
}

// Cache helper with performance optimization for ALL queries
async function withCache(cache, key, ttlMs, fetchFn, res, req) {
  if (isForceRefreshRequest(req)) {
    res.set('Cache-Control', 'no-store');
    return res.json(await fetchFn());
  }

  const isAllQuery = String(req?.query?.vendedorCodes || '').toUpperCase() === 'ALL';

  if (isAllQuery) {
    const perfCacheKey = `ALL:${key}`;
    const role = req?.user?.role || 'COMERCIAL';
    const ttlSec = performanceCache.getTTL(role, true);
    const result = await performanceCache.getOrFetch(perfCacheKey, fetchFn, ttlSec);
    res.set('X-Cache-Source', result.source);
    res.set('X-Cache-Hit', result.cached ? 'true' : 'false');
    res.set('X-Query-Type', 'ALL-OPTIMIZED');
    return res.json(result.data);
  }

  const cached = await cache.get(key);
  if (cached) return res.json(cached);
  const result = await fetchFn();
  await cache.set(key, result, ttlMs);
  return res.json(result);
}

// Invalidación de los listados/stats de pedidos en la ResponseCache de los
// adaptadores DDD tras cualquier mutación de pedidos (crear/editar líneas/
// cancelar/eliminar). Se invalida por prefijo (todos los usuarios) porque un
// JEFE_VENTAS puede mutar pedidos de otros vendedores.
function invalidateOrderListCaches(cache) {
  cache.invalidatePattern('ddd:orders-list:');
  cache.invalidatePattern('ddd:history:');
  cache.invalidatePattern('ddd:stats:');
  cache.invalidatePattern('ddd:orders-stats:');
}

function invalidateCommercialOrderCaches(cache, orderContext = {}) {
  invalidateOrderListCaches(cache);
  cache.invalidatePattern('ddd:cobros:pending-summary:');
  const clientCode = String(orderContext.clientCode || '').trim();
  if (clientCode) {
    cache.invalidatePattern(`ddd:cobros:pendientes:${clientCode}:`);
    cache.invalidatePattern(`ddd:cobros:estado:${clientCode}:`);
    cache.invalidatePattern(`ddd:cobros:historico:${clientCode}:`);
  }
}

function normalizeOrderResponse(result) {
  const order = result || {};
  const header = order.header || order;
  return {
    order,
    header,
    lines: Array.isArray(order.lines) ? order.lines : [],
    id: header && header.id != null ? header.id : order.id,
  };
}

function normalizeNumericCode(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  return raw.replace(/^0+/, '') || '0';
}

function salesCodesMatch(left, right) {
  const leftCode = String(left || '').trim();
  const rightCode = String(right || '').trim();
  if (leftCode === rightCode) return true;
  const leftNumeric = normalizeNumericCode(leftCode);
  const rightNumeric = normalizeNumericCode(rightCode);
  return leftNumeric !== null && rightNumeric !== null && leftNumeric === rightNumeric;
}

function isPrivilegedSalesUser(req) {
  return req.user?.isJefeVentas === true || req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN';
}

function canAccessVendedorCodes(req, vendedorCodes) {
  if (isPrivilegedSalesUser(req)) return true;
  const userCode = req.user?.code || req.user?.id;
  const requested = String(vendedorCodes || userCode || '').trim();
  if (!requested || requested.toUpperCase() === 'ALL') return false;
  return requested.split(',').map((code) => code.trim()).filter(Boolean)
    .every((code) => salesCodesMatch(code, userCode));
}

function normalizePedidoCode(value) {
  return String(value || '').trim();
}

function normalizePedidoCodeList(value) {
  return sanitizeCodeListForParams(String(value || ''), 2);
}

function normalizePedidoMutationVendorCode(value, fallback = '') {
  const requested = normalizePedidoCodeList(value);
  if (requested.length > 0) return requested[0];
  const fallbackCodes = normalizePedidoCodeList(fallback);
  if (fallbackCodes.length > 0) return fallbackCodes[0];
  const raw = normalizePedidoCode(value || fallback);
  if (!raw || raw.toUpperCase() === 'ALL') return '';
  return raw.split(',')[0].trim().substring(0, 2);
}

function normalizeCobrosVendorCodeList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values
    .map((code) => String(code || '').trim())
    .filter((code) => code && code.toUpperCase() !== 'ALL' && /^[A-Za-z0-9]{1,10}$/.test(code))
    .map((code) => code.substring(0, 10));
}

function getPedidoUserContext(req) {
  const user = req.user || {};
  return {
    code: normalizePedidoCode(user.code || user.codigo || user.codigoVendedor || user.vendedorCode || user.userId || user.id),
    isManager: isPrivilegedSalesUser(req),
    visibleVendorCodes: Array.isArray(user.vendorCodes || user.vendedorCodes)
      ? (user.vendorCodes || user.vendedorCodes).map(normalizePedidoCode).filter(Boolean)
      : [],
  };
}

function resolvePedidoVendorScope(req, requestedVendorCodes) {
  const context = getPedidoUserContext(req);
  const requestedRaw = normalizePedidoCode(requestedVendorCodes || 'ALL');
  const requestedAll = !requestedRaw || requestedRaw.toUpperCase() === 'ALL';
  let codes = requestedAll ? [] : normalizePedidoCodeList(requestedRaw);

  if (!context.isManager) {
    if (!context.code) return { ok: false, error: 'Usuario comercial sin vendedor asignado' };
    const visibilityCodes = getVendorVisibilityScope(context.code);
    if (requestedAll) {
      codes = visibilityCodes;
    } else if (codes.some((code) => !visibilityCodes.some((allowed) => salesCodesMatch(code, allowed)))) {
      return { ok: false, error: 'COMERCIAL solo puede operar su vendedor' };
    }
  } else if (context.visibleVendorCodes.length > 0) {
    if (requestedAll) {
      codes = context.visibleVendorCodes;
    } else if (codes.some((code) => !context.visibleVendorCodes.some((visible) => salesCodesMatch(code, visible)))) {
      return { ok: false, error: 'JEFE_VENTAS no puede operar vendedores fuera de su alcance' };
    }
  }

  return { ok: true, codes: [...new Set(codes)] };
}

function resolveCobrosVendorScope(req, requestedVendorCodes) {
  const context = getPedidoUserContext(req);
  const requestedRaw = normalizePedidoCode(requestedVendorCodes || 'ALL');
  const requestedAll = !requestedRaw || requestedRaw.toUpperCase() === 'ALL';
  let codes = requestedAll ? [] : normalizeCobrosVendorCodeList(requestedRaw);

  if (!context.isManager) {
    if (!context.code) return { ok: false, error: 'Usuario comercial sin vendedor asignado' };
    const visibilityCodes = normalizeCobrosVendorCodeList(getVendorVisibilityScope(context.code));
    if (requestedAll) {
      codes = visibilityCodes;
    } else if (codes.some((code) => !visibilityCodes.some((allowed) => salesCodesMatch(code, allowed)))) {
      return { ok: false, error: 'COMERCIAL solo puede operar su vendedor' };
    }
  } else {
    const visibleCodes = normalizeCobrosVendorCodeList(context.visibleVendorCodes);
    if (visibleCodes.length > 0) {
      if (requestedAll) {
        codes = visibleCodes;
      } else if (codes.some((code) => !visibleCodes.some((visible) => salesCodesMatch(code, visible)))) {
        return { ok: false, error: 'JEFE_VENTAS no puede operar vendedores fuera de su alcance' };
      }
    }
  }

  return { ok: true, codes: [...new Set(codes)] };
}

function dddForbiddenBody(code, error) {
  return { success: false, code, error };
}

function numericHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

function statusFromPedidoError(error, fallbackStatus = 500) {
  const explicitStatus = numericHttpStatus(error?.status || error?.statusCode);
  if (explicitStatus) return explicitStatus;
  switch (error?.code) {
    case 'INVALID_LINE_PAYLOAD':
    case 'INVALID_ORDER':
    case 'INVALID_SALE_TYPE':
      return 400;
    case 'ORDER_NOT_FOUND':
    case 'LINE_NOT_FOUND':
      return 404;
    case 'ORDER_NOT_EDITABLE':
    case 'PEDIDO_ALREADY_CONFIRMING':
    case 'PEDIDO_INVALID_STATE':
    case 'PEDIDO_ALREADY_ANULADO':
    case 'PEDIDO_MANAGED_BY_ERP':
      return 409;
    default:
      return fallbackStatus;
  }
}

function sendPedidosMutationError(res, error, { fallbackMessage, fallbackCode = 'PEDIDOS_MUTATION_ERROR' } = {}) {
  const status = statusFromPedidoError(error);
  const code = error?.code || fallbackCode;
  const publicMessage = status >= 500
    ? (fallbackMessage || 'Error interno procesando pedido')
    : (error?.message || fallbackMessage || 'Error procesando pedido');
  return res.status(status).json({ success: false, code, error: publicMessage });
}

function validateDddOrderLinePayload(body = {}) {
  const codigoArticulo = String(body.codigoArticulo || '').trim();
  if (!codigoArticulo) {
    return { ok: false, status: 400, body: { success: false, code: 'INVALID_LINE_PAYLOAD', error: 'codigoArticulo is required' } };
  }
  const claseLinea = body.claseLinea === undefined ? 'VT' : String(body.claseLinea).trim();
  if (!['VT', 'SC'].includes(claseLinea)) {
    return { ok: false, status: 400, body: { success: false, code: 'INVALID_LINE_PAYLOAD', error: 'claseLinea inválida' } };
  }
  return { ok: true, payload: { ...body, codigoArticulo, claseLinea } };
}

function authorizePedidoVendorCode(req, vendedorCode, action = 'operar') {
  const context = getPedidoUserContext(req);
  const vendor = normalizePedidoMutationVendorCode(vendedorCode, context.code);
  if (!vendor) return { ok: false, status: 400, body: dddForbiddenBody('INVALID_VENDOR', 'vendedorCode invalido') };
  if (context.isManager) {
    if (context.visibleVendorCodes.length === 0 || context.visibleVendorCodes.some((code) => salesCodesMatch(code, vendor))) {
      return { ok: true, vendedorCode: vendor };
    }
    return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_VENDOR', `JEFE_VENTAS no puede ${action} vendedores fuera de su alcance`) };
  }
  if (context.code && salesCodesMatch(context.code, vendor)) return { ok: true, vendedorCode: vendor };
  return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_VENDOR', `COMERCIAL solo puede ${action} su vendedor`) };
}

function buildLaclaeVendorParamFilter(vendorCodes, alias = "L") {
  if (!Array.isArray(vendorCodes) || vendorCodes.length === 0) {
    return { clause: "", params: [] };
  }
  const vendorColumn = getVendorColumnExpr(alias);
  const safeCodes = vendorCodes
    .map((code) => String(code || "").trim())
    .filter((code) => /^[a-zA-Z0-9]+$/.test(code))
    .map((code) => code.substring(0, 2))
    .filter(Boolean);
  if (safeCodes.length === 0) {
    return { clause: "", params: [] };
  }
  return {
    clause: "AND TRIM(" + vendorColumn + ") IN (" + safeCodes.map(() => "CAST(? AS VARCHAR(2))").join(",") + ")",
    params: safeCodes,
  };
}


async function authorizePedidoClientScope(req, clientCode, vendedorCodes, action = 'operar') {
  const client = normalizePedidoCode(clientCode).substring(0, 10);
  if (!client) return { ok: false, status: 400, body: dddForbiddenBody('INVALID_CLIENT', 'clientCode invalido') };
  const context = getPedidoUserContext(req);
  const vendorScope = resolvePedidoVendorScope(req, vendedorCodes);
  if (!vendorScope.ok) return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error) };

  const broadManagerScope = context.isManager
    && (vendorScope.codes.length === 0 || vendorScope.codes.length > BROAD_PEDIDO_VENDOR_SCOPE_THRESHOLD);
  if (broadManagerScope) {
    const assignedVendors = await lookupClientAssignedVendorCodes(client);
    if (
      assignedVendors.length > 0
      && vendorScope.codes.length > 0
      && !assignedVendors.some((assigned) => vendorScope.codes.some((allowed) => salesCodesMatch(assigned, allowed)))
    ) {
      return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_CLIENT_VENDOR', `No autorizado para ${action} este cliente con ese vendedor`) };
    }

    const existsRows = await cachedQuery(
      (sql, params = []) => queryWithParams(sql, params),
      `SELECT 1
         FROM DSEDAC.CLI CLI
        WHERE TRIM(CLI.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
        FETCH FIRST 1 ROW ONLY`,
      {
        cacheKey: `pedido-client-exists:${client}`,
        prefix: 'pedidos-auth',
        ttl: RedisTTL.SHORT || 60,
        params: { client },
        queryType: 'pedido-client-auth',
      },
      [client],
    );
    if (!existsRows || existsRows.length === 0) {
      return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_CLIENT_VENDOR', `No autorizado para ${action} este cliente con ese vendedor`) };
    }
    return {
      ok: true,
      clientCode: client,
      vendorCodes: assignedVendors.length > 0 ? assignedVendors : vendorScope.codes,
    };
  }

  const clientVendorFilter = buildClientVendorParamFilter(vendorScope.codes, 'CLI');
  let rows = await queryWithParams(
    `SELECT 1
       FROM DSEDAC.CLI CLI
      WHERE TRIM(CLI.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
        ${clientVendorFilter.clause}
      FETCH FIRST 1 ROW ONLY`,
    [client, ...clientVendorFilter.params],
  );
  let effectiveVendorCodes = vendorScope.codes;
  if ((!rows || rows.length === 0) && context.isManager) {
    const assignedVendors = await lookupClientAssignedVendorCodes(client);
    if (assignedVendors.length > 0) {
      const retryFilter = buildClientVendorParamFilter(assignedVendors, 'CLI');
      rows = await queryWithParams(
        `SELECT 1
           FROM DSEDAC.CLI CLI
          WHERE TRIM(CLI.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
            ${retryFilter.clause}
          FETCH FIRST 1 ROW ONLY`,
        [client, ...retryFilter.params],
      );
      if (rows && rows.length > 0) {
        effectiveVendorCodes = assignedVendors;
      }
    }
  }
  if (!rows || rows.length === 0) {
    return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_CLIENT_VENDOR', `No autorizado para ${action} este cliente con ese vendedor`) };
  }
  return { ok: true, clientCode: client, vendorCodes: effectiveVendorCodes };
}

async function authorizeCobrosClientScope(req, clientCode, vendedorCodes, action = 'consultar cobros de') {
  const client = normalizePedidoCode(clientCode).substring(0, 10);
  if (!client) return { ok: false, status: 400, body: dddForbiddenBody('INVALID_CLIENT', 'clientCode invalido') };

  const context = getPedidoUserContext(req);
  const vendorScope = resolveCobrosVendorScope(req, vendedorCodes);
  if (!vendorScope.ok) return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error) };

  const cvcVendorFilter = buildCvcVendorScopeFilter(vendorScope.codes);
  const cvcRows = await queryWithParams(
    `SELECT 1
       FROM DSEDAC.CVC CVC
      WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
        AND CVC.IMPORTEPENDIENTE > 0.01
        AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
        ${cvcVendorFilter.clause}
      FETCH FIRST 1 ROW ONLY`,
    [client, ...cvcVendorFilter.params],
  );
  if (cvcRows && cvcRows.length > 0) {
    return { ok: true, clientCode: client, vendorCodes: vendorScope.codes };
  }

  if (context.isManager && context.visibleVendorCodes.length === 0 && vendorScope.codes.length === 0) {
    return { ok: true, clientCode: client, vendorCodes: vendorScope.codes };
  }

  return authorizePedidoClientScope(req, client, vendedorCodes, action);
}

async function authorizePedidoMutation(req, orderId, action = 'mutar') {
  const id = parseInt(orderId, 10);
  if (!Number.isFinite(id)) return { ok: false, status: 400, body: dddForbiddenBody('INVALID_ORDER', 'orderId invalido') };

  const pedidosService = require('../../../services/pedidos.service');
  const ownership = await pedidosService.getOrderVendorForAuth(id);
  if (!ownership) {
    return { ok: false, status: 404, body: dddForbiddenBody('ORDER_NOT_FOUND', 'Pedido no encontrado') };
  }

  const context = getPedidoUserContext(req);
  const orderVendor = normalizePedidoCode(ownership.vendedorCode);
  if (context.isManager) {
    if (context.visibleVendorCodes.length === 0 || context.visibleVendorCodes.some((code) => salesCodesMatch(code, orderVendor))) {
      return { ok: true, ownership };
    }
    return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_VENDOR', `JEFE_VENTAS no puede ${action} pedidos fuera de su alcance`) };
  }
  if (context.code && salesCodesMatch(context.code, orderVendor)) {
    return { ok: true, ownership };
  }
  return { ok: false, status: 403, body: dddForbiddenBody('FORBIDDEN_VENDOR', `COMERCIAL solo puede ${action} pedidos de su vendedor`) };
}

function authorizedVendorCodesOrOriginal(access, original) {
  const codes = Array.isArray(access?.vendorCodes) ? access.vendorCodes.filter(Boolean) : [];
  return codes.length > 0 ? codes.join(',') : (original || 'ALL');
}

function canSeePedidoMargin(user) {
  const role = String(user?.role || '').toUpperCase();
  return role === 'JEFE_VENTAS' || role === 'ADMIN' || user?.isJefeVentas === true;
}

function canUseServerForceConfirm(req, body = {}) {
  if (body.forceConfirm !== true) return false;
  const role = String(req.user?.role || '').toUpperCase();
  const isAdmin = req.user?.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN';
  const reason = String(body.forceConfirmReason || body.auditReason || '').trim();
  return isAdmin && reason.length >= 8;
}

function buildCacheSecurityScope(req, { includeMargin = false } = {}) {
  const user = req?.user || {};
  const role = String(user.role || user.userRole || user.tipo || 'COMERCIAL').trim().toUpperCase();
  const userId = normalizePedidoCode(user.code || user.codigo || user.codigoVendedor || user.vendedorCode || user.userId || user.id || 'anonymous');
  const visible = user.vendorCodes || user.vendedorCodes || [];
  const visibleScope = Array.isArray(visible) ? visible.map(normalizePedidoCode).filter(Boolean).sort().join(',') : normalizePedidoCode(visible);
  const marginScope = includeMargin ? `:canSeeMargin=${canSeePedidoMargin(user) ? '1' : '0'}` : '';
  return `scope:v2:role=${role}:user=${userId || 'anonymous'}:visible=${visibleScope || 'self'}${marginScope}`;
}

function stripMarginFromOrder(order, user) {
  if (canSeePedidoMargin(user) || !order) return order;
  const clean = JSON.parse(JSON.stringify(order));
  delete clean.costo;
  delete clean.margen;
  delete clean.importeCosto;
  delete clean.importeMargen;
  delete clean.totalCosto;
  delete clean.totalMargen;
  delete clean.porcentajeMargen;
  if (clean.header) {
    delete clean.header.costo;
    delete clean.header.margen;
    delete clean.header.importeCosto;
    delete clean.header.importeMargen;
    delete clean.header.totalCosto;
    delete clean.header.totalMargen;
    delete clean.header.porcentajeMargen;
  }
  if (Array.isArray(clean.lines)) {
    clean.lines = clean.lines.map((line) => {
      const safeLine = { ...line };
      delete safeLine.precioCosto;
      delete safeLine.importeCosto;
      delete safeLine.importeMargen;
      delete safeLine.porcentajeMargen;
      return safeLine;
    });
  }
  return clean;
}

function stripMarginFromProduct(product, user) {
  if (canSeePedidoMargin(user) || !product) return product;
  const clean = { ...product };
  delete clean.precioCosto;
  delete clean.precioMinimo;
  delete clean.costo;
  delete clean.margen;
  delete clean.importeCosto;
  delete clean.importeMargen;
  delete clean.porcentajeMargen;
  return clean;
}

function stripMarginFromProductHistory(payload, user) {
  if (canSeePedidoMargin(user) || !payload) return payload;
  const clean = JSON.parse(JSON.stringify(payload));
  for (const year of Object.values(clean.years || {})) {
    delete year.totals?.cost;
    delete year.totals?.margin;
    delete year.totals?.marginPct;
    for (const month of Object.values(year.months || {})) {
      delete month.cost;
      delete month.margin;
      delete month.marginPct;
    }
  }
  delete clean.grandTotal?.cost;
  delete clean.grandTotal?.margin;
  delete clean.grandTotal?.marginPct;
  return clean;
}

// =============================================================================
// AUTH ROUTES (DDD)
// =============================================================================
function createAuthRoutes() {
  const router = express.Router();
  const repo = new Db2AuthRepository(getDbPool());

  router.post('/login',
    bruteForceIpTracker,
    loginLimiter,
    sanitizeInput,
    async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos', code: 'MISSING_CREDENTIALS' });
      }

      const user = await repo.findByCode(username);
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      if (!user._passwordHash) {
        logger.warn(`[DDD-AUTH] User ${username} has no password hash - login denied`);
        await repo.logLoginAttempt(user.id, false, req.ip);
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      const pinVerification = await verifyVendorPin({
        vendedorCode: user.code,
        candidatePin: password,
        dbPin: user._passwordHash,
        requestId: 'DDD-AUTH',
      });

      if (!pinVerification.valid) {
        await repo.logLoginAttempt(user.id, false, req.ip);
        if (pinVerification.reason === 'plaintext_pin_denied') {
          logger.warn(`[DDD-AUTH] Plaintext PIN auth denied for user ${username}; PIN hash migration required`);
        } else {
          logger.warn(`[DDD-AUTH] PIN verification failed for user ${username}: ${pinVerification.reason}`);
        }
        return res.status(401).json({ error: 'Credenciales inválidas', code: 'INVALID_CREDENTIALS' });
      }

      logger.info(`[DDD-AUTH] Vendor ${user.code} authenticated via ${pinVerification.method}`);

      await repo.logLoginAttempt(user.id, true, req.ip);

      // Expand vendedorCodes for JEFE_VENTAS (same as legacy: all GMP vendors)
      let vendedorCodes = [user.code];
      if (user.isJefeVentas) {
        try {
          const allVendedores = await getDbPool().execute(
            `SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'`
          );
          const orphans = ['82', '20', 'UNK'];
          const existingCodes = new Set(allVendedores.map(v => v.CODE));
          orphans.forEach(o => existingCodes.add(o));
          vendedorCodes = Array.from(existingCodes);
        } catch (e) {
          logger.warn(`[DDD-AUTH] Could not expand vendedorCodes for JEFE_VENTAS: ${e.message}`);
        }
      } else {
        vendedorCodes = getVendorVisibilityScope(user.code);
      }

      const {
        signAccessToken,
        signRefreshToken,
        registerSession,
        ACCESS_TTL_MS,
        REFRESH_TTL_MS
      } = require('../../../middleware/auth');
      const tokenPayload = {
        id: user.id,
        user: user.code,
        name: user.name,
        role: user.role,
        isJefeVentas: user.isJefeVentas,
        vendorCodes: vendedorCodes,
        vendedorCodes
      };
      const accessToken = signAccessToken(tokenPayload);
      const refreshToken = signRefreshToken(tokenPayload);
      await registerSession(
        user.id,
        refreshToken,
        req.get('user-agent') || 'unknown',
        req.ip || 'unknown'
      );

      // Response format must match legacy auth routes (Flutter expects 'token', not 'accessToken')
      res.json({
        success: true,
        user: {
          id: user.id,
          code: user.code,
          name: user.name,
          role: user.role,
          isJefeVentas: user.isJefeVentas,
          vendedorCode: user.code,
          isRepartidor: user.role === 'REPARTIDOR',
          showCommissions: process.env.HIDE_COMMISSIONS !== 'true'
        },
        role: user.role,
        vendedorCodes,
        token: accessToken,
        refreshToken,
        tokenExpiresIn: Math.floor(ACCESS_TTL_MS / 1000),
        refreshExpiresIn: Math.floor(REFRESH_TTL_MS / 1000)
      });
    } catch (error) {
      logger.error(`[DDD-AUTH] Login error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', code: 'AUTH_INTERNAL_ERROR' });
    }
  });

  // Lightweight token validation — JWT check only, no DB query.
  // Used by Flutter on startup to verify stored tokens are still valid
  // (guards against ephemeral JWT secrets being regenerated on server restart).
  const { verifyToken: _verifyToken } = require('../../../middleware/auth');
  router.get('/validate', _verifyToken, (req, res) => {
    res.json({ valid: true, usuario: req.user.code });
  });

  return router;
}

// =============================================================================
// PEDIDOS ROUTES (DDD) — with caching
// =============================================================================
function createPedidosRoutes() {
  const router = express.Router();
  const repo = new Db2PedidosRepository(getDbPool());
  const cache = getCache();

  router.get('/products', async (req, res) => {
    try {
      const { vendedorCodes, clientCode, family, marca, prefamily, search, limit, offset } = req.query;
      if (!vendedorCodes) return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
      if (!clientCode) return res.status(400).json({ success: false, error: 'clientCode is required' });
      const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCodes, 'consultar catalogo para');
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      const scopedVendedorCodes = authorizedVendorCodesOrOriginal(clientAccess, vendedorCodes);
      const scopedClientCode = clientAccess.clientCode;
      const cacheSecurityScope = buildCacheSecurityScope(req, { includeMargin: true });

      const cacheKey = `ddd:products:${cacheSecurityScope}:${scopedVendedorCodes}:${scopedClientCode}:${family || ''}:${marca || ''}:${prefamily || ''}:${search || ''}:${limit || 50}:${offset || 0}`;
      await withCache(cache, cacheKey, TTL_MS.PRODUCT_CATALOG, async () => {
        const result = await repo.searchProducts({
          vendedorCodes: scopedVendedorCodes,
          clientCode: scopedClientCode,
          family: family ? String(family).trim() : undefined,
          marca: marca ? String(marca).trim() : undefined,
          prefamily: prefamily ? String(prefamily).trim() : undefined,
          search: search ? String(search).trim() : undefined,
          limit: parseInt(limit) || 50,
          offset: parseInt(offset) || 0
        });
        return {
          success: true,
          products: (result.products || []).map((product) => stripMarginFromProduct(product, req.user)),
          count: result.count,
        };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /products: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.post("/products/stock-batch", async (req, res) => {
    try {
      const rawCodes = Array.isArray(req.body?.codes) ? req.body.codes : [];
      const codes = [...new Set(rawCodes.map((code) => String(code || "").trim()).filter(Boolean))].slice(0, 200);
      const almacen = Number.parseInt(req.body?.almacen, 10) || 1;
      if (codes.length === 0) return res.status(400).json({ success: false, error: "codes array is required" });
      const pedidosService = require("../../../services/pedidos.service");
      const stockMap = await pedidosService.getStockBatch(codes, almacen);
      const stock = stockMap instanceof Map ? Object.fromEntries(stockMap.entries()) : (stockMap || {});
      res.json({ success: true, stock });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /products/stock-batch: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/products/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().substring(0, 10);
      const { clientCode, vendedorCodes } = req.query;
      if (!code) return res.status(400).json({ success: false, error: 'Product code required' });
      let scopedClientCode = clientCode ? String(clientCode).trim().substring(0, 10) : undefined;
      let scopedVendedorCodes = vendedorCodes || 'ALL';
      if (scopedClientCode) {
        const clientAccess = await authorizePedidoClientScope(req, scopedClientCode, vendedorCodes, 'consultar producto para');
        if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
        scopedClientCode = clientAccess.clientCode;
        scopedVendedorCodes = authorizedVendorCodesOrOriginal(clientAccess, vendedorCodes);
      } else {
        const vendorScope = resolvePedidoVendorScope(req, vendedorCodes || 'ALL');
        if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
        scopedVendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : (vendedorCodes || 'ALL');
      }

      const cacheSecurityScope = buildCacheSecurityScope(req, { includeMargin: true });
      const cacheKey = `ddd:product:${cacheSecurityScope}:${code}:${scopedClientCode || ''}:${scopedVendedorCodes}`;
      await withCache(cache, cacheKey, TTL_MS.PRODUCT_DETAIL, async () => {
        const product = await repo.getProductDetail({
          code,
          clientCode: scopedClientCode,
          vendedorCodes: scopedVendedorCodes
        });
        if (!product) return { success: false, error: 'Product not found' };
        return { success: true, product: stripMarginFromProduct(product, req.user) };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /products/:code: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/promotions', async (req, res) => {
    try {
      const { clientCode, vendedorCodes } = req.query;
      if (!clientCode) return res.status(400).json({ success: false, error: 'clientCode is required' });

      const trimmedClient = String(clientCode).trim();
      if (!trimmedClient) return res.status(400).json({ success: false, error: 'clientCode cannot be empty' });
      const clientAccess = await authorizePedidoClientScope(req, trimmedClient, vendedorCodes, 'consultar promociones para');
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      const scopedVendedorCodes = authorizedVendorCodesOrOriginal(clientAccess, vendedorCodes);

      const cacheKey = `ddd:promotions:${clientAccess.clientCode}:${scopedVendedorCodes}`;
      await withCache(cache, cacheKey, TTL_MS.PROMOTIONS, async () => {
        const result = await repo.getPromotions({
          clientCode: clientAccess.clientCode,
          vendedorCodes: scopedVendedorCodes
        });
        // result is an array of promotion objects from legacy service
        const promotions = Array.isArray(result) ? result : [];
        logger.info(`[DDD-PEDIDOS] Promotions for ${trimmedClient}: ${promotions.length} found`);
        return { success: true, promotions };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /promotions: ${error.message}`);
      res.status(500).json({ success: false, error: 'Error cargando promociones' });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { limit, offset, vendedorCodes, estado, status } = req.query;
      const requestedVendedorCodes = vendedorCodes || userId;
      const vendorScope = resolvePedidoVendorScope(req, requestedVendedorCodes);
      if (!vendorScope.ok) {
        return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      }
      const scopedVendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';
      const requestedStatus = status || estado;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const safeLimit = parseInt(limit, 10) || 20;
      const safeOffset = offset != null
        ? parseInt(offset, 10) || 0
        : (page - 1) * safeLimit;
      const cacheKey = `ddd:history:${userId}:${scopedVendedorCodes}:${safeLimit}:${safeOffset}:${requestedStatus || 'all'}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_HISTORY, async () => {
        const result = await repo.getOrderHistory({
          userId,
          vendedorCodes: scopedVendedorCodes,
          limit: safeLimit,
          offset: safeOffset,
          estado: requestedStatus ? String(requestedStatus).trim() : undefined,
        });
        const orders = Array.isArray(result) ? result : (result.orders || []);
        const count = Array.isArray(result) ? result.length : (result.count || orders.length);
        return { success: true, orders: orders.map((order) => stripMarginFromOrder(order, req.user)), count };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /history: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      // AppSec: valida el alcance de vendedor. COMERCIAL solo puede consultar
      // sus propias estadísticas; JEFE_VENTAS queda acotado a su visibilidad.
      const vendorScope = resolvePedidoVendorScope(req, req.query.vendedorCodes || userId);
      if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      const vendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';
      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : undefined;
      const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : undefined;

      const cacheKey = `ddd:stats:${vendedorCodes}:${dateFrom || ''}:${dateTo || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_STATS, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const stats = await pedidosService.getOrderStats(vendedorCodes, dateFrom, dateTo);
        return { success: true, stats };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /stats: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.post('/cart/add', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, productCode, quantity, unit } = req.body;
      if (!clientCode || !productCode || !quantity) {
        return res.status(400).json({ success: false, error: 'clientCode, productCode, and quantity required' });
      }

      const result = await repo.addToCart({ userId, clientCode, productCode, quantity, unit });
      cache.invalidatePattern(`ddd:cart:${userId}`);
      res.json({ success: true, cartItem: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /cart/add: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.post('/confirm', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      return res.status(410).json({
        success: false,
        code: 'DIRECT_CONFIRM_DISABLED',
        error: 'Use POST /pedidos/create followed by PUT /pedidos/:id/confirm so stock, ownership and bolsa validations run.',
      });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /confirm: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // =============================================================================
  // MISSING ENDPOINTS (ported from legacy pedidos.js)
  // =============================================================================

  // GET /api/pedidos/client-balance/:clientCode
  router.get('/client-balance/:clientCode', async (req, res) => {
    try {
      const clientCode = String(req.params.clientCode).trim();
      const clientAccess = await authorizePedidoClientScope(
        req,
        clientCode,
        req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
        'consultar saldo de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      const pedidosService = require('../../../services/pedidos.service');
      const balance = await pedidosService.getClientBalance(clientAccess.clientCode);
      res.json({ success: true, balance });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /client-balance: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/recommendations/:clientCode
  router.get('/recommendations/:clientCode', async (req, res) => {
    try {
      const clientCode = String(req.params.clientCode).trim();
      const vendedorCode = req.query.vendedorCode ? String(req.query.vendedorCode).trim() : undefined;
      if (!vendedorCode) {
        return res.status(400).json({ success: false, error: 'vendedorCode is required' });
      }
      const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCode, 'consultar recomendaciones para');
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      const pedidosService = require('../../../services/pedidos.service');
      const scopedVendedor = authorizedVendorCodesOrOriginal(clientAccess, vendedorCode);
      const recommendations = await pedidosService.getRecommendations(clientAccess.clientCode, scopedVendedor);
      res.json({ success: true, clientHistory: recommendations.clientHistory, similarClients: recommendations.similarClients });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /recommendations: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/orders/stats (alias to /stats for Flutter app compatibility)
  router.get('/orders/stats', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      // AppSec: mismo control de alcance que GET /stats.
      const vendorScope = resolvePedidoVendorScope(req, req.query.vendedorCodes || userId);
      if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      const vendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';
      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : undefined;
      const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : undefined;

      const cacheKey = `ddd:orders-stats:${vendedorCodes}:${dateFrom || ''}:${dateTo || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_STATS, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const stats = await pedidosService.getOrderStats(vendedorCodes, dateFrom, dateTo);
        return { success: true, stats };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /orders/stats: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/products/:code/stock
  router.get('/products/:code/stock', async (req, res) => {
    try {
      const { code } = req.params;
      const pedidosService = require('../../../services/pedidos.service');
      const stock = await pedidosService.getProductStock(String(code).trim());
      res.json({ success: true, stock });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /products/:code/stock: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/families
  router.get('/families', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const families = await pedidosService.getProductFamilies();
      res.json({ success: true, families });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /families: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/brands
  router.get('/brands', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const brands = await pedidosService.getProductBrands();
      res.json({ success: true, brands });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /brands: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/client-prices/:clientCode
  router.get('/client-prices/:clientCode', async (req, res) => {
    try {
      const { clientCode } = req.params;
      const clientAccess = await authorizePedidoClientScope(
        req,
        clientCode,
        req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
        'consultar precios de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      const pedidosService = require('../../../services/pedidos.service');
      const prices = await pedidosService.getClientPricing(clientAccess.clientCode);
      const safePrices = Array.isArray(prices)
        ? prices.map((price) => stripMarginFromProduct(price, req.user))
        : prices;
      res.json({ success: true, prices: safePrices });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /client-prices: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/product-comparative/:productCode
  router.get('/product-comparative/:productCode', async (req, res) => {
    try {
      const productCode = String(req.params.productCode || '').trim();
      if (!productCode) {
        return res.status(400).json({ success: false, error: 'productCode requerido' });
      }
      const clientCode = String(req.query.clientCode || '').trim();
      const vendedorCode = String(req.query.vendedorCode || '').trim();
      let scopedVendorCodes = vendedorCode ? [vendedorCode] : [];
      if (clientCode) {
        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCode || 'ALL', 'consultar comparativa para');
        if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
        scopedVendorCodes = clientAccess.vendorCodes.length > 0
          ? clientAccess.vendorCodes
          : (vendedorCode ? [vendedorCode] : []);
      } else {
        const vendorScope = resolvePedidoVendorScope(req, vendedorCode || 'ALL');
        if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
        scopedVendorCodes = vendorScope.codes.length > 0 ? vendorScope.codes : scopedVendorCodes;
      }
      const now = new Date();
      const currentYear = now.getFullYear();
      const previousYear = currentYear - 1;

      const where = [`TRIM(L.LCCDRF) = ?`, `L.LCTPVT IN ('CC','VC')`,
                     `L.LCCLLN IN ('VT','AB')`, `L.LCSRAB NOT IN ('N','Z','G','D')`];
      const params = [productCode];
      if (clientCode) { where.push('TRIM(L.LCCDCL) = ?'); params.push(clientCode); }
      if (scopedVendorCodes.length > 0) {
        where.push(`TRIM(L.LCCDVD) IN (${scopedVendorCodes.map(() => '?').join(',')})`);
        params.push(...scopedVendorCodes);
      }
      const whereSql = where.join(' AND ');

      const { queryWithParams } = require('../../../config/db');

      const sqlByMonth = `
          SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
              COALESCE(SUM(L.LCCTEV), 0) AS ENVASES,
              COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
              COALESCE(SUM(L.LCIMVT), 0) AS IMPORTE
          FROM DSED.LACLAE L
          WHERE ${whereSql} AND L.LCAADC IN (?, ?)
          GROUP BY L.LCAADC, L.LCMMDC
          ORDER BY L.LCAADC, L.LCMMDC
      `;
      const sqlProductName = `
          SELECT TRIM(DESCRIPCIONARTICULO) AS NAME
          FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) = ?
          FETCH FIRST 1 ROW ONLY
      `;

      const [rows, nameRows] = await Promise.all([
        queryWithParams(sqlByMonth, [...params, currentYear, previousYear], []),
        queryWithParams(sqlProductName, [productCode], []),
      ]);

      const empty = () => Array.from({ length: 12 }, (_, i) => ({ m: i + 1, envases: 0, unidades: 0, importe: 0 }));
      const monthlyCurrent = empty();
      const monthlyPrevious = empty();
      for (const r of (rows || [])) {
        const y = parseInt(r.YEAR);
        const m = parseInt(r.MONTH);
        if (!m || m < 1 || m > 12) continue;
        const slot = y === currentYear ? monthlyCurrent : (y === previousYear ? monthlyPrevious : null);
        if (!slot) continue;
        slot[m - 1] = { m, envases: parseFloat(r.ENVASES) || 0, unidades: parseFloat(r.UNIDADES) || 0, importe: parseFloat(r.IMPORTE) || 0 };
      }

      const sumKey = (arr, key) => arr.reduce((s, x) => s + (x[key] || 0), 0);
      const totalEnvCur = sumKey(monthlyCurrent, 'envases');
      const totalImpCur = sumKey(monthlyCurrent, 'importe');
      const totalEnvPrev = sumKey(monthlyPrevious, 'envases');
      const totalImpPrev = sumKey(monthlyPrevious, 'importe');

      const monthsClosed = now.getMonth();
      const partialDay = now.getDate();
      const daysInCurrentMonth = new Date(currentYear, monthsClosed + 1, 0).getDate();
      const accum = (arr) => {
        let s = 0;
        for (let i = 0; i < monthsClosed; i++) s += arr[i].envases;
        s += arr[monthsClosed].envases * (partialDay / daysInCurrentMonth);
        return s;
      };

      res.json({
        success: true, code: productCode,
        name: (nameRows?.[0]?.NAME || '').trim(),
        filters: { clientCode: clientCode || null, vendedorCode: scopedVendorCodes.join(',') || null },
        currentYear:  { year: currentYear, total: totalEnvCur, totalImporte: totalImpCur, monthly: monthlyCurrent },
        previousYear: { year: previousYear, total: totalEnvPrev, totalImporte: totalImpPrev, monthly: monthlyPrevious },
        variation: {
          envasesPct: totalEnvPrev > 0 ? ((totalEnvCur - totalEnvPrev) / totalEnvPrev) * 100 : null,
          importePct: totalImpPrev > 0 ? ((totalImpCur - totalImpPrev) / totalImpPrev) * 100 : null,
          ytdEnvasesPct: (() => { const c = accum(monthlyCurrent), p = accum(monthlyPrevious); return p > 0 ? ((c - p) / p) * 100 : null; })(),
        },
      });
    } catch (error) {
      const odbc0 = error.odbcErrors && error.odbcErrors[0];
      const odbcMsg = odbc0 ? `${odbc0.state} (${odbc0.code}): ${odbc0.message}` : '';
      logger.error(`[DDD-PEDIDOS] product-comparative error: ${error.message} | ODBC: ${odbcMsg}`);
      res.status(500).json({ success: false, error: 'Error obteniendo comparativa de producto' });
    }
  });

  // POST /api/pedidos/acciones-rapidas
  router.post('/acciones-rapidas', async (req, res) => {
    try {
      const {
        codigoArticulo,
        cantidadEnvases = 0,
        cantidadUnidades = 0,
        unidadMedida = 'CAJAS',
        almacen = 1,
      } = req.body || {};
      const code = String(codigoArticulo || '').trim();
      if (!code) {
        return res.status(400).json({ success: false, error: 'codigoArticulo is required' });
      }
      const pedidosService = require('../../../services/pedidos.service');
      const stock = await pedidosService.getProductStock(code, parseInt(almacen, 10) || 1);
      const unit = String(unidadMedida || 'CAJAS').trim().toUpperCase();
      const reqEnvases = parseFloat(cantidadEnvases) || 0;
      const reqUnidades = parseFloat(cantidadUnidades) || 0;
      const stockWarnings = [];

      if (unit === 'CAJAS' && reqEnvases > 0) {
        const available = parseFloat(stock?.envases) || 0;
        if (reqEnvases > available) {
          stockWarnings.push({ product: code, requested: reqEnvases, available, unit: 'envases' });
        }
      } else if (reqUnidades > 0) {
        const available = parseFloat(stock?.unidades) || 0;
        if (reqUnidades > available) {
          stockWarnings.push({ product: code, requested: reqUnidades, available, unit: 'unidades' });
        }
      } else if ((parseFloat(stock?.envases) || 0) <= 0 && (parseFloat(stock?.unidades) || 0) <= 0) {
        stockWarnings.push({ product: code, requested: 1, available: 0, unit: 'envases' });
      }

      let alternatives = [];
      if (stockWarnings.length > 0) {
        alternatives = await pedidosService.getSimilarProducts(code);
        const safeAlternatives = (alternatives || []).map((product) => stripMarginFromProduct(product, req.user));
        return res.status(409).json({
          success: false,
          error: 'STOCK_INSUFICIENTE',
          code: 'STOCK_INSUFICIENTE',
          message: 'Stock insuficiente para la accion rapida',
          codigoArticulo: code,
          stock,
          sufficient: false,
          stockWarnings,
          alternativa: safeAlternatives[0] || null,
          alternatives: safeAlternatives,
        });
      }

      res.json({
        success: true,
        codigoArticulo: code,
        stock,
        sufficient: true,
        stockWarnings: [],
        alternatives: [],
      });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /acciones-rapidas: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/similar-products/:code
  router.get('/similar-products/:code', async (req, res) => {
    try {
      const { code } = req.params;
      const vendorScope = resolvePedidoVendorScope(req, req.query.vendedorCodes || req.query.vendedorCode || 'ALL');
      if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      const pedidosService = require('../../../services/pedidos.service');
      const similar = await pedidosService.getSimilarProducts(String(code).trim());
      // Flutter expects 'alternatives' key
      res.json({ success: true, alternatives: (similar || []).map((product) => stripMarginFromProduct(product, req.user)) });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /similar-products: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/search-products
  router.get('/search-products', async (req, res) => {
    try {
      const { q, limit = 20, vendedorCodes, clientCode } = req.query;
      const searchTerm = q ? String(q).trim() : '';
      if (!searchTerm || searchTerm.length < 2) {
        return res.json({ success: true, products: [] });
      }
      if (clientCode) {
        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCodes || 'ALL', 'buscar productos para');
        if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      } else {
        const vendorScope = resolvePedidoVendorScope(req, vendedorCodes || 'ALL');
        if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      }

      const pedidosService = require('../../../services/pedidos.service');
      const results = await pedidosService.searchProductsWithStock(searchTerm, parseInt(limit) || 20);
      // Flutter expects 'products' key
      res.json({ success: true, products: (results || []).map((product) => stripMarginFromProduct(product, req.user)) });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /search-products: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/product-history/:productCode/:clientCode
  router.get('/product-history/:productCode/:clientCode', async (req, res) => {
    try {
      const { productCode, clientCode } = req.params;
      const clientAccess = await authorizePedidoClientScope(
        req,
        clientCode,
        req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
        'consultar historico de producto para',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
      const scopedClientCode = clientAccess.clientCode;

      // Query LACLAE for purchase history of this product by this client (3 years)
      const { queryWithParams } = require('../../../config/db');
      const currentYear = new Date().getFullYear();

      const sql = `
        SELECT
          L.LCAADC AS YEAR,
          L.LCMMDC AS MONTH,
          COALESCE(SUM(L.LCIMVT), 0) AS SALES,
          COALESCE(SUM(L.LCIMCT), 0) AS COST,
          COALESCE(SUM(L.LCCTUD), 0) AS UNITS
        FROM DSEDAC.LAC L
        WHERE TRIM(L.LCCDCL) = ?
          AND TRIM(L.CODIGOARTICULO) = ?
          AND L.LCAADC >= ?
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      `;

      const rows = await queryWithParams(sql, [scopedClientCode, productCode, currentYear - 2], false);

      // Group by year for Flutter's expected format
      const years = {};
      let grandTotalSales = 0;
      let grandTotalCost = 0;
      let grandTotalUnits = 0;

      for (const row of rows) {
        const year = String(row.YEAR);
        const month = parseInt(row.MONTH) || 0;
        const sales = parseFloat(row.SALES) || 0;
        const cost = parseFloat(row.COST) || 0;
        const units = parseFloat(row.UNITS) || 0;

        grandTotalSales += sales;
        grandTotalCost += cost;
        grandTotalUnits += units;

        if (!years[year]) {
          years[year] = { months: {} };
        }
        years[year].months[month] = {
          sales,
          cost,
          units,
          margin: sales - cost,
          marginPct: sales > 0 ? ((sales - cost) / sales * 100) : 0,
        };
      }

      // Add totals per year
      for (const year of Object.keys(years)) {
        const months = years[year].months;
        let ySales = 0, yCost = 0, yUnits = 0;
        for (const m of Object.values(months)) {
          ySales += m.sales || 0;
          yCost += m.cost || 0;
          yUnits += m.units || 0;
        }
        years[year].totals = {
          sales: ySales,
          cost: yCost,
          units: yUnits,
          margin: ySales - yCost,
          marginPct: ySales > 0 ? ((ySales - yCost) / ySales * 100) : 0,
          envases: 0, // Not available in LAC
          cajas: 0,   // Not available in LAC
        };
      }

      res.json(stripMarginFromProductHistory({
        success: true,
        years,
        grandTotal: {
          sales: grandTotalSales,
          cost: grandTotalCost,
          units: grandTotalUnits,
          margin: grandTotalSales - grandTotalCost,
          marginPct: grandTotalSales > 0 ? ((grandTotalSales - grandTotalCost) / grandTotalSales * 100) : 0,
          envases: 0,
          cajas: 0,
        },
      }, req.user));
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /product-history: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/analytics
  router.get('/analytics', async (req, res) => {
    try {
      const { vendedorCodes } = req.query;
      const pedidosService = require('../../../services/pedidos.service');
      const vendorScope = resolvePedidoVendorScope(req, vendedorCodes || 'ALL');
      if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      const vc = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : (vendedorCodes ? String(vendedorCodes).trim() : 'ALL');
      const analytics = await pedidosService.getOrderAnalytics(vc);
      res.json({ success: true, analytics });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /analytics: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // =============================================================================
  // ADDITIONAL MISSING ENDPOINTS (ported from legacy pedidos.js)
  // =============================================================================

  // GET /api/pedidos/families/detailed
  router.get('/families/detailed', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const families = await pedidosService.getFamiliesDetailed();
      res.json({ success: true, families });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /families/detailed: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/draft-status/:vendedorCode
  router.get('/draft-status/:vendedorCode', async (req, res) => {
    try {
      const code = String(req.params.vendedorCode || '').trim();
      const vendorAccess = authorizePedidoVendorCode(req, code, 'consultar borradores de');
      if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.checkDraftAccumulation(vendorAccess.vendedorCode);
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /draft-status: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // POST /api/pedidos/draft-status/:vendedorCode/auto-confirm
  router.post('/draft-status/:vendedorCode/auto-confirm', async (req, res) => {
    try {
      const code = String(req.params.vendedorCode || '').trim();
      const vendorAccess = authorizePedidoVendorCode(req, code, 'auto-confirmar');
      if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.checkDraftAccumulation(vendorAccess.vendedorCode, {
        autoConfirm: true,
        options: { userId: req.user?.code || req.user?.id || 'API' },
      });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /draft-status/auto-confirm: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/purchase-history-global
  router.get('/purchase-history-global', async (req, res) => {
    try {
      const userIsJefe = req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN';
      const userVendor = String(req.user?.code || req.user?.id || '').trim();

      const now = new Date();
      const defaultFrom = new Date(now.getFullYear(), 0, 1);
      const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
      const to = req.query.to ? new Date(String(req.query.to)) : now;

      let vendor = String(req.query.vendedorCode || '').trim();
      if (!userIsJefe) {
        // Igual que la ruta legacy: un comercial sin código autenticado no
        // puede consultar el histórico global de ningún vendedor.
        if (!userVendor) {
          return res.status(403).json({
            success: false,
            code: 'FORBIDDEN_VENDOR',
            error: 'COMERCIAL sin vendedor autenticado',
          });
        }
        vendor = userVendor;
      }
      const isAllVendor = !vendor || vendor.toUpperCase() === 'ALL';
      const clientCode = String(req.query.clientCode || '').trim();
      const productCode = String(req.query.productCode || '').trim();
      const familia = String(req.query.familia || '').trim();
      const marca = String(req.query.marca || '').trim();
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const offset = parseInt(req.query.offset) || 0;

      const dateRange = buildLaclaeDateRangeFilter('L', from, to);
      const filters = [
        `L.LCTPVT IN ('CC','VC') AND L.LCCLLN IN ('VT','AB')`,
        `L.LCSRAB NOT IN ('N','Z','G','D')`,
      ];
      const filterParams = [];

      if (!isAllVendor) {
        const vendors = vendor.split(',').map(v => v.trim()).filter(Boolean);
        if (vendors.length > 0 && vendors.length <= 50) {
          filters.push(`TRIM(L.LCCDVD) IN (${vendors.map(() => '?').join(',')})`);
          filterParams.push(...vendors);
        } else if (vendors.length > 50) {
          const safe = vendors
            .filter(v => /^[A-Za-z0-9]{1,10}$/.test(v))
            .map(v => `'${v.replace(/'/g, "''")}'`)
            .join(',');
          if (safe) filters.push(`TRIM(L.LCCDVD) IN (${safe})`);
        }
      }
      if (clientCode) { filters.push(`TRIM(L.LCCDCL) = ?`); filterParams.push(clientCode); }
      if (productCode) { filters.push(`TRIM(L.LCCDRF) = ?`); filterParams.push(productCode); }
      if (familia) { filters.push(`TRIM(L.LCCDRF) IN (SELECT TRIM(CODIGOARTICULO) FROM DSEDAC.ART WHERE TRIM(CODIGOFAMILIA) = ?)`); filterParams.push(familia); }
      if (marca) { filters.push(`TRIM(L.LCCDRF) IN (SELECT TRIM(CODIGOARTICULO) FROM DSEDAC.ART WHERE TRIM(CODIGOMARCA) = ?)`); filterParams.push(marca); }

      const whereSql = [dateRange.sql, ...filters].join(' AND ');
      const params = [...dateRange.params, ...filterParams];

      const detailSql = `
        SELECT L.LCAADC AS ANO, L.LCMMDC AS MES, L.LCDDDC AS DIA,
          TRIM(L.LCCDCL) AS CODIGOCLIENTE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) AS NOMBRECLIENTE,
          TRIM(L.LCCDVD) AS CODIGOVENDEDOR, TRIM(L.LCCDRF) AS CODIGOARTICULO,
          TRIM(A.DESCRIPCIONARTICULO) AS DESCRIPCIONARTICULO,
          L.LCCTUD AS CANTIDADUNIDADES, L.LCCTEV AS CANTIDADENVASES,
          L.LCPRVT AS PRECIOVENTA, L.LCPJDT AS PORCENTAJEDESCUENTO,
          L.LCIMVT AS IMPORTEVENTA, (L.LCCTUD * L.LCPRVT) AS IMPORTESINDESCUENTO,
          (L.LCCTUD * L.LCPRVT - L.LCIMVT) AS IMPORTEDESCUENTO,
          TRIM(L.LCCDFP) AS CODIGOFORMAPAGO,
          TRIM(L.LCSRAB) AS SERIEALBARAN, L.LCNRAB AS NUMEROALBARAN
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
        LEFT JOIN DSEDAC.CLI C ON C.CODIGOCLIENTE = L.LCCDCL
        WHERE ${whereSql}
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
        OFFSET ${offset} ROWS FETCH FIRST ${limit} ROWS ONLY`;

      const summarySql = `
        SELECT COUNT(*) AS NUM_LINEAS, COUNT(DISTINCT TRIM(L.LCCDCL)) AS NUM_CLIENTES,
          COUNT(DISTINCT TRIM(L.LCCDRF)) AS NUM_PRODUCTOS,
          COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENDIDO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT), 0) AS TOTAL_SIN_DESCUENTO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT - L.LCIMVT), 0) AS TOTAL_DESCUENTO,
          COALESCE(SUM(L.LCCTUD), 0) AS TOTAL_UNIDADES
        FROM DSED.LACLAE L WHERE ${whereSql}`;

      const topProductosSql = `
        SELECT TRIM(L.LCCDRF) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NAME,
          COALESCE(SUM(L.LCIMVT), 0) AS IMPORTE, COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
          COUNT(*) AS NUM_LINEAS
        FROM DSED.LACLAE L LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
        WHERE ${whereSql}
        GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
        ORDER BY IMPORTE DESC FETCH FIRST 10 ROWS ONLY`;

      const monthlyByYearSql = `
        SELECT L.LCAADC AS ANO, L.LCMMDC AS MES,
          COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENDIDO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT), 0) AS TOTAL_SIN_DESCUENTO,
          COALESCE(SUM(L.LCCTUD * L.LCPRVT - L.LCIMVT), 0) AS TOTAL_DESCUENTO,
          COALESCE(SUM(L.LCCTUD), 0) AS TOTAL_UNIDADES,
          COUNT(*) AS NUM_LINEAS
        FROM DSED.LACLAE L WHERE ${whereSql}
        GROUP BY L.LCAADC, L.LCMMDC ORDER BY L.LCAADC DESC, L.LCMMDC`;

      const lastYearFromDate = new Date(from);
      lastYearFromDate.setFullYear(from.getFullYear() - 1);
      const lastYearToDate = new Date(to);
      lastYearToDate.setFullYear(to.getFullYear() - 1);
      const lastYearDateRange = buildLaclaeDateRangeFilter('L', lastYearFromDate, lastYearToDate);
      const lastYearWhereSql = [lastYearDateRange.sql, ...filters].join(' AND ');
      const lastYearParams = [...lastYearDateRange.params, ...filterParams];
      const lastYearTotalSql = `
        SELECT COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_LAST_YEAR
        FROM DSED.LACLAE L WHERE ${lastYearWhereSql}`;

      const [detail, summary, topProducts, lastYear, monthlyByYear] = await Promise.all([
        queryWithParams(detailSql, params, false),
        queryWithParams(summarySql, params, false),
        queryWithParams(topProductosSql, params, false),
        queryWithParams(lastYearTotalSql, lastYearParams, false),
        queryWithParams(monthlyByYearSql, params, false),
      ]);

      const s = summary?.[0] || {};
      const totalThisPeriod = parseFloat(s.TOTAL_VENDIDO) || 0;
      const totalLastYear = parseFloat(lastYear?.[0]?.TOTAL_LAST_YEAR) || 0;
      const variation = totalLastYear > 0 ? ((totalThisPeriod - totalLastYear) / totalLastYear) * 100 : null;

      res.json({
        success: true,
        filters: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), vendedorCode: isAllVendor ? 'ALL' : vendor, clientCode: clientCode || null, productCode: productCode || null, familia: familia || null, marca: marca || null },
        summary: {
          numLineas: parseInt(s.NUM_LINEAS) || 0, numClientes: parseInt(s.NUM_CLIENTES) || 0, numProductos: parseInt(s.NUM_PRODUCTOS) || 0,
          totalVendido: totalThisPeriod, totalSinDescuento: parseFloat(s.TOTAL_SIN_DESCUENTO) || 0, totalDescuento: parseFloat(s.TOTAL_DESCUENTO) || 0, totalUnidades: parseFloat(s.TOTAL_UNIDADES) || 0,
          comparativaAnoAnterior: { totalAnoAnterior: totalLastYear, variacionPct: variation },
        },
        topProducts: (topProducts || []).map(t => ({ code: (t.CODE || '').trim(), name: (t.NAME || '').trim(), importe: parseFloat(t.IMPORTE) || 0, unidades: parseFloat(t.UNIDADES) || 0, numLineas: parseInt(t.NUM_LINEAS) || 0 })),
        lines: (detail || []).map(r => ({ fecha: `${r.ANO}-${String(r.MES).padStart(2, '0')}-${String(r.DIA).padStart(2, '0')}`, clienteCode: (r.CODIGOCLIENTE || '').trim(), clienteName: (r.NOMBRECLIENTE || '').trim(), vendedorCode: (r.CODIGOVENDEDOR || '').trim(), productCode: (r.CODIGOARTICULO || '').trim(), productName: (r.DESCRIPCIONARTICULO || '').trim(), cantidad: parseFloat(r.CANTIDADUNIDADES) || 0, envases: parseFloat(r.CANTIDADENVASES) || 0, precio: parseFloat(r.PRECIOVENTA) || 0, descuentoPct: parseFloat(r.PORCENTAJEDESCUENTO) || 0, importe: parseFloat(r.IMPORTEVENTA) || 0, importeSinDescuento: parseFloat(r.IMPORTESINDESCUENTO) || 0, importeDescuento: parseFloat(r.IMPORTEDESCUENTO) || 0, formaPago: (r.CODIGOFORMAPAGO || '').trim(), albaran: `${(r.SERIEALBARAN || '').trim()}-${r.NUMEROALBARAN || ''}` })),
        monthlyByYear: (monthlyByYear || []).map(r => ({ year: parseInt(r.ANO), month: parseInt(r.MES), totalVendido: parseFloat(r.TOTAL_VENDIDO) || 0, totalSinDescuento: parseFloat(r.TOTAL_SIN_DESCUENTO) || 0, totalDescuento: parseFloat(r.TOTAL_DESCUENTO) || 0, totalUnidades: parseFloat(r.TOTAL_UNIDADES) || 0, numLineas: parseInt(r.NUM_LINEAS) || 0 })),
        pagination: { limit, offset, hasMore: (detail || []).length === limit },
      });
    } catch (error) {
      const odbc0 = error.odbcErrors && error.odbcErrors[0];
      const odbcMsg = odbc0 ? `${odbc0.state} (${odbc0.code}): ${odbc0.message}` : '';
      logger.error(`[DDD-PEDIDOS] purchase-history-global ERROR: ${error.message}
  ODBC: ${odbcMsg}
  STACK: ${error.stack || ''}`);
      res.status(500).json({ success: false, error: 'Error obteniendo historico global', detail: process.env.NODE_ENV !== 'production' ? error.message : undefined, odbc: process.env.NODE_ENV !== 'production' ? odbcMsg : undefined });
    }
  });

  // POST /api/pedidos/complementary
  router.post('/complementary', async (req, res) => {
    try {
      const { productCodes, clientCode } = req.body;
      if (!productCodes || !Array.isArray(productCodes) || productCodes.length === 0) {
        return res.status(400).json({ success: false, error: 'productCodes array is required' });
      }
      let scopedClientCode = clientCode;
      if (clientCode) {
        const vendorAccess = authorizePedidoVendorCode(req, req.body.vendedorCode || req.query.vendedorCode || req.user?.code || req.user?.id, 'consultar productos complementarios para');
        if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);
        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendorAccess.vendedorCode, 'consultar productos complementarios para');
        if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);
        scopedClientCode = clientAccess.clientCode;
      }
      const pedidosService = require('../../../services/pedidos.service');
      const products = await pedidosService.getComplementaryProducts(productCodes, scopedClientCode);
      res.json({ success: true, products });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in POST /complementary: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/ (order list)
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { limit, offset, estado, status, vendedorCodes, dateFrom, dateTo, search, minAmount, maxAmount, sortBy, sortOrder } = req.query;
      const requestedVendedorCodes = vendedorCodes || userId;
      if (!canAccessVendedorCodes(req, requestedVendedorCodes)) {
        return res.status(403).json({ success: false, error: 'No autorizado para consultar esos vendedores', code: 'FORBIDDEN_VENDOR' });
      }
      const requestedStatus = status || estado;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const safeLimit = parseInt(limit, 10) || 20;
      const safeOffset = offset != null
        ? parseInt(offset, 10) || 0
        : (page - 1) * safeLimit;
      const vendorScopeKey = String(requestedVendedorCodes || '').trim();
      const cacheKey = `ddd:orders-list:${userId}:${vendorScopeKey}:${safeLimit}:${safeOffset}:${requestedStatus || 'all'}:${search || ''}:${dateFrom || ''}:${dateTo || ''}:${minAmount || ''}:${maxAmount || ''}:${sortBy || ''}:${sortOrder || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ORDER_HISTORY, async () => {
        const pedidosService = require('../../../services/pedidos.service');
        const result = await pedidosService.getOrders({
          vendedorCodes: requestedVendedorCodes,
          limit: safeLimit,
          offset: safeOffset,
          status: requestedStatus ? String(requestedStatus).trim() : undefined,
          dateFrom: dateFrom ? String(dateFrom).trim() : undefined,
          dateTo: dateTo ? String(dateTo).trim() : undefined,
          search: search ? String(search).trim() : undefined,
          minAmount: minAmount != null ? parseFloat(minAmount) : undefined,
          maxAmount: maxAmount != null ? parseFloat(maxAmount) : undefined,
          sortBy: sortBy ? String(sortBy).trim() : undefined,
          sortOrder: sortOrder ? String(sortOrder).trim() : undefined,
          forceRefresh: isForceRefreshRequest(req),
        });
        const orders = Array.isArray(result) ? result : (result.orders || []);
        const count = Array.isArray(result) ? result.length : (result.count || orders.length);
        return { success: true, orders, count };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/delivery-options
  router.get('/delivery-options', async (req, res) => {
    try {
      const clientCode = req.query.clientCode ? String(req.query.clientCode).trim() : '';
      const vendedorCode = req.query.vendedorCode ? String(req.query.vendedorCode).trim() : '';
      const deliveryDate = req.query.deliveryDate ? String(req.query.deliveryDate).trim() : undefined;

      if (!clientCode || !vendedorCode) {
        return res.status(400).json({ success: false, error: 'clientCode and vendedorCode are required' });
      }

      const vendorAccess = authorizePedidoVendorCode(req, vendedorCode, 'consultar opciones de reparto para');
      if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);
      const clientAccess = await authorizePedidoClientScope(req, clientCode, vendorAccess.vendedorCode, 'consultar opciones de reparto para');
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      const pedidosService = require('../../../services/pedidos.service');
      const options = await pedidosService.getDeliveryOptions({ clientCode: clientAccess.clientCode, vendedorCode: vendorAccess.vendedorCode, deliveryDate });
      res.json({ success: true, options });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /delivery-options: ${error.message}`);
      const status = error.message.includes('Fecha reparto') ? 409 : 500;
      res.status(status).json({ success: false, error: publicErrorMessageForStatus(error, status) });
    }
  });

  // GET /api/pedidos/available-vehicles
  // Flutter calls this while confirming an order with manual truck assignment.
  router.get('/available-vehicles', async (req, res) => {
    try {
      const pedidosService = require('../../../services/pedidos.service');
      const vehicles = await pedidosService.getAvailableVehicles();
      res.json({ success: true, vehicles });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /available-vehicles: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get("/client-evolution/:clientCode", async (req, res) => {
    try {
      const clientCode = String(req.params.clientCode || "").trim().substring(0, 10);
      const vendedorCodes = req.query.vendedorCodes || req.query.vendorCodes || "ALL";
      if (!clientCode) return res.status(400).json({ success: false, error: "clientCode requerido" });
      const vendorScope = resolvePedidoVendorScope(req, vendedorCodes);
      if (!vendorScope.ok) return res.status(403).json({ success: false, error: vendorScope.error });
      const clientVendorFilter = buildClientVendorParamFilter(vendorScope.codes, "CLI");
      const laclaeVendorFilter = buildLaclaeVendorParamFilter(vendorScope.codes, "L");
      const clientCheckSql = ['SELECT 1 FROM DSEDAC.CLI CLI WHERE TRIM(CLI.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))', clientVendorFilter.clause, 'FETCH FIRST 1 ROWS ONLY'].join(' ');
      const clientCheck = await queryWithParams(clientCheckSql, [clientCode, ...clientVendorFilter.params]);
      if (!clientCheck || clientCheck.length === 0) return res.status(403).json({ success: false, error: "No tienes acceso a este cliente", message: "Cliente no encontrado o no tienes permiso para verlo" });
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - 2;
      const cacheSecurityScope = buildCacheSecurityScope(req, { includeMargin: false });
      const cacheKey = `ddd:client-evolution:${cacheSecurityScope}:${clientCode}:${vendorScope.codes.join(',') || 'ALL'}:${startYear}:${currentYear}`;
      await withCache(cache, cacheKey, TTL_MS.CLIENT_EVOLUTION, async () => {
        const monthlyDataSql = ['SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH, SUM(L.LCIMVT) AS SALES, SUM(L.LCCTUD) AS UNITS FROM DSED.LACLAE L WHERE TRIM(L.LCCDCL) = CAST(? AS VARCHAR(10)) AND L.LCAADC >= ? AND L.LCTPVT IN (?, ?) AND L.LCCLLN IN (?, ?)', laclaeVendorFilter.clause, 'GROUP BY L.LCAADC, L.LCMMDC ORDER BY L.LCAADC ASC, L.LCMMDC ASC'].join(' ');
        const topProductsDataSql = ['SELECT TRIM(L.LCCDRF) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NAME, SUM(L.LCIMVT) AS TOTAL_SALES, SUM(L.LCCTUD) AS TOTAL_UNITS FROM DSED.LACLAE L LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO WHERE TRIM(L.LCCDCL) = CAST(? AS VARCHAR(10)) AND L.LCAADC >= ? AND L.LCTPVT IN (?, ?) AND L.LCCLLN IN (?, ?)', laclaeVendorFilter.clause, 'GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO) ORDER BY TOTAL_SALES DESC FETCH FIRST 20 ROWS ONLY'].join(' ');
        const returnsDataSql = ['SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH, TRIM(L.LCCDRF) AS PRODUCT_CODE, TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME, SUM(L.LCCTUD) AS UNITS, SUM(L.LCIMVT) AS AMOUNT FROM DSED.LACLAE L LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO WHERE TRIM(L.LCCDCL) = CAST(? AS VARCHAR(10)) AND L.LCAADC >= ? AND (L.LCSRAB = ? OR L.LCTPVT = ?)', laclaeVendorFilter.clause, 'GROUP BY L.LCAADC, L.LCMMDC, TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO) ORDER BY YEAR DESC, MONTH DESC, AMOUNT DESC FETCH FIRST 50 ROWS ONLY'].join(' ');
        const [monthlyData, topProductsData, returnsData] = await Promise.all([
          queryWithParams(monthlyDataSql, [clientCode, startYear, "CC", "VC", "AB", "VT", ...laclaeVendorFilter.params]),
          queryWithParams(topProductsDataSql, [clientCode, currentYear - 1, "CC", "VC", "AB", "VT", ...laclaeVendorFilter.params]),
          queryWithParams(returnsDataSql, [clientCode, startYear, "D", "DV", ...laclaeVendorFilter.params]),
        ]);

        return {
          success: true,
          years: [startYear, startYear + 1, currentYear],
          monthlySales: monthlyData.map((r) => ({ year: r.YEAR, month: r.MONTH, sales: parseFloat(r.SALES), units: parseFloat(r.UNITS) })),
          topProducts: topProductsData.map((r) => ({ code: r.CODE, name: r.NAME, totalSales: parseFloat(r.TOTAL_SALES), totalUnits: parseFloat(r.TOTAL_UNITS) })),
          returns: returnsData.map((r) => ({ year: r.YEAR, month: r.MONTH, productCode: r.PRODUCT_CODE, productName: r.PRODUCT_NAME, units: parseFloat(r.UNITS), amount: parseFloat(r.AMOUNT) }))
        };
      }, res, req);
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /client-evolution/:clientCode: ${error.message}`);
      res.status(500).json({ success: false, error: "Error getting client evolution" });
    }
  });

  // GET /api/pedidos/:id  - SOLO numerico para no capturar rutas como
  // /purchase-history-global, /draft-status/:vendedorCode, etc.
  router.get('/:id([0-9]+)', async (req, res) => {
    try {
      const { id } = req.params;
      const requestedVendorRaw = req.query.vendedorCode || req.query.vendedorCodes;
      if (requestedVendorRaw) {
        const requestedVendor = normalizePedidoCode(String(requestedVendorRaw).split(',')[0]);
        const vendorAccess = authorizePedidoVendorCode(req, requestedVendor, 'consultar');
        if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);
      }
      const ownership = await authorizePedidoMutation(req, id, 'consultar');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      if (requestedVendorRaw) {
        const requestedVendor = normalizePedidoCode(String(requestedVendorRaw).split(',')[0]);
        const orderVendor = normalizePedidoCode(ownership.ownership?.vendedorCode);
        if (!salesCodesMatch(orderVendor, requestedVendor)) {
          return res.status(403).json(
            dddForbiddenBody('FORBIDDEN_VENDOR', 'vendedorCode no coincide con el pedido solicitado'),
          );
        }
      }
      const order = await repo.getOrderById(id);
      if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
      res.json({ success: true, order: stripMarginFromOrder(order, req.user) });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // POST /api/pedidos/create
  router.post('/create', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, clientName, vendedorCode, lines, observations, observaciones, tipoventa, almacen, tarifa, formaPago } = req.body;
      // Use explicit vendedorCode from body, fallback to userId (the logged-in user)
      const actualVendedor = normalizePedidoMutationVendorCode(vendedorCode, userId);

      if (!canAccessVendedorCodes(req, actualVendedor)) {
        return res.status(403).json({ success: false, error: 'No autorizado para crear pedidos de otro vendedor', code: 'FORBIDDEN_VENDOR' });
      }

      if (!clientCode || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, error: 'clientCode and lines are required' });
      }

      const vendorAccess = authorizePedidoVendorCode(req, actualVendedor, 'crear pedidos para');
      if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);
      const clientAccess = await authorizePedidoClientScope(req, clientCode, vendorAccess.vendedorCode, 'crear pedidos para');
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      const pedidosService = require('../../../services/pedidos.service');
      const normalizedSaleType = pedidosService.normalizePedidoSaleType(tipoventa || 'CC');
      const idempotencyKey = pedidosService.ensurePedidoIdempotencyKeyFromRequest(req);
      const result = await pedidosService.createOrder({
        clientCode: clientAccess.clientCode,
        clientName: clientName ? String(clientName).trim() : '',
        vendedorCode: vendorAccess.vendedorCode,
        tipoventa: normalizedSaleType,
        almacen: almacen == null || String(almacen || '').trim() === '' ? undefined : parseInt(almacen, 10),
        tarifa: tarifa == null || String(tarifa || '').trim() === '' ? undefined : parseInt(tarifa, 10),
        formaPago: formaPago == null ? undefined : String(formaPago).trim(),
        observaciones: observations || observaciones || '',
        lines: lines,
        origen: 'A',
        idempotencyKey,
      });

      // Invalidate related caches
      cache.invalidatePattern(`ddd:products:`);
      invalidateCommercialOrderCaches(cache, { clientCode: clientAccess.clientCode });

      const normalized = normalizeOrderResponse(result);
      if (result.idempotent) {
        return res.status(200).json({ success: true, idempotent: true, ...normalized });
      }
      res.status(201).json({ success: true, ...normalized });
    } catch (error) {
      if (error.code === 'INVALID_IDEMPOTENCY_KEY') {
        return res.status(400).json({ success: false, code: error.code, error: error.message });
      }
      if (error.code === 'IDEMPOTENCY_CONFLICT') {
        return res.status(409).json({ success: false, code: error.code, error: error.message });
      }
      if (error.code === 'IDEMPOTENCY_UNAVAILABLE') {
        return res.status(503).json({ success: false, code: error.code, error: error.message });
      }
      if (error.code === 'INVALID_SALE_TYPE') {
        return res.status(400).json({ success: false, code: error.code, error: error.message });
      }
      logger.error(`[DDD-PEDIDOS] Error in POST /create: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // PUT /api/pedidos/:id/confirm
  router.put('/:id/confirm', async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { saleType, deliveryDate, vehicleCode, driverCode, routeCode } = req.body || {};
      const pedidosService = require('../../../services/pedidos.service');
      let normalizedSaleType;
      try {
        normalizedSaleType = pedidosService.normalizePedidoSaleType(saleType);
      } catch (saleTypeErr) {
        return res.status(400).json({ success: false, error: saleTypeErr.message, code: saleTypeErr.code || 'INVALID_SALE_TYPE' });
      }
      const ownership = await authorizePedidoMutation(req, id, 'confirmar');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);

      const result = await pedidosService.confirmOrder(parseInt(id), normalizedSaleType, {
        forceConfirm: canUseServerForceConfirm(req, req.body || {}),
        forceConfirmReason: String(req.body?.forceConfirmReason || req.body?.auditReason || '').trim(),
        adminOverride: canUseServerForceConfirm(req, req.body || {}),
        userRole: req.user?.role || 'COMERCIAL',
        userId,
        deliveryDate: deliveryDate ? String(deliveryDate).trim() : undefined,
        vehicleCode: vehicleCode ? String(vehicleCode).trim() : undefined,
        driverCode: driverCode ? String(driverCode).trim() : undefined,
        routeCode: routeCode ? String(routeCode).trim() : undefined,
      });

      if (result && result.blocked) {
        const blockedCode = result.code || result.reason || (
          result.deficit !== undefined || result.saldoBolsa !== undefined
            ? 'BOLSA_INSUFICIENTE'
            : 'STOCK_INSUFICIENTE'
        );
        const payload = {
          success: false,
          blocked: true,
          reason: result.reason,
          code: blockedCode,
          message: result.message,
        };
        if (blockedCode === 'BOLSA_INSUFICIENTE') {
          if (result.deficit !== undefined) payload.deficit = result.deficit;
          if (result.saldoBolsa !== undefined) payload.saldoBolsa = result.saldoBolsa;
          if (result.warnings !== undefined) payload.warnings = result.warnings;
        } else {
          if (result.stockWarnings !== undefined) payload.stockWarnings = result.stockWarnings;
          if (result.alternatives !== undefined) payload.alternatives = result.alternatives;
        }
        return res.status(409).json(payload);
      }

      invalidateCommercialOrderCaches(cache, { clientCode: ownership.ownership?.clientCode });

      const normalized = normalizeOrderResponse(result);
      res.json({ success: true, ...normalized });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/confirm: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al confirmar pedido', fallbackCode: 'PEDIDO_CONFIRM_ERROR' });
    }
  });

  // PUT /api/pedidos/:id/lines
  router.put('/:id/lines', async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = await authorizePedidoMutation(req, id, 'modificar lineas de');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const validation = validateDddOrderLinePayload(req.body || {});
      if (!validation.ok) return res.status(validation.status).json(validation.body);
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.addOrderLine(parseInt(id), validation.payload);
      invalidateOrderListCaches(cache);
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/lines: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al añadir línea de pedido', fallbackCode: 'PEDIDO_LINE_ADD_ERROR' });
    }
  });

  // PUT /api/pedidos/:id/lines/:lineId
  router.put('/:id/lines/:lineId', async (req, res) => {
    try {
      const { id, lineId } = req.params;
      const ownership = await authorizePedidoMutation(req, id, 'modificar lineas de');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require('../../../services/pedidos.service');
      // Contrato del servicio: updateOrderLine(lineId, payload).
      const result = await pedidosService.updateOrderLine(parseInt(lineId), req.body);
      invalidateOrderListCaches(cache);
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/lines/:lineId: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al modificar línea de pedido', fallbackCode: 'PEDIDO_LINE_UPDATE_ERROR' });
    }
  });

  // PUT /api/pedidos/:id/lines/:lineId/delete
  router.put('/:id/lines/:lineId/delete', async (req, res) => {
    try {
      const { id, lineId } = req.params;
      const ownership = await authorizePedidoMutation(req, id, 'eliminar lineas de');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require('../../../services/pedidos.service');
      // Contrato del servicio: deleteOrderLine(lineId, pedidoId).
      const result = await pedidosService.deleteOrderLine(parseInt(lineId), parseInt(id));
      invalidateOrderListCaches(cache);
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/lines/:lineId/delete: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al eliminar línea de pedido', fallbackCode: 'PEDIDO_LINE_DELETE_ERROR' });
    }
  });

  router.delete("/:id/lines/:lineId", async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const lineId = Number.parseInt(req.params.lineId, 10);
      if (!Number.isFinite(id) || !Number.isFinite(lineId)) return res.status(400).json({ success: false, error: "Invalid order or line id" });
      const ownership = await authorizePedidoMutation(req, id, "eliminar lineas de");
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require("../../../services/pedidos.service");
      const result = await pedidosService.deleteOrderLine(lineId, id);
      invalidateOrderListCaches(cache);
      res.json({ success: true, line: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in DELETE /:id/lines/:lineId: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al eliminar línea de pedido', fallbackCode: 'PEDIDO_LINE_DELETE_ERROR' });
    }
  });

  // PUT /api/pedidos/:id/status
  router.put('/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, status, userId } = req.body;
      const nextEstado = estado || status;
      if (!nextEstado) return res.status(400).json({ success: false, error: 'estado required' });
      const ownership = await authorizePedidoMutation(req, id, 'cambiar estado de');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);

      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.updateOrderStatus(parseInt(id), nextEstado, { userId: userId || req.user?.code });
      invalidateCommercialOrderCaches(cache, { clientCode: ownership.ownership?.clientCode });
      const normalized = normalizeOrderResponse(result);
      res.json({ success: true, ...normalized });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/status: ${error.message}`);
      const statusCode = error.code === 'ORDER_NOT_FOUND' ? 404
        : error.code === 'INVALID_ORDER_STATUS' ? 400
          : error.code === 'INVALID_ORDER_TRANSITION' ? 409
            : 500;
      res.status(statusCode).json({ success: false, error: publicErrorMessageForStatus(error, statusCode), code: error.code });
    }
  });

  // PUT /api/pedidos/:id/cancel
  router.put('/:id/cancel', async (req, res) => {
    try {
      const { id } = req.params;
      const numericId = parseInt(id);
      if (isNaN(numericId)) {
        return res.status(400).json({ success: false, error: 'Invalid order ID' });
      }
      const ownership = await authorizePedidoMutation(req, numericId, 'eliminar borrador');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require('../../../services/pedidos.service');
      const result = await pedidosService.cancelOrder(numericId, { userId: req.user?.code });
      invalidateCommercialOrderCaches(cache, { clientCode: ownership.ownership?.clientCode });
      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in PUT /:id/cancel: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al eliminar borrador', fallbackCode: 'PEDIDO_DELETE_DRAFT_ERROR' });
    }
  });

  // GET /api/pedidos/:id/clone
  router.get('/:id/clone', async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = await authorizePedidoMutation(req, id, 'clonar');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require('../../../services/pedidos.service');
      const order = await pedidosService.cloneOrder(parseInt(id));
      res.json({ success: true, order: stripMarginFromOrder(order, req.user) });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id/clone: ${error.message}`);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({ success: false, error: publicErrorMessageForStatus(error, statusCode) });
    }
  });

  // GET /api/pedidos/:id/albaran
  router.get('/:id/albaran', async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = await authorizePedidoMutation(req, id, 'consultar albaran de');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require('../../../services/pedidos.service');
      const albaranes = await pedidosService.getOrderAlbaran(parseInt(id));
      res.json({ success: true, albaranes });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id/albaran: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // GET /api/pedidos/:id/pdf
  router.get('/:id/pdf', async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = await authorizePedidoMutation(req, id, 'generar PDF de');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);
      const pedidosService = require('../../../services/pedidos.service');
      const pdf = await pedidosService.generateOrderPdf(parseInt(id));
      res.json({ success: true, pdf });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in GET /:id/pdf: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // DELETE /api/pedidos/:id
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
      const ownership = await authorizePedidoMutation(req, id, 'eliminar');
      if (!ownership.ok) return res.status(ownership.status).json(ownership.body);

      const result = await repo.deleteOrder({ orderId: id, userId });
      invalidateCommercialOrderCaches(cache, { clientCode: ownership.ownership?.clientCode });
      res.json({ success: true, order: result });
    } catch (error) {
      logger.error(`[DDD-PEDIDOS] Error in DELETE /:id: ${error.message}`);
      return sendPedidosMutationError(res, error, { fallbackMessage: 'Error interno al eliminar pedido', fallbackCode: 'PEDIDO_DELETE_ERROR' });
    }
  });

  return router;
}

async function getCobrosCreditLimit(clientCode) {
  const code = String(clientCode || '').trim();
  if (!code) return 0;
  try {
    const columnRows = await queryWithParams(
      `SELECT COLUMN_NAME
         FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        FETCH FIRST 1 ROW ONLY`,
      ['DSEDAC', 'CLI', 'LIMITECREDITO'],
      false,
      false,
    );
    const hasLimiteCredito = (columnRows || []).some((row) => String(row.COLUMN_NAME || '').trim() === 'LIMITECREDITO');
    if (!hasLimiteCredito) return 0;
    const cliRows = await queryWithParams(
      `SELECT LIMITECREDITO
         FROM DSEDAC.CLI
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROW ONLY`,
      [code],
      false,
      false,
    );
    return parseFloat(cliRows?.[0]?.LIMITECREDITO) || 0;
  } catch (error) {
    logger.warn(`[DDD-COBROS] limiteCredito lookup skipped for ${code}: ${error.message}`);
    return 0;
  }
}

// =============================================================================
// COBROS ROUTES (DDD) — with caching
// =============================================================================
function createCobrosRoutes() {
  const router = express.Router();
  const repo = new Db2CobrosRepository(getDbPool());
  const cache = getCache();

  const cobrosContext = (req, scopedVendorCodes = null, extra = {}) => ({
    userId: req.user?.code || req.user?.id,
    userRole: req.user?.role || 'COMERCIAL',
    isJefeVentas: req.user?.isJefeVentas === true || req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN',
    vendedorCodes: scopedVendorCodes || req.user?.vendedorCodes || req.user?.vendorCodes,
    vendorCodes: scopedVendorCodes || req.user?.vendorCodes || req.user?.vendedorCodes,
    ...extra,
  });

  const cobrosCacheScope = (req) => {
    const role = req.user?.role || 'COMERCIAL';
    const userId = req.user?.code || req.user?.id || 'anonymous';
    const visible = req.user?.vendorCodes || req.user?.vendedorCodes || [];
    const visibleScope = Array.isArray(visible) ? visible.join(',') : String(visible || '');
    return `${role}:${userId}:${visibleScope}`;
  };

  const parseCobrosPagination = (queryParams = {}) => {
    const requestedLimit = parseInt(queryParams.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 2000) : 100;
    const requestedOffset = parseInt(queryParams.offset, 10);
    const hasOffset = Number.isFinite(requestedOffset);
    const offset = hasOffset ? Math.max(requestedOffset, 0) : null;
    const requestedPage = parseInt(queryParams.page, 10);
    const page = hasOffset ? Math.floor(offset / limit) + 1 : (Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1);
    return { limit, page, offset: hasOffset ? offset : (page - 1) * limit };
  };

  const cobrosQueryFilters = (query = {}) => ({
    tipoDocumento: normalizeCvcTipoDocumentoFilter(query.tipoDocumento).join(','),
    fechaDesde: String(query.fechaDesde || '').trim(),
    fechaHasta: String(query.fechaHasta || '').trim(),
  });

  const cobrosFiltersCacheKey = (filters = {}) => [
    `tipo=${filters.tipoDocumento || ''}`,
    `desde=${filters.fechaDesde || ''}`,
    `hasta=${filters.fechaHasta || ''}`,
  ].join(':');

  const selectedCobrosVendorScope = (req) =>
    req.query.vendedorCodes || req.query.vendedorCode || 'ALL';

  const isCobrosForceRefresh = (req) =>
    req.query.forceRefresh != null || req.query.refresh != null || req.query._ts != null;

  const sendCobrosCached = async (req, res, cacheKey, ttl, fetchFn) => {
    if (isCobrosForceRefresh(req)) {
      res.set('Cache-Control', 'no-store');
      return res.json(await fetchFn());
    }
    return withCache(cache, cacheKey, ttl, fetchFn, res);
  };

  const sendCobrosError = (res, error) => {
    const status = Number(error.status) ||
      (error.code === 'INVALID_IDEMPOTENCY_TOKEN' ? 400 :
        error.code === 'INVALID_PAYMENT_PAYLOAD' ? 400 :
          error.code === 'OVERRIDE_REASON_REQUIRED' ? 400 :
            error.code === 'FORBIDDEN_VENDOR' ? 403 :
              error.code === 'FORBIDDEN_CLIENT_VENDOR' ? 403 :
                error.code === 'ORDER_NOT_FOUND_FOR_PAYMENT' ? 404 :
                  error.code === 'IDEMPOTENCY_CONFLICT' ? 409 :
                    error.code === 'OVERPAY_NOT_ALLOWED' ? 409 :
                      error.code === 'PAYMENT_ALREADY_REGISTERED' ? 409 : 500);
    return res.status(status).json({
      success: false,
      error: publicErrorMessageForStatus(error, status),
      code: error.code || 'COBROS_ERROR',
    });
  };

  router.get('/:codigoCliente/pendientes', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      if (!codigoCliente) return res.status(400).json({ success: false, error: 'codigoCliente required' });
      const selectedVendorScope = selectedCobrosVendorScope(req);
      const clientAccess = await authorizeCobrosClientScope(
        req,
        codigoCliente,
        selectedVendorScope,
        'consultar cobros de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      const filters = cobrosQueryFilters(req.query);
      const scopeKey = (clientAccess.vendorCodes || []).join(',') || String(selectedVendorScope || 'ALL');
      const cacheKey = `ddd:cobros:pendientes:${clientAccess.clientCode}:${cobrosCacheScope(req)}:${scopeKey}:${cobrosFiltersCacheKey(filters)}`;
      await sendCobrosCached(req, res, cacheKey, TTL_MS.PENDIENTES, async () => {
        const pendientes = await repo.getPendientes(
          clientAccess.clientCode,
          cobrosContext(req, clientAccess.vendorCodes, filters),
        );
        const resumen = pendientes.resumen || { totalPendiente: 0 };
        const totalPendiente = parseFloat(resumen.totalPendiente) || 0;
        return {
          success: true,
          cobros: pendientes.cobros || [],
          resumen: {
            ...resumen,
            totalPendiente,
            total: resumen.total ?? totalPendiente,
          },
          pendientes
        };
      });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /pendientes: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/:codigoCliente/estado', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      if (!codigoCliente) return res.status(400).json({ success: false, error: 'codigoCliente required' });
      const selectedVendorScope = selectedCobrosVendorScope(req);
      const clientAccess = await authorizeCobrosClientScope(
        req,
        codigoCliente,
        selectedVendorScope,
        'consultar estado de cobros de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      // Misma caché corta que /pendientes: la consulta CVC por cliente es la
      // misma y en frío puede tardar decenas de segundos (scan con TRIM()).
      // Sin caché, cada /estado repetía esa query completa.
      const scopeKey = (clientAccess.vendorCodes || []).join(',') || String(selectedVendorScope || 'ALL');
      const cacheKey = `ddd:cobros:estado:${clientAccess.clientCode}:${cobrosCacheScope(req)}:${scopeKey}`;
      await sendCobrosCached(req, res, cacheKey, TTL_MS.PENDIENTES, async () => {
        const clientCode = clientAccess.clientCode;
        const pendientes = await repo.getPendientes(clientCode, cobrosContext(req, clientAccess.vendorCodes));
        const totalPendiente = parseFloat(pendientes?.resumen?.totalPendiente) || 0;
        const limiteCredito = Number.isFinite(parseFloat(pendientes?.resumen?.limiteCredito))
          ? parseFloat(pendientes.resumen.limiteCredito)
          : await getCobrosCreditLimit(clientCode);
        return {
          success: true,
          estadoCliente: {
            codigo: clientCode,
            nombre: '',
            limiteCredito,
            totalPendiente,
            diasMora: 0,
            estado: totalPendiente > 0 ? 'EN_ROJO' : 'ACTIVO',
            motivo: totalPendiente > 0 ? 'Tiene cobros pendientes' : null
          }
        };
      });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /estado: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo estado de cobros',
        code: 'COBROS_ESTADO_ERROR',
      });
    }
  });

  router.post('/:codigoCliente/registrar', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { referencia, importe, formaPago, observaciones, idempotencyToken, allowOverpay, overrideReason } = req.body;
      if (!codigoCliente || importe == null || !formaPago) {
        return res.status(400).json({ success: false, error: 'codigoCliente, importe, and formaPago required' });
      }
      const clientAccess = await authorizeCobrosClientScope(
        req,
        codigoCliente,
        req.body.vendedorCodes || req.body.vendedorCode || req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
        'registrar cobros de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      const result = await repo.registerPayment({
        clientCode: clientAccess.clientCode,
        amount: parseFloat(importe) || 0,
        paymentMethod: formaPago,
        reference: referencia || '',
        observations: observaciones || '',
        userId,
        userRole: req.user?.role || 'COMERCIAL',
        isJefeVentas: req.user?.isJefeVentas === true,
        idempotencyToken,
        allowOverpay: allowOverpay === true,
        overrideReason: overrideReason || '',
      });

      cache.invalidatePattern(`ddd:cobros:pendientes:${clientAccess.clientCode}:`);
      cache.invalidatePattern(`ddd:cobros:estado:${clientAccess.clientCode}:`);
      cache.invalidatePattern(`ddd:cobros:historico:${clientAccess.clientCode}:`);
      cache.invalidatePattern('ddd:cobros:pending-summary:');

      res.json({ success: true, mensaje: 'Cobro registrado correctamente', payment: result });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in POST /:codigoCliente/registrar: ${error.message}`);
      sendCobrosError(res, error);
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const userId = req.user?.code || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { clientCode, amount, paymentMethod, reference, observations, idempotencyToken, allowOverpay, overrideReason } = req.body;
      if (!clientCode || !amount || !paymentMethod) {
        return res.status(400).json({ success: false, error: 'clientCode, amount, and paymentMethod required' });
      }
      const clientAccess = await authorizeCobrosClientScope(
        req,
        clientCode,
        req.body.vendedorCodes || req.body.vendedorCode || req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
        'registrar cobros de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      const result = await repo.registerPayment({
        clientCode: clientAccess.clientCode,
        amount,
        paymentMethod,
        reference,
        observations,
        userId,
        userRole: req.user?.role || 'COMERCIAL',
        isJefeVentas: req.user?.isJefeVentas === true,
        idempotencyToken,
        allowOverpay: allowOverpay === true,
        overrideReason: overrideReason || '',
      });

      // Invalidate cobros caches
      cache.invalidatePattern(`ddd:cobros:pendientes:${clientAccess.clientCode}:`);
      cache.invalidatePattern(`ddd:cobros:estado:${clientAccess.clientCode}:`);
      cache.invalidatePattern(`ddd:cobros:historico:${clientAccess.clientCode}:`);
      cache.invalidatePattern('ddd:cobros:pending-summary:');

      res.json({ success: true, payment: result });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in POST /register: ${error.message}`);
      sendCobrosError(res, error);
    }
  });

  // GET /api/cobros/pending-summary/:vendedorCode
  // Returns total pending amounts grouped by client for given vendor(s)
  router.get('/pending-summary/:vendedorCode', async (req, res) => {
    try {
      const vendedorCodeParam = req.params.vendedorCode;
      logger.info(`[COBROS] Pending summary for vendor: ${vendedorCodeParam}`);
      const pagination = parseCobrosPagination(req.query);
      const filters = cobrosQueryFilters(req.query);
      const cacheKey = `ddd:cobros:pending-summary:${String(vendedorCodeParam || '').trim()}:${cobrosCacheScope(req)}:${cobrosFiltersCacheKey(filters)}:limit:${pagination.limit}:page:${pagination.page}:offset:${pagination.offset}`;
      await sendCobrosCached(req, res, cacheKey, TTL_MS.PENDIENTES, async () => {
        const result = await repo.getPendingSummary(vendedorCodeParam, {
          ...cobrosContext(req),
          ...filters,
          ...pagination,
        });
        return { success: true, ...result };
      });
    } catch (error) {
      logger.error(`[COBROS] Error pending-summary: ${error.message}`);
      sendCobrosError(res, error);
    }
  });

  router.get('/:codigoCliente/historico', async (req, res) => {
    try {
      const { codigoCliente } = req.params;
      const { limit, offset } = req.query;
      const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 20));
      const safeOffset = Math.max(0, parseInt(offset) || 0);
      const selectedVendorScope = selectedCobrosVendorScope(req);
      const clientAccess = await authorizeCobrosClientScope(
        req,
        codigoCliente,
        selectedVendorScope,
        'consultar historico de cobros de',
      );
      if (!clientAccess.ok) return res.status(clientAccess.status).json(clientAccess.body);

      const scopeKey = (clientAccess.vendorCodes || []).join(',') || String(selectedVendorScope || 'ALL');
      const cacheKey = `ddd:cobros:historico:${clientAccess.clientCode}:${cobrosCacheScope(req)}:${scopeKey}:${safeLimit}:${safeOffset}`;
      await sendCobrosCached(req, res, cacheKey, TTL_MS.COBROS_HISTORICO, async () => {
        const historico = await repo.getHistorico({
          clientCode: clientAccess.clientCode,
          limit: safeLimit,
          offset: safeOffset
        });
        return { success: true, historico };
      });
    } catch (error) {
      logger.error(`[DDD-COBROS] Error in GET /historico: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  return router;
}

// =============================================================================
// ENTREGAS ROUTES (DDD) — with caching
// =============================================================================
function createEntregasRoutes() {
  const router = express.Router();
  const repo = new Db2EntregasRepository(getDbPool());
  const cache = getCache();

  const isPrivileged = (req) =>
    req.user?.isJefeVentas ||
    req.user?.role === 'JEFE_VENTAS' ||
    req.user?.role === 'ADMIN';

  async function canAccessAlbaran(req, albaranId) {
    if (isPrivileged(req)) return true;
    const repartidorId = req.user?.code || req.user?.id;
    if (!repartidorId) return false;
    const albaranes = await repo.getAlbaranes({ repartidorId });
    return albaranes.some((albaran) =>
      String(albaran.id || albaran.number || '').trim() ===
      String(albaranId || '').trim()
    );
  }

  router.get('/albaranes', async (req, res) => {
    try {
      const repartidorId = req.user?.code || req.query.repartidorId;
      if (!repartidorId) return res.status(400).json({ success: false, error: 'repartidorId required' });

      const { date, status } = req.query;
      const cacheKey = `ddd:albaranes:${repartidorId}:${date || ''}:${status || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ALBARANES, async () => {
        const albaranes = await repo.getAlbaranes({ repartidorId, date, status });
        return { success: true, albaranes };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /albaranes: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/albaranes/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!await canAccessAlbaran(req, id)) {
        return res.status(403).json({
          success: false,
          error: 'No tienes permisos para consultar esta entrega',
        });
      }
      const cacheKey = `ddd:albaran:${id}`;
      await withCache(cache, cacheKey, TTL_MS.ALBARAN_DETAIL, async () => {
        const albaran = await repo.getAlbaranDetail(id);
        if (!albaran) return { success: false, error: 'Albaran not found' };
        return { success: true, albaran };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /albaranes/:id: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.post('/albaranes/:id/deliver', async (req, res) => {
    try {
      const { id } = req.params;
      const repartidorId = req.user?.code || req.user?.id;
      if (!repartidorId) return res.status(401).json({ success: false, error: 'Authentication required' });
      if (!await canAccessAlbaran(req, id)) {
        return res.status(403).json({
          success: false,
          error: 'No tienes permisos para entregar este albaran',
        });
      }

      const { observations, signaturePath, latitude, longitude } = req.body;
      const result = await repo.markDelivered({ albaranId: id, observations, signaturePath, latitude, longitude, repartidorId });

      // Invalidate entregas caches
      cache.invalidatePattern(`ddd:albaranes:${repartidorId}`);
      cache.invalidatePattern(`ddd:albaran:${id}`);
      cache.invalidatePattern(`ddd:summary:${repartidorId}`);

      res.json({ success: true, delivery: result });
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in POST /deliver: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/gamification', async (req, res) => {
    try {
      const repartidorId = req.user?.code || req.query.repartidorId;
      if (!repartidorId) return res.status(400).json({ success: false, error: 'repartidorId required' });

      const cacheKey = `ddd:gamification:${repartidorId}`;
      await withCache(cache, cacheKey, TTL_MS.GAMIFICATION, async () => {
        const stats = await repo.getGamificationStats(repartidorId);
        return { success: true, stats };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /gamification: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const repartidorId = req.user?.code || req.query.repartidorId;
      if (!repartidorId) return res.status(400).json({ success: false, error: 'repartidorId required' });

      const { date } = req.query;
      const cacheKey = `ddd:summary:${repartidorId}:${date || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ROUTE_SUMMARY, async () => {
        const summary = await repo.getRouteSummary({ repartidorId, date });
        return { success: true, summary };
      }, res);
    } catch (error) {
      logger.error(`[DDD-ENTREGAS] Error in GET /summary: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  // Keep legacy document delivery endpoints available while DDD owns /api/entregas.
  // This prevents 404s for /receipt/:id, /receipt/:id/email and /receipt/:id/whatsapp.
  router.use(require('../../../routes/entregas'));

  return router;
}

// =============================================================================
// RUTERO ROUTES (DDD) — with caching
// =============================================================================
function createRuteroRoutes() {
  const router = express.Router();
  const repo = new Db2RuteroRepository(getDbPool());
  const cache = getCache();

  router.get('/config', async (req, res) => {
    try {
      const { vendorCode, date } = req.query;
      if (!vendorCode) return res.status(400).json({ success: false, error: 'vendorCode required' });

      const cacheKey = `ddd:ruta-config:${vendorCode}:${date || ''}`;
      await withCache(cache, cacheKey, TTL_MS.RUTA_CONFIG, async () => {
        const config = await repo.getRutaConfig({ vendorCode, date });
        return { success: true, config };
      }, res);
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in GET /config: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.put('/config/:id/order', async (req, res) => {
    try {
      const { id } = req.params;
      const { newOrder } = req.body;
      if (newOrder === undefined || newOrder < 0) {
        return res.status(400).json({ success: false, error: 'newOrder required (>= 0)' });
      }

      const result = await repo.updateOrder({ configId: id, newOrder });

      // Invalidate ruta config cache
      cache.invalidatePattern('ddd:ruta-config:');

      res.json({ success: true, result });
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in PUT /config/:id/order: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/commissions', async (req, res) => {
    try {
      const { vendorCode, date, role } = req.query;
      if (!vendorCode) return res.status(400).json({ success: false, error: 'vendorCode required' });

      const cacheKey = `ddd:commissions:${vendorCode}:${date || ''}:${role || ''}`;
      await withCache(cache, cacheKey, TTL_MS.COMMISSIONS, async () => {
        const commissions = await repo.getCommissions({ vendorCode, date, role });
        return { success: true, commissions };
      }, res);
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in GET /commissions: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const { vendorCode, date } = req.query;
      if (!vendorCode) return res.status(400).json({ success: false, error: 'vendorCode required' });

      const cacheKey = `ddd:rutero-summary:${vendorCode}:${date || ''}`;
      await withCache(cache, cacheKey, TTL_MS.ROUTE_SUMMARY, async () => {
        const summary = await repo.getDaySummary({ vendorCode, date });
        return { success: true, summary };
      }, res);
    } catch (error) {
      logger.error(`[DDD-RUTERO] Error in GET /summary: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  return router;
}

// =============================================================================
// CLIENTS ROUTES (DDD) — with forced Redis ALL cache
// =============================================================================
function createClientsRoutes() {
  const router = express.Router();

  const listClientsHandler = async (req, res) => {
    try {
      let { vendedorCodes, search, limit = 100, offset = 0 } = req.query;
      const vendorScope = resolvePedidoVendorScope(req, vendedorCodes || 'ALL');
      if (!vendorScope.ok) return res.status(403).json(dddForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error));
      vendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';
      const isAllQuery = vendedorCodes === 'ALL' || !vendedorCodes;
      const safeLimit = boundedInt(limit, 1, 200, 100);
      const safeOffset = boundedInt(offset, 0, 100000, 0);
      const safeSearch = normalizeSearchTerm(search);
      const cacheScope = buildCacheSecurityScope(req, { includeMargin: true });
      const cacheKey = `ddd:clients:v4:${cacheScope}:${vendedorCodes || 'all'}:${safeSearch || 'none'}:${safeLimit}:${safeOffset}`;
      const role = req?.user?.role || 'COMERCIAL';
      const ttlSec = performanceCache.getTTL(role, isAllQuery);

      const fetchClients = async () => {
        const vendorFilter = buildVendedorFilterLACLAE(vendedorCodes);
        let clientCodesFilter = '';
        if (vendedorCodes && !safeSearch && vendedorCodes !== 'ALL') {
          const cachedClientCodes = getClientCodesFromCache(vendedorCodes);
          if (cachedClientCodes && cachedClientCodes.length > 0) {
            clientCodesFilter = buildChunkedClientCodeFilter('C.CODIGOCLIENTE', cachedClientCodes);
          }
        }

        const searchClause = buildClientSearchFilter(safeSearch, 'C');
        const queryParams = searchClause.params;

        if (!safeSearch) {
          const cachedClientCodes = getClientCodesFromCache(vendedorCodes);
          if (Array.isArray(cachedClientCodes) && cachedClientCodes.length > 0) {
            const pageCodes = [...new Set(cachedClientCodes.map(c => sanitizeForSQL(c)).filter(Boolean))]
              .sort()
              .slice(safeOffset, safeOffset + safeLimit);

            if (pageCodes.length === 0) {
              return { success: true, clients: [], count: cachedClientCodes.length, isAllQuery };
            }

            const placeholders = pageCodes.map(() => '?').join(',');
            const [detailRows, statRows, lastRows] = await Promise.all([
              queryWithParams(`
                SELECT
                  C.CODIGOCLIENTE as code,
                  COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as name,
                  C.NIF as nif,
                  C.DIRECCION as address,
                  C.POBLACION as city,
                  C.PROVINCIA as province,
                  C.CODIGOPOSTAL as postalCode,
                  C.TELEFONO1 as phone,
                  C.TELEFONO2 as phone2,
                  C.CODIGORUTA as route,
                  C.PERSONACONTACTO as contactPerson,
                  C.ANOBAJA as yearInactive
                FROM DSEDAC.CLI C
                WHERE C.ANOBAJA = 0
                  AND C.CODIGOCLIENTE IN (${placeholders})
              `, pageCodes, false),
              queryWithParams(`
                SELECT
                  L.LCCDCL AS CLIENT_CODE,
                  SUM(L.LCIMVT) AS TOTAL_PURCHASES,
                  SUM(L.LCIMVT - L.LCIMCT) AS TOTAL_MARGIN,
                  COUNT(DISTINCT L.LCAADC || L.LCMMDC || L.LCDDDC) AS NUM_ORDERS,
                  MAX(L.LCAADC * 10000 + L.LCMMDC * 100 + L.LCDDDC) AS LAST_PURCHASE_DATE
                FROM DSED.LACLAE L
                WHERE L.LCAADC >= ?
                  AND L.TPDC = 'LAC'
                  AND L.LCTPVT IN ('CC', 'VC')
                  AND L.LCCLLN IN ('AB', 'VT')
                  AND L.LCSRAB NOT IN ('N', 'Z')
                  AND L.LCCDCL IN (${placeholders})
                GROUP BY L.LCCDCL
              `, [MIN_YEAR, ...pageCodes], false),
              queryWithParams(`
                SELECT CLIENT_CODE, LAST_VENDOR FROM (
                  SELECT
                    L.LCCDCL AS CLIENT_CODE,
                    L.LCCDVD AS LAST_VENDOR,
                    ROW_NUMBER() OVER (
                      PARTITION BY L.LCCDCL
                      ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
                    ) AS RN
                  FROM DSED.LACLAE L
                  WHERE L.LCAADC >= ?
                    AND L.TPDC = 'LAC'
                    AND L.LCTPVT IN ('CC', 'VC')
                    AND L.LCCLLN IN ('AB', 'VT')
                    AND L.LCSRAB NOT IN ('N', 'Z')
                    AND L.LCCDCL IN (${placeholders})
                ) X WHERE RN = 1
              `, [MIN_YEAR, ...pageCodes], false),
            ]);

            const vendorCodesForNames = [...new Set(lastRows
              .map(r => (r.LAST_VENDOR || '').toString().trim())
              .filter(Boolean))];
            const vendorNameRows = vendorCodesForNames.length > 0
              ? await queryWithParams(`
                  SELECT TRIM(CODIGOVENDEDOR) as VENDOR_CODE, TRIM(NOMBREVENDEDOR) as VENDOR_NAME
                  FROM DSEDAC.VDD
                  WHERE TRIM(CODIGOVENDEDOR) IN (${vendorCodesForNames.map(() => '?').join(',')})
                `, vendorCodesForNames, false)
              : [];

            const detailMap = new Map();
            detailRows.forEach(row => {
              const code = (row.code ?? row.CODE ?? '').toString().trim();
              if (code) detailMap.set(code, row);
            });
            const statMap = new Map();
            statRows.forEach(row => {
              const code = (row.CLIENT_CODE || '').toString().trim();
              if (code) statMap.set(code, row);
            });
            const lastVendorMap = new Map();
            lastRows.forEach(row => {
              const code = (row.CLIENT_CODE || '').toString().trim();
              if (code) lastVendorMap.set(code, (row.LAST_VENDOR || '').toString().trim());
            });
            const vendorNameMap = new Map();
            vendorNameRows.forEach(row => {
              const code = (row.VENDOR_CODE || '').toString().trim();
              if (code) vendorNameMap.set(code, (row.VENDOR_NAME || '').toString().trim());
            });

            const fastClients = pageCodes
              .map(code => {
                const details = detailMap.get(code);
                if (!details) return null;
                const stats = statMap.get(code) || {};
                const vendorCode = lastVendorMap.get(code) || '';
                return {
                  code,
                  name: (details.name ?? details.NAME ?? '').toString().trim(),
                  nif: (details.nif ?? details.NIF ?? '').toString().trim(),
                  address: (details.address ?? details.ADDRESS ?? '').toString().trim(),
                  city: (details.city ?? details.CITY ?? '').toString().trim(),
                  province: (details.province ?? details.PROVINCE ?? '').toString().trim(),
                  postalCode: (details.postalCode ?? details.POSTALCODE ?? '').toString().trim(),
                  phone: (details.phone ?? details.PHONE ?? '').toString().trim(),
                  phone2: (details.phone2 ?? details.PHONE2 ?? '').toString().trim(),
                  route: (details.route ?? details.ROUTE ?? '').toString().trim(),
                  contactPerson: (details.contactPerson ?? details.CONTACTPERSON ?? '').toString().trim(),
                  totalPurchases: Number(stats.TOTAL_PURCHASES ?? 0) || 0,
                  numOrders: Number(stats.NUM_ORDERS ?? 0) || 0,
                  lastDateInt: Number(stats.LAST_PURCHASE_DATE ?? 0) || 0,
                  totalMargin: Number(stats.TOTAL_MARGIN ?? 0) || 0,
                  yearInactive: Number(details.yearInactive ?? details.YEARINACTIVE ?? 0) || 0,
                  vendorName: vendorNameMap.get(vendorCode) || '',
                  vendorCode,
                };
              })
              .filter(Boolean);

            return { success: true, clients: fastClients, count: cachedClientCodes.length, isAllQuery, fastPath: true };
          }
        }

        const vendorScopedCliFilter = clientCodesFilter
          ? ''
          : buildClientListVendorSqlFilter(vendedorCodes, 'C');
        const laclaeBoundedFilter = clientCodesFilter
          ? clientCodesFilter.replace(/C\.CODIGOCLIENTE/g, 'LCCDCL')
          : buildLaclaeBoundedClientCodesSql(vendedorCodes);
        const laclaeScopeFilter = laclaeBoundedFilter || vendorFilter.replace(/L\./g, '');

        const clients = await cachedQuery((sql, params = []) => queryWithParams(sql, params, false), `
          WITH LACLAE_SCOPED AS (
            SELECT LCCDCL, LCIMVT, LCIMCT, LCAADC, LCMMDC, LCDDDC, LCCDVD
              FROM DSED.LACLAE
             WHERE LCAADC >= ${MIN_YEAR} AND TPDC = 'LAC'
               AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT')
               AND LCSRAB NOT IN ('N', 'Z')
               ${laclaeScopeFilter}
          ),
          LACLAE_AGG AS (
            SELECT LCCDCL AS CLIENT_CODE,
              SUM(LCIMVT) AS TOTAL_PURCHASES,
              SUM(LCIMVT - LCIMCT) AS TOTAL_MARGIN,
              COUNT(DISTINCT LCAADC || LCMMDC || LCDDDC) AS NUM_ORDERS,
              MAX(LCAADC * 10000 + LCMMDC * 100 + LCDDDC) AS LAST_PURCHASE_DATE
            FROM LACLAE_SCOPED
            GROUP BY LCCDCL
          ),
          LACLAE_LAST AS (
            SELECT CLIENT_CODE, LAST_VENDOR FROM (
              SELECT LCCDCL AS CLIENT_CODE, LCCDVD AS LAST_VENDOR,
                ROW_NUMBER() OVER (PARTITION BY LCCDCL ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC) AS RN
              FROM LACLAE_SCOPED
            ) X WHERE RN = 1
          )
          SELECT
            C.CODIGOCLIENTE as code,
            COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as name,
            C.NIF as nif,
            C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
            C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
            C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
            COALESCE(S.TOTAL_PURCHASES, 0) as totalPurchases,
            COALESCE(S.NUM_ORDERS, 0) as numOrders,
            COALESCE(S.LAST_PURCHASE_DATE, 0) as lastDateInt,
            COALESCE(S.TOTAL_MARGIN, 0) as totalMargin,
            C.ANOBAJA as yearInactive,
            TRIM(V.NOMBREVENDEDOR) as vendorName,
            LV.LAST_VENDOR as vendorCode
          FROM DSEDAC.CLI C
          LEFT JOIN LACLAE_AGG S ON C.CODIGOCLIENTE = S.CLIENT_CODE
          LEFT JOIN LACLAE_LAST LV ON LV.CLIENT_CODE = C.CODIGOCLIENTE
          LEFT JOIN DSEDAC.VDD V ON LV.LAST_VENDOR = V.CODIGOVENDEDOR
          WHERE C.ANOBAJA = 0 ${clientCodesFilter || vendorScopedCliFilter} ${searchClause.clause}
          ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
          OFFSET ${safeOffset} ROWS FETCH FIRST ${safeLimit} ROWS ONLY
        `, {
          cacheKey,
          ttl: RedisTTL.LONG,
          queryType: 'ddd-clients-list',
          params: { vendedorCodes: vendedorCodes || 'ALL', search: safeSearch || null, limit: safeLimit, offset: safeOffset },
          skipCache: isForceRefreshRequest(req),
        }, queryParams);

        const normalized = clients.map(c => ({
          code: (c.code ?? c.CODE ?? '').toString().trim(),
          name: (c.name ?? c.NAME ?? '').toString().trim(),
          nif: (c.nif ?? c.NIF ?? '').toString().trim(),
          address: (c.address ?? c.ADDRESS ?? '').toString().trim(),
          city: (c.city ?? c.CITY ?? '').toString().trim(),
          province: (c.province ?? c.PROVINCE ?? '').toString().trim(),
          postalCode: (c.postalCode ?? c.POSTALCODE ?? '').toString().trim(),
          phone: (c.phone ?? c.PHONE ?? '').toString().trim(),
          phone2: (c.phone2 ?? c.PHONE2 ?? '').toString().trim(),
          route: (c.route ?? c.ROUTE ?? '').toString().trim(),
          contactPerson: (c.contactPerson ?? c.CONTACTPERSON ?? '').toString().trim(),
          totalPurchases: Number(c.totalPurchases ?? c.TOTALPURCHASES ?? 0) || 0,
          numOrders: Number(c.numOrders ?? c.NUMORDERS ?? 0) || 0,
          lastDateInt: Number(c.lastDateInt ?? c.LASTDATEINT ?? 0) || 0,
          totalMargin: Number(c.totalMargin ?? c.TOTALMARGIN ?? 0) || 0,
          yearInactive: Number(c.yearInactive ?? c.YEARINACTIVE ?? 0) || 0,
          vendorName: (c.vendorName ?? c.VENDORNAME ?? '').toString().trim(),
          vendorCode: (c.vendorCode ?? c.VENDORCODE ?? '').toString().trim(),
        }));
        return { success: true, clients: normalized, count: normalized.length, isAllQuery };
      };

      if (isForceRefreshRequest(req)) {
        res.set('Cache-Control', 'no-store');
        res.set('X-Cache-Source', 'bypass');
        res.set('X-Query-Type', isAllQuery ? 'ALL-OPTIMIZED' : 'standard');
        return res.json(await fetchClients());
      }

      const result = await performanceCache.getOrFetch(cacheKey, fetchClients, ttlSec);

      res.set('X-Cache-Source', result.source);
      res.set('X-Query-Type', isAllQuery ? 'ALL-OPTIMIZED' : 'standard');
      res.json(result.data);
    } catch (error) {
      logger.error(`[DDD-CLIENTS] Error: ${error.message}`);
      sendInternalServerError(res);
    }
  };

  router.get('/', listClientsHandler);
  router.get('/list', listClientsHandler);

  return router;
}

// =============================================================================
// COMMISSIONS ROUTES (DDD) — with forced Redis ALL cache
// =============================================================================
function createCommissionsRoutes() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { vendedorCode, year } = req.query;
      if (!vendedorCode) return res.status(400).json({ success: false, error: 'vendedorCode required' });

      const safeVendedorCode = String(vendedorCode).replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
      if (!safeVendedorCode) return res.status(400).json({ success: false, error: 'vendedorCode inválido' });
      const vendorAccess = authorizePedidoVendorCode(req, safeVendedorCode, 'consultar comisiones de');
      if (!vendorAccess.ok) return res.status(vendorAccess.status).json(vendorAccess.body);

      const selectedYear = parseInt(year) || new Date().getFullYear();
      const prevYear = selectedYear - 1;
      const cacheScope = buildCacheSecurityScope(req, { includeMargin: true });
      const cacheKey = `ddd:commissions:v2:${cacheScope}:${safeVendedorCode}:${selectedYear}`;

      const result = await performanceCache.getOrFetch(cacheKey, async () => {
        const { _private: commissionsPrivate } = require('../../../routes/commissions');
        const config = await commissionsPrivate.loadCommissionConfig(selectedYear);
        const vendorData = await commissionsPrivate.calculateVendorData(safeVendedorCode, selectedYear, config);
        const salesRows = (vendorData.months || []).flatMap((month) => [
          { YEAR: selectedYear, MONTH: month.month, SALES: month.actual || 0 },
          { YEAR: prevYear, MONTH: month.month, SALES: month.prevSales || 0 },
        ]);

        return { success: true, salesRows, year: selectedYear, vendorCode: safeVendedorCode };
      }, { role: req?.user?.role || 'COMERCIAL', isAllQuery: vendedorCode === 'ALL' });

      res.set('X-Cache-Source', result.source);
      res.json(result.data);
    } catch (error) {
      logger.error(`[DDD-COMMISSIONS] Error: ${error.message}`);
      sendInternalServerError(res);
    }
  });

  return router;
}

module.exports = {
  createAuthRoutes,
  createPedidosRoutes,
  createCobrosRoutes,
  createEntregasRoutes,
  createRuteroRoutes,
  createClientsRoutes,
  createCommissionsRoutes,
  TTL: TTL_MS
};
