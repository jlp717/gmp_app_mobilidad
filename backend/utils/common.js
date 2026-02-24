// =============================================================================
// DATE HELPERS & CONSTANTS
// =============================================================================
const logger = require('../middleware/logger');
const getCurrentDate = () => new Date();
const getCurrentYear = () => getCurrentDate().getFullYear();
const MIN_YEAR = getCurrentYear() - 2; // Dynamic: always 3 years of data

// =============================================================================
// VENDOR COLUMN FEATURE FLAG (with transition date logic)
// =============================================================================
// VENDOR_COLUMN controls which DB2 column is used for vendor filtering:
//   LCCDVD    = "Quién vendió" (lógica actual de producción)
//   R1_T8CDVD = "Quién tiene el cliente asignado" (nueva lógica 2026)
//
// Set via environment variable. Default: LCCDVD (backward compatible)
//
// TRANSITION: For PRE (VENDOR_COLUMN=R1_T8CDVD), Jan/Feb 2026 keep using
// LCCDVD so objectives match production. From March 2026, use R1_T8CDVD.
const VENDOR_COLUMN = process.env.VENDOR_COLUMN || 'LCCDVD';
const TRANSITION_YEAR = 2026;
const TRANSITION_MONTH = VENDOR_COLUMN === 'R1_T8CDVD' ? 1 : 3; // In PRE (BETA), start from Jan 2026. In PROD, start from March 1st.

/**
 * Get the vendor column to use based on the target date.
 * - Production (LCCDVD env or default): always returns LCCDVD
 * - PRE (R1_T8CDVD env): returns LCCDVD for dates before March 2026,
 *   R1_T8CDVD from March 2026 onwards.
 * @param {number} [year] - Target year (defaults to current)
 * @param {number} [month] - Target month 1-12 (defaults to current)
 * @returns {string} 'LCCDVD' or 'R1_T8CDVD'
 */
function getVendorColumn(year, month) {
    // Production: always LCCDVD, no transition needed
    if (VENDOR_COLUMN === 'LCCDVD') return 'LCCDVD';

    // PRE: date-based transition
    const now = getCurrentDate();
    const y = parseInt(year) || now.getFullYear();
    const m = parseInt(month) || (now.getMonth() + 1);

    // Before transition date → old column (same as production)
    if (y < TRANSITION_YEAR || (y === TRANSITION_YEAR && m < TRANSITION_MONTH)) {
        return 'LCCDVD';
    }

    // March 2026+ → new column
    return VENDOR_COLUMN; // R1_T8CDVD
}

logger.info(`[CONFIG] 🏷️  VENDOR_COLUMN = ${VENDOR_COLUMN} (transition: ${TRANSITION_MONTH}/${TRANSITION_YEAR})`);

// =============================================================================
// SALES FILTER CONSTANTS
// =============================================================================
// SALES FILTERS (GOLDEN DATA ALIGNMENT)
// 1. Standard Filters: Sales ('CC', 'VC'), Line ('AB', 'VT'), Exclude ('N', 'Z')
// 2. Document Type: TPDC = 'LAC' (Albarán de Cliente)
// 
// IMPORTANT: Use LCIMVT for sales WITHOUT VAT (correct: 15,220,182.87€ for 2025)
// DO NOT use IMPORTEVENTA which includes VAT (~19M€ for 2025)
//
// Column mapping: LACLAE (short) vs LAC (long)
//   LCIMVT = Importe Venta (sin IVA) 
//   LCIMCT = Importe Costo
//   LCCDVD = Codigo Vendedor (original)
//   R1_T8CDVD = Codigo Vendedor Asignado (nueva lógica)
//   LCCDCL = Codigo Cliente
//   LCAADC = Año Documento
//   LCMMDC = Mes Documento

// Simple filter for LACLAE table (recommended for all sales queries)
// GOLDEN DATA ALIGNMENT: LCYEAB for year, LCSRAB excludes N, Z, G, D
const LACLAE_SALES_FILTER = `
    L.TPDC = 'LAC'
    AND L.LCTPVT IN ('CC', 'VC') 
    AND L.LCCLLN IN ('AB', 'VT') 
    AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
`.replace(/\s+/g, ' ').trim();

