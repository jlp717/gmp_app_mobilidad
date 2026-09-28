// history.js — split verbatim de services/pedidos/index.js (lote 2026-09-28): pdf-datos, historiales de producto y busqueda con stock.
// Contenido movido tal cual, sin cambios de logica. index.js actua como fachada.
const { queryWithParams } = require('../../config/db');
const { db2AppTable } = require('../../utils/db2-schemas');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const logger = require('../../middleware/logger');
const { cachedQuery } = require('../query-optimizer');
const { TTL } = require('../redis-cache');
const { truncate, roundPrice } = require('./_shared');
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');
const PEDIDOS_STOCK_RESERVE_TABLE = db2AppTable('PEDIDOS_STOCK_RESERVE');
const DRAFT_STOCK_RESERVATION_HOURS = 24;
const DRAFT_STOCK_RESERVATION_STATES_SQL = "'BORRADOR', 'PENDIENTE', 'PEND_APROB', 'PENDIENTE_APROBACION', 'CONFIRMANDO'";
const ACTIVE_STOCK_RESERVATION_CONDITION = `
(
    TRIM(C.ESTADO) = 'CONFIRMADO'
    OR (
        TRIM(C.ESTADO) IN (${DRAFT_STOCK_RESERVATION_STATES_SQL})
        AND SR.CREATED_AT >= CURRENT TIMESTAMP - ${DRAFT_STOCK_RESERVATION_HOURS} HOURS
    )
)`;
async function generateOrderPdf(orderId) {
    const { getOrderDetail } = require('./index'); // puente split: def vive en index
    const detail = await getOrderDetail(orderId);
    if (!detail || !detail.header) throw new Error('Order not found');
    return detail; // Return data, PDF rendering happens in route
}

/**
 * Get product purchase history for a specific client
 * Returns monthly breakdown for last 3 years
 */
async function getProductHistory(productCode, clientCode) {
    if (!productCode || !clientCode) return [];

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 2;

    const sql = `
        SELECT
            L.LCAADC AS YEAR,
            L.LCMMDC AS MONTH,
            SUM(L.LCIMVT) AS SALES,
            SUM(L.LCIMCT) AS COST,
            SUM(L.LCCTUD) AS UNITS,
            COALESCE(SUM(L.LCIMVT) / NULLIF(SUM(L.LCCTUD), 0), 0) AS AVG_PRICE
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCAADC >= ?
          AND L.LCCDCL = ?
          AND TRIM(L.LCCDPR) = ?
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
    `;

    try {
        const rows = await queryWithParams(sql, [startYear, clientCode, productCode], false);
        return rows.map(r => ({
            year: parseInt(r.YEAR),
            month: parseInt(r.MONTH),
            sales: parseFloat(r.SALES) || 0,
            cost: parseFloat(r.COST) || 0,
            units: parseFloat(r.UNITS) || 0,
            avgPrice: parseFloat(r.AVG_PRICE) || 0
        }));
    } catch (e) {
        logger.warn(`[PEDIDOS] getProductHistory error: ${e.message}`);
        return [];
    }
}

async function getProductPriceHistory(productCode, clientCode) {
    const { getPrecioHistoricoTEST } = require('./index'); // puente split: def vive en index
    const product = truncate(productCode, 10);
    const client = truncate(clientCode, 10);
    let competitivo = 0;
    try {
        const rows = await queryWithParams(
            `SELECT COALESCE(PRECIOTARIFA, 0) AS PRECIO FROM ${comercialErpTable('ARA')} WHERE TRIM(CODIGOARTICULO) = ? AND CODIGOTARIFA = 1 FETCH FIRST 1 ROW ONLY`,
            [product],
            false,
        );
        competitivo = roundPrice(rows?.[0]?.PRECIO ?? 0);
    } catch (err) {
        logger.warn(`[PEDIDOS] price-history competitivo skip: ${err.message}`);
    }
    const hist = await getPrecioHistoricoTEST({ clientCode: client, articleCode: product });
    const last = hist.length > 0 ? roundPrice(hist[0].PRECIOVENTA ?? hist[0].precioVenta ?? 0) : 0;
    const prev = hist.length > 1 ? roundPrice(hist[1].PRECIOVENTA ?? hist[1].precioVenta ?? 0) : 0;
    const pctSubida = prev > 0 && last > 0 ? roundPrice(((last - prev) / prev) * 100) : 0;
    return { productCode: product, clientCode: client, ultimoPrecio: last, precioAnterior: prev, pctSubida, competitivo };
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

/**
 * Search products with available stock by name/code/family
 * Used as fallback in stock alternatives modal when no similar products found
 */
async function searchProductsWithStock(searchTerm, limit = 20) {
    const term = (searchTerm || '').trim().toUpperCase();
    if (!term || term.length < 2) return [];
    
    const cacheKey = `pedidos:search_stock:${term}:${limit}`;
    
    try {
        const sql = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.CODIGOMARCA) AS MARCA,
                   TRIM(A.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(A.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM ${comercialErpTable('ART')} A
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM ${comercialErpTable('ARO')}
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
                JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON A.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARA')} T ON A.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE A.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
              AND (
                  UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOARTICULO)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOFAMILIA)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOSUBFAMILIA)) LIKE ?
              )
            ORDER BY 
                CASE 
                    WHEN UPPER(TRIM(A.CODIGOARTICULO)) LIKE ? THEN 1
                    WHEN UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ? THEN 2
                    ELSE 3
                END,
                S.ENVASES_DISP DESC
            FETCH FIRST ? ROWS ONLY
        `;
        
        const likeTerm = `%${term}%`;
        const rows = await cachedQuery(
            (s) => queryWithParams(s, [likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, limit]),
            sql, cacheKey, TTL.SHORT
        );
        
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            brand: (r.MARCA || '').trim(),
            family: (r.FAMILIA || '').trim(),
            subfamily: (r.SUBFAMILIA || '').trim(),
            stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
            stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
            precio: parseFloat(r.PRECIO) || 0,
            similarityScore: 0,
            matchReasons: ['Busqueda manual']
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] searchProductsWithStock error: ${error.message}`);
        return [];
    }
}
module.exports = {
    generateOrderPdf,
    getProductHistory,
    getProductPriceHistory,
    searchProductsWithStock,
};
