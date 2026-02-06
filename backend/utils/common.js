// =============================================================================
// DATE HELPERS & CONSTANTS
// =============================================================================
const getCurrentDate = () => new Date();
const getCurrentYear = () => getCurrentDate().getFullYear();
const MIN_YEAR = getCurrentYear() - 2; // Dynamic: always 3 years of data

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
function formatCurrency(value) {
    // Returns raw number - formatting done in Flutter frontend with Spanish locale
    return parseFloat(value) || 0;
}

function buildVendedorFilter(vendedorCodes, tableAlias = '') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const hasUnk = codeList.includes('UNK');

    // Filter out UNK from standard list
    const validCodes = codeList.filter(c => c !== 'UNK').map(c => `'${c}'`).join(',');

    console.log(`[FILTER] Codes: ${vendedorCodes} | Valid: ${validCodes} | HasUnk: ${hasUnk}`);

    const conditions = [];
    if (validCodes.length > 0) {
        conditions.push(`TRIM(${prefix}CODIGOVENDEDOR) IN (${validCodes})`);
    }
    if (hasUnk) {
        conditions.push(`(${prefix}CODIGOVENDEDOR IS NULL OR TRIM(${prefix}CODIGOVENDEDOR) = '')`);
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

// Vendor filter for LACLAE table (uses short column name LCCDVD)
function buildVendedorFilterLACLAE(vendedorCodes, tableAlias = 'L') {
    if (!vendedorCodes || vendedorCodes === 'ALL') return '';
    const prefix = tableAlias ? `${tableAlias}.` : '';

    const codeList = vendedorCodes.split(',').map(c => c.trim());
    const hasUnk = codeList.includes('UNK');

    const validCodes = codeList.filter(c => c !== 'UNK').map(c => `'${c}'`).join(',');

    const conditions = [];
    if (validCodes.length > 0) {
        conditions.push(`TRIM(${prefix}LCCDVD) IN (${validCodes})`);
    }
    if (hasUnk) {
        conditions.push(`(${prefix}LCCDVD IS NULL OR TRIM(${prefix}LCCDVD) = '')`);
    }

    if (conditions.length === 0) return 'AND 1=0';

    return `AND (${conditions.join(' OR ')})`;
}

const { query } = require('../config/db');

// ... (previous helper functions)

async function getVendorName(vendorCode) {
    if (!vendorCode || vendorCode === 'ALL') return 'Global';
    try {
        const rows = await query(`SELECT NOMBREVENDEDOR FROM DSEDAC.VDD WHERE TRIM(CODIGOVENDEDOR) = '${vendorCode.trim()}'`, false);
        if (rows && rows.length > 0) return rows[0].NOMBREVENDEDOR;
        return vendorCode;
    } catch (e) {
        console.error('Error getting vendor name:', e);
        return vendorCode;
    }
}

module.exports = {
    getCurrentDate,
    getCurrentYear,
    MIN_YEAR,
    LAC_SALES_FILTER,
    LACLAE_SALES_FILTER,
    LAC_TIPOVENTA_FILTER,
    LAC_SERIEALBARAN_FILTER,
    formatCurrency,
    buildVendedorFilter,
    buildVendedorFilterLACLAE,
    buildDateFilter,
    getVendorName, // Added Export

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
