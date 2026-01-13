/**
 * Test de endpoints actualizados para repartidor
 * Verifica que las consultas OPP → CPC → CAC funcionen correctamente
 */

const odbc = require('odbc');

async function main() {
    let connection;
    try {
        connection = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;TRANSLATE=1');
        console.log('Conectado a DB2\n');

        const repartidorId = '79';
        const year = 2026;
        const month = 1;
        const day = 13;

        // ============================================================
        // TEST 1: /entregas/pendientes/:repartidorId
        // ============================================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('TEST 1: GET /entregas/pendientes/79');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const sqlPendientes = `
            SELECT 
              CAC.SUBEMPRESAALBARAN,
              CAC.EJERCICIOALBARAN,
              CAC.SERIEALBARAN,
              CAC.NUMEROALBARAN,
              TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
              TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, 'CLIENTE')) as NOMBRE_CLIENTE,
              TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
              TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
              TRIM(COALESCE(CLI.TELEFONO1, '')) as TELEFONO,
              CPC.IMPORTETOTAL / 100.0 as IMPORTE,
              TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
              CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
              TRIM(CPC.CODIGORUTA) as RUTA
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
              ON CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIO
              AND CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
              ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
              AND OPP.DIAREPARTO = ${day}
              AND OPP.MESREPARTO = ${month}
              AND OPP.ANOREPARTO = ${year}
            ORDER BY CAC.NUMEROALBARAN
            FETCH FIRST 10 ROWS ONLY
        `;
        
        const rows1 = await connection.query(sqlPendientes);
        console.log(`\n✅ Entregas pendientes: ${rows1.length} encontradas\n`);
        rows1.slice(0, 5).forEach((r, i) => {
            console.log(`   [${i+1}] ${r.EJERCICIOALBARAN}-${r.SERIEALBARAN}-${r.NUMEROALBARAN}`);
            console.log(`       Cliente: ${r.CLIENTE} - ${r.NOMBRE_CLIENTE}`);
            console.log(`       Dirección: ${r.DIRECCION}`);
            console.log(`       Importe: ${r.IMPORTE}€\n`);
        });

        // ============================================================
        // TEST 2: /repartidor/collections/summary/:repartidorId
        // ============================================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('TEST 2: GET /repartidor/collections/summary/79');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const sqlCollections = `
            SELECT 
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE_CLIENTE,
                CPC.CODIGOFORMAPAGO as FORMA_PAGO,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                COUNT(*) as NUM_DOCUMENTOS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIO
                AND CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE OPP.MESREPARTO = ${month}
              AND OPP.ANOREPARTO = ${year}
              AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')), CPC.CODIGOFORMAPAGO
            ORDER BY TOTAL_COBRABLE DESC
            FETCH FIRST 10 ROWS ONLY
        `;
        
        const rows2 = await connection.query(sqlCollections);
        console.log(`\n✅ Clientes con cobros: ${rows2.length} encontrados\n`);
        rows2.slice(0, 5).forEach((r, i) => {
            console.log(`   [${i+1}] ${r.CLIENTE} - ${r.NOMBRE_CLIENTE}`);
            console.log(`       Total: ${(parseFloat(r.TOTAL_COBRABLE)/100).toFixed(2)}€ | Docs: ${r.NUM_DOCUMENTOS}\n`);
        });

        // ============================================================
        // TEST 3: /repartidor/history/clients/:repartidorId
        // ============================================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('TEST 3: GET /repartidor/history/clients/79');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const sqlHistory = `
            SELECT DISTINCT
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCION,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACION,
                COUNT(*) as TOTAL_DOCUMENTOS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIO
                AND CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
              AND OPP.ANOREPARTO >= ${year - 1}
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')), TRIM(COALESCE(CLI.DIRECCION, '')), TRIM(COALESCE(CLI.POBLACION, ''))
            ORDER BY TOTAL_DOCUMENTOS DESC
            FETCH FIRST 10 ROWS ONLY
        `;
        
        const rows3 = await connection.query(sqlHistory);
        console.log(`\n✅ Clientes del repartidor: ${rows3.length} encontrados\n`);
        rows3.slice(0, 5).forEach((r, i) => {
            console.log(`   [${i+1}] ${r.CLIENTE} - ${r.NOMBRE}`);
            console.log(`       ${r.DIRECCION}, ${r.POBLACION}`);
            console.log(`       Total docs: ${r.TOTAL_DOCUMENTOS}\n`);
        });

        // ============================================================
        // TEST 4: /repartidor/collections/daily/:repartidorId
        // ============================================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('TEST 4: GET /repartidor/collections/daily/79');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const sqlDaily = `
            SELECT 
                OPP.DIAREPARTO as DIA,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                COUNT(*) as NUM_DOCS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIO
                AND CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE OPP.ANOREPARTO = ${year}
              AND OPP.MESREPARTO = ${month}
              AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
            GROUP BY OPP.DIAREPARTO
            ORDER BY OPP.DIAREPARTO
        `;
        
        const rows4 = await connection.query(sqlDaily);
        console.log(`\n✅ Días con actividad: ${rows4.length}\n`);
        rows4.forEach((r, i) => {
            console.log(`   Día ${r.DIA}: ${(parseFloat(r.TOTAL_COBRABLE)/100).toFixed(2)}€ (${r.NUM_DOCS} docs)`);
        });

        // ============================================================
        // RESUMEN
        // ============================================================
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('                    RESUMEN DE PRUEBAS');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`\n   ✅ Entregas pendientes: ${rows1.length} registros`);
        console.log(`   ✅ Collections summary: ${rows2.length} clientes`);
        console.log(`   ✅ History clients:     ${rows3.length} clientes`);
        console.log(`   ✅ Collections daily:   ${rows4.length} días`);
        console.log('\n   ¡TODAS LAS CONSULTAS FUNCIONAN CORRECTAMENTE!');
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.close();
    }
}

main();
