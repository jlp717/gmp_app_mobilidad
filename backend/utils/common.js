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
// Set via environment variable. Default: R1_T8CDVD for route/objective views.
// Commissions have fixed source columns below so figures do not drift by env.
//
// TRANSITION: From March 2026, use R1_T8CDVD. Jan/Feb 2026 and prior
// always use LCCDVD so historical data remains unchanged.
const VENDOR_COLUMN = process.env.VENDOR_COLUMN || 'R1_T8CDVD';
const TRANSITION_YEAR = 2026;
const TRANSITION_MONTH = 3; // March 2026: new logic starts here
const COMMISSION_SALES_VENDOR_COLUMN = 'LCCDVD';
const COMMISSION_OBJECTIVE_VENDOR_COLUMN = 'R1_T8CDVD';

// Scoped commercial visibility. These users keep their normal commercial role,
// but the app receives the complete vendor list they are allowed to inspect.
const VENDOR_VISIBILITY_SCOPES = {
    '80': ['80', '72', '73', '81', '83']
};

/**
 * Get the vendor column to use based on the target date.
 * - LCCDVD env: always returns LCCDVD
 * - R1_T8CDVD default/env: returns LCCDVD for dates before March 2026,
 *   R1_T8CDVD from March 2026 onwards.
 * @param {number} [year] - Target year (defaults to current)
 * @param {number} [month] - Target month 1-12 (defaults to current)
 * @returns {string} 'LCCDVD' or 'R1_T8CDVD'
 */
function getVendorColumn(year, month) {
    if (VENDOR_COLUMN === 'LCCDVD') return 'LCCDVD';

    const now = getCurrentDate();
    const y = parseInt(year) || now.getFullYear();
    const m = parseInt(month) || (now.getMonth() + 1);

    if (y < TRANSITION_YEAR || (y === TRANSITION_YEAR && m < TRANSITION_MONTH)) {
        return 'LCCDVD';
    }

    return VENDOR_COLUMN; // R1_T8CDVD
}

/**
 * Build a CASE expression that returns the correct vendor column per row,
 * handling the LCCDVD → R1_T8CDVD transition at TRANSITION_MONTH/TRANSITION_YEAR.
 * Use in SELECT and GROUP BY for multi-year queries on DSED.LACLAE.
 * 
 * IMPORTANT: For DSEDAC.LAC table, pass { forLACTable: true } because LAC does NOT
 * have the R1_T8CDVD column. DB2 validates all column references at parse time,
 * so even CASE branches that never execute will cause -205 if the column is missing.
 * 
 * @param {string} tableAlias - SQL table alias (default 'L')
 * @param {Object} [options] - Options
 * @param {boolean} [options.forLACTable=false] - If true, always use LCCDVD (for DSEDAC.LAC which lacks R1_T8CDVD)
 * @returns {string} SQL CASE expression or simple column reference
 */
function getVendorColumnExpr(tableAlias = 'L', { forLACTable = false } = {}) {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    if (VENDOR_COLUMN === 'LCCDVD' || forLACTable) return `${prefix}LCCDVD`;
    // Month-based transition: Jan/Feb (any year) use LCCDVD, Mar+ (any year) use R1_T8CDVD.
    // General views use the transition column. Commission views use their own
    // fixed helpers below because current-year sales and prior-year objectives
    // have different source rules.
    return `CASE WHEN ${prefix}LCMMDC < ${TRANSITION_MONTH} THEN ${prefix}LCCDVD ELSE ${prefix}${VENDOR_COLUMN} END`;
}

logger.info(`[CONFIG] VENDOR_COLUMN = ${VENDOR_COLUMN} (transition: ${TRANSITION_MONTH}/${TRANSITION_YEAR})`);
logger.info(`[CONFIG] COMMISSION_COLUMNS sales=${COMMISSION_SALES_VENDOR_COLUMN} objective=${COMMISSION_OBJECTIVE_VENDOR_COLUMN}`);

