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

module.exports = {
    buildVendedorFilterParameterized,
    buildVendedorFilterLACLAEParameterized,
};
