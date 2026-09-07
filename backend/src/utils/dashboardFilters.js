'use strict';

/**
 * Filtros SQL parametrizados por vendedor para LACLAE. Movidos verbatim desde
 * routes/dashboard.js; el route file importa desde aqui (fuente unica).
 */
function buildVendedorFilterParameterized(vendedorCodes, tableAlias = 'L') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return { filter: '', params: [] };
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const col = `${prefix}LCCDVD`;

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const validCodes = codeList
        .filter(c => c !== 'UNK' && /^[a-zA-Z0-9]+$/.test(c));

    if (validCodes.length === 0) return { filter: 'AND 1=0', params: [] };

    const placeholders = validCodes.map(() => '?').join(',');
    return {
        filter: `AND ${col} IN (${placeholders})`,
        params: validCodes
    };
}

function buildVendedorFilterLACLAEParameterized(vendedorCodes, tableAlias = 'L', year, month) {
    if (!vendedorCodes || vendedorCodes === 'ALL') return { filter: '', params: [] };
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const col = `${prefix}LCCDVD`;

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const hasUnk = codeList.includes('UNK');
    const validCodes = codeList.filter(c => c !== 'UNK' && /^[a-zA-Z0-9]+$/.test(c));

    if (validCodes.length === 0 && !hasUnk) return { filter: 'AND 1=0', params: [] };

    const conditions = [];
    const params = [];

    if (validCodes.length > 0) {
        const placeholders = validCodes.map(() => '?').join(',');
        conditions.push(`${col} IN (${placeholders})`);
        params.push(...validCodes);
    }
    if (hasUnk) {
        conditions.push(`(${col} IS NULL OR ${col} = '')`);
    }

    return { filter: `AND (${conditions.join(' OR ')})`, params };
}

/**
 * Optional month IN-list for LAC/LACLAE. Invalid tokens are dropped.
 * Empty / missing input => no filter (legacy: all months of the selected years).
 */
function buildMonthFilterParameterized(months, column = 'L.LCMMDC') {
    if (months == null || String(months).trim().length === 0) {
        return { filter: '', params: [] };
    }
    const unique = [...new Set(
        String(months)
            .split(',')
            .map((token) => parseInt(token.trim(), 10))
            .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12),
    )];
    if (unique.length === 0) return { filter: '', params: [] };
    const placeholders = unique.map(() => '?').join(',');
    return {
        filter: `AND ${column} IN (${placeholders})`,
        params: unique,
    };
}

/**
 * FETCH FIRST for matrix-data. Client-supplied limit wins (clamped).
 * Default shrinks with hierarchy depth so JEFE ALL vendor-only is ~vendors×months.
 */
function resolveMatrixFetchLimit(groupBy, requestedLimit) {
    const parsed = parseInt(requestedLimit, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
        return Math.max(1, Math.min(1000, parsed));
    }
    const depth = String(groupBy || 'vendor')
        .split(',')
        .map((level) => level.trim())
        .filter(Boolean).length;
    if (depth <= 1) return 240;
    if (depth === 2) return 500;
    return 1000;
}

module.exports = {
    buildVendedorFilterParameterized,
    buildVendedorFilterLACLAEParameterized,
    buildMonthFilterParameterized,
    resolveMatrixFetchLimit,
};