function getCommissionVendorColumnExpr(tableAlias = 'L', purpose = 'sales', { forLACTable = false } = {}) {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    if (forLACTable) return `${prefix}LCCDVD`;

    const normalizedPurpose = String(purpose || 'sales').trim().toLowerCase();
    const column = normalizedPurpose === 'objective'
        ? COMMISSION_OBJECTIVE_VENDOR_COLUMN
        : COMMISSION_SALES_VENDOR_COLUMN;

    return `${prefix}${column}`;
}

function getCommissionActualVendorColumnExprForYear(selectedYear, tableAlias = 'L') {
    const safeYear = parseInt(selectedYear, 10);
    if (!safeYear) return getCommissionVendorColumnExpr(tableAlias, 'sales');

    const prefix = tableAlias ? `${tableAlias}.` : '';
    return `CASE WHEN ${prefix}LCAADC = ${safeYear} THEN ${prefix}${COMMISSION_SALES_VENDOR_COLUMN} WHEN ${prefix}LCMMDC < ${TRANSITION_MONTH} THEN ${prefix}${COMMISSION_SALES_VENDOR_COLUMN} ELSE ${prefix}${COMMISSION_OBJECTIVE_VENDOR_COLUMN} END`;
}

function getCommissionActualVendorColumnExprForMonth(year, month, tableAlias = 'L') {
    return getCommissionVendorColumnExpr(tableAlias, 'sales');
}

// =============================================================================
// SNAPSHOT UNTIL MONTH — controls which months use the immutable sales snapshot
// =============================================================================
// Months 1..SNAPSHOT_UNTIL_MONTH of year 2026 will read from
// JAVIER.COMMISSION_SNAPSHOT_2026_0102 instead of live LACLAE queries.
// Set SNAPSHOT_UNTIL_MONTH=0 to disable snapshot entirely (rollback).
// Default: 2 (covers January and February 2026).
const SNAPSHOT_UNTIL_MONTH = parseInt(process.env.SNAPSHOT_UNTIL_MONTH || '2', 10);
logger.info(`[CONFIG] SNAPSHOT_UNTIL_MONTH = ${SNAPSHOT_UNTIL_MONTH}`);

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
//   LCCDVD = Codigo Vendedor
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

/**
 * Sanitize a comma-separated list of codes for parameterized queries.
 * Returns ["code1", "code2"] format, with each code sanitized.
 * @param {string} codeString - Comma-separated codes
 * @returns {string[]} Sanitized code list safe for bind params
 */
function sanitizeCodeListForParams(codeString, maxLen = 2) {
    if (!codeString) return [];
    return codeString
        .split(',')
        .map(c => c.trim())
        .filter(c => /^[a-zA-Z0-9]+$/.test(c) && c.length <= maxLen);
}

function getVendorVisibilityScope(vendorCode) {
    const normalized = String(vendorCode || '').trim().replace(/^0+/, '') || String(vendorCode || '').trim();
    const scope = VENDOR_VISIBILITY_SCOPES[normalized];
    if (!scope) return [String(vendorCode || '').trim()].filter(Boolean);
    return [...new Set(scope)];
}

/**
 * Semi-join filter: client belongs to vendor scope via CLP.VENDEDORCOMERCIAL
 * or LACLAE sales history (CLI.CODIGOVENDEDOR does not exist on DSEDAC.CLI).
 */
