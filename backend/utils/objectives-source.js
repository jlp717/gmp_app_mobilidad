'use strict';

/**
 * Align objectives sales with commissions: COMMISSION_SNAPSHOT first, then
 * client-scope LACLAE (same as commissions.js), then DSEDAC.LAC fallback.
 * Never use V_FACT_VENTAS / V_FACT_RESUMEN_VENTAS / V_STG_LAC.
 */
const { queryWithParams } = require('../config/db');
const { SNAPSHOT_SOURCE } = require('./commission-snapshot');
const {
    SNAPSHOT_UNTIL_MONTH,
    LACLAE_SALES_FILTER,
    getCommissionActualVendorColumnExprForMonth,
    getBSales,
    buildVendedorFilter,
} = require('./common');
const { getClientCodesFromCache } = require('../services/laclae');
const logger = require('../middleware/logger');

/** Single knob for default objective uplift when COMMERCIAL_TARGETS has no row. */
const DEFAULT_PORCENTAJE_MEJORA = 10;

function getVendorCodeVariants(vendorCode) {
    const raw = String(vendorCode || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!raw) return [];
    const unpadded = raw.replace(/^0+/, '') || raw;
    const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
    return [...new Set([raw, unpadded, padded])];
}

function parseVendorCodeList(vendorCodes) {
    if (!vendorCodes || vendorCodes === 'ALL') return [];
    return [...new Set(
        String(vendorCodes)
            .split(',')
            .flatMap(code => getVendorCodeVariants(code))
            .filter(Boolean),
    )];
}

function parseSingleVendorCode(vendorCodes) {
    const list = parseVendorCodeList(vendorCodes);
    if (list.length === 0) return null;
    const first = String(vendorCodes).split(',')[0].trim().replace(/[^a-zA-Z0-9]/g, '');
    return first || null;
}

function resolveObjectiveSalesTarget(sales, rawTarget, defaultPct = DEFAULT_PORCENTAJE_MEJORA) {
    const safeSales = Number(sales) || 0;
    const parsedTarget = rawTarget != null ? parseFloat(rawTarget) : null;
    if (parsedTarget != null && parsedTarget > 0) return parsedTarget;
    return safeSales * (1 + (Number(defaultPct) || 0) / 100);
}

async function lookupCommercialTarget(vendorCodes, year, month) {
    const codeVariants = parseVendorCodeList(vendorCodes);
    if (codeVariants.length === 0) return null;

    try {
        const placeholders = codeVariants.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT IMPORTE_OBJETIVO
            FROM JAVIER.COMMERCIAL_TARGETS
            WHERE TRIM(CODIGOVENDEDOR) IN (${placeholders})
              AND ANIO = ?
              AND MES = ?
              AND ACTIVO = 1
            FETCH FIRST 1 ROWS ONLY
        `, [...codeVariants, year, month], false);

        if (!rows || rows.length === 0) return null;
        const value = parseFloat(rows[0].IMPORTE_OBJETIVO);
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch (err) {
        logger.debug(`[OBJECTIVES-SOURCE] COMMERCIAL_TARGETS lookup: ${err.message}`);
        return null;
    }
}

async function lookupSnapshotSales(vendorCodes, year, month) {
    const safeYear = parseInt(year, 10);
    const safeMonth = parseInt(month, 10);
    if (safeYear !== 2026 || SNAPSHOT_UNTIL_MONTH <= 0 || safeMonth > SNAPSHOT_UNTIL_MONTH) {
        return null;
    }

    const codeVariants = parseVendorCodeList(vendorCodes);
    if (codeVariants.length === 0) return null;

    try {
        const placeholders = codeVariants.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT COALESCE(SUM(VENTAS_REAL), 0) as SALES
            FROM ${SNAPSHOT_SOURCE}
            WHERE ANIO = ?
              AND MES = ?
              AND VENDEDOR_CODIGO IN (${placeholders})
        `, [safeYear, safeMonth, ...codeVariants], false, false);

        const sales = parseFloat(rows?.[0]?.SALES);
        if (!Number.isFinite(sales) || sales <= 0) return null;
        return sales;
    } catch (err) {
        logger.debug(`[OBJECTIVES-SOURCE] snapshot lookup: ${err.message}`);
        return null;
    }
}

