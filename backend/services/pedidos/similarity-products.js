// similarity-products.js — split de similarity.js: complementarios + similares (acceso DB2).
// Codigo movido verbatim; consts stock-reserve importadas de ./_shared (single-source);
// scoring importado de ./similarity-essence (one-way, sin ciclo).
const { queryWithParams } = require('../../config/db');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const logger = require('../../middleware/logger');
const { cachedQuery } = require('../query-optimizer');
const { TTL } = require('../redis-cache');
const { truncate, PEDIDOS_CAB_TABLE, PEDIDOS_STOCK_RESERVE_TABLE, ACTIVE_STOCK_RESERVATION_CONDITION } = require('./_shared');
const { calculateSemanticScore } = require('./similarity-essence');

async function getComplementaryProducts(productCodes, clientCode) {
    const { applyConfiguredPricingToProducts } = require('./index'); // puente split: def vive en index
    if (!productCodes || productCodes.length === 0) return [];

    const trimmedCodes = productCodes.map(c => c.trim());
    const placeholders = trimmedCodes.map(() => '?').join(',');
    const trimClient = clientCode ? truncate(clientCode, 10) : '';
    const cacheKey = `pedidos:complementary:${trimClient || 'no-client'}:${productCodes.sort().join(',')}`;

    const sql = `
        SELECT TRIM(L2.CODIGOARTICULO) AS code,
               TRIM(A.DESCRIPCIONARTICULO) AS NAME,
               COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) AS cooccurrences,
               COALESCE(T.PRECIOTARIFA, 0) AS price,
               A.UNIDADESCAJA AS unitsPerBox,
               COALESCE(S.ENVASES_DISP, 0) AS stockEnvases,
               COALESCE(S.UNIDADES_DISP, 0) AS stockUnidades
        FROM ${comercialErpTable('LINDTO')} L1
        JOIN ${comercialErpTable('LINDTO')} L2
            ON L2.CODIGOCLIENTEALBARAN = L1.CODIGOCLIENTEALBARAN
            AND L2.ANODOCUMENTO = L1.ANODOCUMENTO
            AND L2.NUMERODOCUMENTO = L1.NUMERODOCUMENTO
            AND TRIM(L2.CODIGOARTICULO) NOT IN (${placeholders})
        JOIN ${comercialErpTable('ART')} A ON TRIM(A.CODIGOARTICULO) = TRIM(L2.CODIGOARTICULO)
        LEFT JOIN ${comercialErpTable('ARA')} T ON TRIM(L2.CODIGOARTICULO) = TRIM(T.CODIGOARTICULO) AND T.CODIGOTARIFA = 1
        LEFT JOIN (
            SELECT CODIGOARTICULO,
                SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM ${comercialErpTable('ARO')} WHERE CODIGOALMACEN = 1
            GROUP BY CODIGOARTICULO
        ) S ON TRIM(L2.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
        WHERE TRIM(L1.CODIGOARTICULO) IN (${placeholders})
          AND L1.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L1.TIPOVENTA IN ('CC','VC')
          AND L1.CLASELINEA IN ('AB','VT')
          AND L2.CLASELINEA IN ('AB','VT')
          AND A.ANOBAJA = 0
        GROUP BY L2.CODIGOARTICULO, A.DESCRIPCIONARTICULO, T.PRECIOTARIFA, A.UNIDADESCAJA, S.ENVASES_DISP, S.UNIDADES_DISP
        HAVING COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) >= 3
        ORDER BY cooccurrences DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    const params = [...trimmedCodes, ...trimmedCodes];

    try {
        const rows = await cachedQuery(
            (s) => queryWithParams(s, params),
            sql, cacheKey, TTL.MEDIUM
        );
        const products = rows.map(r => {
            const price = parseFloat(r.PRICE) || 0;
            return {
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            cooccurrences: parseInt(r.COOCCURRENCES) || 0,
            price,
            precioTarifa1: price,
            precioTarifaCliente: price,
            precioCliente: 0,
            unitsPerBox: parseFloat(r.UNITSPERBOX) || 1,
            stockEnvases: parseFloat(r.STOCKENVASES) || 0,
            stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
            source: 'complementary',
            };
        });
        const pricedProducts = await applyConfiguredPricingToProducts(products, trimClient);
        return pricedProducts.map(product => ({
            ...product,
            price: product.precioTarifaCliente || product.precioCliente || product.price,
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getComplementaryProducts error: ${error.message}`);
        return [];
    }
}

/**
 * Finds products similar to the given one using intelligent 3-level matching.
 * Level 1 (Basic): Family and Subfamily priority
 * Level 2 (Intermediate): Compare Attributes and Format
 * Level 3 (Advanced): Understand semantic intent (raw vs elaborated)
 */