function buildClientVendorParamFilter(vendorCodes, clientAlias = 'CLI') {
    if (!Array.isArray(vendorCodes) || vendorCodes.length === 0) {
        return { clause: '', params: [] };
    }
    const safeCodes = vendorCodes
        .map((code) => String(code || '').trim())
        .filter((code) => /^[a-zA-Z0-9]{1,10}$/.test(code));
    if (safeCodes.length === 0) {
        return { clause: '', params: [] };
    }
    const placeholders = safeCodes.map(() => '?').join(',');
    const laclaeVendorCol = getVendorColumnExpr('LAC');
    return {
        clause: `
      AND (
        EXISTS (
          SELECT 1
            FROM DSEDAC.CLP CLP
           WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(${clientAlias}.CODIGOCLIENTE)
             AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1
            FROM DSED.LACLAE LAC
           WHERE TRIM(LAC.LCCDCL) = TRIM(${clientAlias}.CODIGOCLIENTE)
             AND LAC.TPDC = 'LAC'
             AND LAC.LCTPVT IN ('CC', 'VC')
             AND LAC.LCCLLN IN ('AB', 'VT')
             AND LAC.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
             AND LAC.LCAADC >= ${MIN_YEAR}
             AND TRIM(${laclaeVendorCol}) IN (${placeholders})
        )
      )`,
        params: [...safeCodes, ...safeCodes],
    };
}

/**
 * Expand vendor codes for SQL IN clauses (01 vs 1, leading zeros).
 */
function expandVendorCodesForSql(vendorCodes) {
    const values = Array.isArray(vendorCodes) ? vendorCodes : String(vendorCodes || '').split(',');
    const set = new Set();
    for (const raw of values) {
        const code = String(raw || '').trim();
        if (!code || !/^[a-zA-Z0-9]{1,10}$/.test(code)) continue;
        set.add(code);
        const unpadded = code.replace(/^0+/, '') || '0';
        set.add(unpadded);
        if (unpadded.length <= 2) set.add(unpadded.padStart(2, '0'));
    }
    return Array.from(set);
}

/**
 * Vendor scope for CVC debt queries — aligned with clients list (CLP + LACLAE).
 * Fixes summary=0 when CLP.VENDEDORCOMERCIAL is empty but LACLAE has sales history.
 */
function buildCvcVendorScopeFilter(vendorCodes) {
    const codes = expandVendorCodesForSql(vendorCodes);
    if (codes.length === 0) {
        return { clause: '', params: [] };
    }

    const { getClientCodesFromCache } = require('../services/laclae');
    const cachedClientCodes = getClientCodesFromCache(codes.join(','));
    if (cachedClientCodes && cachedClientCodes.length > 0) {
        const MAX_PARAMS = 50;
        if (cachedClientCodes.length <= MAX_PARAMS) {
            return {
                clause: `AND TRIM(CVC.CODIGOCLIENTEALBARAN) IN (${cachedClientCodes.map(() => '?').join(',')})`,
                params: cachedClientCodes,
            };
        }
        const safeCodes = cachedClientCodes
            .filter((c) => /^[A-Za-z0-9]{1,20}$/.test(String(c || '').trim()))
            .map((c) => `'${String(c).trim().replace(/'/g, "''")}'`)
            .join(',');
        if (safeCodes) {
            return {
                clause: `AND TRIM(CVC.CODIGOCLIENTEALBARAN) IN (${safeCodes})`,
                params: [],
            };
        }
    }

    const laclaeVendorCol = getVendorColumnExpr('LAC');
    const placeholders = codes.map(() => '?').join(',');
    return {
        clause: `AND (
            EXISTS (
                SELECT 1
                  FROM DSEDAC.CLP CLP
                 WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
                   AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${placeholders})
            )
            OR EXISTS (
                SELECT 1
                  FROM DSED.LACLAE LAC
                 WHERE TRIM(LAC.LCCDCL) = TRIM(CVC.CODIGOCLIENTEALBARAN)
                   AND LAC.LCAADC >= ${MIN_YEAR}
                   AND LAC.TPDC = 'LAC'
                   AND LAC.LCTPVT IN ('CC', 'VC')
                   AND LAC.LCCLLN IN ('AB', 'VT')
                   AND LAC.LCSRAB NOT IN ('N', 'Z')
                   AND TRIM(${laclaeVendorCol}) IN (${placeholders})
                FETCH FIRST 1 ROW ONLY
            )
        )`,
        params: [...codes, ...codes],
    };
}

/**
 * Query-side client discovery for vendor-scoped lists (no LACLAE full scan).
 * Uses CLP.VENDEDORCOMERCIAL; LACLAE only as EXISTS with FETCH FIRST 1.
 */
