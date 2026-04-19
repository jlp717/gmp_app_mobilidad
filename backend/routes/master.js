const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const {
    getCurrentDate,
    formatCurrency,
    sanitizeForSQL
} = require('../utils/common');

// =============================================================================
// PRODUCTS LIST (OPTIMIZED with caching)
// =============================================================================
router.get('/products', async (req, res) => {
    try {
        const { search, limit = 50, offset = 0 } = req.query;

        let searchFilter = '';
        if (search) {
            const safeSearch = sanitizeForSQL(search.trim().toUpperCase());
            searchFilter = `AND(UPPER(DESCRIPCIONARTICULO) LIKE '%${safeSearch}%' 
                      OR CODIGOARTICULO LIKE '%${safeSearch}%'
                      OR UPPER(CODIGOMARCA) LIKE '%${safeSearch}%')`;
        }

        // Cache key based on search params
        const cacheKey = `master:products:${search || 'all'}:${limit}:${offset}`;
        const cacheTTL = search ? TTL.SHORT : TTL.LONG; // Longer for browse

        const products = await cachedQuery(query, `
      SELECT CODIGOARTICULO as code, DESCRIPCIONARTICULO as name,
  CODIGOMARCA as brand, CODIGOFAMILIA as family,
  UNIDADESCAJA as unitsPerBox, PESO as weight
      FROM DSEDAC.ART
      WHERE ANOBAJA = 0 ${searchFilter}
      ORDER BY DESCRIPCIONARTICULO
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `, cacheKey, cacheTTL);

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
// -----------------------------------------------------------------------------
// GET /vendedores - Active Salespeople (OPTIMIZED with caching)
// -----------------------------------------------------------------------------
router.get('/vendedores', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;

        // Cache for list of active vendors (changes rarely)
        const cacheKey = `master:vendedores:${currentYear}:${prevYear}`;
        
        const vendedores = await cachedQuery(query, `
            WITH ActiveVendors AS (
                SELECT DISTINCT TRIM(R1_T8CDVD) as CODE
                FROM DSED.LACLAE
                WHERE LCAADC IN (${currentYear}, ${prevYear})
                  AND R1_T8CDVD IS NOT NULL 
                  AND TRIM(R1_T8CDVD) <> ''
            )
            SELECT
                AV.CODE as code,
                D.NOMBREVENDEDOR as name
            FROM ActiveVendors AV
            LEFT JOIN DSEDAC.VDD D ON AV.CODE = TRIM(D.CODIGOVENDEDOR)
            ORDER BY AV.CODE
        `);

        res.json({
            vendedores: vendedores.map(v => ({
                code: v.CODE?.trim(),
                name: (v.NAME?.trim() || `Vendedor ${v.CODE}`).replace(/^(\d+)\s+-\s+\1\s+/, '').replace(/^(\d+)\s+-\s+/, ''),
                type: 'COMERCIAL',
                isJefe: false // Simplified for this view
            }))
        });

    } catch (error) {
        logger.error(`Vendedores error: ${error.message} `);
        res.status(500).json({ error: 'Error obteniendo vendedores', details: error.message });
    }
});

// =============================================================================
// FAMILIES LIST
// =============================================================================
router.get('/families', async (req, res) => {
    try {
        const { search, limit = 50 } = req.query;
        let whereClause = 'WHERE 1=1';
        if (search) {
            const term = search.toUpperCase().replace(/\'/g, "''").trim();
            whereClause += ` AND(UPPER(DESCRIPCIONFAMILIA) LIKE '%${term}%' OR CODIGOFAMILIA LIKE '%${term}%')`;
        }

        const families = await query(`
            SELECT TRIM(CODIGOFAMILIA) as CODE, TRIM(DESCRIPCIONFAMILIA) as NAME
            FROM DSEDAC.FAM
            ${whereClause}
            ORDER BY DESCRIPCIONFAMILIA
            FETCH FIRST ${parseInt(limit)} ROWS ONLY
            `);

        res.json(families.map(f => ({
            code: f.CODE,
            name: f.NAME
        })));
    } catch (error) {
        logger.error(`Families error: ${error.message}`);
        res.status(500).json({ error: 'Error loading families', details: error.message });
    }
});

module.exports = router;
