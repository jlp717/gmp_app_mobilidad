/**
 * Debug rutero for client 8416 (CHIRINGUITO EL LIOS)
 * Check visit days (CDVI) and delivery days (CDLO)
 * Run with: node debug_client_8416_rutero.js
 */
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function debugClient8416() {
    console.log('='.repeat(70));
    console.log(' DEBUG RUTERO: Cliente 8416 (CHIRINGUITO EL LIOS)');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(CONNECTION_STRING);
        console.log('✓ Conectado a DB2\n');

        // 1. Search for CHIRINGUITO EL LIOS by name
        console.log('1. BUSCANDO CLIENTE "CHIRINGUITO EL LIOS":');
        console.log('-'.repeat(50));
        const searchByName = await conn.query(`
      SELECT 
        C.CODIGOCLIENTE as CODIGO,
        TRIM(COALESCE(C.NOMBREALTERNATIVO, C.NOMBRECLIENTE)) as NOMBRE,
        C.DIRECCION,
        C.POBLACION,
        C.ANOBAJA
      FROM DSEDAC.CLI C 
      WHERE UPPER(TRIM(C.NOMBRECLIENTE)) LIKE '%CHIRINGUITO%'
         OR UPPER(TRIM(C.NOMBREALTERNATIVO)) LIKE '%CHIRINGUITO%'
      FETCH FIRST 10 ROWS ONLY
    `);
        if (searchByName.length > 0) {
            console.log(`   Encontrados ${searchByName.length} clientes con "CHIRINGUITO":`);
            searchByName.forEach(c => {
                console.log(`   - ${c.CODIGO?.trim()}: ${c.NOMBRE?.trim()} (${c.POBLACION?.trim() || 'sin población'}) - Baja: ${c.ANOBAJA || 'ACTIVO'}`);
            });
        } else {
            console.log('   ⚠️ No se encontraron clientes con nombre CHIRINGUITO');
        }
        console.log();

        // 2. Search for client with code starting/containing 8416
        console.log('2. BUSCANDO CLIENTES CON CÓDIGO COMO "8416":');
        console.log('-'.repeat(50));
        const searchByCode = await conn.query(`
      SELECT 
        C.CODIGOCLIENTE as CODIGO,
        TRIM(COALESCE(C.NOMBREALTERNATIVO, C.NOMBRECLIENTE)) as NOMBRE,
        C.DIRECCION,
        C.POBLACION,
        C.ANOBAJA
      FROM DSEDAC.CLI C 
      WHERE TRIM(C.CODIGOCLIENTE) LIKE '%8416%'
      FETCH FIRST 10 ROWS ONLY
    `);
        if (searchByCode.length > 0) {
            console.log(`   Encontrados ${searchByCode.length} clientes con código "8416":`);
            searchByCode.forEach(c => {
                console.log(`   - ${c.CODIGO?.trim()}: ${c.NOMBRE?.trim()} (${c.POBLACION?.trim() || 'sin población'})`);
            });
        } else {
            console.log('   ⚠️ No se encontraron clientes con código 8416');
        }
        console.log();

        // 3. Total counts from CDVI
        console.log('3. CONTEO TOTAL CDVI (DÍAS DE VISITA):');
        console.log('-'.repeat(50));
        const visitCounts = await conn.query(`
      SELECT 
        SUM(CASE WHEN DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) as LUNES,
        SUM(CASE WHEN DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) as MARTES,
        SUM(CASE WHEN DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
        SUM(CASE WHEN DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) as JUEVES,
        SUM(CASE WHEN DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END) as VIERNES,
        SUM(CASE WHEN DIAVISITASABADOSN = 'S' THEN 1 ELSE 0 END) as SABADO,
        SUM(CASE WHEN DIAVISITADOMINGOSN = 'S' THEN 1 ELSE 0 END) as DOMINGO,
        COUNT(DISTINCT CODIGOCLIENTE) as TOTAL_CLIENTES
      FROM DSEDAC.CDVI
    `);
        if (visitCounts.length > 0) {
            const vc = visitCounts[0];
            console.log(`   Lunes: ${vc.LUNES}`);
            console.log(`   Martes: ${vc.MARTES}`);
            console.log(`   Miércoles: ${vc.MIERCOLES}`);
            console.log(`   Jueves: ${vc.JUEVES}`);
            console.log(`   Viernes: ${vc.VIERNES}`);
            console.log(`   Sábado: ${vc.SABADO}`);
            console.log(`   Domingo: ${vc.DOMINGO}`);
            console.log(`   TOTAL CLIENTES ÚNICOS: ${vc.TOTAL_CLIENTES}`);
            const suma = parseInt(vc.LUNES) + parseInt(vc.MARTES) + parseInt(vc.MIERCOLES) +
                parseInt(vc.JUEVES) + parseInt(vc.VIERNES) + parseInt(vc.SABADO) + parseInt(vc.DOMINGO);
            console.log(`   SUMA TODOS LOS DÍAS (citas totales): ${suma}`);
            console.log(`\n   EXPLICACIÓN: La suma ${suma} cuenta cada cliente múltiples veces si tiene varios días de visita.`);
            console.log(`   Por ejemplo: si un cliente se visita L y M, cuenta 2 veces (1 en Lunes + 1 en Martes).`);
        }
        console.log();

        // 4. List all vendors in CDVI with counts
        console.log('4. VENDEDORES EN CDVI CON SUS CONTEOS:');
        console.log('-'.repeat(50));
        const allVendors = await conn.query(`
      SELECT 
        CODIGOVENDEDOR as VENDEDOR, 
        COUNT(DISTINCT CODIGOCLIENTE) as CLIENTES,
        SUM(CASE WHEN DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) as L,
        SUM(CASE WHEN DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) as M,
        SUM(CASE WHEN DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) as X,
        SUM(CASE WHEN DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) as J,
        SUM(CASE WHEN DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END) as V
      FROM DSEDAC.CDVI
      GROUP BY CODIGOVENDEDOR
      ORDER BY CLIENTES DESC
    `);
        console.log(`   Vendedores encontrados: ${allVendors.length}`);
        allVendors.forEach(v => {
            const total = parseInt(v.L || 0) + parseInt(v.M || 0) + parseInt(v.X || 0) + parseInt(v.J || 0) + parseInt(v.V || 0);
            console.log(`   - ${(v.VENDEDOR?.trim() || 'N/A').padEnd(15)}: ${String(v.CLIENTES).padStart(3)} clientes, Total citas: ${total} (L:${v.L} M:${v.M} X:${v.X} J:${v.J} V:${v.V})`);
        });
        console.log();

        // 5. Check CDVI for example clients with multiple days
        console.log('5. EJEMPLO DE CLIENTES CON MÚLTIPLES DÍAS DE VISITA:');
        console.log('-'.repeat(50));
        const multiDayClients = await conn.query(`
      SELECT 
        V.CODIGOCLIENTE as CODIGO,
        TRIM(COALESCE(C.NOMBREALTERNATIVO, C.NOMBRECLIENTE)) as NOMBRE,
        V.CODIGOVENDEDOR as VENDEDOR,
        V.DIAVISITALUNESSN as L,
        V.DIAVISITAMARTESSN as M,
        V.DIAVISITAMIERCOLESSN as X,
        V.DIAVISITAJUEVESSN as J,
        V.DIAVISITAVIERNESSN as V
      FROM DSEDAC.CDVI V
      LEFT JOIN DSEDAC.CLI C ON V.CODIGOCLIENTE = C.CODIGOCLIENTE
      WHERE (
        (CASE WHEN V.DIAVISITALUNESSN = 'S' THEN 1 ELSE 0 END) +
        (CASE WHEN V.DIAVISITAMARTESSN = 'S' THEN 1 ELSE 0 END) +
        (CASE WHEN V.DIAVISITAMIERCOLESSN = 'S' THEN 1 ELSE 0 END) +
        (CASE WHEN V.DIAVISITAJUEVESSN = 'S' THEN 1 ELSE 0 END) +
        (CASE WHEN V.DIAVISITAVIERNESSN = 'S' THEN 1 ELSE 0 END)
      ) > 2
      FETCH FIRST 10 ROWS ONLY
    `);
        if (multiDayClients.length > 0) {
            console.log(`   Clientes con más de 2 días de visita:`);
            multiDayClients.forEach(c => {
                const dias = [];
                if (c.L === 'S') dias.push('L');
                if (c.M === 'S') dias.push('M');
                if (c.X === 'S') dias.push('X');
                if (c.J === 'S') dias.push('J');
                if (c.V === 'S') dias.push('V');
                console.log(`   - ${c.CODIGO?.trim()}: ${c.NOMBRE?.trim()?.substring(0, 30)} - Días: ${dias.join(', ')} (${c.VENDEDOR?.trim()})`);
            });
        } else {
            console.log('   No se encontraron clientes con múltiples días de visita');
        }
        console.log();

        // 6. Check count of active clients in CLI
        console.log('6. CLIENTES ACTIVOS EN CLI (filtro pestaña Clientes):');
        console.log('-'.repeat(50));
        const activeClientsCount = await conn.query(`
      SELECT COUNT(*) as TOTAL
      FROM DSEDAC.CLI
      WHERE ANOBAJA = 0 OR ANOBAJA IS NULL
    `);
        const totalClientsCount = await conn.query(`
      SELECT COUNT(*) as TOTAL FROM DSEDAC.CLI
    `);
        console.log(`   Clientes ACTIVOS: ${activeClientsCount[0]?.TOTAL}`);
        console.log(`   Clientes TOTALES: ${totalClientsCount[0]?.TOTAL}`);

        console.log('\n' + '='.repeat(70));
        console.log(' ANÁLISIS COMPLETADO');
        console.log('='.repeat(70));

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

debugClient8416();
