// promotions-v1.js — split de promotions.js: fuente V1 (PRD/PMR) + getActivePromotions + PMR.
// Codigo movido verbatim; PROMOTIONS_SCHEMA/_TABLES importadas de ./_shared (single-source).
const { queryWithParams } = require('../../config/db');
const { db2QualifiedTable } = require('../../utils/db2-identifiers');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const logger = require('../../middleware/logger');
const { trimString, PROMOTIONS_SCHEMA, PROMOTION_SOURCE_TABLES } = require('./_shared');
// Cache de descubrimiento: tabla fuente + columnas presentes.
let _promoSource = null; // { table: 'PRD'|'PMR'|'NONE', cols: Set<string> }

function promotionsQualifiedTable(tableName) {
    const normalized = String(tableName || '').trim().toUpperCase();
    if (!PROMOTION_SOURCE_TABLES.has(normalized)) {
        throw new Error(`Tabla de promociones no permitida: ${normalized || '(vacia)'}`);
    }
    return db2QualifiedTable(PROMOTIONS_SCHEMA, normalized);
}

async function detectPromoSource() {
    if (_promoSource) return _promoSource;
    const candidates = ['PRD', 'PMR'];
    for (const t of candidates) {
        try {
            const cols = await queryWithParams(
                `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [PROMOTIONS_SCHEMA, t], false, false
            );
            if (Array.isArray(cols) && cols.length > 0) {
                const set = new Set(cols.map(c => String(c.COLUMN_NAME || '').trim().toUpperCase()));
                _promoSource = { table: t, cols: set };
                logger.info(`[PEDIDOS] Tabla de promociones detectada: ${promotionsQualifiedTable(t)} (${set.size} cols)`);
                return _promoSource;
            }
        } catch (_) { /* sigue probando */ }
    }
    _promoSource = { table: 'NONE', cols: new Set() };
    logger.warn(`[PEDIDOS] Ninguna tabla de promociones (PRD/PMR) existe en ${PROMOTIONS_SCHEMA}. Promociones desactivadas.`);
    return _promoSource;
}

async function getActivePromotions(clientCode) {
    try {
        const trimmedClientCode = String(clientCode || '').trim();
        if (!trimmedClientCode) return [];

        const src = await detectPromoSource();
        if (src.table === 'NONE') return [];

        const now = new Date();
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

        // PMR schema: gift promotions (client-specific, no product-level data)
        if (src.table === 'PMR') {
            return getActivePromotionsPMR(trimmedClientCode, today);
        }

        // PRD schema: product-level price promotions (original logic)
        const promotionsTable = promotionsQualifiedTable(src.table);
        const has = (col) => src.cols.has(col);

        const colArticulo  = has('CODIGOARTICULO') ? 'P.CODIGOARTICULO' : (has('CDARTICULO') ? 'P.CDARTICULO' : `''`);
        const colDescrip   = has('DESCRIPCION')    ? 'P.DESCRIPCION'    : (has('DESCRIPCIONPROMOCION') ? 'P.DESCRIPCIONPROMOCION' : `''`);
        const colTipo      = has('TIPOPROMOCION')  ? 'P.TIPOPROMOCION'  : `''`;
        const colPrecio    = has('PRECIOPROMOCIONAL') ? 'P.PRECIOPROMOCIONAL' : (has('PRECIO') ? 'P.PRECIO' : '0');
        const colCantMin   = has('CANTIDADMINIMA') ? 'P.CANTIDADMINIMA' : (has('CTMINIMA') ? 'P.CTMINIMA' : '0');
        const colCantReg   = has('CANTIDADREGALO') ? 'P.CANTIDADREGALO' : (has('CTREGALO') ? 'P.CTREGALO' : '0');
        const colAcum      = has('ACUMULABLESN')   ? 'P.ACUMULABLESN'   : `'N'`;
        const colDiaDesde  = has('DIADESDE')       ? 'P.DIADESDE'       : '1';
        const colMesDesde  = has('MESDESDE')       ? 'P.MESDESDE'       : '1';
        const colAnoDesde  = has('ANODESDE')       ? 'P.ANODESDE'       : '2000';
        const colDiaHasta  = has('DIAHASTA')       ? 'P.DIAHASTA'       : '31';
        const colMesHasta  = has('MESHASTA')       ? 'P.MESHASTA'       : '12';
        const colAnoHasta  = has('ANOHASTA')       ? 'P.ANOHASTA'       : '9999';

        const hasDateRange = has('ANOHASTA') && has('ANODESDE');

        const sql = `
            SELECT ${colArticulo} AS CODIGOARTICULO,
                   ${colDescrip}  AS DESCRIPCION,
                   ${colTipo}     AS TIPOPROMOCION,
                   ${colPrecio}   AS PRECIOPROMOCIONAL,
                   ${colDiaDesde} AS DIADESDE,
                   ${colMesDesde} AS MESDESDE,
                   ${colAnoDesde} AS ANODESDE,
                   ${colDiaHasta} AS DIAHASTA,
                   ${colMesHasta} AS MESHASTA,
                   ${colAnoHasta} AS ANOHASTA,
                   ${colCantMin}  AS CANTIDADMINIMA,
                   ${colCantReg}  AS CANTIDADREGALO,
                   ${colAcum}     AS ACUMULABLESN,
                   A.DESCRIPCIONARTICULO AS NOMBRE_ARTICULO,
                   COALESCE(AR.STOCKACTUAL, 0) AS STOCK_ENVASES,
                   0 AS STOCK_UNIDADES
            FROM ${promotionsTable} P
            LEFT JOIN ${comercialErpTable('ART')} A ON ${colArticulo} = A.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARO')} AR ON ${colArticulo} = AR.CODIGOARTICULO AND AR.CODIGOALMACEN = 1
            ${hasDateRange
              ? `WHERE (${colAnoHasta} * 10000 + ${colMesHasta} * 100 + ${colDiaHasta}) >= ?
                   AND (${colAnoDesde} * 10000 + ${colMesDesde} * 100 + ${colDiaDesde}) <= ?`
              : ''}
            FETCH FIRST 200 ROWS ONLY
        `;

        let rows = [];
        try {
            rows = hasDateRange
                ? await queryWithParams(sql, [today, today])
                : await queryWithParams(sql, [], []);
            logger.info(`[PEDIDOS] Promociones activas hoy=${today}: ${rows?.length || 0} fila(s) desde ${promotionsTable}`);
            if (!rows || rows.length === 0) {
                try {
                    const probe = await queryWithParams(`SELECT COUNT(*) AS TOTAL FROM ${promotionsTable}`, [], false, false);
                    const total = parseInt(probe?.[0]?.TOTAL) || 0;
                    logger.info(`[PEDIDOS] ${promotionsTable} total filas=${total}; vigentes hoy=0`);
                } catch (_) { /* ok */ }
            }
        } catch (e) {
            logger.warn(`[PEDIDOS] Query promociones ${promotionsTable} fallo: ${e.message}`);
            return [];
        }

        return (rows || []).map(r => ({
            code: String(r.CODIGOARTICULO || '').trim(),
            name: String(r.NOMBRE_ARTICULO || r.DESCRIPCION || '').trim(),
            promoDesc: String(r.DESCRIPCION || '').trim(),
            promoType: (parseFloat(r.CANTIDADREGALO) || 0) > 0 ? 'GIFT' : 'PRICE',
            promoPrice: parseFloat(r.PRECIOPROMOCIONAL) || 0,
            minQty: parseFloat(r.CANTIDADMINIMA) || 0,
            giftQty: parseFloat(r.CANTIDADREGALO) || 0,
            stackable: String(r.ACUMULABLESN || '').trim() === 'S',
            stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
            stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
        }));
    } catch (error) {
        logger.warn('[PEDIDOS] getActivePromotions error (returning []): ' + error.message);
        return [];
    }
}

/**
 * Query promociones de regalo desde PMR.
 * PMR es una tabla de cabecera: cada fila = una promocion regalo para un cliente especifico.
 * No tiene datos a nivel de producto; el nombre de la promocion describe la oferta.
 */
async function getActivePromotionsPMR(clientCode, today) {
    // Filtrar por cliente y rango de fechas (0 = sin limite)
    const sql = `
        SELECT
            TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
            TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
            P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
            P.DIAFIN, P.MESFIN, P.ANOFIN,
            P.CANTIDADMINIMAPROMOCION,
            P.CANTIDADMAXIMAREGALO,
            P.PROMOCIONACUMULATIVASN
        FROM ${comercialErpTable('PMR')} P
        WHERE P.CODIGOCLIENTE = CAST(? AS CHAR(10))
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)
        FETCH FIRST 200 ROWS ONLY
    `;

    let rows = [];
    try {
        rows = await queryWithParams(sql, [clientCode, today, today]);
        logger.info(`[PEDIDOS] Promociones PMR para cliente=${clientCode}, hoy=${today}: ${rows?.length || 0} fila(s)`);
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones PMR fallo: ${e.message}`);
        return [];
    }

    return (rows || []).map(r => {
        const promoCode = String(r.PROMO_CODE || '').trim();
        const promoName = String(r.PROMO_NAME || '').trim();
        const diaDesde = parseInt(r.DIAINICIO) || 1;
        const mesDesde = parseInt(r.MESINICIO) || 1;
        const anoDesde = parseInt(r.ANOINICIO) || 0;
        const diaHasta = parseInt(r.DIAFIN) || 0;
        const mesHasta = parseInt(r.MESFIN) || 0;
        const anoHasta = parseInt(r.ANOFIN) || 0;

        return {
            code: promoCode,
            name: promoName,
            promoDesc: promoName,
            promoType: 'GIFT',
            promoCode: promoCode,
            promoPrice: 0,
            regularPrice: 0,
            dateFrom: anoDesde > 0 ? `${diaDesde}/${mesDesde}/${anoDesde}` : '',
            dateTo: anoHasta > 0 ? `${diaHasta}/${mesHasta}/${anoHasta}` : '',
            minQty: parseFloat(r.CANTIDADMINIMAPROMOCION) || 0,
            giftQty: parseFloat(r.CANTIDADMAXIMAREGALO) || 0,
            cumulative: String(r.PROMOCIONACUMULATIVASN || '').trim() === 'S',
            stockEnvases: 0,
            stockUnidades: 0,
        };
    });
}

module.exports = {
    promotionsQualifiedTable,
    detectPromoSource,
    getActivePromotions,
    getActivePromotionsPMR,
};
