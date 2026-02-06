const { query } = require('../config/db');
const { LACLAE_SALES_FILTER } = require('../utils/common');

async function debug() {
    console.log('Debugging Bartolo Jan 2025 LCAADC...');

    // Dump all rows
    const rows = await query(`
        SELECT L.LCAADC, L.LCMMDC, L.LCCLLN, L.LCTPVT, L.LCSRAB, L.LCIMVT
        FROM DSED.LACLAE L
        WHERE L.LCAADC = 2025
        AND L.LCMMDC = 1
        AND TRIM(L.LCCDVD) = '02'
    `, false, false);

    let total = 0;
    let filteredTotal = 0;

    console.log('YEAR|MONTH|LCCLLN|LCTPVT|LCSRAB|AMOUNT|INCLUDED?');

    rows.forEach(r => {
        const amount = parseFloat(r.LCIMVT);
        let included = false;

        // Manual filter check matching common.js
        const isAB_VT = ['AB', 'VT'].includes(r.LCCLLN.trim());
        const isCC_VC = ['CC', 'VC'].includes(r.LCTPVT.trim());
        const isBadSeries = ['N', 'Z', 'G', 'D'].includes(r.LCSRAB.trim());

        if (isAB_VT && isCC_VC && !isBadSeries) {
            included = true;
            filteredTotal += amount;
        }
        total += amount;

        console.log(`${r.LCAADC}|${r.LCMMDC}|${r.LCCLLN}|${r.LCTPVT}|${r.LCSRAB}|${amount.toFixed(2)}|${included}`);
    });

    console.log('---');
    console.log(`Raw Total: ${total.toFixed(2)}`);
    console.log(`Filtered Total (My Logic): ${filteredTotal.toFixed(2)}`);
    console.log(`User Expected: 56063.05`);
}

debug();
