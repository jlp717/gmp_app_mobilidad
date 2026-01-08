/**
 * Script de diagnóstico para comisiones
 * Verifica por qué algunos vendedores (35, 01, 15, ALL) no muestran comisiones
 */

const { initDb, query } = require('../config/db');

const PROBLEM_VENDORS = ['35', '01', '15', '93']; // 93 como control (funciona)
const YEAR = 2026;
const PREV_YEAR = 2025;

async function diagnose() {
    // Initialize database connection first
    console.log('Inicializando conexión a base de datos...');
    await initDb();
    console.log('Conexión establecida.\n');

    console.log('='.repeat(70));
    console.log('DIAGNÓSTICO DE COMISIONES - Vendedores problemáticos');
    console.log('='.repeat(70));

    for (const vendorCode of PROBLEM_VENDORS) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`VENDEDOR: ${vendorCode}`);
        console.log('='.repeat(50));

        try {
            // 1. Verificar si existe en VDC
            const vdcCheck = await query(`
                SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME, SUBEMPRESA
                FROM DSEDAC.VDC 
                WHERE TRIM(CODIGOVENDEDOR) = '${vendorCode}'
            `);
            console.log(`\n1. VDC (Vendedores): ${vdcCheck.length > 0 ? '✅ Existe' : '❌ NO EXISTE'}`);
            if (vdcCheck.length > 0) {
                console.log(`   Nombre: ${vdcCheck[0].NAME}, Subempresa: ${vdcCheck[0].SUBEMPRESA}`);
            }

            // 2. Verificar ventas en LACLAE 2025 (año anterior - para objetivos)
            const laclae2025 = await query(`
                SELECT 
                    L.LCAADC as YEAR,
                    L.LCMMDC as MONTH,
                    COUNT(*) as RECORDS,
                    SUM(L.LCIMVT) as TOTAL_SALES
                FROM DSED.LACLAE L
                WHERE TRIM(L.LCCDVD) = '${vendorCode}'
                  AND L.LCAADC = ${PREV_YEAR}
                  AND L.TPDC = 'LAC'
                  AND L.LCTPVT IN ('CC', 'VC')
                  AND L.LCCLLN IN ('AB', 'VT')
                  AND L.LCSRAB NOT IN ('N', 'Z')
                GROUP BY L.LCAADC, L.LCMMDC
                ORDER BY L.LCAADC, L.LCMMDC
            `);
            console.log(`\n2. LACLAE 2025 (Año anterior - BASE PARA OBJETIVOS): ${laclae2025.length > 0 ? '✅ Tiene datos' : '❌ SIN DATOS (NO HABRÁ OBJETIVO!)'}`);
            if (laclae2025.length > 0) {
                let total2025 = 0;
                console.log('   Mes | Year | Records | Total Ventas');
                laclae2025.forEach(row => {
                    total2025 += parseFloat(row.TOTAL_SALES) || 0;
                    console.log(`   ${String(row.MONTH).padStart(2, '0')} | ${row.YEAR} | ${String(row.RECORDS).padStart(7)} | ${parseFloat(row.TOTAL_SALES).toFixed(2)}€`);
                });
                console.log(`   TOTAL 2025: ${total2025.toFixed(2)}€`);
            }

            // 3. Verificar ventas en LACLAE 2026 (año actual)
            const laclae2026 = await query(`
                SELECT 
                    L.LCAADC as YEAR,
                    L.LCMMDC as MONTH,
                    COUNT(*) as RECORDS,
                    SUM(L.LCIMVT) as TOTAL_SALES
                FROM DSED.LACLAE L
                WHERE TRIM(L.LCCDVD) = '${vendorCode}'
                  AND L.LCAADC = ${YEAR}
                  AND L.TPDC = 'LAC'
                  AND L.LCTPVT IN ('CC', 'VC')
                  AND L.LCCLLN IN ('AB', 'VT')
                  AND L.LCSRAB NOT IN ('N', 'Z')
                GROUP BY L.LCAADC, L.LCMMDC
                ORDER BY L.LCAADC, L.LCMMDC
            `);
            console.log(`\n3. LACLAE 2026 (Año actual): ${laclae2026.length > 0 ? '✅ Tiene datos' : '❌ SIN DATOS'}`);
            if (laclae2026.length > 0) {
                console.log('   Mes | Year | Records | Total Ventas');
                laclae2026.forEach(row => {
                    console.log(`   ${String(row.MONTH).padStart(2, '0')} | ${row.YEAR} | ${String(row.RECORDS).padStart(7)} | ${parseFloat(row.TOTAL_SALES).toFixed(2)}€`);
                });
            }

            // 4. Verificar formato del código en LACLAE (sin filtros de tipo)
            const formatCheck = await query(`
                SELECT DISTINCT LCCDVD as RAW_CODE, LENGTH(LCCDVD) as LEN
                FROM DSED.LACLAE
                WHERE LCCDVD LIKE '%${vendorCode}%'
                  AND LCAADC IN (${YEAR}, ${PREV_YEAR})
                FETCH FIRST 5 ROWS ONLY
            `);
            console.log(`\n4. Formato código en LACLAE:`);
            if (formatCheck.length > 0) {
                formatCheck.forEach(row => {
                    console.log(`   '${row.RAW_CODE}' (longitud: ${row.LEN})`);
                });
            } else {
                console.log('   No encontrado con LIKE');
            }

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
        }
    }

    // 5. Listar TODOS los vendedores con ventas en 2025
    console.log(`\n${'='.repeat(50)}`);
    console.log('LISTA DE VENDEDORES CON VENTAS EN 2025');
    console.log('='.repeat(50));

    try {
        const allVendors2025 = await query(`
            SELECT 
                TRIM(L.LCCDVD) as VENDOR_CODE,
                COUNT(*) as RECORDS,
                SUM(L.LCIMVT) as TOTAL_SALES
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${PREV_YEAR}
              AND L.TPDC = 'LAC'
              AND L.LCTPVT IN ('CC', 'VC')
              AND L.LCCLLN IN ('AB', 'VT')
              AND L.LCSRAB NOT IN ('N', 'Z')
            GROUP BY TRIM(L.LCCDVD)
            ORDER BY SUM(L.LCIMVT) DESC
        `);
        console.log('\nCódigo | Records | Total Ventas 2025');
        allVendors2025.forEach(row => {
            const code = row.VENDOR_CODE || '(vacío)';
            const highlight = PROBLEM_VENDORS.includes(code.trim()) ? ' ⚠️' : '';
            console.log(`${code.padEnd(8)} | ${String(row.RECORDS).padStart(7)} | ${parseFloat(row.TOTAL_SALES).toFixed(2)}€${highlight}`);
        });
    } catch (error) {
        console.error(`Error listando vendedores: ${error.message}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('FIN DIAGNÓSTICO');
    console.log('='.repeat(70));

    process.exit(0);
}

diagnose().catch(e => {
    console.error('Error fatal:', e);
    process.exit(1);
});
