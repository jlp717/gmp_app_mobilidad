'use strict';

/**
 * Objectives DB2 repository — acceso DB2 de objetivos.
 *
 * SQL movido verbatim desde backend/routes/objectives.js (sin cambios de
 * comportamiento). Todo binding parametrizado; FETCH FIRST (nunca LIMIT).
 *
 * TODO(DIP): recibir query/queryWithParams siempre por parametros en vez de
 * requires directos (patron actual del repo por tiempo).
 */

const { query, queryWithParams } = require('../middleware/db-timing');
const logger = require('../middleware/logger');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const { LACLAE_SALES_FILTER } = require('../utils/common');
const { assertIdentifier } = require('../utils/sql-identifiers');

function fetchObjectiveVendorClients(vendorCode, col, year, db = { queryWithParams }) {
    return db.queryWithParams(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.${col} = ?
          AND L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
    `, [vendorCode, year], false);
}

function fetchClientsMonthlySales(safeCodes, year, db = { queryWithParams }) {
    return db.queryWithParams(`
        SELECT
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            SUM(L.LCIMCT) as COST,
            COUNT(DISTINCT L.LCCDCL) as CLIENTS
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCCDCL IN (${safeCodes.map(() => '?').join(',')})
          AND L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
    `, [...safeCodes, year], false);
}

function fetchObjConfigExplicit(codeVariants, db = { queryWithParams }) {
    const placeholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT TARGET_PERCENTAGE
            FROM JAVIER.OBJ_CONFIG
            WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})
              AND CODIGOCLIENTE = '*'
            FETCH FIRST 1 ROWS ONLY
        `, codeVariants, false);
}

function fetchObjConfigVendor(codeVariants, db = { queryWithParams }) {
    const placeholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT TARGET_PERCENTAGE, COUNT(*) as CNT
            FROM JAVIER.OBJ_CONFIG
            WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})
            GROUP BY TARGET_PERCENTAGE
            ORDER BY CNT DESC, TARGET_PERCENTAGE DESC
            FETCH FIRST 1 ROWS ONLY
        `, codeVariants, false);
}

function fetchObjConfigGlobal(db = { queryWithParams }) {
    return db.queryWithParams(`
            SELECT TARGET_PERCENTAGE
            FROM JAVIER.OBJ_CONFIG
            WHERE CODIGOVENDEDOR = '*'
              AND CODIGOCLIENTE = '*'
            FETCH FIRST 1 ROWS ONLY
        `, [], false);
}

function fetchFixedMonthlyTarget(codeVariants, year, month, db = { queryWithParams }) {
    const placeholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION, MES
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})
              AND ANIO = ?
              AND (MES <= ? OR MES IS NULL)
              AND ACTIVO = 1
            ORDER BY
              CASE WHEN MES = ? THEN 3 WHEN MES IS NULL THEN 1 ELSE 2 END DESC,
              MES DESC
            FETCH FIRST 1 ROWS ONLY
        `, [...codeVariants, year, month, month], false);
}

function fetchExactMonthlyTargets(codeVariants, year, db = { queryWithParams }) {
    const placeholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT MES, IMPORTE_OBJETIVO
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})
              AND ANIO = ?
              AND ACTIVO = 1
              AND MES IS NOT NULL
            ORDER BY MES
        `, [...codeVariants, year], false);
}

function fetchGlobalPinnedMonthlyTargets(year, db = { queryWithParams }) {
    return db.queryWithParams(`
            SELECT MES, SUM(IMPORTE_OBJETIVO) as TOTAL
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE ANIO = ? AND ACTIVO = 1 AND MES IS NOT NULL
            GROUP BY MES
            HAVING COUNT(DISTINCT TRIM(CODIGOVENDEDOR)) > 1
        `, [year], false);
}

function fetchScopedPinnedMonthlyTargets(year, allVariants, db = { queryWithParams }) {
    const ph = allVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT MES, SUM(IMPORTE_OBJETIVO) as TOTAL
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE ANIO = ? AND ACTIVO = 1
              AND MES IS NOT NULL
              AND TRIM(CODIGOVENDEDOR) IN (${ph})
            GROUP BY MES
        `, [year, ...allVariants], false);
}