// Legacy filter for DSEDAC.LAC table (uses short column names but with EXISTS)
const LAC_SALES_FILTER = `
    L.LCTPVT IN ('CC', 'VC') 
    AND L.LCCLLN IN ('AB', 'VT') 
    AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
    AND EXISTS (
        SELECT 1 FROM DSEDAC.CAC CX
        WHERE L.LCSBAB = CX.CCSBAB 
          AND L.LCYEAB = CX.CCYEAB 
          AND L.LCSRAB = CX.CCSRAB 
          AND L.LCTRAB = CX.CCTRAB
          AND L.LCNRAB = CX.CCNRAB
          AND CX.CODIGOTIPOALBARAN NOT IN ('L', 'J', 'M', 'C', 'N', 'Z')
    )
`.replace(/\s+/g, ' ').trim();

const LAC_TIPOVENTA_FILTER = `L.LCTPVT IN ('CC', 'VC')`;
const LAC_SERIEALBARAN_FILTER = `L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')`;


// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sanitize a value for safe SQL interpolation.
 * Only allows alphanumeric chars, spaces, dots, hyphens, underscores.
 * Use this when parameterized queries are not possible (legacy routes).
 * @param {string} value - The value to sanitize
 * @returns {string} Sanitized value safe for SQL
 */
function sanitizeForSQL(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[^a-zA-Z0-9\s.\-_áéíóúÁÉÍÓÚñÑ]/g, '');
}

/**
 * Sanitize a comma-separated list of codes for SQL IN clauses.
 * Returns "'code1','code2'" format, with each code sanitized.
 * @param {string} codeString - Comma-separated codes
 * @returns {string} Sanitized SQL-safe IN-clause string
 */
function sanitizeCodeList(codeString) {
    if (!codeString) return '';
    return codeString
        .split(',')
        .map(c => c.trim())
        .filter(c => /^[a-zA-Z0-9]+$/.test(c))
        .map(c => `'${c}'`)
        .join(',');
}

function formatCurrency(value) {
    // Returns raw number - formatting done in Flutter frontend with Spanish locale
    return parseFloat(value) || 0;
}

function buildVendedorFilter(vendedorCodes, tableAlias = '') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const hasUnk = codeList.includes('UNK');

    // SECURITY FIX: Sanitize vendor codes - only allow alphanumeric characters
    const validCodes = codeList
        .filter(c => c !== 'UNK')
        .filter(c => /^[a-zA-Z0-9]+$/.test(c))
        .map(c => `'${c}'`)
        .join(',');

    logger.info(`[FILTER] Codes: ${vendedorCodes} | Valid: ${validCodes} | HasUnk: ${hasUnk}`);

    const conditions = [];
    if (validCodes.length > 0) {
        // PERF: Removed TRIM() - DB2 CHAR comparison handles trailing spaces automatically
        // This allows DB2 to use indexes on CODIGOVENDEDOR
        conditions.push(`${prefix}CODIGOVENDEDOR IN (${validCodes})`);
    }
    if (hasUnk) {
        conditions.push(`(${prefix}CODIGOVENDEDOR IS NULL OR ${prefix}CODIGOVENDEDOR = '')`);
    }

    if (conditions.length === 0) return 'AND 1=0'; // No valid selection

    return `AND (${conditions.join(' OR ')})`;
}

function buildDateFilter(yearParam, monthParam, tableAlias = '') {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const now = getCurrentDate();
    const year = parseInt(yearParam) || now.getFullYear();
    const month = parseInt(monthParam) || (now.getMonth() + 1);
    return { year, month, filter: `AND ${prefix}ANODOCUMENTO >= ${MIN_YEAR}` };
}

// Vendor filter for LACLAE table
// Uses getVendorColumn(year, month) for date-aware column selection
function buildVendedorFilterLACLAE(vendedorCodes, tableAlias = 'L', year, month) {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const col = getVendorColumn(year, month); // Date-aware: LCCDVD or R1_T8CDVD

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const hasUnk = codeList.includes('UNK');

    // SECURITY FIX: Sanitize vendor codes - only allow alphanumeric characters
    const validCodes = codeList
        .filter(c => c !== 'UNK')
        .filter(c => /^[a-zA-Z0-9]+$/.test(c))
        .map(c => `'${c}'`)
        .join(',');

    const conditions = [];
    if (validCodes.length > 0) {
        // PERF: Removed TRIM() - DB2 CHAR comparison handles trailing spaces automatically
        conditions.push(`${prefix}${col} IN (${validCodes})`);
    }
    if (hasUnk) {
        conditions.push(`(${prefix}${col} IS NULL OR ${prefix}${col} = '')`);
    }

    if (conditions.length === 0) return 'AND 1=0';

    return `AND (${conditions.join(' OR ')})`;
}

