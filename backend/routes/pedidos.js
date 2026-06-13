/**
 * PEDIDOS ROUTES (CommonJS)
 * ==========================
 * Endpoints for order management from the mobile app.
 * Product catalog, pricing, stock, order CRUD, recommendations.
 */

function sanitizeOrderForRole(order, role) {
  if (role === 'JEFE_VENTAS' || role === 'ADMIN') return order;
  // Eliminar campos sensibles para COMERCIAL/REPARTIDOR
  if (!order) return order;
  
  // Create a deep copy to avoid mutating the original
  const safe = JSON.parse(JSON.stringify(order));
  
  delete safe.importeCosto;
  delete safe.importeMargen;
  delete safe.porcentajeMargen;
  delete safe.totalCosto;
  delete safe.totalMargen;
  
  if (Array.isArray(safe.lines)) {
    safe.lines = safe.lines.map(l => {
      delete l.precioCosto;
      delete l.importeCosto;
      delete l.importeMargen;
      delete l.porcentajeMargen;
      return l;
    });
  }
  return safe;
}

const express = require('express');
const router = express.Router();
const pedidosService = require('../services/pedidos.service');
const logger = require('../middleware/logger');
const {
    buildClientVendorParamFilter,
    lookupClientAssignedVendorCodes,
    getVendorColumnExpr,
    getVendorVisibilityScope,
    sanitizeCodeListForParams,
    sanitizeForSQL,
} = require('../utils/common');
const { queryWithParams, query } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { verifyToken } = require('../middleware/auth');
const { TTL } = require('../services/redis-cache');
const { db2WriteTable } = require('../utils/db2-schemas');

// =============================================================================
// ALL ROUTES REQUIRE AUTHENTICATION
// =============================================================================

router.use(verifyToken);

// Req #2: Margin visibility — only JEFE_VENTAS / ADMIN / Comercial 80 see cost/margin data
const MARGIN_VISIBLE_ROLES = ['JEFE_VENTAS', 'ADMIN'];
function canSeeMargin(user) {
    const role = (user?.role || '').toUpperCase();
    const code = (user?.code || '').replace(/^0+/, '');
    return MARGIN_VISIBLE_ROLES.includes(role) || user?.isJefeVentas === true || code === '80';
}

function canUseServerForceConfirm(req, body = {}) {
    if (body.forceConfirm !== true) return false;
    const role = String(req.user?.role || '').toUpperCase();
    const isAdmin = req.user?.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN';
    const reason = String(body.forceConfirmReason || body.auditReason || '').trim();
    return isAdmin && reason.length >= 8;
}
function stripMarginFromOrder(order, user) {
    if (canSeeMargin(user)) return order;
    const clean = { ...order };
    delete clean.costo;
    delete clean.margen;
    delete clean.importeCosto;
    delete clean.importeMargen;
    if (clean.header) {
        clean.header = { ...clean.header };
        delete clean.header.costo;
        delete clean.header.margen;
        delete clean.header.importeCosto;
        delete clean.header.importeMargen;
    }
    if (Array.isArray(clean.lines)) {
        clean.lines = clean.lines.map(l => {
            const lc = { ...l };
            delete lc.precioCosto;
            delete lc.importeCosto;
            delete lc.importeMargen;
            delete lc.porcentajeMargen;
            return lc;
        });
    }
    return clean;
}
function stripMarginFromProduct(product, user) {
    if (canSeeMargin(user)) return product;
    const clean = { ...product };
    delete clean.precioMinimo;
    delete clean.precioCosto;
    delete clean.costo;
    delete clean.margen;
    delete clean.importeCosto;
    delete clean.importeMargen;
    delete clean.porcentajeMargen;
    return clean;
}


// =============================================================================
// INITIALIZATION (called from server.js startServer after initDb)
// =============================================================================

// =============================================================================
// HELPERS
// =============================================================================

function parseIntSafe(value, defaultVal) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultVal : parsed;
}

function parseFloatSafe(value, defaultVal) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultVal : parsed;
}

function buildUpdatePedidoEstadoSql() {
    return [
        'UPDATE',
        db2WriteTable('PEDIDOS_CAB'),
        'SET ESTADO = ?, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?',
    ].join(' ');
}

function normalizePedidoCode(value) {
    return String(value || '').trim();
}

function normalizePedidoCodeList(value) {
    return sanitizeCodeListForParams(String(value || ''), 10);
}

function pedidoCodesMatch(left, right) {
    const leftCode = normalizePedidoCode(left);
    const rightCode = normalizePedidoCode(right);
    if (!leftCode || !rightCode) return false;
    if (leftCode === rightCode) return true;
    return leftCode.replace(/^0+/, '') === rightCode.replace(/^0+/, '');
}

function getPedidoUserContext(req) {
    const user = req.user || {};
    const role = String(user.role || user.userRole || user.tipo || 'COMERCIAL')
        .trim()
        .toUpperCase();
    return {
        code: normalizePedidoCode(
            user.code || user.codigo || user.codigoVendedor || user.vendedorCode || user.userId || user.id,
        ),
        isManager: user.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN',
        visibleVendorCodes: Array.isArray(user.vendorCodes || user.vendedorCodes)
            ? (user.vendorCodes || user.vendedorCodes).map(normalizePedidoCode).filter(Boolean)
            : [],
    };
}

function resolvePedidoVendorScope(req, requestedVendorCodes) {
    const requestedRaw = normalizePedidoCode(requestedVendorCodes || 'ALL');
    const requestedAll = !requestedRaw || requestedRaw.toUpperCase() === 'ALL';
    const context = getPedidoUserContext(req);
    let codes = requestedAll ? [] : normalizePedidoCodeList(requestedRaw);

    if (!context.isManager) {
        if (!context.code) {
            return { ok: false, error: 'Usuario comercial sin vendedor asignado' };
        }
        const visibilityCodes = getVendorVisibilityScope(context.code);
        if (requestedAll) {
            codes = visibilityCodes;
        } else if (codes.some((code) => !visibilityCodes.some((allowed) => pedidoCodesMatch(code, allowed)))) {
            return { ok: false, error: 'COMERCIAL solo puede consultar su vendedor' };
        }
    } else if (context.visibleVendorCodes.length > 0) {
        if (requestedAll) {
            codes = context.visibleVendorCodes;
        } else if (codes.some(code => !context.visibleVendorCodes.some(visible => pedidoCodesMatch(code, visible)))) {
            return { ok: false, error: 'JEFE_VENTAS no puede consultar vendedores fuera de su alcance' };
        }
    }

    return { ok: true, codes: [...new Set(codes)] };
}

function pedidoForbiddenBody(code, error) {
    return { success: false, code, error };
}

function authorizePedidoVendorCode(req, vendedorCode, action = 'consultar') {
    const context = getPedidoUserContext(req);
    const vendor = normalizePedidoCode(vendedorCode);
    if (!vendor) {
        return { ok: false, status: 400, body: pedidoForbiddenBody('INVALID_VENDOR', 'vendedorCode invalido') };
    }
    if (context.isManager) {
        if (context.visibleVendorCodes.length === 0 || context.visibleVendorCodes.some(code => pedidoCodesMatch(code, vendor))) {
            return { ok: true, vendedorCode: vendor };
        }
        return { ok: false, status: 403, body: pedidoForbiddenBody('FORBIDDEN_VENDOR', `JEFE_VENTAS no puede ${action} vendedores fuera de su alcance`) };
    }
    if (context.code && pedidoCodesMatch(context.code, vendor)) {
        return { ok: true, vendedorCode: vendor };
    }
    return { ok: false, status: 403, body: pedidoForbiddenBody('FORBIDDEN_VENDOR', `COMERCIAL solo puede ${action} su vendedor`) };
}