function fetchFixedMonthlyObjectiveTargets(codeVariants, year, db = { queryWithParams }) {
    const placeholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT IMPORTE_OBJETIVO, MES
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})
              AND ANIO = ?
              AND ACTIVO = 1
            ORDER BY MES DESC
        `, [...codeVariants, year], false);
}

function fetchGlobalBaselinePrevYear(prevYear, db = { queryWithParams }) {
    return db.queryWithParams(`
        SELECT
            L.LCAADC as YEAR,
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            0 as COST,
            0 as CLIENTS
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCAADC = ?
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC, L.LCMMDC
    `, [prevYear], false);
}

function fetchVendorEvolutionRows(uniqueYears, clause, params, db = { queryWithParams }) {
    return db.queryWithParams(`
        SELECT
            L.LCAADC as YEAR,
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            SUM(L.LCIMCT) as COST,
            COUNT(DISTINCT L.LCCDCL) as CLIENTS
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCAADC IN (${uniqueYears.map(() => '?').join(',')})
          AND ${LACLAE_SALES_FILTER}
          ${clause}
        GROUP BY L.LCAADC, L.LCMMDC
    `, [...uniqueYears, ...params], false);
}

function fetchCofcQuota(quotaField, db = { query }) {
    return db.query(`
          SELECT COALESCE(SUM(${quotaField}), 0) as quota
          FROM ${comercialErpTable('COFC')}
          WHERE CODIGOTIPOCUOTA IS NOT NULL
        `, false);
}

function fetchCmvObjective(code, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT COALESCE(IMPORTEOBJETIVO, 0) as objetivo,
                           COALESCE(PORCENTAJEOBJETIVO, 0) as porcentaje
                    FROM ${comercialErpTable('CMV')}
                    WHERE CODIGOVENDEDOR = ?
                `, [code], false);
}

function fetchLacMonthMargin(year, month, clause, params, db = { queryWithParams }) {
    return db.queryWithParams(`
                SELECT
                    COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
                    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
                FROM ${comercialErpTable('LAC')} L
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? ${clause}
            `, [year, month, ...params]);
}

function fetchLacMonthSales(year, month, clause, params, db = { queryWithParams }) {
    return db.queryWithParams(`
                SELECT
                    COALESCE(SUM(IMPORTEVENTA), 0) as sales,
                    COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
                    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
                FROM ${comercialErpTable('LAC')} L
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? ${clause}
            `, [year, month, ...params]);
}

// =============================================================================
// MATRIX (movidos verbatim desde routes/objectives.js — handler /matrix)
// =============================================================================

function fetchMatrixContact(clientCode, db = { queryWithParams }) {
    return db.queryWithParams(`
                SELECT TELEFONO1 as PHONE, TELEFONO2 as PHONE2
                FROM ${comercialErpTable('CLI')} WHERE CODIGOCLIENTE = CAST(? AS CHAR(10)) FETCH FIRST 1 ROWS ONLY
            `, [clientCode]);
}

function fetchMatrixNotes(clientCode, db = { queryWithParams }) {
    return db.queryWithParams(`
                SELECT OBSERVACIONES, MODIFIED_BY FROM JAVIER.CLIENT_NOTES
                WHERE CLIENT_CODE = ? FETCH FIRST 1 ROWS ONLY
            `, [clientCode], false);
}

