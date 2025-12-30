/**
 * Debug específico para cliente 4300008416 (CHIRINGUITO EL LIOS)
 * Run with: node debug_chiringuito_lios.js
 */
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function debug() {
    console.log('='.repeat(70));
    console.log(' DEBUG: CHIRINGUITO EL LIOS (4300008416)');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(CONNECTION_STRING);
        console.log('✓ Conectado a DB2\n');

        // 1. Get client info - simple query
        console.log('1. INFO DEL CLIENTE:');
        console.log('-'.repeat(50));
        const clientInfo = await conn.query(`
      SELECT 
        CODIGOCLIENTE,
        NOMBRECLIENTE,
        NOMBREALTERNATIVO,
        DIRECCION,
        POBLACION,
        ANOBAJA
      FROM DSEDAC.CLI
      WHERE TRIM(CODIGOCLIENTE) = '4300008416'
    `);
        if (clientInfo.length > 0) {
            const c = clientInfo[0];
            console.log(`   Código: ${c.CODIGOCLIENTE?.trim()}`);
            console.log(`   Nombre: ${c.NOMBRECLIENTE?.trim()}`);
            console.log(`   Nombre Alt: ${c.NOMBREALTERNATIVO?.trim() || 'N/A'}`);
            console.log(`   Dirección: ${c.DIRECCION?.trim()}`);
            console.log(`   Población: ${c.POBLACION?.trim()}`);
            console.log(`   Año Baja: ${c.ANOBAJA || 'ACTIVO'}`);
        } else {
            console.log('   Cliente no encontrado');
        }
        console.log();

        // 2. Check CDVI 
        console.log('2. DÍAS DE VISITA EN CDVI:');
        console.log('-'.repeat(50));
        const cdviData = await conn.query(`
      SELECT 
        CODIGOCLIENTE,
        CODIGOVENDEDOR,
        DIAVISITALUNESSN,
        DIAVISITAMARTESSN,
        DIAVISITAMIERCOLESSN,
        DIAVISITAJUEVESSN,
        DIAVISITAVIERNESSN,
        DIAVISITASABADOSN,
        DIAVISITADOMINGOSN
      FROM DSEDAC.CDVI
      WHERE TRIM(CODIGOCLIENTE) = '4300008416'
    `);

        if (cdviData.length > 0) {
            console.log(`   Registros encontrados: ${cdviData.length}`);
            cdviData.forEach((row, i) => {
                console.log(`\n   [Registro ${i + 1}]`);
                console.log(`   Vendedor en CDVI: ${row.CODIGOVENDEDOR?.trim() || 'N/A'}`);
                const dias = [];
                if (row.DIAVISITALUNESSN === 'S') dias.push('Lunes');
                if (row.DIAVISITAMARTESSN === 'S') dias.push('Martes');
                if (row.DIAVISITAMIERCOLESSN === 'S') dias.push('Miércoles');
                if (row.DIAVISITAJUEVESSN === 'S') dias.push('Jueves');
                if (row.DIAVISITAVIERNESSN === 'S') dias.push('Viernes');
                if (row.DIAVISITASABADOSN === 'S') dias.push('Sábado');
                if (row.DIAVISITADOMINGOSN === 'S') dias.push('Domingo');
                console.log(`   Días de Visita: ${dias.length > 0 ? dias.join(', ') : 'NINGUNO'}`);
                console.log(`   Raw: L=${row.DIAVISITALUNESSN} M=${row.DIAVISITAMARTESSN} X=${row.DIAVISITAMIERCOLESSN} J=${row.DIAVISITAJUEVESSN} V=${row.DIAVISITAVIERNESSN} S=${row.DIAVISITASABADOSN} D=${row.DIAVISITADOMINGOSN}`);
            });
        } else {
            console.log('   ⚠️ NO hay registros en CDVI para este cliente');
        }
        console.log();

        // 3. Check CDLO
        console.log('3. DÍAS DE REPARTO EN CDLO:');
        console.log('-'.repeat(50));
        const cdloData = await conn.query(`
      SELECT 
        CODIGOCLIENTE,
        DIAREPARTOLUNESSN,
        DIAREPARTOMARTESSN,
        DIAREPARTOMIERCOLESSN,
        DIAREPARTOJUEVESSN,
        DIAREPARTOVIERNESSN,
        DIAREPARTOSABADOSN,
        DIAREPARTODOMINGOSN
      FROM DSEDAC.CDLO
      WHERE TRIM(CODIGOCLIENTE) = '4300008416'
    `);

        if (cdloData.length > 0) {
            console.log(`   Registros encontrados: ${cdloData.length}`);
            cdloData.forEach((row, i) => {
                const dias = [];
                if (row.DIAREPARTOLUNESSN === 'S') dias.push('Lunes');
                if (row.DIAREPARTOMARTESSN === 'S') dias.push('Martes');
                if (row.DIAREPARTOMIERCOLESSN === 'S') dias.push('Miércoles');
                if (row.DIAREPARTOJUEVESSN === 'S') dias.push('Jueves');
                if (row.DIAREPARTOVIERNESSN === 'S') dias.push('Viernes');
                if (row.DIAREPARTOSABADOSN === 'S') dias.push('Sábado');
                if (row.DIAREPARTODOMINGOSN === 'S') dias.push('Domingo');
                console.log(`   Días de Reparto: ${dias.length > 0 ? dias.join(', ') : 'NINGUNO'}`);
                console.log(`   Raw: L=${row.DIAREPARTOLUNESSN} M=${row.DIAREPARTOMARTESSN} X=${row.DIAREPARTOMIERCOLESSN} J=${row.DIAREPARTOJUEVESSN} V=${row.DIAREPARTOVIERNESSN} S=${row.DIAREPARTOSABADOSN} D=${row.DIAREPARTODOMINGOSN}`);
            });
        } else {
            console.log('   ⚠️ NO hay registros en CDLO para este cliente');
        }
        console.log();

        // 4. Analyze the count discrepancy for a sample vendor
        console.log('4. ANÁLISIS DISCREPANCIA (Vendedor 93):');
        console.log('-'.repeat(50));
        const vendorTest = await conn.query(`
      SELECT 
        SUM(CASE WHEN DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) as LUNES,
        SUM(CASE WHEN DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) as MARTES,
        SUM(CASE WHEN DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
        SUM(CASE WHEN DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) as JUEVES,
        SUM(CASE WHEN DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END) as VIERNES,
        SUM(CASE WHEN DIAVISITASABADOSN = 'S' THEN 1 ELSE 0 END) as SABADO,
        SUM(CASE WHEN DIAVISITADOMINGOSN = 'S' THEN 1 ELSE 0 END) as DOMINGO,
        COUNT(DISTINCT CODIGOCLIENTE) as CLIENTES_UNICOS
      FROM DSEDAC.CDVI
      WHERE TRIM(CODIGOVENDEDOR) = '93'
    `);

        if (vendorTest.length > 0) {
            const v = vendorTest[0];
            const suma = parseInt(v.LUNES || 0) + parseInt(v.MARTES || 0) + parseInt(v.MIERCOLES || 0) +
                parseInt(v.JUEVES || 0) + parseInt(v.VIERNES || 0) + parseInt(v.SABADO || 0) + parseInt(v.DOMINGO || 0);
            console.log(`   Lunes: ${v.LUNES}, Martes: ${v.MARTES}, Miércoles: ${v.MIERCOLES}`);
            console.log(`   Jueves: ${v.JUEVES}, Viernes: ${v.VIERNES}, Sábado: ${v.SABADO}, Domingo: ${v.DOMINGO}`);
            console.log(`   ---`);
            console.log(`   SUMA TODOS LOS DÍAS: ${suma} <- Esto aparece en header rutero`);
            console.log(`   CLIENTES ÚNICOS: ${v.CLIENTES_UNICOS} <- Esto debería aparecer`);
        }

        console.log('\n' + '='.repeat(70));
        console.log(' CONCLUSIONES DEL PROBLEMA');
        console.log('='.repeat(70));
        console.log(`
   El badge del header en rutero_page.dart (línea 315) hace:
   _weekData.values.fold(0, (a, b) => a + b)
   
   Esto SUMA los valores de cada día de la semana, lo cual cuenta
   cada cliente tantas veces como días de visita tenga.
   
   Por ejemplo, si un cliente tiene visita L, M, X, J:
   - Cuenta 1 en Lunes
   - Cuenta 1 en Martes  
   - Cuenta 1 en Miércoles
   - Cuenta 1 en Jueves
   = 4 "apariciones" cuando es solo 1 cliente
   
   El fix es mostrar el total de clientes únicos, no la suma.
`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (conn) {
            await conn.close();
            console.log('\n✓ Conexión cerrada');
        }
    }
}

debug();
