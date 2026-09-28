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
                FROM ${comercialErpTable('CLI')} WHERE CODIGOCLIENTE = ? FETCH FIRST 1 ROWS ONLY
            `, [clientCode]);
}

function fetchMatrixNotes(clientCode, db = { queryWithParams }) {
    return db.queryWithParams(`
                SELECT OBSERVACIONES, MODIFIED_BY FROM JAVIER.CLIENT_NOTES
                WHERE CLIENT_CODE = ? FETCH FIRST 1 ROWS ONLY
            `, [clientCode], false);
}

function fetchMatrixProductRows(clientCode, uniqueYears, monthStart, monthEnd, filterConditions, filterParams, db = { queryWithParams }) {
    return db.queryWithParams(`
            SELECT
                L.LCCDRF as PRODUCT_CODE,
                COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.LCDESC)) as PRODUCT_NAME,
                COALESCE(A.CODIGOFAMILIA, 'SIN_FAM') as FAMILY_CODE,
                COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as SUBFAMILY_CODE,
                COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
                L.LCAADC as YEAR,
                L.LCMMDC as MONTH,
                SUM(L.LCIMVT) as SALES,
                SUM(L.LCIMCT) as COST,
                SUM(L.LCCTUD) as UNITS,
                SUM(CASE WHEN L.LCPRTC <> 0 AND L.LCPRT1 <> 0
                    AND L.LCPRTC <> L.LCPRT1 THEN 1 ELSE 0 END) as HAS_SPECIAL_PRICE,
                SUM(CASE WHEN L.LCPJDT <> 0 THEN 1 ELSE 0 END) as HAS_DISCOUNT,
                AVG(CASE WHEN L.LCPJDT <> 0 THEN L.LCPJDT ELSE NULL END) as AVG_DISCOUNT_PCT,
                CAST(NULL AS DECIMAL(10,2)) as AVG_DISCOUNT_EUR,
                AVG(L.LCPRTC) as AVG_CLIENT_TARIFF,
                AVG(L.LCPRT1) as AVG_BASE_TARIFF,
                COALESCE(TRIM(AX.FILTRO01), '') as FI1_CODE,
                COALESCE(TRIM(AX.FILTRO02), '') as FI2_CODE,
                COALESCE(TRIM(AX.FILTRO03), '') as FI3_CODE,
                COALESCE(TRIM(AX.FILTRO04), '') as FI4_CODE,
                COALESCE(TRIM(A.CODIGOSECCIONLARGA), '') as FI5_CODE
            FROM ${comercialErpTable('LACLAE')} L
            LEFT JOIN ${comercialErpTable('ART')} A ON L.LCCDRF = A.CODIGOARTICULO
            LEFT JOIN ${comercialErpTable('ARTX')} AX ON L.LCCDRF = AX.CODIGOARTICULO
            WHERE L.LCCDCL = ?
              AND L.LCAADC IN(${uniqueYears.map(() => '?').join(',')})
              AND L.LCMMDC BETWEEN ? AND ?
              AND ${LACLAE_SALES_FILTER}
              ${filterConditions}
            GROUP BY L.LCCDRF, A.DESCRIPCIONARTICULO, L.LCDESC, A.CODIGOFAMILIA, A.CODIGOSUBFAMILIA, A.UNIDADMEDIDA, L.LCAADC, L.LCMMDC, AX.FILTRO01, AX.FILTRO02, AX.FILTRO03, AX.FILTRO04, A.CODIGOSECCIONLARGA
            ORDER BY SALES DESC
            FETCH FIRST 1000 ROWS ONLY
        `, [clientCode, ...uniqueYears, monthStart, monthEnd, ...filterParams]);
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