async function fetchMatrixProductRows(clientCode, uniqueYears, monthStart, monthEnd, filterConditions, filterParams, db = { queryWithParams }) {
    // Agrega LACLAE sola, en DECFLOAT, y luego une el artículo.
    // SUM/AVG de DECIMAL revienta con SQLSTATE 22003 (precisión o desbordamiento
    // al cruzar ART/ARTX) y la evolución de pedidos responde 500 para cualquier rol.
    const salesFilter = LACLAE_SALES_FILTER.replace(/L\./g, 'S.');
    const yearMarks = uniqueYears.map(() => '?').join(',');
    const plainSql = `
            SELECT
                TRIM(S.LCCDRF) AS PRODUCT_CODE,
                COALESCE(MAX(TRIM(S.LCDESC)), '') AS PRODUCT_NAME,
                CAST('SIN_FAM' AS VARCHAR(20)) AS FAMILY_CODE,
                CAST('General' AS VARCHAR(20)) AS SUBFAMILY_CODE,
                CAST('UDS' AS VARCHAR(5)) AS UNIT_TYPE,
                S.LCAADC AS YEAR,
                S.LCMMDC AS MONTH,
                SUM(S.LCIMVT) AS SALES,
                SUM(S.LCIMCT) AS COST,
                SUM(S.LCCTUD) AS UNITS,
                CAST(0 AS INTEGER) AS HAS_SPECIAL_PRICE,
                CAST(0 AS INTEGER) AS HAS_DISCOUNT,
                CAST(NULL AS DECIMAL(15,2)) AS AVG_DISCOUNT_PCT,
                CAST(NULL AS DECIMAL(15,2)) AS AVG_DISCOUNT_EUR,
                CAST(NULL AS DECIMAL(15,2)) AS AVG_CLIENT_TARIFF,
                CAST(NULL AS DECIMAL(15,2)) AS AVG_BASE_TARIFF,
                CAST('' AS VARCHAR(12)) AS FI1_CODE,
                CAST('' AS VARCHAR(12)) AS FI2_CODE,
                CAST('' AS VARCHAR(12)) AS FI3_CODE,
                CAST('' AS VARCHAR(12)) AS FI4_CODE,
                CAST('' AS VARCHAR(20)) AS FI5_CODE
            FROM ${comercialErpTable('LACLAE')} S
            WHERE S.LCCDCL = CAST(? AS CHAR(10))
              AND S.LCAADC IN (${yearMarks})
              AND S.LCMMDC BETWEEN ? AND ?
              AND ${salesFilter}
            GROUP BY S.LCCDRF, S.LCAADC, S.LCMMDC
            ORDER BY SALES DESC
            FETCH FIRST 1000 ROWS ONLY
        `;
    try {
        const rows = await db.queryWithParams(plainSql, [clientCode, ...uniqueYears, monthStart, monthEnd]);
        return attachMatrixArticleFields(rows, db);
    } catch (error) {
        error.matrixSql = 'matrix product rows';
        throw error;
    }
}

async function attachMatrixArticleFields(rows, db) {
    const codes = [...new Set((rows || []).map((row) => String(row.PRODUCT_CODE || '').trim()).filter(Boolean))].slice(0, 200);
    if (!codes.length) return rows || [];
    try {
        const artRows = await db.queryWithParams(
            `SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, CODIGOFAMILIA, CODIGOSUBFAMILIA, UNIDADMEDIDA, CODIGOSECCIONLARGA
               FROM ${comercialErpTable('ART')}
              WHERE CODIGOARTICULO IN (${codes.map(() => '?').join(',')})`,
            codes,
        );
        const byCode = new Map((artRows || []).map((art) => [String(art.CODIGOARTICULO || '').trim(), art]));
        return rows.map((row) => {
            const art = byCode.get(String(row.PRODUCT_CODE || '').trim());
            if (!art) return row;
            return {
                ...row,
                PRODUCT_NAME: String(art.DESCRIPCIONARTICULO || '').trim() || row.PRODUCT_NAME,
                FAMILY_CODE: String(art.CODIGOFAMILIA || '').trim() || row.FAMILY_CODE,
                SUBFAMILY_CODE: String(art.CODIGOSUBFAMILIA || '').trim() || row.SUBFAMILY_CODE,
                UNIT_TYPE: String(art.UNIDADMEDIDA || '').trim() || row.UNIT_TYPE,
                FI5_CODE: String(art.CODIGOSECCIONLARGA || '').trim() || row.FI5_CODE,
            };
        });
    } catch (artError) {
        logger.warn(`[MATRIX] article lookup skipped ${artError.message}`);
        return rows || [];
    }
}

function fetchMatrixFamilyNames(db = { query }) {
    return db.query(`SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM ${assertIdentifier(comercialErpTable('FAM'), 'objectives FAM table')}`, false, false);
}

function fetchMatrixFiNames(table, db = { query }) {
    return db.query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM ${assertIdentifier(comercialErpTable(table), `objectives ${table} table`)}`, false, false);
}

// =============================================================================
// POPULATIONS (movido verbatim desde routes/objectives.js — handler /populations)
// =============================================================================

function fetchPopulations(db = { query }) {
    return db.query(`
            SELECT DISTINCT TRIM(POBLACION) as CITY
            FROM ${comercialErpTable('CLI')}
            WHERE ANOBAJA = 0
            AND TRIM(POBLACION) <> ''
            ORDER BY 1
        `);
}

// =============================================================================
// BY-CLIENT (movidos verbatim desde routes/objectives.js — handleByClientRequest)
// =============================================================================

function fetchByClientFilteredCount(safeClientCodes, extraFilters, extraFilterParams, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT COUNT(*) as TOTAL
                    FROM ${comercialErpTable('CLI')} C
                    WHERE C.CODIGOCLIENTE IN (${safeClientCodes.map(() => '?').join(',')})
                      ${extraFilters}
                `, [...safeClientCodes, ...extraFilterParams], false);
}

