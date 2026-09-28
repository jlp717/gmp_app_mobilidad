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
};
