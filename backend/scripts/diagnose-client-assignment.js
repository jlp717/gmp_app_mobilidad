/**
 * Script de Diagnóstico: Verificar asignación de cliente a vendedor
 * 
 * Ejecutar en el servidor: node scripts/diagnose-client-assignment.js
 */

const { getPool, initDb } = require('../config/db');

async function diagnoseClientAssignment() {
    const clientCode = '4300008335';

    console.log('='.repeat(60));
    console.log('DIAGNÓSTICO: Asignación Cliente-Vendedor');
    console.log(`Cliente: ${clientCode}`);
    console.log('='.repeat(60));

    try {
        // Initialize DB first
        await initDb();
        const pool = getPool();
        const conn = await pool.connect();

        try {
            // 1. Buscar cliente en CLI
            console.log('\n1. DATOS DEL CLIENTE (DSEDAC.CLI)');
            console.log('-'.repeat(40));

            const clientResult = await conn.query(`
                SELECT 
                    TRIM(CODIGOCLIENTE) as CODE,
                    TRIM(COALESCE(NOMBREALTERNATIVO, NOMBRECLIENTE)) as NAME,
                    TRIM(CODIGOVENDEDOR) as VENDOR_CLI,
                    TRIM(CODIGOREPARTIDOR) as REPARTIDOR_CLI,
                    TRIM(POBLACION) as CITY,
                    TRIM(CODIGORUTA) as ROUTE
                FROM DSEDAC.CLI
                WHERE CODIGOCLIENTE = '${clientCode}'
                FETCH FIRST 1 ROWS ONLY
            `);

            if (clientResult.length > 0) {
                const c = clientResult[0];
                console.log(`   Código: ${c.CODE}`);
                console.log(`   Nombre: ${c.NAME}`);
                console.log(`   Vendedor en CLI: ${c.VENDOR_CLI || 'N/A'}`);
                console.log(`   Repartidor en CLI: ${c.REPARTIDOR_CLI || 'N/A'}`);
                console.log(`   Ciudad: ${c.CITY}`);
                console.log(`   Ruta: ${c.ROUTE || 'N/A'}`);

                // Buscar nombre del vendedor
                if (c.VENDOR_CLI) {
                    const vendorResult = await conn.query(`
                        SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME
                        FROM DSEDAC.VDD
                        WHERE CODIGOVENDEDOR = '${c.VENDOR_CLI}'
                        FETCH FIRST 1 ROWS ONLY
                    `);
                    if (vendorResult.length > 0) {
                        console.log(`   → Nombre Vendedor: ${vendorResult[0].NAME}`);
                    }
                }
            } else {
                console.log('   ⚠ Cliente NO encontrado en CLI');
            }

            // 2. Buscar en LACLAE (historial de ventas)
            console.log('\n2. HISTORIAL EN LACLAE (Vendedores por ventas)');
            console.log('-'.repeat(40));

            const laclaeResult = await conn.query(`
                SELECT DISTINCT
                    TRIM(L.R1_T8CDVD) as VENDOR,
                    L.LCAADC as YEAR,
                    L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X,
                    L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V
                FROM DSED.LACLAE L
                WHERE TRIM(L.LCCDCL) = '${clientCode}'
                ORDER BY L.LCAADC DESC
                FETCH FIRST 10 ROWS ONLY
            `);

            if (laclaeResult.length > 0) {
                const vendors = [...new Set(laclaeResult.map(r => r.VENDOR))];
                console.log(`   Vendedores encontrados: ${vendors.join(', ')}`);
                console.log('');

                for (const row of laclaeResult) {
                    const visitDays = [
                        row.VIS_L === 'S' ? 'L' : '',
                        row.VIS_M === 'S' ? 'M' : '',
                        row.VIS_X === 'S' ? 'X' : '',
                        row.VIS_J === 'S' ? 'J' : '',
                        row.VIS_V === 'S' ? 'V' : ''
                    ].filter(d => d).join('');
                    console.log(`   ${row.YEAR}: Vendedor ${row.VENDOR}, Visita: ${visitDays || 'N/A'}`);
                }

                // Buscar nombres de todos los vendedores
                console.log('');
                for (const vendorCode of vendors) {
                    const vInfo = await conn.query(`
                        SELECT TRIM(NOMBREVENDEDOR) as NAME
                        FROM DSEDAC.VDD
                        WHERE CODIGOVENDEDOR = '${vendorCode}'
                        FETCH FIRST 1 ROWS ONLY
                    `);
                    if (vInfo.length > 0) {
                        console.log(`   → ${vendorCode}: ${vInfo[0].NAME}`);
                    }
                }
            } else {
                console.log('   Sin registros en LACLAE');
            }

            // 3. Buscar en RUTERO_CONFIG (overrides)
            console.log('\n3. OVERRIDES EN JAVIER.RUTERO_CONFIG');
            console.log('-'.repeat(40));

            try {
                const configResult = await conn.query(`
                    SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(DIA) as DIA, ORDEN
                    FROM JAVIER.RUTERO_CONFIG
                    WHERE TRIM(CLIENTE) = '${clientCode}'
                `);

                if (configResult.length > 0) {
                    console.log('   ⚠ HAY OVERRIDES:');
                    for (const r of configResult) {
                        console.log(`   Vendedor: ${r.VENDEDOR}, Día: ${r.DIA}, Orden: ${r.ORDEN}`);
                    }
                } else {
                    console.log('   Sin overrides para este cliente');
                }
            } catch (e) {
                console.log('   Tabla RUTERO_CONFIG no accesible o no existe');
            }

            // 4. Buscar vendedores ZZ o CAYETANO
            console.log('\n4. VENDEDORES ZZ / CAYETANO');
            console.log('-'.repeat(40));

            const zzResult = await conn.query(`
                SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME
                FROM DSEDAC.VDD
                WHERE CODIGOVENDEDOR LIKE 'ZZ%' OR UPPER(NOMBREVENDEDOR) LIKE '%CAYETANO%'
                FETCH FIRST 10 ROWS ONLY
            `);

            if (zzResult.length > 0) {
                for (const v of zzResult) {
                    console.log(`   ${v.CODE}: ${v.NAME}`);
                }
            } else {
                console.log('   No se encontraron vendedores ZZ ni CAYETANO');
            }

            // RESUMEN
            console.log('\n' + '='.repeat(60));
            console.log('RESUMEN');
            console.log('='.repeat(60));

            if (clientResult.length > 0 && clientResult[0].VENDOR_CLI) {
                console.log(`El cliente ${clientCode} tiene vendedor "${clientResult[0].VENDOR_CLI}" en DSEDAC.CLI`);
            }

            if (laclaeResult.length > 0) {
                const latestVendor = laclaeResult[0].VENDOR;
                console.log(`El vendedor más reciente en LACLAE es "${latestVendor}" (${laclaeResult[0].YEAR})`);
            }

        } finally {
            await conn.close();
        }

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }

    process.exit(0);
}

diagnoseClientAssignment();