function fetchByClientSalesRank(yearsArray, monthFilter, monthParams, safeClientCodes, rowsLimit, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT L.LCCDCL as CODE, SUM(L.LCIMVT) as SALES, SUM(L.LCIMCT) as COST
                    FROM ${comercialErpTable('LACLAE')} L
                    WHERE L.LCAADC IN (${yearsArray.map(() => '?').join(',')})
                      ${monthFilter}
                      AND ${LACLAE_SALES_FILTER}
                      AND L.LCCDCL IN (${safeClientCodes.map(() => '?').join(',')})
                    GROUP BY L.LCCDCL
                    ORDER BY SALES DESC
                    FETCH FIRST ? ROWS ONLY
                `, [...yearsArray, ...monthParams, ...safeClientCodes, rowsLimit], false);
}

function fetchByClientDetails(topCodes, db = { queryWithParams }) {
    return db.queryWithParams(`
                        SELECT
                            C.CODIGOCLIENTE as CODE,
                            COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), C.NOMBRECLIENTE) as NAME,
                            C.DIRECCION as ADDRESS,
                            C.CODIGOPOSTAL as POSTALCODE,
                            C.POBLACION as CITY
                        FROM ${comercialErpTable('CLI')} C
                        WHERE C.CODIGOCLIENTE IN (${topCodes.map(() => '?').join(',')})
                    `, topCodes, false);
}

function fetchByClientFallbackDetails(fallbackCodes, rowsLimit, db = { queryWithParams }) {
    return db.queryWithParams(`
                        SELECT
                            C.CODIGOCLIENTE as CODE,
                            COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), C.NOMBRECLIENTE) as NAME,
                            C.DIRECCION as ADDRESS,
                            C.CODIGOPOSTAL as POSTALCODE,
                            C.POBLACION as CITY
                        FROM ${comercialErpTable('CLI')} C
                        WHERE C.CODIGOCLIENTE IN (${fallbackCodes.map(() => '?').join(',')})
                        FETCH FIRST ? ROWS ONLY
                    `, [...fallbackCodes, rowsLimit], false);
}

function fetchByClientFilteredJoin(yearsArray, monthBareFilter, monthBareParams, safeClientCodes, extraFilters, extraFilterParams, rowsLimit, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT
                        C.CODIGOCLIENTE as CODE,
                        COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), C.NOMBRECLIENTE) as NAME,
                        C.DIRECCION as ADDRESS,
                        C.CODIGOPOSTAL as POSTALCODE,
                        C.POBLACION as CITY,
                        COALESCE(S.SALES, 0) as SALES,
                        COALESCE(S.COST, 0) as COST
                    FROM ${comercialErpTable('CLI')} C
                    LEFT JOIN (
                        SELECT LCCDCL, SUM(LCIMVT) as SALES, SUM(LCIMCT) as COST
                        FROM ${comercialErpTable('LACLAE')}
                        WHERE LCAADC IN (${yearsArray.map(() => '?').join(',')})
                          ${monthBareFilter}
                          AND ${LACLAE_SALES_FILTER.replace(/L\./g, '')}
                          AND LCCDCL IN (${safeClientCodes.map(() => '?').join(',')})
                        GROUP BY LCCDCL
                    ) S ON C.CODIGOCLIENTE = S.LCCDCL
                    WHERE C.CODIGOCLIENTE IN (${safeClientCodes.map(() => '?').join(',')})
                      ${extraFilters}
                    ORDER BY COALESCE(S.SALES, 0) DESC
                    FETCH FIRST ? ROWS ONLY
                `, [...yearsArray, ...monthBareParams, ...safeClientCodes, ...safeClientCodes, ...extraFilterParams, rowsLimit]);
}

