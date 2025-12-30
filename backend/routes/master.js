const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const {
    getCurrentDate,
    formatCurrency
} = require('../utils/common');

// =============================================================================
// PRODUCTS LIST
// =============================================================================
router.get('/products', async (req, res) => {
    try {
        const { search, limit = 50, offset = 0 } = req.query;

        let searchFilter = '';
        if (search) {
            const safeSearch = search.replace(/'/g, "''").trim().toUpperCase();
            searchFilter = `AND(UPPER(DESCRIPCIONARTICULO) LIKE '%${safeSearch}%' 
                      OR CODIGOARTICULO LIKE '%${safeSearch}%'
                      OR UPPER(CODIGOMARCA) LIKE '%${safeSearch}%')`;
        }

        const products = await query(`
      SELECT CODIGOARTICULO as code, DESCRIPCIONARTICULO as name,
  CODIGOMARCA as brand, CODIGOFAMILIA as family,
  UNIDADESCAJA as unitsPerBox, PESO as weight
      FROM DSEDAC.ART
      WHERE ANOBAJA = 0 ${searchFilter}
      ORDER BY DESCRIPCIONARTICULO
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

        res.json({
            products: products.map(p => ({
                code: p.CODE?.trim(),
                name: p.NAME?.trim() || 'Sin nombre',
                brand: p.BRAND?.trim(),
                family: p.FAMILY?.trim(),
                unitsPerBox: parseInt(p.UNITSPERBOX) || 1,
                weight: parseFloat(p.WEIGHT) || 0
            })),
            hasMore: products.length === parseInt(limit)
        });

    } catch (error) {
        logger.error(`Products error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo productos', details: error.message });
    }
});

// =============================================================================
// VENDEDORES LIST
// =============================================================================
router.get('/vendedores', async (req, res) => {
    try {
        const now = getCurrentDate();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);

        const vendedores = await query(`
SELECT
V.CODIGOVENDEDOR as code,
  V.TIPOVENDEDOR as type,
  X.CORREOELECTRONICO as email,
  X.JEFEVENTASSN as isJefe,
  COALESCE(S.TOTAL_VENTAS, 0) as totalSales,
  COALESCE(S.TOTAL_MARGEN, 0) as totalMargin,
  COALESCE(S.TOTAL_ENVASES, 0) as totalBoxes,
  COALESCE(S.TOTAL_CLIENTES, 0) as totalClients
      FROM DSEDAC.VDC V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      LEFT JOIN(
    SELECT CODIGOVENDEDOR,
    SUM(IMPORTEVENTA) as TOTAL_VENTAS,
    SUM(IMPORTEMARGENREAL) as TOTAL_MARGEN,
    SUM(CANTIDADENVASES) as TOTAL_ENVASES,
    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as TOTAL_CLIENTES
        FROM DSEDAC.LINDTO WHERE ANODOCUMENTO = ${year} AND MESDOCUMENTO = ${month}
        GROUP BY CODIGOVENDEDOR
  ) S ON TRIM(V.CODIGOVENDEDOR) = TRIM(S.CODIGOVENDEDOR)
      WHERE V.SUBEMPRESA = 'GMP'
      ORDER BY COALESCE(S.TOTAL_VENTAS, 0) DESC
    `);

        res.json({
            period: { year, month },
            vendedores: vendedores.map(v => ({
                code: v.CODE?.trim(),
                type: v.TYPE?.trim() || '-',
                email: v.EMAIL?.trim(),
                isJefe: v.ISJEFE === 'S',
                totalSales: formatCurrency(v.TOTALSALES),
                totalMargin: formatCurrency(v.TOTALMARGIN),
                totalBoxes: parseInt(v.TOTALBOXES) || 0,
                totalClients: parseInt(v.TOTALCLIENTS) || 0
            }))
        });

    } catch (error) {
        logger.error(`Vendedores error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo vendedores', details: error.message });
    }
});

module.exports = router;
