/**
 * Test específico: Simular exactamente lo que hace el endpoint de comisiones
 */

const { initDb, query } = require('../config/db');

const YEAR = 2026;
const PREV_YEAR = 2025;
const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;

async function testVendor(vendorCode) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`VENDEDOR: ${vendorCode}`);
    console.log('='.repeat(50));

    // Simular exactamente la query del endpoint de comisiones
    const vendedorFilter = `AND (TRIM(L.LCCDVD) IN ('${vendorCode}'))`;

    const salesQuery = `
        SELECT 
            L.LCAADC as YEAR,
            LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (${YEAR}, ${PREV_YEAR})
          AND ${LACLAE_SALES_FILTER}
          ${vendedorFilter}
        GROUP BY L.LCAADC, LCMMDC
        ORDER BY L.LCAADC, LCMMDC
    `;

    console.log('Query ejecutada (truncada):');
    console.log(salesQuery.substring(0, 200) + '...');

    try {
        const rows = await query(salesQuery);
        console.log(`\nResultados: ${rows.length} filas`);

        if (rows.length === 0) {
            console.log('❌ SIN DATOS - El vendedor no tiene ventas con los filtros aplicados');
        } else {
            console.log('\nYear | Month | Sales');
            let total2025 = 0, total2026 = 0;
            rows.forEach(row => {
                const sales = parseFloat(row.SALES) || 0;
                console.log(`${row.YEAR} | ${String(row.MONTH).padStart(5)} | ${sales.toFixed(2)}€`);
                if (row.YEAR == PREV_YEAR) total2025 += sales;
                if (row.YEAR == YEAR) total2026 += sales;
            });
            console.log(`\nTOTAL 2025: ${total2025.toFixed(2)}€`);
            console.log(`TOTAL 2026: ${total2026.toFixed(2)}€`);
            console.log(`OBJETIVO 2026 (+3%): ${(total2025 * 1.03).toFixed(2)}€`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
    }
}

async function main() {
    console.log('Inicializando conexión...');
    await initDb();
    console.log('Conexión establecida.\n');

    const vendors = ['35', '01', '15', '93'];

    for (const v of vendors) {
        await testVendor(v);
    }

    console.log('\n\nFIN');
    process.exit(0);
}

main().catch(e => {
    console.error('Error fatal:', e);
    process.exit(1);
});