async function authorizePedidoClientScope(req, clientCode, vendedorCodes, action = 'consultar') {
    const client = normalizePedidoCode(clientCode).substring(0, 10);
    if (!client) {
        return { ok: false, status: 400, body: pedidoForbiddenBody('INVALID_CLIENT', 'clientCode invalido') };
    }
    const vendorScope = resolvePedidoVendorScope(req, vendedorCodes);
    if (!vendorScope.ok) {
        return { ok: false, status: 403, body: pedidoForbiddenBody('FORBIDDEN_VENDOR', vendorScope.error) };
    }
    const context = getPedidoUserContext(req);
    const clientVendorFilter = buildClientVendorParamFilter(vendorScope.codes, 'CLI');
    let rows = await queryWithParams(
        `SELECT 1
           FROM DSEDAC.CLI CLI
          WHERE TRIM(CLI.CODIGOCLIENTE) = ?
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
                  WHERE TRIM(CLI.CODIGOCLIENTE) = ?
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
        return {
            ok: false,
            status: 403,
            body: pedidoForbiddenBody('FORBIDDEN_CLIENT_VENDOR', `No autorizado para ${action} este cliente con ese vendedor`),
        };
    }
    return { ok: true, clientCode: client, vendorCodes: effectiveVendorCodes };
}

async function authorizePedidoAccess(req, orderId, action = 'consultar') {
    const ownership = await pedidosService.getOrderVendorForAuth(orderId);
    if (!ownership) {
        return { ok: false, status: 404, body: { success: false, code: 'ORDER_NOT_FOUND', error: 'Pedido no encontrado' } };
    }
    const context = getPedidoUserContext(req);
    const orderVendor = normalizePedidoCode(ownership.vendedorCode);
    if (context.isManager) {
        if (context.visibleVendorCodes.length === 0 || context.visibleVendorCodes.some(code => pedidoCodesMatch(code, orderVendor))) {
            return { ok: true, ownership };
        }
        return { ok: false, status: 403, body: { success: false, code: 'FORBIDDEN_VENDOR', error: `JEFE_VENTAS no puede ${action} pedidos fuera de su alcance` } };
    }
    if (context.code && pedidoCodesMatch(context.code, orderVendor)) {
        return { ok: true, ownership };
    }
    return { ok: false, status: 403, body: { success: false, code: 'FORBIDDEN_VENDOR', error: `COMERCIAL solo puede ${action} pedidos de su vendedor` } };
}

async function authorizePedidoMutation(req, orderId) {
    return authorizePedidoAccess(req, orderId, 'mutar');
}

function buildLaclaeVendorParamFilter(vendorCodes, alias = 'L') {
    if (!Array.isArray(vendorCodes) || vendorCodes.length === 0) {
        return { clause: '', params: [] };
    }
    const vendorColumn = getVendorColumnExpr(alias);
    return {
        clause: `AND TRIM(${vendorColumn}) IN (${vendorCodes.map(() => '?').join(',')})`,
        params: vendorCodes,
    };
}

// =============================================================================
// PRODUCT CATALOG
// =============================================================================

/**
 * GET /api/pedidos/products
 * Product catalog search with filters
 */
router.get('/products', async (req, res) => {
    try {
        const { vendedorCodes, clientCode, family, marca, prefamily } = req.query;

        if (!vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        if (!clientCode) {
            return res.status(400).json({ success: false, error: 'clientCode is required for product catalog access' });
        }

        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCodes, 'consultar catalogo');
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }

        const search = req.query.search ? sanitizeForSQL(req.query.search) : undefined;
        const limit = parseIntSafe(req.query.limit, 50);
        const offset = parseIntSafe(req.query.offset, 0);

        const result = await pedidosService.searchProducts({
            vendedorCodes: clientAccess.vendorCodes.length > 0 ? clientAccess.vendorCodes.join(',') : vendedorCodes,
            search,
            clientCode: clientAccess.clientCode,
            family: family ? String(family).trim() : undefined,
            marca: marca ? String(marca).trim() : undefined,
            // Req #14: filtro Nestlé / otras prefamilias.
            prefamily: prefamily ? String(prefamily).trim() : undefined,
            limit,
            offset
        });

        const products = result.products.map(p => stripMarginFromProduct(p, req.user));
        res.json({ success: true, products, count: result.count });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /products: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/products/:code
 * Full product detail: base info, tariffs, stock, client-specific price
 */
router.get('/products/:code', async (req, res) => {
    try {
        const code = String(req.params.code).trim();
        const clientCode = req.query.clientCode ? String(req.query.clientCode).trim() : undefined;

        if (clientCode) {
            const clientAccess = await authorizePedidoClientScope(
                req,
                clientCode,
                req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
                'consultar producto',
            );
            if (!clientAccess.ok) {
                return res.status(clientAccess.status).json(clientAccess.body);
            }
        }

        const product = await pedidosService.getProductDetail(code, clientCode);

        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        res.json({ success: true, product: stripMarginFromProduct(product, req.user) });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /products/${req.params.code}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/products/:code/stock
 * Real-time stock for a product
 */
router.get('/products/:code/stock', async (req, res) => {
    try {
        const code = String(req.params.code).trim();

        const stock = await pedidosService.getProductStock(code);

        res.json({ success: true, stock });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /products/${req.params.code}/stock: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/pedidos/products/stock-batch
 * Real-time stock for multiple products in one DB2 query chunk.
 */
router.post('/products/stock-batch', async (req, res) => {
    try {
        const rawCodes = Array.isArray(req.body?.codes) ? req.body.codes : [];
        const codes = [...new Set(rawCodes
            .map(code => String(code || '').trim())
            .filter(Boolean))]
            .slice(0, 200);
        const almacen = parseIntSafe(req.body?.almacen, 1);

        if (codes.length === 0) {
            return res.status(400).json({ success: false, error: 'codes array is required' });
        }

        const stockMap = await pedidosService.getStockBatch(codes, almacen);
        const stock = Object.fromEntries(stockMap.entries());

        res.json({ success: true, stock });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in POST /products/stock-batch: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// CLIENT PRICING
// =============================================================================

/**
 * GET /api/pedidos/client-prices/:clientCode
 * Tariff/pricing info for a specific client
 */
router.get('/client-prices/:clientCode', async (req, res) => {
    try {
        const clientCode = String(req.params.clientCode).trim();
        const clientAccess = await authorizePedidoClientScope(
            req,
            clientCode,
            req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
            'consultar precios',
        );
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }

        const pricing = await pedidosService.getClientPricing(clientAccess.clientCode);

        res.json({ success: true, pricing });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /client-prices/${req.params.clientCode}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// FILTER DATA
// =============================================================================

/**
 * GET /api/pedidos/families
 * Product families for filter chips
 */
router.get('/families', async (req, res) => {
    try {
        const families = await pedidosService.getProductFamilies();

        res.json({ success: true, families });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /families: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Req #14: GET /api/pedidos/families/detailed
 * Devuelve familias con metadatos completos incluida la prefamilia (e.g. NESTLE)
 * para que el frontend pueda agrupar chips dinámicamente.
 */
router.get('/families/detailed', async (req, res) => {
    try {
        const families = await pedidosService.getFamiliesDetailed();
        res.json({ success: true, families });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /families/detailed: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Req #8: GET /api/pedidos/draft-status/:vendedorCode
 * Indica al frontend si hay >=3 borradores acumulados para advertir al usuario.
 * Llamada solo de lectura: no auto-confirma. El frontend puede llamar a
 * POST /api/pedidos/draft-status/:vendedorCode/auto-confirm para opt-in.
 */
router.get('/draft-status/:vendedorCode', async (req, res) => {
    try {
        const code = String(req.params.vendedorCode || '').trim();
        const vendorAccess = authorizePedidoVendorCode(req, code, 'consultar');
        if (!vendorAccess.ok) {
            return res.status(vendorAccess.status).json(vendorAccess.body);
        }
        const result = await pedidosService.checkDraftAccumulation(code);
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /draft-status: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/draft-status/:vendedorCode/auto-confirm', async (req, res) => {
    try {
        const code = String(req.params.vendedorCode || '').trim();
        const vendorAccess = authorizePedidoVendorCode(req, code, 'auto-confirmar');
        if (!vendorAccess.ok) {
            return res.status(vendorAccess.status).json(vendorAccess.body);
        }
        const result = await pedidosService.checkDraftAccumulation(code, {
            autoConfirm: true,
            options: { userId: req.user?.codigo || req.user?.userId || 'API' },
        });
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in POST /draft-status/auto-confirm: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/brands
 * Product brands for filter chips
 */
router.get('/brands', async (req, res) => {
    try {
        const brands = await pedidosService.getProductBrands();

        res.json({ success: true, brands });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /brands: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// CLIENT BALANCE
// =============================================================================
router.get('/client-balance/:clientCode', async (req, res) => {
    try {
        const clientCode = String(req.params.clientCode).trim();
        const clientAccess = await authorizePedidoClientScope(
            req,
            clientCode,
            req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
            'consultar balance',
        );
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }
        const balance = await pedidosService.getClientBalance(clientAccess.clientCode);
        res.json({ success: true, balance });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /client-balance: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// ANALYTICS
// =============================================================================
router.get('/analytics', async (req, res) => {
    try {
        const vendorScope = resolvePedidoVendorScope(req, req.query.vendedorCodes || 'ALL');
        if (!vendorScope.ok) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_VENDOR', error: vendorScope.error });
        }
        const vendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';
        const analytics = await pedidosService.getOrderAnalytics(vendedorCodes);
        res.json({ success: true, analytics });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /analytics: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// COMPLEMENTARY PRODUCTS
// =============================================================================
router.post('/complementary', async (req, res) => {
    try {
        const { productCodes, clientCode } = req.body;
        if (!productCodes || !Array.isArray(productCodes) || productCodes.length === 0) {
            return res.status(400).json({ success: false, error: 'productCodes array is required' });
        }
        let effectiveClientCode = clientCode;
        if (clientCode) {
            const clientAccess = await authorizePedidoClientScope(
                req,
                clientCode,
                req.body.vendedorCodes || req.body.vendedorCode || req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
                'consultar complementarios',
            );
            if (!clientAccess.ok) {
                return res.status(clientAccess.status).json(clientAccess.body);
            }
            effectiveClientCode = clientAccess.clientCode;
        }
        const products = await pedidosService.getComplementaryProducts(productCodes, effectiveClientCode);
        res.json({ success: true, products });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in POST /complementary: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// RECOMMENDATIONS
// =============================================================================

/**
 * GET /api/pedidos/recommendations/:clientCode
 * Product recommendations based on client history and similar clients
 */
router.get('/recommendations/:clientCode', async (req, res) => {
    try {
        const clientCode = String(req.params.clientCode).trim();
        const vendedorCode = req.query.vendedorCode ? String(req.query.vendedorCode).trim() : undefined;

        if (!vendedorCode) {
            return res.status(400).json({ success: false, error: 'vendedorCode is required' });
        }

        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCode, 'consultar recomendaciones');
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }

        const recommendations = await pedidosService.getRecommendations(clientAccess.clientCode, vendedorCode);

        res.json({
            success: true,
            clientHistory: recommendations.clientHistory,
            similarClients: recommendations.similarClients
        });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /recommendations/${req.params.clientCode}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// PRODUCT-CLIENT PURCHASE HISTORY
// =============================================================================

/**
 * GET /api/pedidos/product-history/:productCode/:clientCode
 * Monthly purchase breakdown for a specific product+client (3 years)
 */
router.get('/product-history/:productCode/:clientCode', async (req, res) => {
    try {
        const productCode = String(req.params.productCode).trim();
        const clientCode = String(req.params.clientCode).trim();

        if (!productCode || !clientCode) {
            return res.status(400).json({ success: false, error: 'productCode and clientCode are required' });
        }

        const clientAccess = await authorizePedidoClientScope(
            req,
            clientCode,
            req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
            'consultar historico',
        );
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }

        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 2;

        const sql = `
            SELECT
                L.LCAADC AS YEAR,
                L.LCMMDC AS MONTH,
                SUM(L.LCIMVT) AS SALES,
                SUM(L.LCIMCT) AS COST,
                SUM(L.LCCTUD) AS UNITS,
                SUM(L.LCCTEV) AS ENVASES,
                AVG(L.LCPRMD) AS AVG_PRICE,
                AVG(L.LCPRT1) AS AVG_TARIFF,
                AVG(CASE WHEN L.LCPJDT <> 0 THEN L.LCPJDT ELSE NULL END) AS AVG_DISCOUNT_PCT,
                COUNT(*) AS LINE_COUNT
        FROM DSED.LACLAE L
        WHERE L.LCCDCL = ?
          AND L.LCCDRF = ?
          AND L.LCAADC >= ?
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN (?, ?)
          AND L.LCCLLN IN (?, ?)
          AND L.LCSRAB NOT IN (?, ?, ?, ?)
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC ASC
    `;

        const rows = await queryWithParams(sql, [clientAccess.clientCode, productCode, startYear, 'CC', 'VC', 'AB', 'VT', 'N', 'Z', 'G', 'D']);

        // Build years structure
        const years = {};
        for (const row of rows) {
            const yr = String(row.YEAR);
            const mo = String(Number(row.MONTH));

            if (!years[yr]) {
                years[yr] = { months: {}, totals: { sales: 0, cost: 0, units: 0, envases: 0, avgPrice: 0, lineCount: 0 } };
            }

            years[yr].months[mo] = {
                sales: Number(row.SALES) || 0,
                cost: Number(row.COST) || 0,
                units: Number(row.UNITS) || 0,
                envases: Number(row.ENVASES) || 0,
                avgPrice: Number(row.AVG_PRICE) || 0,
                avgTariff: Number(row.AVG_TARIFF) || 0,
                avgDiscount: row.AVG_DISCOUNT_PCT != null ? Number(row.AVG_DISCOUNT_PCT) : null,
                lineCount: Number(row.LINE_COUNT) || 0
            };

            years[yr].totals.sales += Number(row.SALES) || 0;
            years[yr].totals.cost += Number(row.COST) || 0;
            years[yr].totals.units += Number(row.UNITS) || 0;
            years[yr].totals.envases += Number(row.ENVASES) || 0;
            years[yr].totals.lineCount += Number(row.LINE_COUNT) || 0;
        }

        // Compute avgPrice per year from totals
        for (const yr of Object.keys(years)) {
            const t = years[yr].totals;
            t.avgPrice = t.units > 0 ? t.sales / t.units : 0;
        }

        // Grand total
        const allYears = Object.keys(years);
        const grandTotal = {
            sales: 0, cost: 0, units: 0, envases: 0, avgPrice: 0, years: allYears.length
        };
        for (const yr of allYears) {
            grandTotal.sales += years[yr].totals.sales;
            grandTotal.cost += years[yr].totals.cost;
            grandTotal.units += years[yr].totals.units;
            grandTotal.envases += years[yr].totals.envases;
        }
        grandTotal.avgPrice = grandTotal.units > 0 ? grandTotal.sales / grandTotal.units : 0;

        // Trend: compare current year vs previous year sales
        const curSales = years[String(currentYear)] ? years[String(currentYear)].totals.sales : 0;
        const prevSales = years[String(currentYear - 1)] ? years[String(currentYear - 1)].totals.sales : 0;
        let trend = 'stable';
        if (prevSales > 0) {
            const pctChange = ((curSales - prevSales) / prevSales) * 100;
            if (pctChange > 5) trend = 'up';
            else if (pctChange < -5) trend = 'down';
        } else if (curSales > 0) {
            trend = 'up';
        }

        res.json({
            success: true,
            productCode,
            clientCode,
            years,
            grandTotal,
            trend
        });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /product-history/${req.params.productCode}/${req.params.clientCode}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// PROMOTIONS
// =============================================================================

router.get('/promotions', async (req, res) => {
    try {
        const { clientCode } = req.query;
        const trimmedClient = clientCode ? String(clientCode).trim() : '';
        
        if (!trimmedClient) {
            return res.status(400).json({ success: false, error: 'clientCode is required for promotions' });
        }

        const clientAccess = await authorizePedidoClientScope(
            req,
            trimmedClient,
            req.query.vendedorCodes || req.query.vendedorCode || 'ALL',
            'consultar promociones',
        );
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }
        
        const promotions = await pedidosService.getActivePromotions(clientAccess.clientCode);
        res.json({ success: true, promotions });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /promotions: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error obteniendo promociones', code: 'PROMOTIONS_ERROR' });
    }
});

// =============================================================================
// ORDERS  CRUD
// =============================================================================

/**
 * GET /api/pedidos
 * List orders with filters
 */
router.get('/', async (req, res) => {
    try {
        const { vendedorCodes, status, year, month, dateFrom, dateTo, search, minAmount, maxAmount, sortBy, sortOrder } = req.query;

        if (!vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        const vendorScope = resolvePedidoVendorScope(req, vendedorCodes);
        if (!vendorScope.ok) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_VENDOR', error: vendorScope.error });
        }
        const effectiveVendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';

        const result = await pedidosService.getOrders({
            vendedorCodes: effectiveVendedorCodes,
            status: status ? String(status).trim() : undefined,
            year: year ? parseInt(year) : undefined,
            month: month ? parseInt(month) : undefined,
            dateFrom: dateFrom ? String(dateFrom).trim() : undefined,
            dateTo: dateTo ? String(dateTo).trim() : undefined,
            search: search ? String(search).trim() : undefined,
            minAmount: minAmount ? parseFloat(minAmount) : undefined,
            maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
            sortBy: sortBy ? String(sortBy).trim() : 'fecha',
            sortOrder: (sortOrder || 'DESC').toUpperCase(),
            limit: parseIntSafe(req.query.limit, 50),
            offset: parseIntSafe(req.query.offset, 0),
        });

        const orders = result.orders.map(o => stripMarginFromOrder(o, req.user));
        res.json({ success: true, orders, count: result.count });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/orders/stats
 * Order statistics and analytics
 */
router.get('/orders/stats', async (req, res) => {
    try {
        const vendorScope = resolvePedidoVendorScope(req, req.query.vendedorCodes || 'ALL');
        if (!vendorScope.ok) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_VENDOR', error: vendorScope.error });
        }
        const vendedorCodes = vendorScope.codes.length > 0 ? vendorScope.codes.join(',') : 'ALL';
        const stats = await pedidosService.getOrderStats(
            vendedorCodes,
            req.query.dateFrom ? String(req.query.dateFrom).trim() : undefined,
            req.query.dateTo ? String(req.query.dateTo).trim() : undefined
        );
        res.json({ success: true, stats });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /orders/stats: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/delivery-options
 * Delivery days + provisional truck for client/vendor.
 */
router.get('/delivery-options', async (req, res) => {
    try {
        const clientCode = req.query.clientCode ? String(req.query.clientCode).trim() : '';
        const vendedorCode = req.query.vendedorCode ? String(req.query.vendedorCode).trim() : '';
        const deliveryDate = req.query.deliveryDate ? String(req.query.deliveryDate).trim() : undefined;

        if (!clientCode || !vendedorCode) {
            return res.status(400).json({ success: false, error: 'clientCode and vendedorCode are required' });
        }

        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendedorCode, 'consultar reparto');
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }

        const options = await pedidosService.getDeliveryOptions({ clientCode: clientAccess.clientCode, vendedorCode, deliveryDate });
        res.json({ success: true, options });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /delivery-options: ${error.message}`);
        const status = error.message.includes('Fecha reparto') ? 409 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/available-vehicles
 * List all active vehicles for truck assignment in order confirmation.
 */
router.get('/available-vehicles', async (req, res) => {
    try {
        const vehicles = await pedidosService.getAvailableVehicles();
        res.json({ success: true, vehicles });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /available-vehicles: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/:id/albaran
 * Find albaranes linked to an order
 */
router.get('/:id/albaran', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) return res.status(400).json({ success: false, error: 'Invalid order id' });
        const ownership = await authorizePedidoAccess(req, id, 'consultar');
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }
        const albaranes = await pedidosService.getOrderAlbaran(id);
        res.json({ success: true, albaranes });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /${req.params.id}/albaran: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/:id/clone
 * Clone an existing order for re-ordering
 */
router.get('/:id/clone', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) return res.status(400).json({ success: false, error: 'Invalid order id' });
        const ownership = await authorizePedidoAccess(req, id, 'clonar');
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }
        const data = await pedidosService.cloneOrder(id);
        res.json({ success: true, order: data });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /${req.params.id}/clone: ${error.message}`);
        res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/:id/pdf
 * Order data for PDF rendering
 */
router.get('/:id/pdf', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) return res.status(400).json({ success: false, error: 'Invalid order id' });
        const ownership = await authorizePedidoAccess(req, id, 'consultar');
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }
        const detail = await pedidosService.generateOrderPdf(id);
        res.json({ success: true, order: detail });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /${req.params.id}/pdf: ${error.message}`);
        res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/product-comparative/:productCode
 * ==================================================
 * Compara las ventas mensuales (en envases) de un producto entre el año
 * actual y el año anterior. NOTA: debe estar ANTES de /:id catch-all.
 */
router.get('/product-comparative/:productCode', async (req, res) => {
    try {
        const productCode = String(req.params.productCode || '').trim();
        if (!productCode) {
            return res.status(400).json({ success: false, error: 'productCode requerido' });
        }
        const clientCode = String(req.query.clientCode || '').trim();
        const vendedorCode = String(req.query.vendedorCode || '').trim();
        const now = new Date();
        const currentYear = now.getFullYear();
        const previousYear = currentYear - 1;

        let effectiveVendorCodes = [];
        if (vendedorCode) {
            const vendorScope = resolvePedidoVendorScope(req, vendedorCode);
            if (!vendorScope.ok) {
                return res.status(403).json({ success: false, code: 'FORBIDDEN_VENDOR', error: vendorScope.error });
            }
            effectiveVendorCodes = vendorScope.codes;
        }
        if (clientCode) {
            const clientAccess = await authorizePedidoClientScope(
                req,
                clientCode,
                effectiveVendorCodes.length > 0 ? effectiveVendorCodes.join(',') : (vendedorCode || 'ALL'),
                'consultar comparativa',
            );
            if (!clientAccess.ok) {
                return res.status(clientAccess.status).json(clientAccess.body);
            }
        }

        const where = [`TRIM(L.LCCDRF) = ?`, `L.LCTPVT IN ('CC','VC')`,
                       `L.LCCLLN IN ('VT','AB')`, `L.LCSRAB NOT IN ('N','Z','G','D')`];
        const params = [productCode];
        if (clientCode) { where.push('TRIM(L.LCCDCL) = ?'); params.push(clientCode); }
        if (effectiveVendorCodes.length === 1) {
            where.push('TRIM(L.LCCDVD) = ?');
            params.push(effectiveVendorCodes[0]);
        } else if (effectiveVendorCodes.length > 1) {
            where.push(`TRIM(L.LCCDVD) IN (${effectiveVendorCodes.map(() => '?').join(',')})`);
            params.push(...effectiveVendorCodes);
        }
        const whereSql = where.join(' AND ');

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
            filters: { clientCode: clientCode || null, vendedorCode: vendedorCode || null },
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
        logger.error(`[PEDIDOS] product-comparative error: ${error.message} | ODBC: ${odbcMsg}`);
        res.status(500).json({ success: false, error: 'Error obteniendo comparativa de producto' });
    }
});

/**
 * GET /api/pedidos/client-evolution/:clientCode
 */
router.get('/client-evolution/:clientCode', async (req, res) => {
    try {
        const clientCode = String(req.params.clientCode || '').trim();
        const vendedorCodes = req.query.vendedorCodes || req.query.vendorCodes || 'ALL';
        
        if (!clientCode) {
            return res.status(400).json({ success: false, error: 'clientCode requerido' });
        }

        const vendorScope = resolvePedidoVendorScope(req, vendedorCodes);
        if (!vendorScope.ok) {
            return res.status(403).json({
                success: false,
                error: vendorScope.error,
            });
        }
        const clientVendorFilter = buildClientVendorParamFilter(vendorScope.codes, 'CLI');
        const laclaeVendorFilter = buildLaclaeVendorParamFilter(vendorScope.codes, 'L');
        
        // Verify client belongs to vendor scope
        const clientCheckQuery = `
            SELECT 1 FROM DSEDAC.CLI CLI
            WHERE TRIM(CLI.CODIGOCLIENTE) = ?
              ${clientVendorFilter.clause}
            FETCH FIRST 1 ROWS ONLY
        `;
        const clientCheck = await queryWithParams(
            clientCheckQuery,
            [clientCode, ...clientVendorFilter.params],
        );

        if (clientCheck.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: 'No tienes acceso a este cliente',
                message: 'Cliente no encontrado o no tienes permiso para verlo' 
            });
        }
        
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 2;

        const monthlyQuery = `
            SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
                   SUM(L.LCIMVT) AS SALES, SUM(L.LCCTUD) AS UNITS
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = ? AND L.LCAADC >= ?
              AND L.LCTPVT IN (?, ?) AND L.LCCLLN IN (?, ?)
              ${laclaeVendorFilter.clause}
            GROUP BY L.LCAADC, L.LCMMDC
            ORDER BY L.LCAADC ASC, L.LCMMDC ASC
        `;
        const monthlyData = await queryWithParams(
            monthlyQuery,
            [clientCode, startYear, 'CC', 'VC', 'AB', 'VT', ...laclaeVendorFilter.params],
        );

        const topProductsQuery = `
            SELECT TRIM(L.LCCDRF) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   SUM(L.LCIMVT) AS TOTAL_SALES, SUM(L.LCCTUD) AS TOTAL_UNITS
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            WHERE TRIM(L.LCCDCL) = ? AND L.LCAADC >= ?
              AND L.LCTPVT IN (?, ?) AND L.LCCLLN IN (?, ?)
              ${laclaeVendorFilter.clause}
            GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
            ORDER BY TOTAL_SALES DESC
            FETCH FIRST 20 ROWS ONLY
        `;
        const topProductsData = await queryWithParams(
            topProductsQuery,
            [clientCode, currentYear - 1, 'CC', 'VC', 'AB', 'VT', ...laclaeVendorFilter.params],
        );

        const returnsQuery = `
            SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
                   TRIM(L.LCCDRF) AS PRODUCT_CODE, TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
                   SUM(L.LCCTUD) AS UNITS, SUM(L.LCIMVT) AS AMOUNT
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            WHERE TRIM(L.LCCDCL) = ? AND L.LCAADC >= ?
              AND (L.LCSRAB = 'D' OR L.LCTPVT = 'DV')
              ${laclaeVendorFilter.clause}
            GROUP BY L.LCAADC, L.LCMMDC, TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
            ORDER BY YEAR DESC, MONTH DESC, AMOUNT DESC
            FETCH FIRST 50 ROWS ONLY
        `;
        const returnsData = await queryWithParams(
            returnsQuery,
            [clientCode, startYear, ...laclaeVendorFilter.params],
        );

        res.json({
            success: true,
            years: [startYear, startYear + 1, currentYear],
            monthlySales: monthlyData.map(r => ({ year: r.YEAR, month: r.MONTH, sales: parseFloat(r.SALES), units: parseFloat(r.UNITS) })),
            topProducts: topProductsData.map(r => ({ code: r.CODE, name: r.NAME, totalSales: parseFloat(r.TOTAL_SALES), totalUnits: parseFloat(r.TOTAL_UNITS) })),
            returns: returnsData.map(r => ({ year: r.YEAR, month: r.MONTH, productCode: r.PRODUCT_CODE, productName: r.PRODUCT_NAME, units: parseFloat(r.UNITS), amount: parseFloat(r.AMOUNT) })),
        });
    } catch (error) {
        logger.error('[PEDIDOS] client-evolution error: ' + error.message);
        res.status(500).json({ success: false, error: 'Error getting client evolution' });
    }
});

