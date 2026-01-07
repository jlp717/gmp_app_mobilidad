/**
 * Sales Query Constants and Utilities
 * 
 * IMPORTANT: All sales data should use LCIMVT (without VAT) from LACLAE
 * with the following filters to get accurate sales figures.
 * 
 * Expected result for 2025 (all vendors): 15,220,182.87€
 */

// =============================================================================
// STANDARD SALES FILTERS
// =============================================================================
// These filters ensure we only count valid sales transactions:
// - TPDC = 'LAC' : Document type is LAC (sales invoice)
// - LCTPVT IN ('CC', 'VC') : Sales type is Credit (CC) or Cash (VC)
// - LCCLLN IN ('AB', 'VT') : Line class is Delivery (AB) or Sale (VT)
// - LCSRAB NOT IN ('N', 'Z') : Exclude cancelled (N) and zero (Z) entries

const SALES_FILTERS = {
    // For LACLAE table (short column names)
    laclae: `
        TPDC = 'LAC'
        AND LCTPVT IN ('CC', 'VC')
        AND LCCLLN IN ('AB', 'VT')
        AND LCSRAB NOT IN ('N', 'Z')
    `,
    // Column name for sales without VAT
    salesColumn: 'LCIMVT',
    // Column name for cost
    costColumn: 'LCIMCT',
    // Column name for year
    yearColumn: 'LCAADC',
    // Column name for month
    monthColumn: 'LCMMDC',
    // Column name for vendor
    vendorColumn: 'LCCDVD',
    // Column name for client
    clientColumn: 'LCCDCL',
};

// For LAC table (long column names) - alias mapping
const LAC_COLUMN_MAPPING = {
    'ANODOCUMENTO': 'LCAADC',
    'MESDOCUMENTO': 'LCMMDC',
    'IMPORTEVENTA': 'LCIMVT',  // Changed: was including VAT
    'IMPORTECOSTO': 'LCIMCT',
    'CODIGOVENDEDOR': 'LCCDVD',
    'CODIGOCLIENTEALBARAN': 'LCCDCL',
    'TIPODOCUMENTO': 'TPDC',
    'TIPOVENTA': 'LCTPVT',
    'CLASELINEA': 'LCCLLN',
    'SECCIONRABATIBLE': 'LCSRAB',
};

/**
 * Builds a standard WHERE clause for sales queries on LACLAE
 * @param {Object} options - Query options
 * @param {string} options.vendorFilter - SQL filter for vendors e.g. "LCCDVD IN ('01', '02')"
 * @param {number|string} options.year - Year to filter
 * @param {number|string} options.month - Month to filter (optional)
 * @param {string} options.tableAlias - Table alias (default: 'L')
 * @returns {string} WHERE clause
 */
function buildSalesWhereClause(options = {}) {
    const { vendorFilter, year, month, tableAlias = 'L' } = options;
    const T = tableAlias ? `${tableAlias}.` : '';

    const conditions = [
        `${T}TPDC = 'LAC'`,
        `${T}LCTPVT IN ('CC', 'VC')`,
        `${T}LCCLLN IN ('AB', 'VT')`,
        `${T}LCSRAB NOT IN ('N', 'Z')`,
    ];

    if (year) {
        conditions.push(`${T}LCAADC = ${year}`);
    }

    if (month) {
        conditions.push(`${T}LCMMDC = ${month}`);
    }

    if (vendorFilter) {
        conditions.push(vendorFilter);
    }

    return conditions.join(' AND ');
}

/**
 * Builds a SELECT clause for sales totals
 * @param {string} tableAlias - Table alias (default: 'L')
 * @returns {string} SELECT columns for sales and cost
 */
function buildSalesSelectClause(tableAlias = 'L') {
    const T = tableAlias ? `${tableAlias}.` : '';
    return `
        COALESCE(SUM(${T}LCIMVT), 0) as SALES,
        COALESCE(SUM(${T}LCIMCT), 0) as COST
    `;
}

module.exports = {
    SALES_FILTERS,
    LAC_COLUMN_MAPPING,
    buildSalesWhereClause,
    buildSalesSelectClause,
};
