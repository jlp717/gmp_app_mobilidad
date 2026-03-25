/**
 * PEDIDOS ROUTES (CommonJS)
 * ==========================
 * Endpoints for order management from the mobile app.
 * Product catalog, pricing, stock, order CRUD, recommendations.
 */

const express = require('express');
const router = express.Router();
const pedidosService = require('../services/pedidos.service');
const logger = require('../middleware/logger');
const { sanitizeForSQL } = require('../utils/common');
const { queryWithParams } = require('../config/db');

// =============================================================================
// INITIALIZATION
// =============================================================================
(async () => {
    try {
        await pedidosService.initPedidosTables();
        logger.info('Pedidos tables initialized');
    } catch (error) {
        logger.error(`Error initializing pedidos tables: ${error.message}`);
    }
})();

// =============================================================================
// HELPERS
// =============================================================================

function parseIntSafe(value, defaultVal) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultVal : parsed;
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
        const { vendedorCodes, clientCode, family, marca } = req.query;

        if (!vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        const search = req.query.search ? sanitizeForSQL(req.query.search) : undefined;
        const limit = parseIntSafe(req.query.limit, 50);
        const offset = parseIntSafe(req.query.offset, 0);

        const result = await pedidosService.searchProducts({
            vendedorCodes,
            search,
            clientCode: clientCode ? String(clientCode).trim() : undefined,
            family: family ? String(family).trim() : undefined,
            marca: marca ? String(marca).trim() : undefined,
            limit,
            offset
        });

        res.json({ success: true, products: result.products, count: result.count });
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

        const product = await pedidosService.getProductDetail(code, clientCode);

        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        res.json({ success: true, product });
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

        const pricing = await pedidosService.getClientPricing(clientCode);

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
        const balance = await pedidosService.getClientBalance(clientCode);
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
        const vendedorCodes = req.query.vendedorCodes || 'ALL';
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
        const products = await pedidosService.getComplementaryProducts(productCodes, clientCode);
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

        const recommendations = await pedidosService.getRecommendations(clientCode, vendedorCode);

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
                AVG(L.LCPRTC) AS AVG_PRICE,
                AVG(L.LCPRT1) AS AVG_TARIFF,
                AVG(CASE WHEN L.LCPJDT <> 0 THEN L.LCPJDT ELSE NULL END) AS AVG_DISCOUNT_PCT,
                COUNT(*) AS LINE_COUNT
            FROM DSED.LACLAE L
            WHERE L.LCCDCL = ?
              AND L.LCCDRF = ?
              AND L.LCAADC >= ?
              AND L.TPDC = 'LAC'
              AND L.LCTPVT IN ('CC', 'VC')
              AND L.LCCLLN IN ('AB', 'VT')
              AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
            GROUP BY L.LCAADC, L.LCMMDC
            ORDER BY L.LCAADC DESC, L.LCMMDC ASC
        `;

        const rows = await queryWithParams(sql, [clientCode, productCode, startYear]);

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
        const promotions = await pedidosService.getActivePromotions();
        res.json({ success: true, promotions });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /promotions: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================================================
// ORDERS — CRUD
// =============================================================================

/**
 * GET /api/pedidos
 * List orders with filters
 */
router.get('/', async (req, res) => {
    try {
        const { vendedorCodes, status, dateFrom, dateTo } = req.query;

        if (!vendedorCodes) {
            return res.status(400).json({ success: false, error: 'vendedorCodes is required' });
        }

        // Handle 'ALL' vendor code for JEFE_VENTAS
        const effectiveVendedorCodes = (vendedorCodes === 'ALL' && req.user && req.user.isJefeVentas)
            ? 'ALL'
            : vendedorCodes;

        const year = parseIntSafe(req.query.year, undefined);
        const month = parseIntSafe(req.query.month, undefined);
        const limit = parseIntSafe(req.query.limit, 50);
        const offset = parseIntSafe(req.query.offset, 0);

        const result = await pedidosService.getOrders({
            vendedorCodes: effectiveVendedorCodes,
            status: status ? String(status).trim() : undefined,
            year,
            month,
            dateFrom: dateFrom ? String(dateFrom).trim() : undefined,
            dateTo: dateTo ? String(dateTo).trim() : undefined,
            limit,
            offset
        });

        res.json({ success: true, orders: result.orders, count: result.count });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /: ${error.message}`);
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
        const detail = await pedidosService.generateOrderPdf(id);
        res.json({ success: true, order: detail });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in GET /${req.params.id}/pdf: ${error.message}`);
        res.status(error.message.includes('not found') ? 404 : 500).json({ success: false, error: error.message });
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

        const order = await pedidosService.getOrderDetail(id);

        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        res.json({ success: true, order });
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
            lines
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

        const order = await pedidosService.createOrder({
            clientCode: String(clientCode).trim(),
            clientName: clientName ? String(clientName).trim() : '',
            vendedorCode: String(vendedorCode).trim(),
            tipoventa: tipoventa ? String(tipoventa).trim() : undefined,
            almacen: almacen ? String(almacen).trim() : undefined,
            tarifa: tarifa ? String(tarifa).trim() : undefined,
            observaciones: observaciones ? String(observaciones).trim() : '',
            lines,
            userId: req.user ? req.user.vendedorCode : undefined
        });

        res.status(201).json({ success: true, order });
    } catch (error) {
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

        const {
            codigoArticulo, descripcion,
            cantidadEnvases, cantidadUnidades,
            unidadMedida, unidadesCaja,
            precioVenta, precioCosto, precioTarifa,
            precioTarifaCliente, precioMinimo
        } = req.body;

        if (!codigoArticulo) {
            return res.status(400).json({ success: false, error: 'codigoArticulo is required' });
        }

        const line = await pedidosService.addOrderLine(id, {
            codigoArticulo: String(codigoArticulo).trim(),
            descripcion: descripcion ? String(descripcion).trim() : '',
            cantidadEnvases: parseIntSafe(cantidadEnvases, 0),
            cantidadUnidades: parseIntSafe(cantidadUnidades, 0),
            unidadMedida: unidadMedida ? String(unidadMedida).trim() : undefined,
            unidadesCaja: parseIntSafe(unidadesCaja, 0),
            precioVenta: parseFloat(precioVenta) || 0,
            precioCosto: parseFloat(precioCosto) || 0,
            precioTarifa: parseFloat(precioTarifa) || 0,
            precioTarifaCliente: parseFloat(precioTarifaCliente) || 0,
            precioMinimo: parseFloat(precioMinimo) || 0
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

        const { cantidadEnvases, cantidadUnidades, precioVenta, unidadMedida } = req.body;

        const line = await pedidosService.updateOrderLine(id, lineId, {
            cantidadEnvases: cantidadEnvases !== undefined ? parseIntSafe(cantidadEnvases, 0) : undefined,
            cantidadUnidades: cantidadUnidades !== undefined ? parseIntSafe(cantidadUnidades, 0) : undefined,
            precioVenta: precioVenta !== undefined ? parseFloat(precioVenta) || 0 : undefined,
            unidadMedida: unidadMedida !== undefined ? String(unidadMedida).trim() : undefined
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

        await pedidosService.deleteOrderLine(id, lineId);

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

        const { saleType } = req.body;
        if (!saleType || !['CC', 'VC', 'NV'].includes(saleType)) {
            return res.status(400).json({ success: false, error: 'saleType must be CC, VC, or NV' });
        }

        const order = await pedidosService.confirmOrder(id, saleType);

        res.json({ success: true, order });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/confirm: ${error.message}`);
        const status = error.message.includes('not found') ? 404
            : error.message.includes('BORRADOR') ? 409
            : 500;
        res.status(status).json({ success: false, error: error.message });
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
        await pedidosService.deleteOrderLine(id, lineId);
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
        await pedidosService.cancelOrder(id);
        res.json({ success: true });
    } catch (error) {
        logger.error(`[PEDIDOS] Error in PUT /${req.params.id}/cancel: ${error.message}`);
        const status = error.message.includes('not found') ? 404
            : error.message.includes('ENVIADO') ? 409 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

module.exports = router;