/**
 * Enhanced Date-Aware Vendor Filter for SQL Queries.
 * Generates an OR block that handles column transition month-by-month.
 * Use this for evolution/matrix queries that span multiple years/months.
 * 
 * @param {string} vendedorCodes - Comma separated vendor codes (or 'ALL')
 * @param {Array<number>} years - Array of years to filter
 * @param {string} tableAlias - SQL table alias (default 'L')
 * @returns {string} SQL snippet e.g. "AND ((Column='LCCDVD' AND Year<2026) OR (Column='R1_T8CDVD' AND Year>=2026))"
 */
function buildColumnaVendedorFilter(vendedorCodes, years = [], tableAlias = 'L') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const validCodes = codeList
        .filter(c => /^[a-zA-Z0-9]+$/.test(c))
        .map(c => `'${c}'`)
        .join(',');

    if (validCodes.length === 0) return 'AND 1=0';

    // If we only have LCCDVD mode, keep it simple
    if (VENDOR_COLUMN === 'LCCDVD') {
        return `AND ${prefix}LCCDVD IN (${validCodes})`;
    }

    // Check if any of the requested years involve the transition or the base year for the transition
    const involvesTransition = (!Array.isArray(years) || years.length === 0) ? true : years.some(y => y >= (TRANSITION_YEAR - 1));

    if (!involvesTransition) {
        // Historical years purely use the old column
        return `AND ${prefix}LCCDVD IN (${validCodes})`;
    }

    // Dynamic month-based transition logic
    // This perfectly aligns the comparison year (e.g. 2025) with the current year (2026) Month by Month.
    // So Jan 2025 uses LCCDVD (to compare with Jan 2026 LCCDVD), while Mar 2025 uses R1_T8CDVD (to compare with Mar 2026).
    if (TRANSITION_MONTH <= 1) {
        // If transition is January (like in PRE), just use the new column for everything
        return `AND ${prefix}${VENDOR_COLUMN} IN (${validCodes})`;
    }

    const oldFilter = `(${prefix}LCMMDC < ${TRANSITION_MONTH} AND ${prefix}LCCDVD IN (${validCodes}))`;
    const newFilter = `(${prefix}LCMMDC >= ${TRANSITION_MONTH} AND ${prefix}${VENDOR_COLUMN} IN (${validCodes}))`;

    return `AND (${oldFilter} OR ${newFilter})`;
}

const { query } = require('../config/db');

// ... (previous helper functions)

// In-memory cache for vendor names (rarely changes)
const _vendorNameCache = new Map();
async function getVendorName(vendorCode) {
    if (!vendorCode || vendorCode === 'ALL') return 'Global';
    const trimmed = vendorCode.trim();
    if (_vendorNameCache.has(trimmed)) return _vendorNameCache.get(trimmed);
    try {
        // PERF: Removed TRIM() - DB2 CHAR blank-padded comparison works without it
        const rows = await query(`SELECT NOMBREVENDEDOR FROM DSEDAC.VDD WHERE CODIGOVENDEDOR = '${trimmed}'`, false);
        const name = (rows && rows.length > 0) ? rows[0].NOMBREVENDEDOR : vendorCode;
        _vendorNameCache.set(trimmed, name);
        return name;
    } catch (e) {
        logger.warn(`Error getting vendor name: ${e.message}`);
        return vendorCode;
    }
}

/**
 * Get B-Sales (Ventas en B) from JAVIER.VENTAS_B
 * These are secondary channel sales stored separately.
 * Shared across commissions, objectives, and dashboard.
 * @param {string} vendorCode - Single vendor code (or 'ALL')
 * @param {number} year - Year to query
 * @returns {Object} Monthly map { [month]: amount }
 */
// PERF: In-memory cache for B-Sales (small table, rarely changes)
const _bSalesCache = new Map();
const _bSalesCacheTTL = 10 * 60 * 1000; // 10 minutes

