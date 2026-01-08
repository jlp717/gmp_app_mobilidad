/**
 * Test: Simular el endpoint de comisiones con lógica de herencia
 */

const { initDb, query } = require('../config/db');

const YEAR = 2026;
const PREV_YEAR = 2025;
const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;
const IPC = 3.0;

async function getVendorCurrentClients(vendorCode, currentYear) {
    const rows = await query(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${vendorCode}'
          AND L.LCAADC = ${currentYear}
          AND ${LACLAE_SALES_FILTER}
    `, false);

    if (rows.length === 0) {
        const prevRows = await query(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDVD) = '${vendorCode}'
              AND L.LCAADC = ${currentYear - 1}
              AND ${LACLAE_SALES_FILTER}
        `, false);
        return prevRows.map(r => r.CLIENT_CODE);
    }

    return rows.map(r => r.CLIENT_CODE);
}

async function getClientsMonthlySales(clientCodes, year) {
    if (!clientCodes || clientCodes.length === 0) return {};

    const clientList = clientCodes.map(c => `'${c}'`).join(',');

    const rows = await query(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) IN (${clientList})
          AND L.LCAADC = ${year}
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
    `, false);

    const monthlyMap = {};
    rows.forEach(r => {
        monthlyMap[r.MONTH] = parseFloat(r.SALES) || 0;
    });

    return monthlyMap;
}

async function simulateCommissions(vendorCode) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SIMULACIÓN COMISIONES: ${vendorCode}`);
    console.log('='.repeat(60));

    // 1. Get vendor's own sales
    const salesRows = await query(`
        SELECT 
            L.LCAADC as YEAR,
            LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${vendorCode}'
          AND L.LCAADC IN (${YEAR}, ${PREV_YEAR})
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC, LCMMDC
    `);

    // 2. Check for missing months
    const monthsWithData = salesRows.filter(r => r.YEAR == PREV_YEAR).map(r => r.MONTH);
    const missingMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => !monthsWithData.includes(m));

    console.log(`\nMeses CON datos propios 2025: [${monthsWithData.join(', ')}]`);
    console.log(`Meses SIN datos propios 2025: [${missingMonths.join(', ')}]`);

    // 3. Load inherited sales if needed
    let inheritedMonthlySales = {};
    if (missingMonths.length > 0) {
        const currentClients = await getVendorCurrentClients(vendorCode, YEAR);
        console.log(`Clientes actuales: ${currentClients.length}`);

        if (currentClients.length > 0) {
            inheritedMonthlySales = await getClientsMonthlySales(currentClients, PREV_YEAR);
        }
    }

    // 4. Calculate targets month by month
    console.log('\n' + 'Mes'.padEnd(4) + '| ' + 'Propias 2025'.padStart(14) + ' | ' + 'Heredadas 2025'.padStart(14) + ' | ' + 'Usado'.padStart(14) + ' | ' + 'Objetivo 2026'.padStart(14) + ' | ' + 'Fuente'.padStart(10));
    console.log('-'.repeat(85));

    let totalTarget = 0;
    let totalOwnSales = 0;
    let totalInheritedUsed = 0;

    for (let m = 1; m <= 12; m++) {
        const prevRow = salesRows.find(r => r.YEAR == PREV_YEAR && r.MONTH == m);
        let ownSales = prevRow ? parseFloat(prevRow.SALES) : 0;
        let inheritedSales = inheritedMonthlySales[m] || 0;

        let usedSales = ownSales;
        let source = 'propio';

        if (ownSales === 0 && inheritedSales > 0) {
            usedSales = inheritedSales;
            source = 'HEREDADO';
            totalInheritedUsed += inheritedSales;
        } else {
            totalOwnSales += ownSales;
        }

        const target = usedSales * (1 + (IPC / 100));
        totalTarget += target;

        console.log(
            String(m).padStart(2).padEnd(4) + '| ' +
            ownSales.toFixed(2).padStart(14) + ' | ' +
            inheritedSales.toFixed(2).padStart(14) + ' | ' +
            usedSales.toFixed(2).padStart(14) + ' | ' +
            target.toFixed(2).padStart(14) + ' | ' +
            source.padStart(10)
        );
    }

    console.log('-'.repeat(85));
    console.log('TOTAL'.padEnd(4) + '| ' +
        totalOwnSales.toFixed(2).padStart(14) + ' | ' +
        totalInheritedUsed.toFixed(2).padStart(14) + ' | ' +
        (totalOwnSales + totalInheritedUsed).toFixed(2).padStart(14) + ' | ' +
        totalTarget.toFixed(2).padStart(14) + ' | ');

    console.log(`\n📊 OBJETIVO TOTAL 2026: ${totalTarget.toFixed(2)}€`);
    console.log(`   (Propias: ${totalOwnSales.toFixed(2)}€ + Heredadas: ${totalInheritedUsed.toFixed(2)}€) * 1.03`);
}

async function main() {
    console.log('Inicializando conexión...');
    await initDb();
    console.log('Conexión establecida.');

    // Test con los comerciales problemáticos
    const vendors = ['15', '35', '93', '01'];

    for (const v of vendors) {
        await simulateCommissions(v);
    }

    console.log('\n\nFIN');
    process.exit(0);
}

main().catch(e => {
    console.error('Error fatal:', e);
    process.exit(1);
});
