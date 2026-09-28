'use strict';

/**
 * Commissions DB2 repository — acceso DB2 de comisiones.
 *
 * SQL movido verbatim desde backend/routes/commissions.js (sin cambios de
 * comportamiento). Todo binding parametrizado; FETCH FIRST (nunca LIMIT).
 *
 * TODO(DIP): recibir query/queryWithParams siempre por parametros en vez de
 * requires directos (patron actual del repo por tiempo).
 */

const { query, queryWithParams } = require('../middleware/db-timing');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const { LACLAE_SALES_FILTER } = require('../utils/common');

const COMM_CONFIG_SELECT_SQL = [
    'SELECT IPC_PCT, TIER1_MAX, TIER1_PCT, TIER2_MAX, TIER2_PCT, TIER3_MAX, TIER3_PCT, TIER4_PCT',
    'FROM JAVIER.COMM_CONFIG',
    'WHERE YEAR = ?',
    'FETCH FIRST 1 ROWS ONLY',
].join(' ');

function fetchExcludedVendorCodes(db = { query }) {
    return db.query(`
            SELECT TRIM(CODIGOVENDEDOR) as CODE
            FROM JAVIER.COMMISSION_EXCEPTIONS
            WHERE EXCLUIDO_COMISIONES = 'Y'
        `, false, false);
}

function fetchCommissionConfig(year, db = { queryWithParams }) {
    return db.queryWithParams(
        COMM_CONFIG_SELECT_SQL,
        [parseInt(year, 10)],
        false,
        false,
    );
}

function fetchVendorPaymentRows(safeVCode, safeNCode, year, db = { queryWithParams }) {
    return db.queryWithParams(`
            SELECT
                MES,
                IMPORTE_PAGADO,
                COMISION_GENERADA,
                VENTAS_REAL,
                OBJETIVO_MES,
                OBSERVACIONES,
                FECHA_PAGO
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE (VENDEDOR_CODIGO = ? OR VENDEDOR_CODIGO = ?)
              AND ANIO = ?
            ORDER BY MES, FECHA_PAGO
        `, [safeVCode, safeNCode, parseInt(year, 10)], false, false);
}

function deleteMonthPayments(year, month, codeVariants, db = { queryWithParams }) {
    const placeholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
        DELETE FROM JAVIER.COMMISSION_PAYMENTS
        WHERE ANIO = ?
          AND MES = ?
          AND VENDEDOR_CODIGO IN (${placeholders})
    `, [parseInt(year, 10), parseInt(month, 10), ...codeVariants], false, false);
}

function insertCommissionPayment({
    vendorCode, year, month, ventaComision, objetivoMes, ventasSobreObjetivo,
    comisionGenerada, importePagado, observaciones, creadoPor,
}, db = { queryWithParams }) {
    return db.queryWithParams(`
                    INSERT INTO JAVIER.COMMISSION_PAYMENTS
                    (VENDEDOR_CODIGO, ANIO, MES, VENTAS_REAL, OBJETIVO_MES, VENTAS_SOBRE_OBJETIVO, COMISION_GENERADA, IMPORTE_PAGADO, FECHA_PAGO, OBSERVACIONES, CREADO_POR)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
                `, [vendorCode, year, month, ventaComision, objetivoMes, ventasSobreObjetivo, comisionGenerada, importePagado, observaciones, creadoPor]);
}

function fetchSnapshotAll(year, monthList, db = { queryWithParams }) {
    const monthPlaceholders = monthList.map(() => '?').join(',');
    return db.queryWithParams(`
                SELECT TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO, MES, VENTAS_REAL,
                       OBJETIVO_MES, COMISION_GENERADA
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
            `, [year, ...monthList], false, false);
}

function fetchSnapshotScoped(year, monthList, safeCodes, db = { queryWithParams }) {
    const monthPlaceholders = monthList.map(() => '?').join(',');
    const codePlaceholders = safeCodes.map(() => '?').join(',');
    return db.queryWithParams(`
                SELECT TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO, MES, VENTAS_REAL,
                       OBJETIVO_MES, COMISION_GENERADA
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
                  AND VENDEDOR_CODIGO IN (${codePlaceholders})
            `, [year, ...monthList, ...safeCodes], false, false);
}

function fetchSnapshotCoverage(year, monthList, db = { queryWithParams }) {
    const monthPlaceholders = monthList.map(() => '?').join(',');
    return db.queryWithParams(`
                SELECT DISTINCT MES
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
            `, [year, ...monthList], false, false);
}

function fetchMonthLacSales(year, month, vendorExpr, codeVariants, db = { queryWithParams }) {
    const vendorPlaceholders = codeVariants.map(() => '?').join(',');
    return db.queryWithParams(`
            SELECT SUM(L.LCIMVT) as SALES
            FROM ${comercialErpTable('LACLAE')} L
            WHERE L.LCAADC = ?
              AND L.LCMMDC = ?
              AND ${LACLAE_SALES_FILTER}
              AND TRIM(${vendorExpr}) IN (${vendorPlaceholders})
            FETCH FIRST 1 ROWS ONLY
        `, [year, month, ...codeVariants], false);
}

function fetchMonthCommercialTargets(safeVendor, safeUnpadded, year, db = { queryWithParams }) {
    // Tier-1 listados sin limite: COMMERCIAL_TARGETS por vendor/anio son <=12
    // filas/mes, FETCH FIRST 60 ROWS ONLY es margen 5x documentado.
    return db.queryWithParams(`
                SELECT IMPORTE_BASE_COMISION, MES
                FROM JAVIER.COMMERCIAL_TARGETS
                WHERE (CODIGOVENDEDOR = ? OR CODIGOVENDEDOR = ?)
                  AND ANIO = ?
                  AND ACTIVO = 1
                ORDER BY MES DESC
                FETCH FIRST 60 ROWS ONLY
            `, [safeVendor, safeUnpadded, year], false);
}

function fetchPayFallbackSales(year, month, vendorFilterClause, codeVariants, db = { queryWithParams }) {
    return db.queryWithParams(`
                    SELECT SUM(L.LCIMVT) as SALES
                    FROM ${comercialErpTable('LACLAE')} L
                    WHERE L.LCAADC = ?
                      AND L.LCMMDC = ?
                      AND ${LACLAE_SALES_FILTER}
                      ${vendorFilterClause}
                    FETCH FIRST 1 ROWS ONLY
                `, [year, month, ...codeVariants], false);
}

module.exports = {
    COMM_CONFIG_SELECT_SQL,
    fetchExcludedVendorCodes,
    fetchCommissionConfig,
    fetchVendorPaymentRows,
    deleteMonthPayments,
    insertCommissionPayment,
    fetchSnapshotAll,
    fetchSnapshotScoped,
    fetchSnapshotCoverage,
    fetchMonthLacSales,
    fetchMonthCommercialTargets,
    fetchPayFallbackSales,
};
