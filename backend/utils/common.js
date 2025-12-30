// =============================================================================
// DATE HELPERS & CONSTANTS
// =============================================================================
const getCurrentDate = () => new Date();
const getCurrentYear = () => getCurrentDate().getFullYear();
const MIN_YEAR = getCurrentYear() - 2; // Dynamic: always 3 years of data

// =============================================================================
// SALES FILTER CONSTANTS
// =============================================================================
const LAC_SALES_FILTER = `TIPOVENTA IN ('CC', 'VC') AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')`;
const LAC_TIPOVENTA_FILTER = `TIPOVENTA IN ('CC', 'VC')`;
const LAC_SERIEALBARAN_FILTER = `SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function formatCurrency(value) {
    // Returns raw number - formatting done in Flutter frontend with Spanish locale
    return parseFloat(value) || 0;
}

function buildVendedorFilter(vendedorCodes, tableAlias = '') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';

    // Always use string format with TRIM since CODIGOVENDEDOR is CHAR type
    const codes = vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',');
    return `AND TRIM(${prefix}CODIGOVENDEDOR) IN (${codes})`;
}

function buildDateFilter(yearParam, monthParam, tableAlias = '') {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const now = getCurrentDate();
    const year = parseInt(yearParam) || now.getFullYear();
    const month = parseInt(monthParam) || (now.getMonth() + 1);
    return { year, month, filter: `AND ${prefix}ANODOCUMENTO >= ${MIN_YEAR}` };
}

module.exports = {
    getCurrentDate,
    getCurrentYear,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LAC_TIPOVENTA_FILTER,
    LAC_SERIEALBARAN_FILTER,
    formatCurrency,
    buildVendedorFilter,
    buildDateFilter
};
