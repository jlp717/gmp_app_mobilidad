const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireVendorQueryScope } = require('../middleware/vendor-scope');
const logger = require('../middleware/logger');
const { query, queryWithParams } = require('../config/db');
const {
    buildVendedorFilter,
    formatCurrency,
    MIN_YEAR,
    sanitizeForSQL,
    handleRouteError
} = require('../utils/common');
const { comercialErpTable } = require('../utils/comercial-erp-tables');

// =============================================================================
// EXPORT DATA (for PDF generation)
// =============================================================================
router.get('/client-report', verifyToken, requireVendorQueryScope, async (req, res) => {
    try {
        const { code, vendedorCodes } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'Se requiere código de cliente' });
        }

        const safeCode = sanitizeForSQL(code.trim());
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

        // Get complete client data for PDF report
        const clientRows = await queryWithParams(`
      SELECT CODIGOCLIENTE as code, NOMBRECLIENTE as name, NIF as nif,
             DIRECCION as address, POBLACION as city, PROVINCIA as province,
             CODIGOPOSTAL as postalCode, TELEFONO1 as phone, CODIGORUTA as route
      FROM ${comercialErpTable('CLI')} WHERE CODIGOCLIENTE = ?
    `, [safeCode]);
        const clientInfo = clientRows && clientRows.length > 0 ? clientRows[0] : null;

        // Yearly summary
        const yearlySummary = await queryWithParams(`
      SELECT ANODOCUMENTO as year,
             SUM(IMPORTEVENTA) as sales,
             SUM(IMPORTEMARGENREAL) as margin,
             SUM(CANTIDADENVASES) as boxes,
             COUNT(DISTINCT MESDOCUMENTO) as activeMonths
      FROM ${comercialErpTable('LINDTO')}
      WHERE CODIGOCLIENTEALBARAN = ?
        AND ANODOCUMENTO >= ? ${vendedorFilter}
      GROUP BY ANODOCUMENTO
      ORDER BY ANODOCUMENTO
    `, [safeCode, MIN_YEAR]);

        // Top 10 products
        const topProducts = await queryWithParams(`
      SELECT L.CODIGOARTICULO as code,
             COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Producto') as name,
             SUM(L.IMPORTEVENTA) as sales,
             SUM(L.CANTIDADENVASES) as boxes,
             COUNT(*) as orders
      FROM ${comercialErpTable('LINDTO')} L
      LEFT JOIN ${comercialErpTable('ART')} A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.CODIGOCLIENTEALBARAN = ?
        AND L.ANODOCUMENTO >= ? ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `, [safeCode, MIN_YEAR]);

        res.json({
            exportDate: new Date().toISOString(),
            client: clientInfo ? {
                code: clientInfo.CODE?.trim(),
                name: clientInfo.NAME?.trim(),
                nif: clientInfo.NIF?.trim(),
                address: clientInfo.ADDRESS?.trim(),
                city: clientInfo.CITY?.trim(),
                province: clientInfo.PROVINCE?.trim(),
                phone: clientInfo.PHONE?.trim(),
                route: clientInfo.ROUTE?.trim()
            } : null,
            yearlySummary: yearlySummary.map(y => ({
                year: y.YEAR,
                sales: formatCurrency(y.SALES),
                margin: formatCurrency(y.MARGIN),
                boxes: parseInt(y.BOXES) || 0,
                activeMonths: parseInt(y.ACTIVEMONTHS) || 0
            })),
            topProducts: topProducts.map(p => ({
                code: p.CODE?.trim(),
                name: p.NAME?.trim(),
                sales: formatCurrency(p.SALES),
                boxes: parseInt(p.BOXES) || 0,
                orders: parseInt(p.ORDERS) || 0
            }))
        });

    } catch (error) {
        handleRouteError(error, res, 'Error exportando datos', 500);
    }
});

module.exports = router;