function buildClientListVendorSqlFilter(vendorCodes, clientAlias = 'C') {
    if (!vendorCodes || vendorCodes === 'ALL' || String(vendorCodes).trim() === '') {
        return '';
    }
    const codes = String(vendorCodes).split(',')
        .map((code) => code.trim())
        .filter((code) => /^[a-zA-Z0-9]+$/.test(code));
    if (codes.length === 0) return 'AND 1=0';
    const inList = codes.map((code) => `'${code}'`).join(',');
    const laclaeVendorCol = getVendorColumnExpr('LAC');
    return `AND (
        EXISTS (
            SELECT 1
              FROM DSEDAC.CLP CLP
             WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(${clientAlias}.CODIGOCLIENTE)
               AND TRIM(CLP.VENDEDORCOMERCIAL) IN (${inList})
        )
        OR EXISTS (
            SELECT 1
              FROM DSED.LACLAE LAC
             WHERE TRIM(LAC.LCCDCL) = TRIM(${clientAlias}.CODIGOCLIENTE)
               AND LAC.LCAADC >= ${MIN_YEAR}
               AND LAC.TPDC = 'LAC'
               AND LAC.LCTPVT IN ('CC', 'VC')
               AND LAC.LCCLLN IN ('AB', 'VT')
               AND LAC.LCSRAB NOT IN ('N', 'Z')
               AND TRIM(${laclaeVendorCol}) IN (${inList})
            FETCH FIRST 1 ROW ONLY
        )
    )`;
}

/**
 * Bound LACLAE scans to vendor client codes from CLP (no index on LACLAE required).
 */
function buildLaclaeBoundedClientCodesSql(vendorCodes) {
    if (!vendorCodes || vendorCodes === 'ALL' || String(vendorCodes).trim() === '') {
        return '';
    }
    const codes = String(vendorCodes).split(',')
        .map((code) => code.trim())
        .filter((code) => /^[a-zA-Z0-9]+$/.test(code));
    if (codes.length === 0) return 'AND 1=0';
    const inList = codes.map((code) => `'${code}'`).join(',');
    const laclaeVendorCol = getVendorColumnExpr('');
    return `AND LCCDCL IN (
        SELECT TRIM(CLP.CODIGOCLIENTE) FROM DSEDAC.CLP CLP WHERE TRIM(CLP.VENDEDORCOMERCIAL) IN (${inList})
    ) AND TRIM(${laclaeVendorCol}) IN (${inList})`;
}

async function lookupClientAssignedVendorCodes(clientCode) {
    const client = String(clientCode || '').trim();
    if (!client) return [];
    const laclaeVendorCol = getVendorColumnExpr('LAC');
    const rows = await queryWithParams(
        `SELECT DISTINCT TRIM(VENDOR_CODE) AS VENDOR_CODE
           FROM (
             SELECT TRIM(CLP.VENDEDORCOMERCIAL) AS VENDOR_CODE
               FROM DSEDAC.CLP CLP
              WHERE TRIM(CLP.CODIGOCLIENTE) = ?
             UNION
             SELECT TRIM(${laclaeVendorCol}) AS VENDOR_CODE
               FROM DSED.LACLAE LAC
              WHERE TRIM(LAC.LCCDCL) = ?
                AND LAC.LCAADC >= ?
                AND LAC.TPDC = 'LAC'
           ) V
          WHERE VENDOR_CODE IS NOT NULL AND TRIM(VENDOR_CODE) <> ''`,
        [client, client, MIN_YEAR],
    );
    return (rows || [])
        .map((row) => String(row.VENDOR_CODE || row.vendor_code || '').trim())
        .filter(Boolean);
}