async function queryClientScopeMonthSales(vendorCode, year, month) {
    const cachedCodes = getClientCodesFromCache(vendorCode);
    if (!Array.isArray(cachedCodes) || cachedCodes.length === 0) return null;

    const safeClientCodes = [...new Set(
        cachedCodes
            .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 10))
            .filter(Boolean),
    )];
    const maxCodes = Math.max(1, Math.min(parseInt(process.env.COMMISSION_CLIENT_SCOPE_MAX_CODES || '2000', 10), 5000));
    if (safeClientCodes.length === 0 || safeClientCodes.length > maxCodes) return null;

    const chunkSize = 250;
    let total = 0;
    for (let index = 0; index < safeClientCodes.length; index += chunkSize) {
        const chunk = safeClientCodes.slice(index, index + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await queryWithParams(`
            SELECT COALESCE(SUM(L.LCIMVT), 0) as SALES
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ?
              AND L.LCMMDC = ?
              AND ${LACLAE_SALES_FILTER}
              AND L.LCCDCL IN (${placeholders})
        `, [year, month, ...chunk], false);
        total += parseFloat(rows?.[0]?.SALES) || 0;
    }

    const bSales = await getBSales(vendorCode, year);
    total += parseFloat(bSales?.[month]) || 0;
    return total;
}

async function queryLiveLaclaeMonthSales(vendorCodes, year, month) {
    const codeVariants = parseVendorCodeList(vendorCodes);
    if (codeVariants.length === 0) return 0;

    const salesVendorExpr = getCommissionActualVendorColumnExprForMonth(year, month, 'L');
    const placeholders = codeVariants.map(() => '?').join(',');
    const rows = await queryWithParams(`
        SELECT COALESCE(SUM(L.LCIMVT), 0) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ?
          AND L.LCMMDC = ?
          AND ${LACLAE_SALES_FILTER}
          AND TRIM(${salesVendorExpr}) IN (${placeholders})
    `, [year, month, ...codeVariants], false);

    let sales = parseFloat(rows?.[0]?.SALES) || 0;
    const vendorList = String(vendorCodes).split(',').map(c => c.trim()).filter(Boolean);
    for (const code of vendorList) {
        const bSales = await getBSales(code, year);
        sales += parseFloat(bSales?.[month]) || 0;
    }
    return sales;
}

async function queryFallbackLacMonthSales(vendorCodes, year, month) {
    const vendedorFilter = buildVendedorFilter(vendorCodes);
    const rows = await queryWithParams(`
        SELECT COALESCE(SUM(IMPORTEVENTA), 0) as SALES
        FROM DSEDAC.LAC L
        WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? ${vendedorFilter}
    `, [year, month]);
    return parseFloat(rows?.[0]?.SALES) || 0;
}

async function getAlignedVendorSalesForObjectives(vendorCodes, year, month) {
    const rawTarget = await lookupCommercialTarget(vendorCodes, year, month);

    const snapshotSales = await lookupSnapshotSales(vendorCodes, year, month);
    if (snapshotSales != null) {
        return { sales: snapshotSales, source: 'snapshot', rawTarget };
    }

    const singleVendor = parseSingleVendorCode(vendorCodes);
    if (singleVendor) {
        try {
            const clientScopeSales = await queryClientScopeMonthSales(singleVendor, year, month);
            if (clientScopeSales != null) {
                return { sales: clientScopeSales, source: 'live_client_scope', rawTarget };
            }
        } catch (err) {
            logger.debug(`[OBJECTIVES-SOURCE] client-scope sales: ${err.message}`);
        }
    }

    try {
        const liveSales = await queryLiveLaclaeMonthSales(vendorCodes, year, month);
        return { sales: liveSales, source: 'live_client_scope', rawTarget };
    } catch (err) {
        logger.debug(`[OBJECTIVES-SOURCE] live LACLAE sales failed: ${err.message}`);
    }

    const fallbackSales = await queryFallbackLacMonthSales(vendorCodes, year, month);
    return { sales: fallbackSales, source: 'fallback', rawTarget };
}

module.exports = {
    DEFAULT_PORCENTAJE_MEJORA,
    getAlignedVendorSalesForObjectives,
    resolveObjectiveSalesTarget,
    lookupCommercialTarget,
    lookupSnapshotSales,
};
