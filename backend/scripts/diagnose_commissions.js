/**
 * Script de diagnóstico para comisiones
 * Verifica por qué algunos vendedores (35, 01, 15, ALL) no muestran comisiones
 */

const { query } = require('./config/db');

const PROBLEM_VENDORS = ['35', '01', '15', '93']; // 93 como control (funciona)
const YEAR = 2026;
const PREV_YEAR = 2025;

async function diagnose() {
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

            // 2. Verificar ventas en LACLAE (tabla principal)
            const laclaeCheck = await query(`
                SELECT 
                    L.LCAADC as YEAR,
                    L.LCMMDC as MONTH,
                    COUNT(*) as RECORDS,
                    SUM(L.LCIMVT) as TOTAL_SALES
                FROM DSED.LACLAE L
                WHERE TRIM(L.LCCDVD) = '${vendorCode}'
                  AND L.LCAADC IN (${YEAR}, ${PREV_YEAR})
                GROUP BY L.LCAADC, L.LCMMDC
                ORDER BY L.LCAADC, L.LCMMDC
            `);
            console.log(`\n2. LACLAE (Ventas agregadas): ${laclaeCheck.length > 0 ? '✅ Tiene datos' : '❌ SIN DATOS'}`);
            if (laclaeCheck.length > 0) {
                console.log('   Mes | Year | Records | Total Ventas');
                laclaeCheck.forEach(row => {
                    console.log(`   ${String(row.MONTH).padStart(2, '0')} | ${row.YEAR} | ${String(row.RECORDS).padStart(7)} | ${parseFloat(row.TOTAL_SALES).toFixed(2)}€`);
                });
            }

            // 3. Verificar ventas en LINDTO (tabla detalle)
            const lindtoCheck = await query(`
                SELECT 
                    ANODOCUMENTO as YEAR,
                    MESDOCUMENTO as MONTH,
                    COUNT(*) as RECORDS,
                    SUM(IMPORTEVENTA) as TOTAL_SALES
                FROM DSEDAC.LINDTO
                WHERE TRIM(CODIGOVENDEDOR) = '${vendorCode}'
                  AND ANODOCUMENTO IN (${YEAR}, ${PREV_YEAR})
                  AND TIPOVENTA IN ('CC', 'VC')
                  AND TIPOLINEA IN ('AB', 'VT')
                  AND SERIEALBARAN NOT IN ('N', 'Z')
                GROUP BY ANODOCUMENTO, MESDOCUMENTO
                ORDER BY ANODOCUMENTO, MESDOCUMENTO
            `);
            console.log(`\n3. LINDTO (Detalle ventas): ${lindtoCheck.length > 0 ? '✅ Tiene datos' : '❌ SIN DATOS'}`);
            if (lindtoCheck.length > 0 && lindtoCheck.length <= 10) {
                console.log('   Mes | Year | Records | Total Ventas');
                lindtoCheck.forEach(row => {
                    console.log(`   ${String(row.MONTH).padStart(2, '0')} | ${row.YEAR} | ${String(row.RECORDS).padStart(7)} | ${parseFloat(row.TOTAL_SALES).toFixed(2)}€`);
                });
            } else if (lindtoCheck.length > 10) {
                console.log(`   (${lindtoCheck.length} meses con datos)`);
            }

            // 4. Verificar formato del código en LACLAE
            const formatCheck = await query(`
                SELECT DISTINCT LCCDVD as RAW_CODE, LENGTH(LCCDVD) as LEN
                FROM DSED.LACLAE
                WHERE LCCDVD LIKE '%${vendorCode}%'
                  AND LCAADC = ${YEAR}
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

    // 5. Verificar vista agregada (ALL vendors)
    console.log(`\n${'='.repeat(50)}`);
    console.log('VISTA AGREGADA (Todos los vendedores)');
    console.log('='.repeat(50));

    try {
        const allVendors = await query(`
            SELECT 
                L.LCAADC as YEAR,
                L.LCMMDC as MONTH,
                COUNT(DISTINCT L.LCCDVD) as VENDOR_COUNT,
                SUM(L.LCIMVT) as TOTAL_SALES
            FROM DSED.LACLAE L
            WHERE L.LCAADC IN (${YEAR}, ${PREV_YEAR})
            GROUP BY L.LCAADC, L.LCMMDC
            ORDER BY L.LCAADC, L.LCMMDC
            FETCH FIRST 12 ROWS ONLY
        `);
        console.log('\nMes | Year | Vendedores | Total Ventas');
        allVendors.forEach(row => {
            console.log(`${String(row.MONTH).padStart(2, '0')} | ${row.YEAR} | ${String(row.VENDOR_COUNT).padStart(10)} | ${parseFloat(row.TOTAL_SALES).toFixed(2)}€`);
        });
    } catch (error) {
        console.error(`Error vista agregada: ${error.message}`);
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