/**
 * Chunk vendor codes and execute a query with UNION ALL across batches.
 * Prevents ODBC 22001/CWB0111 errors when passing 90+ vendor codes.
 *
 * @param {string} baseSql - Template SQL with @VENDOR_IN@ placeholder
 * @param {string} vendorColumn - Column name for vendor filter
 * @param {string} vendedorCodes - Comma-separated vendor codes or 'ALL'
 * @param {Function} executeFn - Query execution function (sql, params) => rows
 * @param {number} [batchSize=20] - Max vendor codes per batch
 * @returns {Promise<Array>} Combined result rows
 */
async function chunkedVendorQuery(baseSql, vendorColumn, vendedorCodes, executeFn, batchSize = 20) {
    if (!vendedorCodes || vendedorCodes.toUpperCase() === 'ALL') {
        const sql = baseSql.replace('@VENDOR_IN@', '1=1');
        return executeFn(sql, []);
    }
    const codes = sanitizeCodeListForParams(vendedorCodes);
    if (codes.length === 0) return [];

    if (codes.length <= batchSize) {
        const placeholders = codes.map(() => '?').join(',');
        const sql = baseSql.replace('@VENDOR_IN@', `TRIM(${vendorColumn}) IN (${placeholders})`);
        return executeFn(sql, codes);
    }

    const batches = [];
    for (let i = 0; i < codes.length; i += batchSize) {
        batches.push(codes.slice(i, i + batchSize));
    }

    const results = await Promise.all(
        batches.map(batch => {
            const placeholders = batch.map(() => '?').join(',');
            const sql = baseSql.replace('@VENDOR_IN@', `TRIM(${vendorColumn}) IN (${placeholders})`);
            return executeFn(sql, batch);
        })
    );
    return results.flat();
}

/**
 * Execute a query with a large IN-clause by batching into parallel sub-queries.
 * Prevents DB2 ODBC statement-preparation errors when passing 30+ parameters.
 *
 * @param {string} baseSql - Template SQL with @IN_IDS@ placeholder
 * @param {string} columnExpr - Column expression for the IN filter (e.g. 'TRIM(OPP.CODIGOREPARTIDOR)')
 * @param {string[]} ids - Sanitized list of IDs
 * @param {Function} executeFn - Query execution function (sql, params) => rows
 * @param {number} [batchSize=20] - Max IDs per batch
 * @returns {Promise<Array>} Combined result rows
 */
async function chunkedInQuery(baseSql, columnExpr, ids, executeFn, batchSize = 20) {
    if (!ids || ids.length === 0) return [];

    if (ids.length <= batchSize) {
        const placeholders = ids.map(() => '?').join(',');
        const sql = baseSql.replace('@IN_IDS@', `${columnExpr} IN (${placeholders})`);
        return executeFn(sql, ids);
    }

    const batches = [];
    for (let i = 0; i < ids.length; i += batchSize) {
        batches.push(ids.slice(i, i + batchSize));
    }

    const results = await Promise.all(
        batches.map(batch => {
            const placeholders = batch.map(() => '?').join(',');
            const sql = baseSql.replace('@IN_IDS@', `${columnExpr} IN (${placeholders})`);
            return executeFn(sql, batch);
        })
    );
    return results.flat();
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
    const col = getVendorColumn(year, month);

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
        conditions.push(`${prefix}${col} IN (${validCodes})`);
    }
    if (hasUnk) {
        conditions.push(`(${prefix}${col} IS NULL OR ${prefix}${col} = '')`);
    }

    if (conditions.length === 0) return 'AND 1=0';

    return `AND (${conditions.join(' OR ')})`;
}

/**
 * Date-Aware Vendor Filter for multi-year SQL queries.
 * Generates an OR block that handles column transition month-by-month.
 * Use for evolution/matrix queries spanning multiple years/months.
 *
 * IMPORTANT: For DSEDAC.LAC table, pass { forLACTable: true } because LAC does NOT
 * have the R1_T8CDVD column.
 *
 * @param {string} vendedorCodes - Comma separated vendor codes (or 'ALL')
 * @param {Array<number>} years - Array of years to filter
 * @param {string} tableAlias - SQL table alias (default 'L')
 * @param {Object} [options] - Options
 * @param {boolean} [options.forLACTable=false] - If true, always use LCCDVD (for DSEDAC.LAC which lacks R1_T8CDVD)
 * @returns {string} SQL snippet with AND prefix
 */
