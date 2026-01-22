/**
 * Script de diagnóstico para clientes faltantes en el rutero comercial
 * Uso: node backend/scripts/diagnose_rutero_client.js <código_cliente> [código_vendedor]
 */

const { query, initPool, closePool } = require('../config/db');

async function diagnoseClient() {
    const clientCode = process.argv[2];
    const vendorCode = process.argv[3];

    if (!clientCode) {
        console.log('❌ Uso: node diagnose_rutero_client.js <código_cliente> [código_vendedor]');
        console.log('   Ejemplo: node diagnose_rutero_client.js 000123 01');
        process.exit(1);
    }

    console.log('='.repeat(70));
    console.log(`🔍 DIAGNÓSTICO DE CLIENTE EN RUTERO: ${clientCode}`);
    if (vendorCode) console.log(`   Vendedor especificado: ${vendorCode}`);
    console.log('='.repeat(70));

    try {
        await initPool();

        // 1. Verificar si el cliente existe en la tabla CLI
        console.log('\n📋 1. DATOS BÁSICOS DEL CLIENTE (DSEDAC.CLI)');
        console.log('-'.repeat(50));
        const clientData = await query(`
            SELECT 
                CODIGOCLIENTE, 
                NOMBRECLIENTE, 
                POBLACION,
                CODIGOVENDEDOR,
                CODIGOVENDEDOR2
            FROM DSEDAC.CLI 
            WHERE CODIGOCLIENTE = '${clientCode.padStart(6, '0')}'
            FETCH FIRST 1 ROW ONLY
        `);

        if (clientData.length === 0) {
            console.log(`   ❌ Cliente ${clientCode} NO ENCONTRADO en DSEDAC.CLI`);
        } else {
            const c = clientData[0];
            console.log(`   ✅ Cliente encontrado:`);
            console.log(`      Código: ${c.CODIGOCLIENTE}`);
            console.log(`      Nombre: ${c.NOMBRECLIENTE}`);
            console.log(`      Población: ${c.POBLACION}`);
            console.log(`      Vendedor Principal: ${c.CODIGOVENDEDOR}`);
            console.log(`      Vendedor Secundario: ${c.CODIGOVENDEDOR2 || 'N/A'}`);
        }

        // 2. Verificar presencia en LACLAE
        console.log('\n📋 2. REGISTROS EN DSED.LACLAE (Ventas/Historial)');
        console.log('-'.repeat(50));
        const currentYear = new Date().getFullYear();
        const laclaeCheck = await query(`
            SELECT 
                LCAADC as AÑO,
                COUNT(*) as REGISTROS,
                MIN(LCMMDC) as PRIMER_MES,
                MAX(LCMMDC) as ULTIMO_MES,
                R1_T8CDVD as VENDEDOR_RUTERO
            FROM DSED.LACLAE
            WHERE TRIM(LCCDCL) = '${clientCode.padStart(6, '0')}'
            GROUP BY LCAADC, R1_T8CDVD
            ORDER BY LCAADC DESC
            FETCH FIRST 10 ROWS ONLY
        `);

        if (laclaeCheck.length === 0) {
            console.log(`   ⚠️ Cliente ${clientCode} NO TIENE REGISTROS en DSED.LACLAE`);
            console.log(`   👉 CAUSA PROBABLE: Es un cliente NUEVO sin ventas registradas`);
            console.log(`   👉 Los días de visita se obtienen de LACLAE, sin registros no aparecerá en rutero`);
        } else {
            console.log(`   ✅ Cliente tiene ${laclaeCheck.length} años de registros:`);
            laclaeCheck.forEach(r => {
                console.log(`      Año ${r.AÑO}: ${r.REGISTROS} registros (meses ${r.PRIMER_MES}-${r.ULTIMO_MES}), Vendedor: ${r.VENDEDOR_RUTERO}`);
            });
        }

        // 3. Verificar campos de días de visita/reparto en LACLAE
        console.log('\n📋 3. DÍAS DE VISITA/REPARTO EN LACLAE');
        console.log('-'.repeat(50));
        const daysCheck = await query(`
            SELECT DISTINCT
                R1_T8CDVD as VENDEDOR,
                R1_T8DIVL as VIS_LUNES,
                R1_T8DIVM as VIS_MARTES,
                R1_T8DIVX as VIS_MIERCOLES,
                R1_T8DIVJ as VIS_JUEVES,
                R1_T8DIVV as VIS_VIERNES,
                R1_T8DIVS as VIS_SABADO,
                R1_T8DIVD as VIS_DOMINGO,
                R1_T8DIRL as DEL_LUNES,
                R1_T8DIRM as DEL_MARTES,
                R1_T8DIRX as DEL_MIERCOLES,
                R1_T8DIRJ as DEL_JUEVES,
                R1_T8DIRV as DEL_VIERNES,
                R1_T8DIRS as DEL_SABADO,
                R1_T8DIRD as DEL_DOMINGO
            FROM DSED.LACLAE
            WHERE TRIM(LCCDCL) = '${clientCode.padStart(6, '0')}'
              ${vendorCode ? `AND TRIM(R1_T8CDVD) = '${vendorCode}'` : ''}
            FETCH FIRST 5 ROWS ONLY
        `);

        if (daysCheck.length === 0) {
            console.log(`   ⚠️ No hay datos de días de visita/reparto para este cliente`);
        } else {
            daysCheck.forEach(r => {
                const visitDays = [];
                if (r.VIS_LUNES === 'S') visitDays.push('L');
                if (r.VIS_MARTES === 'S') visitDays.push('M');
                if (r.VIS_MIERCOLES === 'S') visitDays.push('X');
                if (r.VIS_JUEVES === 'S') visitDays.push('J');
                if (r.VIS_VIERNES === 'S') visitDays.push('V');
                if (r.VIS_SABADO === 'S') visitDays.push('S');
                if (r.VIS_DOMINGO === 'S') visitDays.push('D');

                const deliveryDays = [];
                if (r.DEL_LUNES === 'S') deliveryDays.push('L');
                if (r.DEL_MARTES === 'S') deliveryDays.push('M');
                if (r.DEL_MIERCOLES === 'S') deliveryDays.push('X');
                if (r.DEL_JUEVES === 'S') deliveryDays.push('J');
                if (r.DEL_VIERNES === 'S') deliveryDays.push('V');
                if (r.DEL_SABADO === 'S') deliveryDays.push('S');
                if (r.DEL_DOMINGO === 'S') deliveryDays.push('D');

                console.log(`   Vendedor: ${r.VENDEDOR}`);
                console.log(`      Días de VISITA:  ${visitDays.length > 0 ? visitDays.join('') : 'NINGUNO'}`);
                console.log(`      Días de REPARTO: ${deliveryDays.length > 0 ? deliveryDays.join('') : 'NINGUNO'}`);
            });
        }

        // 4. Verificar si está en RUTERO_CONFIG (override manual)
        console.log('\n📋 4. CONFIGURACIÓN MANUAL (JAVIER.RUTERO_CONFIG)');
        console.log('-'.repeat(50));
        try {
            const configCheck = await query(`
                SELECT VENDEDOR, DIA, ORDEN
                FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(CLIENTE) = '${clientCode.padStart(6, '0')}'
                   OR TRIM(CLIENTE) = '${clientCode}'
            `);

            if (configCheck.length === 0) {
                console.log(`   ⚠️ Cliente NO tiene override en RUTERO_CONFIG`);
            } else {
                console.log(`   ✅ Cliente tiene configuración manual:`);
                configCheck.forEach(r => {
                    console.log(`      Vendedor ${r.VENDEDOR}: ${r.DIA.toUpperCase()} (orden: ${r.ORDEN})`);
                });
            }
        } catch (e) {
            console.log(`   ⚠️ Tabla JAVIER.RUTERO_CONFIG no accesible: ${e.message}`);
        }

        // 5. Resumen y recomendación
        console.log('\n' + '='.repeat(70));
        console.log('📊 RESUMEN Y RECOMENDACIÓN');
        console.log('='.repeat(70));

        if (laclaeCheck.length === 0) {
            console.log(`
🔴 PROBLEMA IDENTIFICADO:
   El cliente ${clientCode} es NUEVO y no tiene registros en DSED.LACLAE.
   
   Los campos R1_T8DIV* (días de visita) y R1_T8DIR* (días de reparto)
   se almacenan en la tabla LACLAE, por lo que si un cliente no tiene
   ningún registro de ventas, no aparecerá en el rutero.

📋 SOLUCIONES POSIBLES:
   1. Esperar a que el cliente tenga su primera venta registrada
   2. Crear un registro manual en una tabla auxiliar de rutero
   3. Consultar directamente la tabla CLICAB o CLI donde se defina
      el día de visita del cliente (si existe tal tabla)`);
        } else if (daysCheck.length > 0 && daysCheck[0].VIS_VIERNES !== 'S') {
            console.log(`
🟡 OBSERVACIÓN:
   El cliente existe en LACLAE pero no tiene marcado el VIERNES como día de visita.
   
   Verifique si el programa anterior usa una tabla diferente para el rutero
   o si los campos R1_T8DIV* no están actualizados.`);
        } else {
            console.log(`
🟢 El cliente DEBERÍA aparecer en el rutero.
   Si no aparece, verifique:
   - Que la caché del servidor esté actualizada (reiniciar backend)
   - Que el vendedor sea correcto
   - Filtros aplicados en la app`);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await closePool();
    }
}

diagnoseClient().catch(console.error);
