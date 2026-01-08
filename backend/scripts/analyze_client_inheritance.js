/**
 * Análisis: Herencia de clientes entre comerciales
 * 
 * Para comerciales nuevos (sin historial completo en 2025), necesitamos:
 * 1. Identificar qué clientes manejan actualmente
 * 2. Ver qué comerciales manejaban esos clientes en 2025
 * 3. Sumar las ventas de esos comerciales anteriores para esos clientes
 */

const { initDb, query } = require('../config/db');

const YEAR = 2026;
const PREV_YEAR = 2025;
const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;

// Ejemplos de comerciales con historial incompleto
const NEW_VENDORS = ['35', '15', '01'];

async function analyzeVendor(vendorCode) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ANÁLISIS COMERCIAL: ${vendorCode}`);
    console.log('='.repeat(60));

    // 1. Obtener los clientes actuales de este comercial (2026)
    console.log('\n1. CLIENTES ACTUALES (2026):');
    const currentClients = await query(`
        SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${vendorCode}'
          AND L.LCAADC = ${YEAR}
          AND ${LACLAE_SALES_FILTER}
    `);
    console.log(`   Clientes en 2026: ${currentClients.length}`);

    if (currentClients.length === 0) {
        // Si no tiene clientes en 2026, buscar en 2025
        const clients2025 = await query(`
            SELECT DISTINCT TRIM(L.LCCDCL) as CLIENT_CODE
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDVD) = '${vendorCode}'
              AND L.LCAADC = ${PREV_YEAR}
              AND ${LACLAE_SALES_FILTER}
        `);
        console.log(`   Clientes en 2025: ${clients2025.length}`);
    }

    // 2. Para esos clientes, ver quién los manejaba en 2025
    if (currentClients.length > 0) {
        const clientCodes = currentClients.map(c => `'${c.CLIENT_CODE}'`).join(',');

        console.log('\n2. ¿QUIÉN MANEJABA ESTOS CLIENTES EN 2025?');
        const previousVendors = await query(`
            SELECT 
                TRIM(L.LCCDVD) as VENDOR_CODE,
                COUNT(DISTINCT L.LCCDCL) as CLIENTS,
                SUM(L.LCIMVT) as TOTAL_SALES
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) IN (${clientCodes})
              AND L.LCAADC = ${PREV_YEAR}
              AND ${LACLAE_SALES_FILTER}
            GROUP BY TRIM(L.LCCDVD)
            ORDER BY SUM(L.LCIMVT) DESC
        `);

        console.log('   Vendor | Clientes | Ventas 2025');
        let totalInherited = 0;
        previousVendors.forEach(row => {
            const sales = parseFloat(row.TOTAL_SALES) || 0;
            totalInherited += sales;
            const isSelf = row.VENDOR_CODE.trim() === vendorCode;
            console.log(`   ${row.VENDOR_CODE.padEnd(6)} | ${String(row.CLIENTS).padStart(8)} | ${sales.toFixed(2)}€ ${isSelf ? '← PROPIO' : ''}`);
        });
        console.log(`   TOTAL HEREDADO: ${totalInherited.toFixed(2)}€`);
        console.log(`   OBJETIVO SUGERIDO (+3%): ${(totalInherited * 1.03).toFixed(2)}€`);

        // 3. Desglose mensual de ventas de estos clientes en 2025
        console.log('\n3. DESGLOSE MENSUAL DE ESTOS CLIENTES EN 2025:');
        const monthlyBreakdown = await query(`
            SELECT 
                L.LCMMDC as MONTH,
                TRIM(L.LCCDVD) as VENDOR_CODE,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) IN (${clientCodes})
              AND L.LCAADC = ${PREV_YEAR}
              AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCMMDC, TRIM(L.LCCDVD)
            ORDER BY L.LCMMDC, SUM(L.LCIMVT) DESC
        `);

        // Agrupar por mes
        const byMonth = {};
        monthlyBreakdown.forEach(row => {
            const m = row.MONTH;
            if (!byMonth[m]) byMonth[m] = { total: 0, vendors: [] };
            const sales = parseFloat(row.SALES) || 0;
            byMonth[m].total += sales;
            byMonth[m].vendors.push({ code: row.VENDOR_CODE.trim(), sales });
        });

        console.log('   Mes | Total Clientes | Vendedor Principal');
        for (let m = 1; m <= 12; m++) {
            const data = byMonth[m];
            if (data) {
                const mainVendor = data.vendors[0];
                console.log(`   ${String(m).padStart(2, '0')} | ${data.total.toFixed(2).padStart(12)}€ | ${mainVendor.code} (${mainVendor.sales.toFixed(2)}€)`);
            } else {
                console.log(`   ${String(m).padStart(2, '0')} | Sin datos`);
            }
        }
    }

    // 4. Comparar con el objetivo actual (solo ventas propias del comercial)
    console.log('\n4. COMPARACIÓN CON OBJETIVO ACTUAL (solo propias):');
    const ownSales = await query(`
        SELECT 
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDVD) = '${vendorCode}'
          AND L.LCAADC = ${PREV_YEAR}
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCMMDC
        ORDER BY L.LCMMDC
    `);

    let ownTotal = 0;
    console.log('   Mes | Ventas Propias 2025');
    ownSales.forEach(row => {
        const sales = parseFloat(row.SALES) || 0;
        ownTotal += sales;
        console.log(`   ${String(row.MONTH).padStart(2, '0')} | ${sales.toFixed(2)}€`);
    });
    console.log(`   TOTAL PROPIO: ${ownTotal.toFixed(2)}€`);
    console.log(`   OBJETIVO ACTUAL (+3%): ${(ownTotal * 1.03).toFixed(2)}€`);
}

async function main() {
    console.log('Inicializando conexión...');
    await initDb();
    console.log('Conexión establecida.');

    for (const vendor of NEW_VENDORS) {
        await analyzeVendor(vendor);
    }

    console.log('\n\n' + '='.repeat(60));
    console.log('FIN DEL ANÁLISIS');
    console.log('='.repeat(60));

    process.exit(0);
}

main().catch(e => {
    console.error('Error fatal:', e);
    process.exit(1);
});