function buildColumnaVendedorFilter(vendedorCodes, years = [], tableAlias = 'L', { forLACTable = false } = {}) {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const validCodes = codeList
        .filter(c => /^[a-zA-Z0-9]+$/.test(c))
        .map(c => `'${c}'`)
        .join(',');

    if (validCodes.length === 0) return 'AND 1=0';

    // If VENDOR_COLUMN is default LCCDVD, or querying DSEDAC.LAC (no R1_T8CDVD column), no transition needed
    if (VENDOR_COLUMN === 'LCCDVD' || forLACTable) {
        return `AND ${prefix}LCCDVD IN (${validCodes})`;
    }

    const vendorColumnExpr = getVendorColumnExpr(tableAlias);
    return `AND TRIM(${vendorColumnExpr}) IN (${validCodes})`;
}

const { query, queryWithParams } = require('../config/db');

// ... (previous helper functions)

// In-memory cache for vendor names (rarely changes)
const _vendorNameCache = new Map();
async function getVendorName(vendorCode) {
    if (!vendorCode || vendorCode === 'ALL') return 'Global';
    const trimmed = vendorCode.trim();
    
    // Handle comma-separated list (Jefe de Ventas case) - return generic name
    if (trimmed.includes(',')) {
        return 'Jefe de Ventas';
    }
    
    if (_vendorNameCache.has(trimmed)) return _vendorNameCache.get(trimmed);
    try {
        const rows = await queryWithParams(`SELECT NOMBREVENDEDOR FROM DSEDAC.VDD WHERE CODIGOVENDEDOR = ?`, [trimmed], false);
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

function normalizeSalesVendorCode(vendorCode) {
    const raw = String(vendorCode || '').trim();
    if (!raw) return '';
    const unpadded = raw.replace(/^0+/, '') || raw;
    return /^\d+$/.test(unpadded) && unpadded.length <= 2
        ? unpadded.padStart(2, '0')
        : unpadded;
}

function getSalesVendorCodeVariants(vendorCode) {
    const raw = String(vendorCode || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!raw) return [];
    const unpadded = raw.replace(/^0+/, '') || raw;
    const padded = /^\d+$/.test(unpadded) && unpadded.length <= 2
        ? unpadded.padStart(2, '0')
        : raw;
    return [...new Set([raw, unpadded, padded].filter(Boolean))];
}

function parseSalesVendorCodes(vendorCodes) {
    if (!vendorCodes || vendorCodes === 'ALL') return [];
    if (Array.isArray(vendorCodes)) {
        return vendorCodes
            .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, ''))
            .filter(Boolean);
    }
    return String(vendorCodes)
        .split(',')
        .map(code => code.trim().replace(/[^a-zA-Z0-9]/g, ''))
        .filter(Boolean);
}

async function getBSalesByVendor(year, vendorCodes = []) {
    const safeYear = parseInt(year, 10);
    if (!safeYear) return {};

    const parsedCodes = parseSalesVendorCodes(vendorCodes);
    const codeVariants = [...new Set(parsedCodes.flatMap(getSalesVendorCodeVariants))];
    const params = [safeYear];
    let vendorFilter = '';

    if (codeVariants.length > 0) {
        vendorFilter = `AND TRIM(CODIGOVENDEDOR) IN (${codeVariants.map(() => '?').join(',')})`;
        params.push(...codeVariants);
    }

    try {
        const rows = await queryWithParams(`
            SELECT TRIM(CODIGOVENDEDOR) as CODIGOVENDEDOR, MES, SUM(IMPORTE) as IMPORTE
            FROM JAVIER.VENTAS_B
            WHERE EJERCICIO = ?
              ${vendorFilter}
            GROUP BY TRIM(CODIGOVENDEDOR), MES
        `, params, false, false);

        const byVendor = {};
        rows.forEach(row => {
            const code = normalizeSalesVendorCode(row.CODIGOVENDEDOR);
            const month = parseInt(row.MES, 10);
            const amount = parseFloat(row.IMPORTE) || 0;
            if (!code || !month) return;
            if (!byVendor[code]) byVendor[code] = {};
            byVendor[code][month] = (byVendor[code][month] || 0) + amount;
        });
        return byVendor;
    } catch (e) {
        logger.debug(`getBSalesByVendor: table may not exist for ${year}: ${e.message}`);
        return {};
    }
}