async function getSimilarProducts(productCode) {
    const code = (productCode || '').trim();
    if (!code) return [];

    const cacheKey = `pedidos:similar_v3:${code}`;

    try {
        // 1. Get original product attributes
        const sqlOriginal = `
            SELECT TRIM(CODIGOFAMILIA) AS FAMILIA,
                   TRIM(CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(CODIGOMARCA) AS MARCA,
                   TRIM(COALESCE(CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(CODIGOTIPO, '')) AS TIPO,
                   TRIM(DESCRIPCIONARTICULO) AS DESCRIPTION
            FROM ${comercialErpTable('ART')} WHERE TRIM(CODIGOARTICULO) = ?
        `;
        const origRows = await queryWithParams(sqlOriginal, [code]);
        if (!origRows || origRows.length === 0) return [];
        const orig = origRows[0];

        // 2. Fetch candidates from the SAME FAMILY that have stock
        const sqlCandidates = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM ${comercialErpTable('ART')} B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM ${comercialErpTable('ARO')}
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
                JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARA')} T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
        `;
        let rows = await cachedQuery(
            (s) => queryWithParams(s, [orig.FAMILIA, code]),
            sqlCandidates, cacheKey, TTL.SHORT
        );

        // 2b. FALLBACK: If no candidates in same family, expand to subfamilia across all families
        if ((!rows || rows.length === 0) && orig.SUBFAMILIA) {
            const sqlFallback = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM ${comercialErpTable('ART')} B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM ${comercialErpTable('ARO')}
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM ${PEDIDOS_STOCK_RESERVE_TABLE} SR
                JOIN ${PEDIDOS_CAB_TABLE} C ON SR.PEDIDO_ID = C.ID AND ${ACTIVE_STOCK_RESERVATION_CONDITION}
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARA')} T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOSUBFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
            FETCH FIRST 30 ROWS ONLY
            `;
            const fallbackKey = `pedidos:similar_v3_fallback:${code}`;
            rows = await cachedQuery(
                (s) => queryWithParams(s, [orig.SUBFAMILIA, code]),
                sqlFallback, fallbackKey, TTL.SHORT
            );
            logger.info(`[PEDIDOS] getSimilarProducts fallback: subfamilia=${orig.SUBFAMILIA}, found ${(rows || []).length} candidates`);
        }

        // 3. Apply intelligent 3-level scoring
        const scored = [];

        for (const r of rows) {
            const candidate = {
                NAME: r.NAME,
                DESCRIPTION: r.NAME, // Use name as description for keyword analysis
                FAMILIA: r.FAMILIA,
                SUBFAMILIA: r.SUBFAMILIA,
                GRUPO: r.GRUPO,
                MARCA: r.MARCA,
                FORMATO: r.FORMATO,
                PRESENTACION: r.PRESENTACION,
                TIPO: r.TIPO
            };

            const origProduct = {
                NAME: orig.DESCRIPTION,
                DESCRIPTION: orig.DESCRIPTION,
                FAMILIA: orig.FAMILIA,
                SUBFAMILIA: orig.SUBFAMILIA,
                GRUPO: orig.GRUPO,
                MARCA: orig.MARCA,
                FORMATO: orig.FORMATO,
                PRESENTACION: orig.PRESENTACION,
                TIPO: orig.TIPO
            };

            const { score, reasons, compatible } = calculateSemanticScore(origProduct, candidate);

            // Improved threshold: accept products with score > -30 or same family
            const sameFamily = candidate.FAMILIA === origProduct.FAMILIA;
            const sameSubfamily = candidate.SUBFAMILIA && origProduct.SUBFAMILIA &&
                                  candidate.SUBFAMILIA === origProduct.SUBFAMILIA;

            // Always include if same subfamily, otherwise check score
            if (sameSubfamily || sameFamily || score > -30) {
                scored.push({
                    code: (r.CODE || '').trim(),
                    name: (r.NAME || '').trim(),
                    brand: (r.MARCA || '').trim(),
                    family: (r.FAMILIA || '').trim(),
                    subfamily: (r.SUBFAMILIA || '').trim(),
                    stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
                    stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
                    precio: parseFloat(r.PRECIO) || 0,
                    similarityScore: Math.max(0, score),
                    matchReasons: reasons.length > 0 ? reasons : (sameSubfamily ? ['Misma subfamilia'] : ['Misma familia'])
                });
            }
        }

        // 4. Sort and limit to top 10
        scored.sort((a, b) => b.similarityScore - a.similarityScore || b.stockEnvases - a.stockEnvases);
        return scored.slice(0, 10);
    } catch (error) {
        logger.error(`[PEDIDOS] getSimilarProducts error for ${code}: ${error.message}`);
        return [];
    }
}

module.exports = {
    getComplementaryProducts,
    getSimilarProducts,
};