/**
 * GET /api/pedidos/:id
 * Order detail with header + lines
 */
router.get('/:id', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) {
            return res.status(400).json({ success: false, error: 'Invalid order id' });
        }

        const ownership = await authorizePedidoAccess(req, id, 'consultar');
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        const order = await pedidosService.getOrderDetail(id);

        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        res.json({ success: true, order: stripMarginFromOrder(order, req.user) });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /${req.params.id}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/pedidos/create
 * Create a new order with lines
 */
router.post('/create', async (req, res) => {
    try {
        const {
            clientCode, clientName, vendedorCode,
            tipoventa, almacen, tarifa, observaciones,
            descuentoGlobal, lines
        } = req.body;

        // Validation
        if (!clientCode) {
            return res.status(400).json({ success: false, error: 'clientCode is required' });
        }
        if (!vendedorCode) {
            return res.status(400).json({ success: false, error: 'vendedorCode is required' });
        }
        if (!lines || !Array.isArray(lines) || lines.length === 0) {
            return res.status(400).json({ success: false, error: 'At least 1 order line is required' });
        }

        const vendorAccess = authorizePedidoVendorCode(req, vendedorCode, 'crear pedidos para');
        if (!vendorAccess.ok) {
            return res.status(vendorAccess.status).json(vendorAccess.body);
        }
        const clientAccess = await authorizePedidoClientScope(req, clientCode, vendorAccess.vendedorCode, 'crear pedidos para');
        if (!clientAccess.ok) {
            return res.status(clientAccess.status).json(clientAccess.body);
        }

        const idempotencyKey = pedidosService.extractIdempotencyKeyFromRequest(req);
        const order = await pedidosService.createOrder({
            clientCode: clientAccess.clientCode,
            clientName: clientName ? String(clientName).trim() : '',
            vendedorCode: vendorAccess.vendedorCode,
            tipoventa: tipoventa ? String(tipoventa).trim() : undefined,
            almacen: almacen ? String(almacen).trim() : undefined,
            tarifa: tarifa ? String(tarifa).trim() : undefined,
            descuentoGlobal: descuentoGlobal ? parseFloat(descuentoGlobal) : 0,
            observaciones: observaciones ? String(observaciones).trim() : '',
            lines,
            userId: req.user?.code || req.user?.codigo || req.user?.vendedorCode || undefined,
            idempotencyKey,
        });

        if (order.idempotent) {
            return res.status(200).json({
                success: true,
                idempotent: true,
                order: stripMarginFromOrder(order, req.user),
            });
        }

        res.status(201).json({ success: true, order: stripMarginFromOrder(order, req.user) });
    } catch (error) {
        if (error.code === 'INVALID_IDEMPOTENCY_KEY') {
            return res.status(400).json({ success: false, code: error.code, error: error.message });
        }
        if (error.code === 'IDEMPOTENCY_CONFLICT') {
            return res.status(409).json({ success: false, code: error.code, error: error.message });
        }
        logger.error(`[PEDIDOS] Error in POST /create: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/pedidos/:id/lines
 * Add a new line to an existing order (must be BORRADOR)
 */
router.put('/:id/lines', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) {
            return res.status(400).json({ success: false, error: 'Invalid order id' });
        }

        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        const {
            codigoArticulo, descripcion,
            cantidadEnvases, cantidadUnidades,
            unidadMedida, unidadesCaja,
            precioVenta, precioCosto, precioTarifa,
            precioTarifaCliente, precioMinimo,
            claseLinea = 'VT'
        } = req.body;

        if (!codigoArticulo) {
            return res.status(400).json({ success: false, error: 'codigoArticulo is required' });
        }
        if (!['VT', 'SC'].includes(claseLinea)) {
            return res.status(400).json({ success: false, error: 'claseLinea inválida' });
        }

        const line = await pedidosService.addOrderLine(id, {
            codigoArticulo: String(codigoArticulo).trim(),
            descripcion: descripcion ? String(descripcion).trim() : '',
            cantidadEnvases: parseFloatSafe(cantidadEnvases, 0),
            cantidadUnidades: parseFloatSafe(cantidadUnidades, 0),
            unidadMedida: unidadMedida ? String(unidadMedida).trim() : undefined,
            unidadesCaja: parseFloatSafe(unidadesCaja, 0),
            precioVenta: parseFloat(precioVenta) || 0,
            precioCosto: parseFloat(precioCosto) || 0,
            precioTarifa: parseFloat(precioTarifa) || 0,
            precioTarifaCliente: parseFloat(precioTarifaCliente) || 0,
            precioMinimo: parseFloat(precioMinimo) || 0,
            claseLinea,
        });

        res.json({ success: true, line });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/lines: ${error.message}`);
        const status = error.message.includes('BORRADOR') ? 409 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/pedidos/:id/lines/:lineId
 * Update an existing order line (must be BORRADOR)
 */
router.put('/:id/lines/:lineId', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        const lineId = parseIntSafe(req.params.lineId, null);
        if (id === null || lineId === null) {
            return res.status(400).json({ success: false, error: 'Invalid order or line id' });
        }

        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        const { cantidadEnvases, cantidadUnidades, precioVenta, unidadMedida, claseLinea } = req.body;

        if (claseLinea !== undefined && !['VT', 'SC'].includes(claseLinea)) {
            return res.status(400).json({ success: false, error: 'claseLinea inválida' });
        }

        const line = await pedidosService.updateOrderLine(lineId, {
            cantidadEnvases: cantidadEnvases !== undefined ? parseFloatSafe(cantidadEnvases, 0) : undefined,
            cantidadUnidades: cantidadUnidades !== undefined ? parseFloatSafe(cantidadUnidades, 0) : undefined,
            precioVenta: precioVenta !== undefined ? parseFloat(precioVenta) || 0 : undefined,
            unidadMedida: unidadMedida !== undefined ? String(unidadMedida).trim() : undefined,
            claseLinea: claseLinea !== undefined ? String(claseLinea).trim() : undefined,
        });

        res.json({ success: true, line });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/lines/${req.params.lineId}: ${error.message}`);
        const status = error.message.includes('BORRADOR') ? 409
            : error.message.includes('not found') ? 404
            : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/pedidos/:id/lines/:lineId
 * Delete an order line (must be BORRADOR)
 */
router.delete('/:id/lines/:lineId', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        const lineId = parseIntSafe(req.params.lineId, null);
        if (id === null || lineId === null) {
            return res.status(400).json({ success: false, error: 'Invalid order or line id' });
        }

        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        await pedidosService.deleteOrderLine(lineId, id);

        res.json({ success: true });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in DELETE /${req.params.id}/lines/${req.params.lineId}: ${error.message}`);
        const status = error.message.includes('BORRADOR') ? 409
            : error.message.includes('not found') ? 404
            : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

// =============================================================================
// ORDER STATUS CHANGES
// =============================================================================

/**
 * PUT /api/pedidos/:id/confirm
 * Confirm a draft order (BORRADOR -> CONFIRMADO)
 */
router.put('/:id/confirm', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) {
            return res.status(400).json({ success: false, error: 'Invalid order id' });
        }

        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        const { saleType, deliveryDate, vehicleCode, driverCode, routeCode } = req.body;
        if (!saleType || !['CC', 'VC', 'NV'].includes(saleType)) {
            return res.status(400).json({ success: false, error: 'saleType must be CC, VC, or NV' });
        }

        const options = {
            forceConfirm: canUseServerForceConfirm(req, req.body),
            forceConfirmReason: String(req.body?.forceConfirmReason || req.body?.auditReason || '').trim(),
            adminOverride: canUseServerForceConfirm(req, req.body),
            userRole: req.user?.role || 'COMERCIAL',
            userId: req.user?.code || 'SYSTEM',
            deliveryDate: deliveryDate ? String(deliveryDate).trim() : undefined,
            vehicleCode: vehicleCode ? String(vehicleCode).trim() : undefined,
            driverCode: driverCode ? String(driverCode).trim() : undefined,
            routeCode: routeCode ? String(routeCode).trim() : undefined,
        };
        const order = await pedidosService.confirmOrder(id, saleType, options);

        // P0-C / P0-BOLSA: If validation blocked the order, return typed 409 payload.
        if (order.blocked) {
            logger.warn(`[PEDIDOS] Order #${id} blocked due to ${order.reason || 'UNKNOWN'}: ${order.message}`);
            const blockedCode = order.reason || (
                order.deficit !== undefined || order.saldoBolsa !== undefined
                    ? 'BOLSA_INSUFICIENTE'
                    : 'STOCK_INSUFICIENTE'
            );
            const payload = {
                success: false,
                blocked: true,
                reason: order.reason,
                code: blockedCode,
                message: order.message,
            };

            if (order.reason === 'BOLSA_INSUFICIENTE') {
                if (order.deficit !== undefined) payload.deficit = order.deficit;
                if (order.saldoBolsa !== undefined) payload.saldoBolsa = order.saldoBolsa;
                if (order.warnings !== undefined) payload.warnings = order.warnings;
                payload.details = {
                    deficit: order.deficit,
                    saldoBolsa: order.saldoBolsa,
                    warnings: order.warnings,
                };
            } else {
                payload.stockWarnings = order.stockWarnings;
                payload.alternatives = order.alternatives;
            }

            return res.status(409).json(payload);
        }

        logger.info(`[PEDIDOS] Order #${id} confirmed successfully`);
        res.json({ success: true, order: sanitizeOrderForRole(order, req.user?.role || req.user?.tipo || 'COMERCIAL') });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/confirm: ${error.message}`);
        // Errores tipados (PEDIDO_ALREADY_CONFIRMING / PEDIDO_INVALID_STATE) traen
        // error.status; respetamos eso y devolvemos error.code al cliente.
        const status = (error.status && Number.isInteger(error.status))
            ? error.status
            : (error.message.includes('not found') ? 404
                : error.message.includes('BORRADOR') ? 409
                : error.message.includes('Fecha reparto') ? 409
                : error.message.includes('reserva de stock') ? 500
                : 500);
        res.status(status).json({
            success: false,
            code: error.code || undefined,
            error: error.message,
        });
    }
});

/**
 * DELETE /api/pedidos/:id
 * Cancel an order (only BORRADOR or CONFIRMADO, not ENVIADO)
 */
router.delete('/:id', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) {
            return res.status(400).json({ success: false, error: 'Invalid order id' });
        }

        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        await pedidosService.cancelOrder(id);

        res.json({ success: true });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in DELETE /${req.params.id}: ${error.message}`);
        const status = error.message.includes('not found') ? 404
            : error.message.includes('ENVIADO') ? 409
            : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

// PUT aliases for mobile app (ApiClient has no DELETE method)
router.put('/:id/lines/:lineId/delete', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        const lineId = parseIntSafe(req.params.lineId, null);
        if (id === null || lineId === null) {
            return res.status(400).json({ success: false, error: 'Invalid order or line id' });
        }
        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }
        await pedidosService.deleteOrderLine(lineId, id);
        res.json({ success: true });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/lines/${req.params.lineId}/delete: ${error.message}`);
        const status = error.message.includes('BORRADOR') ? 409
            : error.message.includes('not found') ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

router.put('/:id/cancel', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) {
            return res.status(400).json({ success: false, error: 'Invalid order id' });
        }
        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        await pedidosService.cancelOrder(id, { userId: req.user?.code || 'SYSTEM' });
        res.json({ success: true });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/cancel: ${error.message}`);
        const status = error.message.includes('not found') ? 404
            : error.message.includes('ENVIADO') ? 409 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/pedidos/:id/status
 * Update order status (for Pendiente aprobación, Enviar, etc.)
 */
router.put('/:id/status', async (req, res) => {
    try {
        const id = parseIntSafe(req.params.id, null);
        if (id === null) {
            return res.status(400).json({ success: false, error: 'Invalid order id' });
        }
        const ownership = await authorizePedidoMutation(req, id);
        if (!ownership.ok) {
            return res.status(ownership.status).json(ownership.body);
        }

        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, error: 'Status is required' });
        }
        const result = await pedidosService.updateOrderStatus(id, status, { userId: req.user?.code || 'SYSTEM' });
        res.json({ success: true, order: result });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/status: ${error.message}`);
        const status = error.message.includes('not found') ? 404
            : error.message.includes('no válido') ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

// =============================================================================
// SIMILAR PRODUCTS (stock alternatives)
// =============================================================================

/**
 * GET /api/pedidos/similar-products/:code
 * Find alternative products from the same family/subfamily with stock available
 */
router.get('/similar-products/:code', async (req, res) => {
    try {
        const code = req.params.code;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Product code is required' });
        }
        const alternatives = await pedidosService.getSimilarProducts(code.trim());
        res.json({ success: true, product: code.trim(), alternatives });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /similar-products/${req.params.code}: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/search-products
 * Search products with available stock (for fallback search in stock alternatives modal)
 * Query params: q (search term), limit (default 20)
 */
router.get('/search-products', async (req, res) => {
    try {
        const searchTerm = (req.query.q || '').trim();
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        
        if (searchTerm.length < 2) {
            return res.json({ success: true, products: [] });
        }
        
        const products = await pedidosService.searchProductsWithStock(searchTerm, limit);
        res.json({ success: true, products });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /search-products: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// DEBUG ENDPOINTS (for testing only)
// =============================================================================

const debugMiddleware = (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ success: false, error: 'Debug endpoints disabled in production' });
    }
    next();
};

/**
 * GET /api/pedidos/debug/estados
 * Documentación de estados de pedidos
 */
router.get('/debug/estados', debugMiddleware, (req, res) => {
    res.json({
        estados: {
            BORRADOR: 'Estado inicial. Pedido creado en la app pero sin confirmar.',
            PENDIENTE_APROBACION: 'Pedido pendiente de aprobacion antes de confirmarlo.',
            CONFIRMANDO: 'Estado tecnico temporal mientras se valida stock y se confirma.',
            CONFIRMADO: 'Pedido confirmado por el comercial. Listo para proceso de almacén.',
            ENVIADO: 'Pedido enviado/entregado. Se marca externamente (CPC/albarán generado).',
            ANULADO: 'Pedido anulado/cancelado.'
        },
        transiciones: {
            'BORRADOR -> CONFIRMADO': 'Usuario confirma en detalle del pedido (botón)',
            'BORRADOR -> PENDIENTE_APROBACION -> CONFIRMADO': 'Flujo con aprobacion previa antes de validar stock y confirmar',
            'CONFIRMADO -> ENVIADO': 'Se marcaexternamente cuando se genera albarán',
            'BORRADOR/CONFIRMADO -> ANULADO': 'Usuario cancela el pedido'
        },
        valoresPermitidos: ['BORRADOR', 'PENDIENTE_APROBACION', 'CONFIRMANDO', 'CONFIRMADO', 'ENVIADO', 'ANULADO']
    });
});

/**
 * POST /api/pedidos/debug/set-estado
 * Cambiar estado de un pedido (para pruebas)
 * Body: { orderId, estado }
 */
router.post('/debug/set-estado', debugMiddleware, async (req, res) => {
    try {
        const { orderId, estado } = req.body;
        const estadosValidos = ['BORRADOR', 'PENDIENTE_APROBACION', 'CONFIRMADO', 'ENVIADO', 'ANULADO'];
        
        if (!orderId) {
            return res.status(400).json({ success: false, error: 'Falta orderId' });
        }
        const canonicalEstado = pedidosService.canonicalOrderStatus(estado);
        if (!estado || !estadosValidos.includes(canonicalEstado)) {
            return res.status(400).json({ 
                success: false, 
                error: `Estado inválido. Valores: ${estadosValidos.join(', ')}` 
            });
        }

        const storedEstado = pedidosService.storedOrderStatus(canonicalEstado);
        await queryWithParams(
            buildUpdatePedidoEstadoSql(),
            [storedEstado, orderId],
            false
        );
        
        logger.info(`[DEBUG] Pedido #${orderId} -> ESTADO = ${storedEstado} (canonical: ${canonicalEstado})`);
        res.json({ success: true, orderId, estado: canonicalEstado, storedEstado });
    } catch (error) {
        logger.error(`[DEBUG] Error set-estado: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/pedidos/debug/list-estados
 * Listar pedidos con sus estados actuales
 * Query: vendedorCode (optional), limit (default 50)
 */
router.get('/debug/list-estados', debugMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const vendedorCode = (req.query.vendedorCode || '').replace(/[^a-zA-Z0-9]/g, '').trim();

        let sql;
        let params;

        if (vendedorCode) {
            sql = `
                SELECT ID, NUMEROPEDIDO, SERIEPEDIDO, CODIGOCLIENTE, ESTADO, IMPORTETOTAL,
                       DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
                FROM JAVIER.PEDIDOS_CAB
                WHERE TRIM(CODIGOVENDEDOR) = CAST(? AS VARCHAR(50))
                ORDER BY ID DESC FETCH FIRST ${limit} ROWS ONLY
            `;
            params = [vendedorCode];
        } else {
            sql = `
                SELECT ID, NUMEROPEDIDO, SERIEPEDIDO, CODIGOCLIENTE, ESTADO, IMPORTETOTAL,
                       DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
                FROM JAVIER.PEDIDOS_CAB
                ORDER BY ID DESC FETCH FIRST ${limit} ROWS ONLY
            `;
            params = [];
        }

        const rows = await queryWithParams(sql, params, false);
        res.json({ success: true, pedidos: rows });
    } catch (error) {
        logger.error(`[DEBUG] Error list-estados: ${error.message}`);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/pedidos/purchase-history-global
 * =========================================
 * Historico GLOBAL de compras (todos los clientes, todos los productos).
 * Fuente: DSED.LACLAE (lineas albaranes). Devuelve detalle linea-a-linea y
 * resumen agregado para construir tablas + graficos en la UI.
 *
 * Query params (todos opcionales):
 *   - from (YYYY-MM-DD): default = 1 enero del año actual
 *   - to   (YYYY-MM-DD): default = hoy
 *   - vendedorCode (str): filtra por LCCDVD. Si "ALL" no filtra. Si el usuario
 *     no es JEFE el backend fuerza a su propio vendedor.
 *   - clientCode (str): filtra por LCCDCL
 *   - productCode (str): filtra por LCCDRF
 *   - limit (int, max 500, default 100)
 *   - offset (int, default 0)
 *
 * Devuelve: { success, lines: [...], summary: {...}, pagination: {...} }
 */
router.get('/purchase-history-global', async (req, res) => {
    try {
        const userIsJefe = req.user?.role === 'JEFE_VENTAS' || req.user?.role === 'ADMIN';
        const userVendor = String(req.user?.code || '').trim();

        // Fechas
        const now = new Date();
        const defaultFrom = new Date(now.getFullYear(), 0, 1);
        const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
        const to = req.query.to ? new Date(String(req.query.to)) : now;
        const fromYmd = from.getFullYear() * 10000 + (from.getMonth() + 1) * 100 + from.getDate();
        const toYmd = to.getFullYear() * 10000 + (to.getMonth() + 1) * 100 + to.getDate();

        // Filtros
        let vendor = String(req.query.vendedorCode || '').trim();
        if (!userIsJefe) {
            if (!userVendor) {
                return res.status(403).json({
                    success: false,
                    code: 'FORBIDDEN_VENDOR',
                    error: 'COMERCIAL sin vendedor autenticado',
                });
            }
            vendor = userVendor; // comercial solo ve lo suyo
        }
        const isAllVendor = !vendor || vendor.toUpperCase() === 'ALL';
        const clientCode = String(req.query.clientCode || '').trim();
        const productCode = String(req.query.productCode || '').trim();
        const familia = String(req.query.familia || '').trim();
        const marca = String(req.query.marca || '').trim();

        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;

        // Condiciones WHERE
        const where = [
            `(L.LCAADC * 10000 + L.LCMMDC * 100 + L.LCDDDC) BETWEEN ? AND ?`,
            `L.LCTPVT IN ('CC','VC') AND L.LCCLLN IN ('VT','AB')`,
            `L.LCSRAB NOT IN ('N','Z','G','D')`,
        ];
        const params = [fromYmd, toYmd];

        if (!isAllVendor) {
            // Soporta lista separada por comas
            const vendors = vendor.split(',').map(v => v.trim()).filter(Boolean);
            if (vendors.length > 0 && vendors.length <= 50) {
                where.push(`TRIM(L.LCCDVD) IN (${vendors.map(() => '?').join(',')})`);
                params.push(...vendors);
            } else if (vendors.length > 50) {
                // Embed sanitizado para evitar limite ODBC
                const safe = vendors
                    .filter(v => /^[A-Za-z0-9]{1,10}$/.test(v))
                    .map(v => `'${v.replace(/'/g, "''")}'`)
                    .join(',');
                if (safe) where.push(`TRIM(L.LCCDVD) IN (${safe})`);
            }
        }
        if (clientCode) {
            where.push(`TRIM(L.LCCDCL) = ?`);
            params.push(clientCode);
        }
        if (productCode) {
            where.push(`TRIM(L.LCCDRF) = ?`);
            params.push(productCode);
        }
        // Filtros adicionales por familia y marca (vienen de DSEDAC.ART
        // via el JOIN con A en la consulta detalle/top).
        if (familia) {
            where.push(`L.LCCDRF IN (SELECT CODIGOARTICULO FROM DSEDAC.ART WHERE TRIM(CODIGOFAMILIA) = ?)`);
            params.push(familia);
        }
        if (marca) {
            where.push(`L.LCCDRF IN (SELECT CODIGOARTICULO FROM DSEDAC.ART WHERE TRIM(CODIGOMARCA) = ?)`);
            params.push(marca);
        }

        const whereSql = where.join(' AND ');

        // 1) DETALLE linea a linea (paginado)
        const detailSql = `
            SELECT
                L.LCAADC AS ANO, L.LCMMDC AS MES, L.LCDDDC AS DIA,
                TRIM(L.LCCDCL) AS CODIGOCLIENTE,
                COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) AS NOMBRECLIENTE,
                TRIM(L.LCCDVD) AS CODIGOVENDEDOR,
                TRIM(L.LCCDRF) AS CODIGOARTICULO,
                TRIM(A.DESCRIPCIONARTICULO) AS DESCRIPCIONARTICULO,
                L.LCCTUD AS CANTIDADUNIDADES,
                L.LCCTEV AS CANTIDADENVASES,
                L.LCPRVT AS PRECIOVENTA,
                L.LCPJDT AS PORCENTAJEDESCUENTO,
                L.LCIMVT AS IMPORTEVENTA,
                (L.LCCTUD * L.LCPRVT) AS IMPORTESINDESCUENTO,
                (L.LCCTUD * L.LCPRVT - L.LCIMVT) AS IMPORTEDESCUENTO,
                TRIM(L.LCCDFP) AS CODIGOFORMAPAGO,
                TRIM(L.LCSRAB) AS SERIEALBARAN, L.LCNRAB AS NUMEROALBARAN
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.CLI C ON TRIM(C.CODIGOCLIENTE) = TRIM(L.LCCDCL)
            WHERE ${whereSql}
            ORDER BY L.LCAADC DESC, L.LCMMDC DESC, L.LCDDDC DESC
            OFFSET ${offset} ROWS FETCH FIRST ${limit} ROWS ONLY
        `;

        // 2) RESUMEN agregado
        const summarySql = `
            SELECT
                COUNT(*) AS NUM_LINEAS,
                COUNT(DISTINCT TRIM(L.LCCDCL)) AS NUM_CLIENTES,
                COUNT(DISTINCT TRIM(L.LCCDRF)) AS NUM_PRODUCTOS,
                COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENDIDO,
                COALESCE(SUM(L.LCCTUD * L.LCPRVT), 0) AS TOTAL_SIN_DESCUENTO,
                COALESCE(SUM(L.LCCTUD * L.LCPRVT - L.LCIMVT), 0) AS TOTAL_DESCUENTO,
                COALESCE(SUM(L.LCCTUD), 0) AS TOTAL_UNIDADES
            FROM DSED.LACLAE L
            WHERE ${whereSql}
        `;

        // 3) TOP 10 productos del periodo
        const topProductosSql = `
            SELECT
                TRIM(L.LCCDRF) AS CODE,
                TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                COALESCE(SUM(L.LCIMVT), 0) AS IMPORTE,
                COALESCE(SUM(L.LCCTUD), 0) AS UNIDADES,
                COUNT(*) AS NUM_LINEAS
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            WHERE ${whereSql}
            GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
            ORDER BY IMPORTE DESC
            FETCH FIRST 10 ROWS ONLY
        `;

        // 4) Comparacion misma fecha año anterior (lo que el usuario llamo "a estas alturas")
        const lastYearSql = `
            SELECT COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_LAST_YEAR
            FROM DSED.LACLAE L
            WHERE ${whereSql}
        `;
        const lastYearFrom = (from.getFullYear() - 1) * 10000 + (from.getMonth() + 1) * 100 + from.getDate();
        const lastYearTo = (to.getFullYear() - 1) * 10000 + (to.getMonth() + 1) * 100 + to.getDate();
        const lastYearParams = [lastYearFrom, lastYearTo, ...params.slice(2)];

        // 5) Mensual por año: agrupa importe por ANO y MES para gráfico multi-año
        const monthlyByYearSql = `
            SELECT
                L.LCAADC AS ANO,
                L.LCMMDC AS MES,
                COALESCE(SUM(L.LCIMVT), 0) AS TOTAL_VENDIDO,
                COALESCE(SUM(L.LCCTUD * L.LCPRVT), 0) AS TOTAL_SIN_DESCUENTO,
                COALESCE(SUM(L.LCCTUD * L.LCPRVT - L.LCIMVT), 0) AS TOTAL_DESCUENTO,
                COALESCE(SUM(L.LCCTUD), 0) AS TOTAL_UNIDADES,
                COUNT(*) AS NUM_LINEAS
            FROM DSED.LACLAE L
            WHERE ${whereSql}
            GROUP BY L.LCAADC, L.LCMMDC
            ORDER BY L.LCAADC DESC, L.LCMMDC
        `;

        const [detail, summary, topProducts, lastYear, monthlyByYear] = await Promise.all([
            queryWithParams(detailSql, params, []),
            queryWithParams(summarySql, params, []),
            queryWithParams(topProductosSql, params, []),
            queryWithParams(lastYearSql, lastYearParams, []),
            queryWithParams(monthlyByYearSql, params, []),
        ]);

        const s = summary?.[0] || {};
        const totalThisPeriod = parseFloat(s.TOTAL_VENDIDO) || 0;
        const totalLastYear = parseFloat(lastYear?.[0]?.TOTAL_LAST_YEAR) || 0;
        const variation = totalLastYear > 0
            ? ((totalThisPeriod - totalLastYear) / totalLastYear) * 100
            : null;

        res.json({
            success: true,
            filters: {
                from: from.toISOString().slice(0, 10),
                to: to.toISOString().slice(0, 10),
                vendedorCode: isAllVendor ? 'ALL' : vendor,
                clientCode: clientCode || null,
                productCode: productCode || null,
                familia: familia || null,
                marca: marca || null,
            },
            summary: {
                numLineas: parseInt(s.NUM_LINEAS) || 0,
                numClientes: parseInt(s.NUM_CLIENTES) || 0,
                numProductos: parseInt(s.NUM_PRODUCTOS) || 0,
                totalVendido: totalThisPeriod,
                totalSinDescuento: parseFloat(s.TOTAL_SIN_DESCUENTO) || 0,
                totalDescuento: parseFloat(s.TOTAL_DESCUENTO) || 0,
                totalUnidades: parseFloat(s.TOTAL_UNIDADES) || 0,
                comparativaAnoAnterior: {
                    totalAnoAnterior: totalLastYear,
                    variacionPct: variation,
                },
            },
            topProducts: (topProducts || []).map(t => ({
                code: (t.CODE || '').trim(),
                name: (t.NAME || '').trim(),
                importe: parseFloat(t.IMPORTE) || 0,
                unidades: parseFloat(t.UNIDADES) || 0,
                numLineas: parseInt(t.NUM_LINEAS) || 0,
            })),
            lines: (detail || []).map(r => ({
                fecha: `${r.ANO}-${String(r.MES).padStart(2, '0')}-${String(r.DIA).padStart(2, '0')}`,
                clienteCode: (r.CODIGOCLIENTE || '').trim(),
                clienteName: (r.NOMBRECLIENTE || '').trim(),
                vendedorCode: (r.CODIGOVENDEDOR || '').trim(),
                productCode: (r.CODIGOARTICULO || '').trim(),
                productName: (r.DESCRIPCIONARTICULO || '').trim(),
                cantidad: parseFloat(r.CANTIDADUNIDADES) || 0,
                envases: parseFloat(r.CANTIDADENVASES) || 0,
                precio: parseFloat(r.PRECIOVENTA) || 0,
                descuentoPct: parseFloat(r.PORCENTAJEDESCUENTO) || 0,
                importe: parseFloat(r.IMPORTEVENTA) || 0,
                importeSinDescuento: parseFloat(r.IMPORTESINDESCUENTO) || 0,
                importeDescuento: parseFloat(r.IMPORTEDESCUENTO) || 0,
                formaPago: (r.CODIGOFORMAPAGO || '').trim(),
                albaran: `${(r.SERIEALBARAN || '').trim()}-${r.NUMEROALBARAN || ''}`,
            })),
            monthlyByYear: (monthlyByYear || []).map(r => ({
                year: parseInt(r.ANO),
                month: parseInt(r.MES),
                totalVendido: parseFloat(r.TOTAL_VENDIDO) || 0,
                totalSinDescuento: parseFloat(r.TOTAL_SIN_DESCUENTO) || 0,
                totalDescuento: parseFloat(r.TOTAL_DESCUENTO) || 0,
                totalUnidades: parseFloat(r.TOTAL_UNIDADES) || 0,
                numLineas: parseInt(r.NUM_LINEAS) || 0,
            })),
            pagination: { limit, offset, hasMore: (detail || []).length === limit },
        });
    } catch (error) {
        // STACK COMPLETO + odbcErrors para diagnostico (el 500 en 3ms suele ser
        // error de sintaxis SQL o de prepare antes de tocar la BD).
        const odbc0 = error.odbcErrors && error.odbcErrors[0];
        const odbcMsg = odbc0 ? `${odbc0.state} (${odbc0.code}): ${odbc0.message}` : '';
        logger.error(`[PEDIDOS] purchase-history-global ERROR: ${error.message}\n  ODBC: ${odbcMsg}\n  STACK: ${error.stack || ''}`);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo historico global',
            detail: process.env.NODE_ENV !== 'production' ? error.message : undefined,
            odbc: process.env.NODE_ENV !== 'production' ? odbcMsg : undefined,
        });
    }
});

module.exports = router;