function aggregateBSalesByMonth(bSalesByVendor) {
    const monthly = {};
    Object.values(bSalesByVendor || {}).forEach(vendorMonths => {
        Object.entries(vendorMonths || {}).forEach(([month, amount]) => {
            const m = parseInt(month, 10);
            const value = parseFloat(amount) || 0;
            if (!m) return;
            monthly[m] = (monthly[m] || 0) + value;
        });
    });
    return monthly;
}

async function getBSales(vendorCode, year) {
    if (!vendorCode || vendorCode === 'ALL') return {};

    const rawCode = vendorCode.trim();
    const cacheKey = `${rawCode}:${year}`;
    const cached = _bSalesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < _bSalesCacheTTL) return cached.data;

    try {
        const byVendor = await getBSalesByVendor(year, [rawCode]);
        const monthlyMap = byVendor[normalizeSalesVendorCode(rawCode)] || {};
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
    COMMISSION_SALES_VENDOR_COLUMN,
    COMMISSION_OBJECTIVE_VENDOR_COLUMN,
    SNAPSHOT_UNTIL_MONTH,
    getVendorColumn,
    getVendorColumnExpr,
    getCommissionVendorColumnExpr,
    getCommissionActualVendorColumnExprForYear,
    getCommissionActualVendorColumnExprForMonth,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER,
    LAC_TIPOVENTA_FILTER,
    LAC_SERIEALBARAN_FILTER,
    formatCurrency,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    buildColumnaVendedorFilter,
    buildDateFilter,
    getVendorName,
    getVendorVisibilityScope,
    buildClientVendorParamFilter,
    buildClientListVendorSqlFilter,
    buildCvcVendorScopeFilter,
    expandVendorCodesForSql,
    buildLaclaeBoundedClientCodesSql,
    lookupClientAssignedVendorCodes,
    getBSales,
    getBSalesByVendor,
    aggregateBSalesByMonth,
    normalizeSalesVendorCode,
    sanitizeForSQL,
    sanitizeCodeList,
    sanitizeCodeListForParams,
    chunkedVendorQuery,
    chunkedInQuery,

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

// =============================================================================
// ERROR HANDLING - Sanitized error responses for production
// =============================================================================

/**
 * Patterns that indicate sensitive information should NEVER be exposed
 * These are checked and stripped from error messages
 */
const SENSITIVE_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /key/i,
    /credential/i,
    /auth/i,
    /jwt/i,
    /bearer/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /session/i,
    /cookie/i,
    /db[_-]?pass/i,
    /connection[_-]?string/i,
    /odbc/i,
    /dsn/i,
    /host/i,
    /port/i,
    /charset/i,
    /encoding/i,
    /sql/i,
    /syntax/i,
    /table/i,
    /column/i,
    /index/i,
    /constraint/i,
    /trigger/i,
    /procedure/i,
    /function/i,
    /schema/i,
    /catalog/i,
    /driver/i,
    /pool/i,
    /connection/i,
    /timeout/i,
    /memory/i,
    /heap/i,
    /stack/i,
    /overflow/i,
    /underflow/i,
    /null/i,
    /undefined/i,
    /NaN/i,
    /undefined/i,
    /\[object/i,
    /object\.object/i,
    /^\s*at\s+/m, // stack trace lines
    /line\s+\d+/i,
    /column\s+\d+/i,
    /file\s+"?[^"]+\.js"?/i,
    /\.js:\d+:\d+/i,
    /<anonymous>/i,
    /internal\/modules/i,
    /node_modules/i,
    /async\s*lib/i,
    /node:internal/i,
];

