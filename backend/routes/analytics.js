const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { handleRouteError } = require('../utils/common');
const { verifyToken } = require('../middleware/auth');
const { authorizeVendorScope, isFinancialRole, requireVendorQueryScope } = require('../middleware/vendor-scope');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const analyticsService = require('../services/analytics-service');

// DI composition: la ruta aporta el mapeo fisico de tablas (test/isolated_test
// incluido) y el service/repo ejecutan sobre el. Uso genuino de
// comercialErpTable en la capa de ruta.
function analyticsTables() {
    return {
        LACLAE: comercialErpTable('LACLAE'),
        CLI: comercialErpTable('CLI'),
        LINDTO: comercialErpTable('LINDTO'),
        ART: comercialErpTable('ART'),
        ARTX: comercialErpTable('ARTX'),
        LAC: comercialErpTable('LAC'),
    };
}

function serviceError(res, error, fallbackMessage, fallbackCode) {
    if (error && error.status) {
        return res.status(error.status).json({
            success: false,
            code: error.code || fallbackCode,
            error: error.message,
        });
    }
    handleRouteError(error, res, fallbackMessage, 500, { code: fallbackCode });
}

// =============================================================================
// YOY COMPARISON (Using LACLAE with LCIMVT for sales without VAT)
// =============================================================================
router.get('/yoy-comparison', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes, year, month } = req.query;
        res.json(await analyticsService.getYoyComparison(
            { vendedorCodes, year, month },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        logger.error(`YoY error: ${error.message}`);
        serviceError(res, error, 'Error obteniendo comparación', 'ANALYTICS_YOY_ERROR');
    }
});

// =============================================================================
// TOP CLIENTS (Using LACLAE with LCIMVT)
// =============================================================================
router.get('/top-clients', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes, year, month, limit = 10 } = req.query;
        res.json(await analyticsService.getTopClients(
            { vendedorCodes, year, month, limit },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        logger.error(`Top clients error: ${error.message} | stack: ${error.stack?.substring(0, 300)}`);
        serviceError(res, error, 'Error top clients', 'ANALYTICS_TOP_CLIENTS_ERROR');
    }
});

// =============================================================================
// TRENDS (Using LACLAE with LCIMVT)
// =============================================================================
router.get('/trends', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        res.json(await analyticsService.getTrends(
            { vendedorCodes },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        logger.error(`Trends error: ${error.message}`);
        serviceError(res, error, 'Error calculating trends', 'ANALYTICS_TRENDS_ERROR');
    }
});

// =============================================================================
// TOP PRODUCTS
// =============================================================================
router.get('/top-products', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes, limit = 20 } = req.query;
        res.json(await analyticsService.getTopProducts(
            { vendedorCodes, limit, year: req.query.year },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        logger.error(`Top Products error: ${error.message} `);
        serviceError(res, error, 'Error obteniendo productos', 'ANALYTICS_TOP_PRODUCTS_ERROR');
    }
});

// =============================================================================
// MARGIN ANALYSIS
// =============================================================================
router.get('/margins', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes } = req.query;
        res.json(await analyticsService.getMargins(
            { vendedorCodes, year: req.query.year },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        logger.error(`Margins error: ${error.message} `);
        serviceError(res, error, 'Error obteniendo márgenes', 'ANALYTICS_MARGINS_ERROR');
    }
});


// =============================================================================
// SALES HISTORY EXPLORER (Detailed Product Sales)
// =============================================================================
router.get('/sales-history', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const {
            vendedorCodes,
            clientCode,
            productSearch,
            startDate,
            endDate,
            limit = 100,
            offset = 0,
        } = req.query;

        const rawVendor = String(vendedorCodes || '').trim();
        let requestedScope;
        if (!rawVendor) {
            requestedScope = isFinancialRole(req.user)
                ? 'ALL'
                : [String(req.user?.code || '').trim()].filter(Boolean);
        } else if (rawVendor.toUpperCase() === 'ALL') {
            requestedScope = 'ALL';
        } else {
            requestedScope = rawVendor.split(',').map((code) => code.trim()).filter(Boolean);
        }
        const scopeCheck = authorizeVendorScope(
            req,
            requestedScope === 'ALL' ? 'ALL' : requestedScope,
        );
        const financialCanPickVendors = isFinancialRole(req.user) && requestedScope !== 'ALL';
        if (!scopeCheck.ok && !financialCanPickVendors) {
            return res.status(403).json({
                success: false,
                code: 'VENDOR_SCOPE_FORBIDDEN',
                error: 'Forbidden: vendedor fuera de tu alcance',
                denied: scopeCheck.denied,
            });
        }

        res.json(await analyticsService.getSalesHistory(
            {
                requestedScope,
                clientCode,
                productSearch,
                startDate,
                endDate,
                limit,
                offset,
                user: req.user,
            },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        serviceError(res, error, 'Error obteniendo histórico de ventas', 'ANALYTICS_SALES_HISTORY_ERROR');
    }
});


// =============================================================================
// SALES HISTORY SUMMARY (Comparison Header)
// =============================================================================
router.get('/sales-history/summary', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { vendedorCodes, clientCode, productSearch, startDate, endDate } = req.query;
        res.json(await analyticsService.getSalesHistorySummary(
            { vendedorCodes, clientCode, productSearch, startDate, endDate },
            { tables: analyticsTables() },
        ));
    } catch (error) {
        serviceError(res, error, 'Error calculating summary', 'ANALYTICS_SALES_SUMMARY_ERROR');
    }
});

module.exports = router;
