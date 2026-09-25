const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const {
    getCurrentDate,
    formatCurrency,
    sanitizeForSQL,
    handleRouteError
} = require('../utils/common');
const { comercialErpTable } = require('../utils/comercial-erp-tables');

// =============================================================================
// PRODUCTS LIST (OPTIMIZED with caching)
// =============================================================================
router.get('/products', async (req, res) => {
    try {
        const { search, limit = 50, offset = 0 } = req.query;

        const boundLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        const boundOffset = Math.max(parseInt(offset, 10) || 0, 0);
        const params = [];
        let searchFilter = '';
        if (search) {
            const like = `%${String(search).trim().toUpperCase()}%`;
            searchFilter = `AND (UPPER(DESCRIPCIONARTICULO) LIKE ? OR CODIGOARTICULO LIKE ? OR UPPER(CODIGOMARCA) LIKE ?)`;
            params.push(like, like, like);
        }
        params.push(boundOffset, boundLimit);

        const products = await queryWithParams(`
      SELECT CODIGOARTICULO as code, DESCRIPCIONARTICULO as name,
  CODIGOMARCA as brand, CODIGOFAMILIA as family,
  UNIDADESCAJA as unitsPerBox, PESO as weight
      FROM ${comercialErpTable('ART')}
      WHERE ANOBAJA = 0 ${searchFilter}
      ORDER BY DESCRIPCIONARTICULO
      OFFSET ? ROWS
      FETCH FIRST ? ROWS ONLY
    `, params);

        res.json({
            products: products.map(p => ({
                code: p.CODE?.trim(),
                name: p.NAME?.trim() || 'Sin nombre',
                brand: p.BRAND?.trim(),
                family: p.FAMILY?.trim(),
                unitsPerBox: parseInt(p.UNITSPERBOX) || 1,
                weight: parseFloat(p.WEIGHT) || 0
            })),
            hasMore: products.length === boundLimit
        });

    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo productos', 500, { code: 'MASTER_PRODUCTS_ERROR' });
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

        // Keep this endpoint aligned with /rutero/vendedores. The old LACLAE
        // DISTINCT scan was 7-10s on cold cache and only produced a dropdown.
        const activeComerciales = ['01', '02', '03', '05', '10', '13', '15', '16', '33', '35', '72', '73', '80', '81', '83', '92', '93', '95', '97', '98'];
        const placeholders = activeComerciales.map(() => '?').join(',');
        const vendedores = await cachedQuery(queryWithParams, `
            SELECT
                TRIM(D.CODIGOVENDEDOR) as code,
                TRIM(D.NOMBREVENDEDOR) as name
            FROM ${comercialErpTable('VDD')} D
            WHERE TRIM(D.CODIGOVENDEDOR) IN (${placeholders})
            ORDER BY D.CODIGOVENDEDOR
        `, {
            cacheKey,
            ttl: TTL.LONG,
            params: activeComerciales
        }, activeComerciales);

        res.json({
            vendedores: vendedores
                .map(v => {
                    const code = (v.CODE ?? v.code ?? '').toString().trim();
                    const rawName = (v.NAME ?? v.name ?? '').toString().trim();
                    const name = (rawName || `Vendedor ${code}`)
                        .replace(/^(\d+)\s+-\s+\1\s+/, '')
                        .replace(/^(\d+)\s+-\s+/, '');
                    return { code, name, type: 'COMERCIAL', isJefe: false };
                })
                .filter(v => v.code.length > 0)
        });

    } catch (error) {
        handleRouteError(error, res, 'Error obteniendo vendedores', 500, { code: 'MASTER_VENDEDORES_ERROR' });
    }
});

// =============================================================================
// FAMILIES LIST
// =============================================================================
router.get('/families', async (req, res) => {
    try {
        const { search, limit = 50 } = req.query;
        const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
        let whereClause = 'WHERE 1=1';
        let params = [];
        if (search) {
            // Sanitized LIKE term, bound as a parameter (no string interpolation).
            const term = `%${sanitizeForSQL(search.toUpperCase().trim())}%`;
            whereClause += ` AND(UPPER(DESCRIPCIONFAMILIA) LIKE ? OR CODIGOFAMILIA LIKE ?)`;
            params = [term, term];
        }

        // Semi-static dropdown catalog — cache like /products and /vendedores do.
        const cacheKey = `master:families:${search || 'all'}:${safeLimit}`;
        const families = await cachedQuery(queryWithParams, `
            SELECT TRIM(CODIGOFAMILIA) as CODE, TRIM(DESCRIPCIONFAMILIA) as NAME
            FROM ${comercialErpTable('FAM')}
            ${whereClause}
            ORDER BY DESCRIPCIONFAMILIA
            FETCH FIRST ${safeLimit} ROWS ONLY
            `, {
            cacheKey,
            ttl: search ? TTL.SHORT : TTL.LONG,
            params
        }, params);

        res.json(families.map(f => ({
            code: (f.CODE ?? f.code ?? '').toString().trim(),
            name: (f.NAME ?? f.name ?? '').toString().trim()
        })));
    } catch (error) {
        handleRouteError(error, res, 'Error loading families', 500, { code: 'MASTER_FAMILIES_ERROR' });
    }
});

module.exports = router;