function fetchByClientVendorSalesRank(yearsArray, monthFilter, monthParams, vendedorClause, vendedorParams, rowsLimit, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT
                        L.LCCDCL as CODE,
                        SUM(L.LCIMVT) as SALES,
                        SUM(L.LCIMCT) as COST
                    FROM ${comercialErpTable('LACLAE')} L
                    WHERE L.LCAADC IN (${yearsArray.map(() => '?').join(',')})
                      ${monthFilter}
                      AND ${LACLAE_SALES_FILTER}
                      ${vendedorClause}
                    GROUP BY L.LCCDCL
                    ORDER BY SALES DESC
                    FETCH FIRST ? ROWS ONLY
                `, [...yearsArray, ...monthParams, ...vendedorParams, rowsLimit], false);
}

function fetchByClientVendorFilteredJoin(yearsArray, monthFilter, monthParams, vendedorClause, vendedorParams, extraFilters, extraFilterParams, rowsLimit, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT
                        L.LCCDCL as CODE,
                        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
                        MIN(C.DIRECCION) as ADDRESS,
                        MIN(C.CODIGOPOSTAL) as POSTALCODE,
                        MIN(C.POBLACION) as CITY,
                        SUM(L.LCIMVT) as SALES,
                        SUM(L.LCIMCT) as COST
                    FROM ${comercialErpTable('LACLAE')} L
                    LEFT JOIN ${comercialErpTable('CLI')} C ON L.LCCDCL = C.CODIGOCLIENTE
                    WHERE L.LCAADC IN (${yearsArray.map(() => '?').join(',')})
                      ${monthFilter}
                      AND ${LACLAE_SALES_FILTER}
                      ${vendedorClause}
                      ${extraFilters}
                    GROUP BY L.LCCDCL
                    ORDER BY SALES DESC
                    FETCH FIRST ? ROWS ONLY
                `, [...yearsArray, ...monthParams, ...vendedorParams, ...extraFilterParams, rowsLimit]);
}

function fetchByClientPrevSalesChunk(prevYear, monthFilter, monthParams, chunk, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT
                        L.LCCDCL as CODE,
                        SUM(L.LCIMVT) as PREV_SALES
                    FROM ${comercialErpTable('LACLAE')} L
                    WHERE L.LCAADC = ?
                      ${monthFilter}
                      AND ${LACLAE_SALES_FILTER}
                      AND L.LCCDCL IN (${chunk.map(() => '?').join(',')})
                    GROUP BY L.LCCDCL
                `, [prevYear, ...monthParams, ...chunk], false);
}

function fetchByClientObjConfigChunk(chunk, db = { queryWithParams }) {
    return db.queryWithParams(`
                            SELECT CODIGOCLIENTE, TARGET_PERCENTAGE
                            FROM JAVIER.OBJ_CONFIG
                            WHERE CODIGOCLIENTE IN (${chunk.map(() => '?').join(',')})
                        `, chunk, false);
}

function fetchByClientObjConfigGlobal(db = { queryWithParams }) {
    return db.queryWithParams(`
                        SELECT CODIGOCLIENTE, TARGET_PERCENTAGE
                        FROM JAVIER.OBJ_CONFIG
                        WHERE CODIGOCLIENTE = '*'
                    `, [], false);
}

function fetchByClientVendorFixedTarget(vendorCodesArray, currentYear, currentMonth, db = { queryWithParams }) {
    return db.queryWithParams(`
                        SELECT CODIGOVENDEDOR, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION, PORCENTAJE_MEJORA
                        FROM JAVIER.COMMERCIAL_TARGETS
                        WHERE CODIGOVENDEDOR IN (${vendorCodesArray.map(() => '?').join(',')})
                          AND ANIO = ?
                          AND (MES = ? OR MES IS NULL)
                          AND ACTIVO = 1
                        ORDER BY MES DESC
                        FETCH FIRST 1 ROWS ONLY
                    `, [...vendorCodesArray, currentYear, currentMonth], false);
}

module.exports = {
    fetchObjectiveVendorClients,
    fetchClientsMonthlySales,
    fetchObjConfigExplicit,
    fetchObjConfigVendor,
    fetchObjConfigGlobal,
    fetchFixedMonthlyTarget,
    fetchExactMonthlyTargets,
    fetchGlobalPinnedMonthlyTargets,
    fetchScopedPinnedMonthlyTargets,
    fetchFixedMonthlyObjectiveTargets,
    fetchGlobalBaselinePrevYear,
    fetchVendorEvolutionRows,
    fetchCofcQuota,
    fetchCmvObjective,
    fetchLacMonthMargin,
    fetchLacMonthSales,
    fetchMatrixContact,
    fetchMatrixNotes,
    fetchMatrixProductRows,
    fetchMatrixFamilyNames,
    fetchMatrixFiNames,
    fetchPopulations,
    fetchByClientFilteredCount,
    fetchByClientSalesRank,
    fetchByClientDetails,
    fetchByClientFallbackDetails,
    fetchByClientFilteredJoin,
    fetchByClientVendorSalesRank,
    fetchByClientVendorFilteredJoin,
    fetchByClientPrevSalesChunk,
    fetchByClientObjConfigChunk,
    fetchByClientObjConfigGlobal,
    fetchByClientVendorFixedTarget,
};
