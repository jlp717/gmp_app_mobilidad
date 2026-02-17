const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const {
    buildVendedorFilter,
    formatCurrency,
    MIN_YEAR
} = require('../utils/common');

// =============================================================================
// EXPORT DATA (for PDF generation)
// =============================================================================
router.get('/client-report', async (req, res) => {
    try {
        const { code, vendedorCodes } = req.query;
        if (!code) {
            return res.status(400).json({ error: 'Se requiere código de cliente' });
        }

        const safeCode = code.replace(/'/g, "''").trim();
        const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

        // Get complete client data for PDF report
        const clientRows = await query(`
      SELECT CODIGOCLIENTE as code, NOMBRECLIENTE as name, NIF as nif,
             DIRECCION as address, POBLACION as city, PROVINCIA as province,
             CODIGOPOSTAL as postalCode, TELEFONO1 as phone, CODIGORUTA as route
      FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${safeCode}'
    `);
        const clientInfo = clientRows && clientRows.length > 0 ? clientRows[0] : null;

        // Yearly summary
        const yearlySummary = await query(`
      SELECT ANODOCUMENTO as year,
             SUM(IMPORTEVENTA) as sales,
             SUM(IMPORTEMARGENREAL) as margin,
             SUM(CANTIDADENVASES) as boxes,
             COUNT(DISTINCT MESDOCUMENTO) as activeMonths
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = '${safeCode}' 
        AND ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY ANODOCUMENTO
      ORDER BY ANODOCUMENTO
    `);

        // Top 10 products
        const topProducts = await query(`
      SELECT L.CODIGOARTICULO as code,
             COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Producto') as name,
             SUM(L.IMPORTEVENTA) as sales,
             SUM(L.CANTIDADENVASES) as boxes,
             COUNT(*) as orders
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}' 
        AND L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `);

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
        logger.error(`Export error: ${error.message} `);
        res.status(500).json({ error: 'Error exportando datos', details: error.message });
    }
});

module.exports = router;