/**
 * Check if a message contains sensitive patterns
 * @param {string} msg - Error message to check
 * @returns {boolean} True if sensitive patterns found
 */
function containsSensitiveInfo(msg) {
    if (!msg || typeof msg !== 'string') return false;
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(msg));
}

/**
 * Sanitize an error message for client response.
 * Removes sensitive patterns, stack traces, and internal details.
 * 
 * @param {string|Error} error - Error object or message
 * @param {string} fallbackMessage - Message to return if error is too generic
 * @returns {string} Sanitized error message safe for client
 */
function sanitizeErrorMessage(error, fallbackMessage = 'Error interno del servidor') {
    let originalMessage = '';
    
    if (error instanceof Error) {
        originalMessage = error.message || '';
    } else if (typeof error === 'string') {
        originalMessage = error;
    } else if (error && typeof error === 'object') {
        originalMessage = error.message || error.error || JSON.stringify(error);
    }
    
    if (!originalMessage || originalMessage.trim() === '') {
        return fallbackMessage;
    }
    
    // Check if message contains sensitive patterns
    if (containsSensitiveInfo(originalMessage)) {
        logger.warn(`[SECURITY] Blocking exposure of sensitive error info: ${originalMessage.substring(0, 50)}...`);
        return fallbackMessage;
    }
    
    // Additional cleanup: remove any remaining potential internal paths or stack traces
    let sanitized = originalMessage
        .replace(/\s+at\s+[^\n]+/g, '') // Remove stack trace lines
        .replace(/in\s+"?[^"]+\.js"?/gi, '') // Remove file references
        .replace(/:\d+:\d+/g, '') // Remove line:column numbers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    
    // If the sanitized message is too short or looks like garbage, use fallback
    if (sanitized.length < 5 || /^[^\w\s]{3,}$/.test(sanitized)) {
        return fallbackMessage;
    }
    
    // Truncate to reasonable length (never expose huge error dumps)
    if (sanitized.length > 200) {
        sanitized = sanitized.substring(0, 200) + '...';
    }
    
    return sanitized;
}

/**
 * Create a standardized error response object.
 * Use this in all catch blocks to ensure consistent, safe error responses.
 * 
 * @param {string|Error} error - The caught error
 * @param {string} userMessage - User-friendly message to display
 * @param {object} extras - Additional fields to include in response
 * @returns {object} Safe error response object
 */
function createErrorResponse(error, userMessage = 'Error interno del servidor', extras = {}) {
    const safeMessage = sanitizeErrorMessage(error, userMessage);
    
    const response = {
        error: safeMessage,
        code: extras.code || 'INTERNAL_ERROR',
        ...extras
    };
    
    // Only include 'details' if the error is safe (doesn't contain sensitive info)
    if (error instanceof Error && !containsSensitiveInfo(error.message)) {
        // Include a generic indicator, not the actual message
        response.details = 'Ver logs internos para más información';
    }
    
    return response;
}

/**
 * Handle a caught error in an async route handler.
 * Logs the full error and sends a safe response to the client.
 * 
 * @param {Error} error - The caught error
 * @param {object} res - Express response object
 * @param {string} userMessage - User-friendly message
 * @param {number} statusCode - HTTP status code (default 500)
 * @param {object} extras - Additional response fields
 */
function handleRouteError(error, res, userMessage = 'Error interno del servidor', statusCode = 500, extras = {}) {
    // Log full error details internally (never sent to client)
    logger.error(`[ROUTE ERROR] ${error.message}${error.stack ? '\n' + error.stack.substring(0, 500) : ''}`);
    
    // Send safe response to client
    res.status(statusCode).json(createErrorResponse(error, userMessage, extras));
}

module.exports = {
    ...module.exports,
    sanitizeErrorMessage,
    createErrorResponse,
    handleRouteError,
    containsSensitiveInfo,
};
