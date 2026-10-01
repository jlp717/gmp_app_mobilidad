// promotions-v2.js — split de promotions.js: agregador V2 (PMR/PMRC/PMP + CPES + PRD).
// Codigo movido verbatim; promotionsQualifiedTable importada de ./promotions-v1 (one-way);
// PROMOTIONS_SCHEMA importada de ./_shared (single-source).
const { queryWithParams } = require('../../config/db');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const logger = require('../../middleware/logger');
const { trimString, PROMOTIONS_SCHEMA } = require('./_shared');
const { promotionsQualifiedTable } = require('./promotions-v1');

// Promotion aggregator V2: combines direct gift headers, client-assigned gift
// promotions with article lines, and client-specific special prices.
let _promoSourcesV2 = null; // Map<table, Set<column>>

async function detectPromoSourcesV2() {
    if (_promoSourcesV2) return _promoSourcesV2;
    const candidates = ['PRD', 'PMR', 'PMRC', 'PMP', 'CPES'];
    const found = new Map();
    for (const table of candidates) {
        try {
            const cols = await queryWithParams(
                `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [PROMOTIONS_SCHEMA, table], false, false
            );
            if (Array.isArray(cols) && cols.length > 0) {
                found.set(table, new Set(cols.map(c => String(c.COLUMN_NAME || '').trim().toUpperCase())));
            }
        } catch (_) { /* best-effort source discovery */ }
    }
    _promoSourcesV2 = found;
    if (_promoSourcesV2.size === 0) {
        logger.warn(`[PEDIDOS] Ninguna tabla de promociones existe en ${PROMOTIONS_SCHEMA}. Promociones desactivadas.`);
    } else {
        logger.info(`[PEDIDOS] Fuentes de promociones detectadas: ${Array.from(_promoSourcesV2.keys()).join(',')}`);
    }
    return _promoSourcesV2;
}

function ymdParts(year, month, day) {
    const y = parseInt(year, 10) || 0;
    if (y <= 0) return 0;
    return y * 10000 + (parseInt(month, 10) || 1) * 100 + (parseInt(day, 10) || 1);
}

function promotionWindowActive(startYmd, endYmd, today) {
    const started = !startYmd || startYmd <= today;
    const open = !endYmd || endYmd >= today;
    return started && open;
}

function todayYmd(now = new Date()) {
    return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

async function getActivePromotionsV2(clientCode, options = {}) {
    try {
        const trimmedClientCode = String(clientCode || '').trim();
        if (!trimmedClientCode) return [];

        const sources = await detectPromoSourcesV2();
        if (!sources || sources.size === 0) return [];

        const includeHistory = options.includeHistory === true;
        const today = todayYmd();
        const promotions = [];

        if (sources.has('PMR')) {
            promotions.push(...await getActiveGiftPromotionsV2(trimmedClientCode, today, {
                hasClientAssignments: sources.has('PMRC'),
                hasProductLines: sources.has('PMP'),
                includeHistory,
            }));
        }
        if (sources.has('CPES')) {
            promotions.push(...await getActiveSpecialPricePromotionsV2(trimmedClientCode, today, { includeHistory }));
        }
        if (sources.has('PRD')) {
            promotions.push(...await getActivePrdPromotionsV2(today, sources.get('PRD') || new Set(), { includeHistory }));
        }

        const unique = dedupePromotionItemsV2(promotions);
        if (includeHistory) return unique;
        return unique.filter((item) => item.active !== false);
    } catch (error) {
        logger.warn('[PEDIDOS] getActivePromotions error (returning []): ' + error.message);
        return [];
    }
}

async function getClientPromotionCatalogV2(clientCode) {
    const all = await getActivePromotionsV2(clientCode, { includeHistory: true });
    const promotions = all.filter((item) => item.active !== false);
    const history = all.filter((item) => item.active === false);
    return { promotions, history, newCount: promotions.length };
}

async function getActivePrdPromotionsV2(today, cols, options = {}) {
    try {
        const promotionsTable = promotionsQualifiedTable('PRD');
        const has = (col) => cols.has(col);
        const colArticulo = has('CODIGOARTICULO') ? 'P.CODIGOARTICULO' : (has('CDARTICULO') ? 'P.CDARTICULO' : `''`);
        const colDescrip = has('DESCRIPCION') ? 'P.DESCRIPCION' : (has('DESCRIPCIONPROMOCION') ? 'P.DESCRIPCIONPROMOCION' : `''`);
        const colTipo = has('TIPOPROMOCION') ? 'P.TIPOPROMOCION' : `''`;
        const colPrecio = has('PRECIOPROMOCIONAL') ? 'P.PRECIOPROMOCIONAL' : (has('PRECIO') ? 'P.PRECIO' : '0');
        const colCantMin = has('CANTIDADMINIMA') ? 'P.CANTIDADMINIMA' : (has('CTMINIMA') ? 'P.CTMINIMA' : '0');
        const colCantReg = has('CANTIDADREGALO') ? 'P.CANTIDADREGALO' : (has('CTREGALO') ? 'P.CTREGALO' : '0');
        const colAcum = has('ACUMULABLESN') ? 'P.ACUMULABLESN' : `'N'`;
        const colDiaDesde = has('DIADESDE') ? 'P.DIADESDE' : '1';
        const colMesDesde = has('MESDESDE') ? 'P.MESDESDE' : '1';
        const colAnoDesde = has('ANODESDE') ? 'P.ANODESDE' : '2000';
        const colDiaHasta = has('DIAHASTA') ? 'P.DIAHASTA' : '31';
        const colMesHasta = has('MESHASTA') ? 'P.MESHASTA' : '12';
        const colAnoHasta = has('ANOHASTA') ? 'P.ANOHASTA' : '9999';
        const hasDateRange = has('ANOHASTA') && has('ANODESDE');
        const includeHistory = options.includeHistory === true;
        const sql = `
            SELECT ${colArticulo} AS CODIGOARTICULO,
                   ${colDescrip} AS DESCRIPCION,
                   ${colTipo} AS TIPOPROMOCION,
                   ${colPrecio} AS PRECIOPROMOCIONAL,
                   ${colDiaDesde} AS DIADESDE,
                   ${colMesDesde} AS MESDESDE,
                   ${colAnoDesde} AS ANODESDE,
                   ${colDiaHasta} AS DIAHASTA,
                   ${colMesHasta} AS MESHASTA,
                   ${colAnoHasta} AS ANOHASTA,
                   ${colCantMin} AS CANTIDADMINIMA,
                   ${colCantReg} AS CANTIDADREGALO,
                   ${colAcum} AS ACUMULABLESN,
                   A.DESCRIPCIONARTICULO AS NOMBRE_ARTICULO,
                   COALESCE(AR.ENVASESDISPONIBLES, 0) AS STOCK_ENVASES,
                   COALESCE(AR.UNIDADESDISPONIBLES, 0) AS STOCK_UNIDADES
            FROM ${promotionsTable} P
            LEFT JOIN ${comercialErpTable('ART')} A ON ${colArticulo} = A.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARO')} AR ON ${colArticulo} = AR.CODIGOARTICULO AND AR.CODIGOALMACEN = 1
            ${hasDateRange
              ? (includeHistory
                ? `WHERE (${colAnoDesde} * 10000 + ${colMesDesde} * 100 + ${colDiaDesde}) <= ?
                   ORDER BY (${colAnoHasta} * 10000 + ${colMesHasta} * 100 + ${colDiaHasta}) DESC`
                : `WHERE (${colAnoHasta} * 10000 + ${colMesHasta} * 100 + ${colDiaHasta}) >= ?
                   AND (${colAnoDesde} * 10000 + ${colMesDesde} * 100 + ${colDiaDesde}) <= ?`)
              : ''}
            FETCH FIRST ${includeHistory ? 400 : 200} ROWS ONLY
        `;
        const rows = hasDateRange
            ? await queryWithParams(sql, includeHistory ? [today] : [today, today])
            : await queryWithParams(sql, [], []);
        // REQ-25 tanda4: log total/vigentes (TEST-only observable, sin cambio
        // de logica: rows ya viene filtrada por vigencia en el WHERE).
        const vigentes = Array.isArray(rows) ? rows.length : 0;
        if (vigentes === 0) {
            try {
                const probe = await queryWithParams(`SELECT COUNT(*) AS TOTAL FROM ${promotionsTable}`, [], false, false);
                const total = parseInt(probe?.[0]?.TOTAL, 10) || 0;
                logger.info(`[PEDIDOS] ${promotionsTable} total filas=${total}; vigentes hoy=0`);
            } catch (_) { /* best-effort */ }
        } else {
            logger.info(`[PEDIDOS] ${promotionsTable} vigentes hoy=${vigentes}`);
        }
        return (rows || []).map(r => ({
            source: 'PRD',
            code: trimString(r.CODIGOARTICULO),
            productCode: trimString(r.CODIGOARTICULO),
            name: trimString(r.NOMBRE_ARTICULO || r.DESCRIPCION),
            promoDesc: trimString(r.DESCRIPCION),
            promoType: (parseFloat(r.CANTIDADREGALO) || 0) > 0 ? 'GIFT' : 'PRICE',
            promoCode: '',
            promoPrice: parseFloat(r.PRECIOPROMOCIONAL) || 0,
            minQty: parseFloat(r.CANTIDADMINIMA) || 0,
            giftQty: parseFloat(r.CANTIDADREGALO) || 0,
            cumulative: String(r.ACUMULABLESN || '').trim() === 'S',
            stackable: String(r.ACUMULABLESN || '').trim() === 'S',
            stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
            stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
            active: hasDateRange
                ? promotionWindowActive(
                    ymdParts(r.ANODESDE, r.MESDESDE, r.DIADESDE),
                    ymdParts(r.ANOHASTA, r.MESHASTA, r.DIAHASTA),
                    today,
                )
                : true,
        }));
    } catch (error) {
        logger.warn('[PEDIDOS] getActivePrdPromotionsV2 error (returning []): ' + error.message);
        return [];
    }
}

async function getActiveGiftPromotionsV2(clientCode, today, options = {}) {
    const rows = [];
    const includeHistory = options.includeHistory === true;
    const endClause = includeHistory
        ? ''
        : 'AND (P.ANOFIN = 0 OR (P.ANOFIN * 10000 + P.MESFIN * 100 + P.DIAFIN) >= ?)';
    const directSql = `
        SELECT
            TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
            TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
            P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
            P.DIAFIN, P.MESFIN, P.ANOFIN,
            P.CANTIDADMINIMAPROMOCION,
            P.CANTIDADMAXIMAREGALO,
            P.CANTIDADMINIMAREGALO,
            P.CANTIDADMAXIMAPROMOCION,
            P.PROMOCIONACUMULATIVASN,
            P.NOREGALARPRODUCTOSCOMPRADOSSN,
            P.PICADOOBLIGATORIOSN,
            TRIM(P.CODIGOCLIENTE) AS CLIENT_CODE,
            CAST(NULL AS VARCHAR(10)) AS PRODUCT_CODE,
            CAST(NULL AS VARCHAR(80)) AS PRODUCT_NAME,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MIN_ENVASES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MIN_UNIDADES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MAX_ENVASES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MAX_UNIDADES,
            CAST(0 AS DECIMAL(15, 5)) AS STOCK_ENVASES,
            CAST(0 AS DECIMAL(15, 5)) AS STOCK_UNIDADES,
            CAST(0 AS INTEGER) AS PRODUCT_ORDER,
            'PMR_DIRECT' AS ASSIGNMENT_SOURCE
        FROM ${comercialErpTable('PMR')} P
        WHERE P.CODIGOCLIENTE = CAST(? AS CHAR(10))
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          ${endClause}
        ${includeHistory ? 'ORDER BY CASE WHEN P.ANOFIN = 0 THEN 1 ELSE 0 END DESC, P.ANOFIN DESC, P.MESFIN DESC, P.DIAFIN DESC' : ''}
        FETCH FIRST ${includeHistory ? 400 : 200} ROWS ONLY
    `;
    try {
        rows.push(...(await queryWithParams(directSql, includeHistory ? [clientCode, today] : [clientCode, today, today]) || []));
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones PMR directas fallo: ${e.message}`);
    }

    if (options.hasClientAssignments) {
        const assignedSql = `
            SELECT
                TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
                TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
                P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
                P.DIAFIN, P.MESFIN, P.ANOFIN,
                P.CANTIDADMINIMAPROMOCION,
                P.CANTIDADMAXIMAREGALO,
                P.CANTIDADMINIMAREGALO,
                P.CANTIDADMAXIMAPROMOCION,
                P.PROMOCIONACUMULATIVASN,
                P.NOREGALARPRODUCTOSCOMPRADOSSN,
                P.PICADOOBLIGATORIOSN,
                TRIM(C.CODIGOCLIENTE) AS CLIENT_CODE,
                TRIM(G.CODIGOARTICULO) AS PRODUCT_CODE,
                TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
                G.CANTIDADMINIMAENVASES AS PRODUCT_MIN_ENVASES,
                G.CANTIDADMINIMAUNIDADES AS PRODUCT_MIN_UNIDADES,
                G.CANTIDADMAXIMAENVASES AS PRODUCT_MAX_ENVASES,
                G.CANTIDADMAXIMAUNIDADES AS PRODUCT_MAX_UNIDADES,
                COALESCE(S.STOCK_ENVASES, 0) AS STOCK_ENVASES,
                COALESCE(S.STOCK_UNIDADES, 0) AS STOCK_UNIDADES,
                G.ORDEN AS PRODUCT_ORDER,
                'PMRC' AS ASSIGNMENT_SOURCE
            FROM ${comercialErpTable('PMRC')} C
            JOIN ${comercialErpTable('PMR')} P
              ON TRIM(P.CODIGOPROMOCIONREGALO) = TRIM(C.CODIGOPROMOCIONREGALO)
            LEFT JOIN ${comercialErpTable('PMP')} G
              ON TRIM(G.CODIGOPROMOCION) = TRIM(C.CODIGOPROMOCIONREGALO)
            LEFT JOIN ${comercialErpTable('ART')} A
              ON TRIM(A.CODIGOARTICULO) = TRIM(G.CODIGOARTICULO)
            LEFT JOIN (
                SELECT TRIM(CODIGOARTICULO) AS CODE,
                       SUM(ENVASESDISPONIBLES) AS STOCK_ENVASES,
                       SUM(UNIDADESDISPONIBLES) AS STOCK_UNIDADES
                FROM ${comercialErpTable('ARO')}
                WHERE CODIGOALMACEN = 1
                GROUP BY TRIM(CODIGOARTICULO)
            ) S ON S.CODE = TRIM(G.CODIGOARTICULO)
            WHERE C.CODIGOCLIENTE = CAST(? AS CHAR(10))
              AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
              ${endClause}
            ORDER BY TRIM(P.CODIGOPROMOCIONREGALO), G.ORDEN, TRIM(G.CODIGOARTICULO)
            FETCH FIRST ${includeHistory ? 800 : 500} ROWS ONLY
        `;
        try {
            rows.push(...(await queryWithParams(assignedSql, includeHistory ? [clientCode, today] : [clientCode, today, today]) || []));
        } catch (e) {
            logger.warn(`[PEDIDOS] Query promociones PMRC/PMP fallo: ${e.message}`);
        }
    }

    // Cabecera sin cliente y sin filas PMRC: campaña general (vale para
    // cualquier cliente). Las que sí tienen PMRC siguen siendo solo de esos
    // clientes. DSEDAC no tiene tabla PRD de precios generales.
    const generalGuard = options.hasClientAssignments
        ? `AND NOT EXISTS (
              SELECT 1 FROM ${comercialErpTable('PMRC')} C
               WHERE TRIM(C.CODIGOPROMOCIONREGALO) = TRIM(P.CODIGOPROMOCIONREGALO)
           )`
        : '';
    const generalSql = options.hasProductLines
        ? `
        SELECT
            TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
            TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
            P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
            P.DIAFIN, P.MESFIN, P.ANOFIN,
            P.CANTIDADMINIMAPROMOCION,
            P.CANTIDADMAXIMAREGALO,
            P.CANTIDADMINIMAREGALO,
            P.CANTIDADMAXIMAPROMOCION,
            P.PROMOCIONACUMULATIVASN,
            P.NOREGALARPRODUCTOSCOMPRADOSSN,
            P.PICADOOBLIGATORIOSN,
            '' AS CLIENT_CODE,
            TRIM(G.CODIGOARTICULO) AS PRODUCT_CODE,
            TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
            G.CANTIDADMINIMAENVASES AS PRODUCT_MIN_ENVASES,
            G.CANTIDADMINIMAUNIDADES AS PRODUCT_MIN_UNIDADES,
            G.CANTIDADMAXIMAENVASES AS PRODUCT_MAX_ENVASES,
            G.CANTIDADMAXIMAUNIDADES AS PRODUCT_MAX_UNIDADES,
            COALESCE(S.STOCK_ENVASES, 0) AS STOCK_ENVASES,
            COALESCE(S.STOCK_UNIDADES, 0) AS STOCK_UNIDADES,
            G.ORDEN AS PRODUCT_ORDER,
            'PMR_GENERAL' AS ASSIGNMENT_SOURCE
        FROM ${comercialErpTable('PMR')} P
        LEFT JOIN ${comercialErpTable('PMP')} G
          ON TRIM(G.CODIGOPROMOCION) = TRIM(P.CODIGOPROMOCIONREGALO)
        LEFT JOIN ${comercialErpTable('ART')} A
          ON TRIM(A.CODIGOARTICULO) = TRIM(G.CODIGOARTICULO)
        LEFT JOIN (
            SELECT TRIM(CODIGOARTICULO) AS CODE,
                   SUM(ENVASESDISPONIBLES) AS STOCK_ENVASES,
                   SUM(UNIDADESDISPONIBLES) AS STOCK_UNIDADES
            FROM ${comercialErpTable('ARO')}
            WHERE CODIGOALMACEN = 1
            GROUP BY TRIM(CODIGOARTICULO)
        ) S ON S.CODE = TRIM(G.CODIGOARTICULO)
        WHERE TRIM(COALESCE(P.CODIGOCLIENTE, '')) = ''
          ${generalGuard}
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          ${endClause}
        ORDER BY CASE WHEN P.ANOFIN = 0 THEN 0 ELSE 1 END,
                 P.ANOFIN DESC, P.MESFIN DESC, P.DIAFIN DESC,
                 TRIM(P.CODIGOPROMOCIONREGALO), G.ORDEN, TRIM(G.CODIGOARTICULO)
        FETCH FIRST ${includeHistory ? 2000 : 1000} ROWS ONLY
        `
        : `
        SELECT
            TRIM(P.CODIGOPROMOCIONREGALO) AS PROMO_CODE,
            TRIM(P.NOMBREPROMOCIONREGALO) AS PROMO_NAME,
            P.DIAINICIO, P.MESINICIO, P.ANOINICIO,
            P.DIAFIN, P.MESFIN, P.ANOFIN,
            P.CANTIDADMINIMAPROMOCION,
            P.CANTIDADMAXIMAREGALO,
            P.CANTIDADMINIMAREGALO,
            P.CANTIDADMAXIMAPROMOCION,
            P.PROMOCIONACUMULATIVASN,
            P.NOREGALARPRODUCTOSCOMPRADOSSN,
            P.PICADOOBLIGATORIOSN,
            '' AS CLIENT_CODE,
            CAST(NULL AS VARCHAR(10)) AS PRODUCT_CODE,
            CAST(NULL AS VARCHAR(80)) AS PRODUCT_NAME,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MIN_ENVASES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MIN_UNIDADES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MAX_ENVASES,
            CAST(0 AS DECIMAL(10, 5)) AS PRODUCT_MAX_UNIDADES,
            CAST(0 AS DECIMAL(15, 5)) AS STOCK_ENVASES,
            CAST(0 AS DECIMAL(15, 5)) AS STOCK_UNIDADES,
            CAST(0 AS INTEGER) AS PRODUCT_ORDER,
            'PMR_GENERAL' AS ASSIGNMENT_SOURCE
        FROM ${comercialErpTable('PMR')} P
        WHERE TRIM(COALESCE(P.CODIGOCLIENTE, '')) = ''
          ${generalGuard}
          AND (P.ANOINICIO = 0 OR (P.ANOINICIO * 10000 + P.MESINICIO * 100 + P.DIAINICIO) <= ?)
          ${endClause}
        ORDER BY CASE WHEN P.ANOFIN = 0 THEN 0 ELSE 1 END, P.ANOFIN DESC
        FETCH FIRST ${includeHistory ? 400 : 200} ROWS ONLY
        `;
    try {
        rows.push(...(await queryWithParams(generalSql, includeHistory ? [today] : [today, today]) || []));
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones generales fallo: ${e.message}`);
    }

    logger.info(`[PEDIDOS] Promociones regalo PMR/PMRC para cliente=${clientCode}, hoy=${today}: ${rows.length} fila(s)`);
    return buildGiftPromotionItemsV2(rows, today);
}

async function getActiveSpecialPricePromotionsV2(clientCode, today, options = {}) {
    const includeHistory = options.includeHistory === true;
    const endClause = includeHistory
        ? ''
        : 'AND (C.ANOFINAL = 0 OR (C.ANOFINAL * 10000 + C.MESFINAL * 100 + C.DIAFINAL) >= ?)';
    const sql = `
        SELECT
            TRIM(C.CODIGOARTICULO) AS PRODUCT_CODE,
            TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
            C.PRECIO AS PROMO_PRICE,
            C.DIAINICIO, C.MESINICIO, C.ANOINICIO,
            C.DIAFINAL, C.MESFINAL, C.ANOFINAL,
            TRIM(C.PREFIJOPROMOCION) AS PROMO_PREFIX,
            C.SECUENCIA,
            COALESCE(S.STOCK_ENVASES, 0) AS STOCK_ENVASES,
            COALESCE(S.STOCK_UNIDADES, 0) AS STOCK_UNIDADES
        FROM ${comercialErpTable('CPES')} C
        LEFT JOIN ${comercialErpTable('ART')} A
          ON TRIM(A.CODIGOARTICULO) = TRIM(C.CODIGOARTICULO)
        LEFT JOIN (
            SELECT TRIM(CODIGOARTICULO) AS CODE,
                   SUM(ENVASESDISPONIBLES) AS STOCK_ENVASES,
                   SUM(UNIDADESDISPONIBLES) AS STOCK_UNIDADES
            FROM ${comercialErpTable('ARO')}
            WHERE CODIGOALMACEN = 1
            GROUP BY TRIM(CODIGOARTICULO)
        ) S ON S.CODE = TRIM(C.CODIGOARTICULO)
        WHERE C.CODIGOCLIENTE = CAST(? AS CHAR(10))
          AND TRIM(COALESCE(C.CODIGOARTICULO, '')) <> ''
          AND (C.ANOINICIO = 0 OR (C.ANOINICIO * 10000 + C.MESINICIO * 100 + C.DIAINICIO) <= ?)
          ${endClause}
        ORDER BY TRIM(C.CODIGOARTICULO), C.SECUENCIA
        FETCH FIRST ${includeHistory ? 500 : 300} ROWS ONLY
    `;
    try {
        const rows = await queryWithParams(sql, includeHistory ? [clientCode, today] : [clientCode, today, today]);
        logger.info(`[PEDIDOS] Promociones CPES para cliente=${clientCode}, hoy=${today}: ${rows?.length || 0} fila(s)`);
        return (rows || []).map((r) => {
            const productCode = trimString(r.PRODUCT_CODE);
            const sequence = parseInt(r.SECUENCIA) || 0;
            return {
                source: 'CPES',
                code: productCode,
                productCode,
                name: trimString(r.PRODUCT_NAME) || productCode,
                promoDesc: 'Precio especial cliente',
                promoType: 'PRICE',
                promoCode: `CPES:${productCode}:${sequence}`,
                promoPrice: parseFloat(r.PROMO_PRICE) || 0,
                regularPrice: 0,
                dateFrom: formatPromoDateV2(r.DIAINICIO, r.MESINICIO, r.ANOINICIO),
                dateTo: formatPromoDateV2(r.DIAFINAL, r.MESFINAL, r.ANOFINAL),
                minQty: 1,
                giftQty: 0,
                cumulative: false,
                stackable: false,
                stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
                stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
                active: promotionWindowActive(
                    ymdParts(r.ANOINICIO, r.MESINICIO, r.DIAINICIO),
                    ymdParts(r.ANOFINAL, r.MESFINAL, r.DIAFINAL),
                    today,
                ),
            };
        });
    } catch (e) {
        logger.warn(`[PEDIDOS] Query promociones CPES fallo: ${e.message}`);
        return [];
    }
}

function buildGiftPromotionItemsV2(rows, today = todayYmd()) {
    const byPromo = new Map();
    const items = [];
    for (const r of rows || []) {
        const promoCode = trimString(r.PROMO_CODE);
        const promoName = trimString(r.PROMO_NAME);
        if (!promoCode) continue;
        const productCode = trimString(r.PRODUCT_CODE);
        const item = {
            source: 'PMR',
            assignmentSource: trimString(r.ASSIGNMENT_SOURCE) || 'PMR',
            code: productCode || promoCode,
            productCode,
            name: trimString(r.PRODUCT_NAME) || promoName || promoCode,
            promoDesc: promoName,
            promoType: 'GIFT',
            promoCode,
            promoPrice: 0,
            regularPrice: 0,
            dateFrom: formatPromoDateV2(r.DIAINICIO, r.MESINICIO, r.ANOINICIO),
            dateTo: formatPromoDateV2(r.DIAFIN, r.MESFIN, r.ANOFIN),
            minQty: parseFloat(r.CANTIDADMINIMAPROMOCION) || 0,
            giftQty: parseFloat(r.CANTIDADMAXIMAREGALO)
                || parseFloat(r.CANTIDADMINIMAREGALO)
                || parseFloat(r.PRODUCT_MAX_ENVASES)
                || parseFloat(r.PRODUCT_MAX_UNIDADES)
                || 0,
            cumulative: String(r.PROMOCIONACUMULATIVASN || '').trim() === 'S',
            stackable: String(r.PROMOCIONACUMULATIVASN || '').trim() === 'S',
            stockEnvases: parseFloat(r.STOCK_ENVASES) || 0,
            stockUnidades: parseFloat(r.STOCK_UNIDADES) || 0,
            noGiftBought: String(r.NOREGALARPRODUCTOSCOMPRADOSSN || '').trim() === 'S',
            isGlobal: trimString(r.ASSIGNMENT_SOURCE) === 'PMR_GENERAL',
            giftSelectionLocked: Boolean(productCode),
            giftSkus: [],
            productMinQty: parseFloat(r.PRODUCT_MIN_ENVASES) || parseFloat(r.PRODUCT_MIN_UNIDADES) || 0,
            productMaxQty: parseFloat(r.PRODUCT_MAX_ENVASES) || parseFloat(r.PRODUCT_MAX_UNIDADES) || 0,
            order: parseInt(r.PRODUCT_ORDER) || 0,
            active: promotionWindowActive(
                ymdParts(r.ANOINICIO, r.MESINICIO, r.DIAINICIO),
                ymdParts(r.ANOFIN, r.MESFIN, r.DIAFIN),
                today,
            ),
        };
        items.push(item);
        if (!byPromo.has(promoCode)) byPromo.set(promoCode, new Set());
        if (productCode) byPromo.get(promoCode).add(productCode);
    }
    for (const item of items) {
        item.giftSkus = Array.from(byPromo.get(item.promoCode) || []);
    }
    return dedupePromotionItemsV2(items);
}

function formatPromoDateV2(day, month, year) {
    const y = parseInt(year) || 0;
    if (y <= 0) return '';
    return `${parseInt(day) || 1}/${parseInt(month) || 1}/${y}`;
}

function dedupePromotionItemsV2(promotions) {
    const seen = new Set();
    const result = [];
    for (const promo of promotions || []) {
        const key = [
            promo.source || '',
            promo.assignmentSource || '',
            promo.promoType || '',
            promo.promoCode || '',
            promo.code || '',
            promo.productCode || '',
            promo.dateFrom || '',
            promo.dateTo || '',
            promo.promoPrice || 0,
            promo.minQty || 0,
            promo.giftQty || 0,
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(promo);
    }
    return result;
}

module.exports = {
    detectPromoSourcesV2,
    getActivePromotionsV2,
    getClientPromotionCatalogV2,
    promotionWindowActive,
    getActivePrdPromotionsV2,
    getActiveGiftPromotionsV2,
    getActiveSpecialPricePromotionsV2,
    buildGiftPromotionItemsV2,
    formatPromoDateV2,
    dedupePromotionItemsV2,
};
