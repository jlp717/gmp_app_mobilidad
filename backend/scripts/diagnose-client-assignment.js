/**
 * Script de Diagnóstico: Verificar asignación de cliente a vendedor
 * 
 * Investigar por qué cliente "Taberna la Esquinica" (código *8335)
 * aparece asignado a "ZZ 20 CAYETANO MONTIEL"
 * 
 * Ejecutar: node scripts/diagnose-client-assignment.js
 */

const { query, initDb } = require('../config/db');

async function diagnoseClientAssignment() {
    await initDb();
    console.log('='.repeat(60));
    console.log('DIAGNÓSTICO: Asignación Cliente-Vendedor');
    console.log('='.repeat(60));

    const exactClientCode = '4300008335'; // Código exacto del cliente

    try {
        // 1. Buscar el cliente en CLI
        console.log('\n1. DATOS DEL CLIENTE (DSEDAC.CLI)');
        console.log('-'.repeat(40));

        const clientSql = `
            SELECT 
                CODIGOCLIENTE as CODE,
                NOMBRECLIENTE as NAME,
                CODIGOVENDEDOR as VENDOR_CLI,
                CODIGOREPARTIDOR as REPART_CLI,
                POBLACION as CITY
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE = '${exactClientCode}'
            FETCH FIRST 5 ROWS ONLY
        `;

        const clients = await query(clientSql);
        clients.forEach(c => {
            console.log(`   Código: ${c.CODE?.trim()}`);
            console.log(`   Nombre: ${c.NAME?.trim()}`);
            console.log(`   Vendedor (CLI): ${c.VENDOR_CLI?.trim() || 'N/A'}`);
            console.log(`   Repartidor (CLI): ${c.REPART_CLI?.trim() || 'N/A'}`);
            console.log(`   Ciudad: ${c.CITY?.trim()}`);
            console.log('');
        });

        if (clients.length === 0) {
            console.log('   No se encontró cliente con código *8335');
            process.exit(0);
        }

        const exactCode = clients[0].CODE?.trim();

        // 2. Buscar en LACLAE (historial de ventas)
        console.log('\n2. HISTORIAL EN LACLAE (Vendedor asignado por ventas)');
        console.log('-'.repeat(40));

        const laclaeSql = `
            SELECT DISTINCT
                L.LCCDCL as CLIENT,
                L.R1_T8CDVD as VENDOR_LACLAE,
                L.R1_T8DIVL as VISIT_DAYS,
                L.LCAADC as YEAR
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = '${exactCode}'
            ORDER BY L.LCAADC DESC
            FETCH FIRST 5 ROWS ONLY
        `;

        const laclaeData = await query(laclaeSql);
        laclaeData.forEach(l => {
            console.log(`   Año: ${l.YEAR}, Vendedor: ${l.VENDOR_LACLAE?.trim()}, Días Visita: ${l.VISIT_DAYS?.trim() || 'N/A'}`);
        });

        if (laclaeData.length === 0) {
            console.log('   No hay registros en LACLAE para este cliente');
        }

        // 3. Buscar nombre del vendedor
        console.log('\n3. DATOS DEL VENDEDOR ASIGNADO');
        console.log('-'.repeat(40));

        const vendorCode = clients[0].VENDOR_CLI?.trim() || laclaeData[0]?.VENDOR_LACLAE?.trim();
        if (vendorCode) {
            const vendorSql = `
                SELECT CODIGOVENDEDOR as CODE, NOMBREVENDEDOR as NAME
                FROM DSEDAC.VDD
                WHERE CODIGOVENDEDOR = '${vendorCode}'
            `;
            const vendor = await query(vendorSql);
            if (vendor.length > 0) {
                console.log(`   Código: ${vendor[0].CODE?.trim()}`);
                console.log(`   Nombre: ${vendor[0].NAME?.trim()}`);
            }
        }

        // 4. Verificar si hay override en RUTERO_CONFIG
        console.log('\n4. OVERRIDE EN JAVIER.RUTERO_CONFIG');
        console.log('-'.repeat(40));

        try {
            const configSql = `
                SELECT VENDEDOR, DIA, ORDEN
                FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(CLIENTE) = '${exactCode}'
            `;
            const configs = await query(configSql);
            if (configs.length > 0) {
                configs.forEach(c => {
                    console.log(`   Vendedor: ${c.VENDEDOR}, Día: ${c.DIA}, Orden: ${c.ORDEN}`);
                });
            } else {
                console.log('   No hay overrides para este cliente');
            }
        } catch (e) {
            console.log('   Tabla RUTERO_CONFIG no accesible');
        }

        // 5. Verificar vendedor "ZZ" específico
        console.log('\n5. INFO VENDEDOR "ZZ" (si existe)');
        console.log('-'.repeat(40));

        const zzSql = `
            SELECT CODIGOVENDEDOR as CODE, NOMBREVENDEDOR as NAME
            FROM DSEDAC.VDD
            WHERE CODIGOVENDEDOR LIKE 'ZZ%' OR NOMBREVENDEDOR LIKE '%CAYETANO%'
            FETCH FIRST 5 ROWS ONLY
        `;
        const zzVendors = await query(zzSql);
        zzVendors.forEach(v => {
            console.log(`   ${v.CODE?.trim()}: ${v.NAME?.trim()}`);
        });

        console.log('\n' + '='.repeat(60));
        console.log('DIAGNÓSTICO COMPLETO');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Error:', error.message);
    }

    process.exit(0);
}

diagnoseClientAssignment();