async function getBSales(vendorCode, year) {
    if (!vendorCode || vendorCode === 'ALL') return {};

    const rawCode = vendorCode.trim();
    const cacheKey = `${rawCode}:${year}`;
    const cached = _bSalesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < _bSalesCacheTTL) return cached.data;

    const unpaddedCode = rawCode.replace(/^0+/, '');

    try {
        const safeRaw = rawCode.replace(/[^a-zA-Z0-9]/g, '');
        const safeUnpadded = unpaddedCode.replace(/[^a-zA-Z0-9]/g, '');
        const rows = await query(`
            SELECT MES, IMPORTE
            FROM JAVIER.VENTAS_B
            WHERE (CODIGOVENDEDOR = '${safeRaw}' OR CODIGOVENDEDOR = '${safeUnpadded}')
              AND EJERCICIO = ${parseInt(year)}
        `, false, false);

        const monthlyMap = {};
        rows.forEach(r => {
            monthlyMap[r.MES] = (monthlyMap[r.MES] || 0) + (parseFloat(r.IMPORTE) || 0);
        });
        _bSalesCache.set(cacheKey, { data: monthlyMap, ts: Date.now() });
        // Limit cache size
        if (_bSalesCache.size > 500) {
            const oldest = _bSalesCache.keys().next().value;
            _bSalesCache.delete(oldest);
        }
        return monthlyMap;
    } catch (e) {
        // Table might not exist - return empty
        logger.debug(`getBSales: table may not exist for ${vendorCode}/${year}: ${e.message}`);
        return {};
    }
}

module.exports = {
    getCurrentDate,
    getCurrentYear,
    MIN_YEAR,
    VENDOR_COLUMN,
    getVendorColumn,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER,
    LAC_TIPOVENTA_FILTER,
    LAC_SERIEALBARAN_FILTER,
    formatCurrency,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    buildColumnaVendedorFilter,
    buildDateFilter,
    getVendorName, // Added Export
    getBSales, // Shared B-sales lookup
    sanitizeForSQL,
    sanitizeCodeList,

    // Helper to calculate working days (Mon-Fri + Sat/Sun if active)
    calculateWorkingDays: (year, month, activeWeekDays = []) => {
        // If no active days specified, assume standard Mon-Fri
        const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
            ? activeWeekDays
            : ['VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S']; // martes-sabado

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0);
        let count = 0;

        const jsDayToCol = {
            0: 'VIS_D', 1: 'VIS_L', 2: 'VIS_M', 3: 'VIS_X', 4: 'VIS_J', 5: 'VIS_V', 6: 'VIS_S'
        };

        const HOLIDAYS = ['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = `${d.getMonth() + 1}-${d.getDate()}`;
            if (HOLIDAYS.includes(dateStr)) continue;

            const jsDay = d.getDay();
            const colName = jsDayToCol[jsDay];
            if (effectiveDays.includes(colName)) {
                count++;
            }
        }
        return count;
    },

    // Helper to calculate days passed (working days up to 'now')
    calculateDaysPassed: (year, month, activeWeekDays = []) => {
        const now = new Date();
        // If past month, return all working days
        if (year < now.getFullYear() || (year === now.getFullYear() && month < (now.getMonth() + 1))) {
            return module.exports.calculateWorkingDays(year, month, activeWeekDays);
        }
        // If future month, return 0
        if (year > now.getFullYear() || (year === now.getFullYear() && month > (now.getMonth() + 1))) {
            return 0;
        }

        // Current month: count up to today
        const effectiveDays = (activeWeekDays && activeWeekDays.length > 0)
            ? activeWeekDays
            : ['VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S']; // martes-sabado


        const start = new Date(year, month - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let count = 0;
        const jsDayToCol = { 0: 'VIS_D', 1: 'VIS_L', 2: 'VIS_M', 3: 'VIS_X', 4: 'VIS_J', 5: 'VIS_V', 6: 'VIS_S' };
        const HOLIDAYS = ['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = `${d.getMonth() + 1}-${d.getDate()}`;
            if (HOLIDAYS.includes(dateStr)) continue;
            const jsDay = d.getDay();
            const colName = jsDayToCol[jsDay];
            if (effectiveDays.includes(colName)) count++;
        }
        return count;
    }
};
