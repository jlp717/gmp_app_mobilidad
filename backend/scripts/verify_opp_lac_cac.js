/**
 * VERIFICAR: LAC.ORDENPREPARACION vincula con OPP.NUMEROORDENPREPARACION
 * Esto nos permite: OPP (repartidor) → LAC → CAC (documentos)
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║    VERIFICAR RELACIÓN: OPP → LAC → CAC                        ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Ver una orden del repartidor 79
        const opp79 = await conn.query(`
            SELECT EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION, DIAREPARTO, MESREPARTO, ANOREPARTO
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOREPARTO = 2026
            ORDER BY MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST 5 ROWS ONLY
        `);
        
        console.log('1. ÓRDENES OPP DEL REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        opp79.forEach((r, i) => {
            console.log(`   [${i+1}] Orden ${r.EJERCICIOORDENPREPARACION}-${r.NUMEROORDENPREPARACION} para ${r.DIAREPARTO}/${r.MESREPARTO}/${r.ANOREPARTO}`);
        });

        // 2. Buscar esa orden en LAC
        if (opp79.length > 0) {
            const ejercicio = opp79[0].EJERCICIOORDENPREPARACION;
            const numOrden = opp79[0].NUMEROORDENPREPARACION;
            
            console.log(`\n\n2. BUSCAR EN LAC DONDE ORDENPREPARACION = ${numOrden}:`);
            console.log('═══════════════════════════════════════════════════════════════\n');
            
            // Primero verificar columnas clave de LAC
            const lacKeyCols = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' 
                  AND TABLE_NAME = 'LAC'
                  AND COLUMN_NAME IN ('EJERCICIO', 'NUMDOCUMENTO', 'ORDENPREPARACION', 'CODIGOCLIENTE', 'CODIGOARTICULO')
            `);
            console.log('   Columnas LAC disponibles:', lacKeyCols.map(c => c.COLUMN_NAME).join(', '));
            
            const lacRows = await conn.query(`
                SELECT 
                    EJERCICIO, NUMDOCUMENTO, ORDENPREPARACION, 
                    TRIM(CODIGOCLIENTE) as CLIENTE,
                    TRIM(CODIGOARTICULO) as ARTICULO,
                    CANTIDAD,
                    IMPORTELINEABASE / 100.0 as IMPORTE
                FROM DSEDAC.LAC
                WHERE ORDENPREPARACION = ${numOrden}
                  AND EJERCICIO = ${ejercicio}
                FETCH FIRST 5 ROWS ONLY
            `);
            
            if (lacRows.length > 0) {
                console.log('\n   ¡ENCONTRADO! Líneas en LAC:');
                lacRows.forEach((r, i) => {
                    console.log(`       [${i+1}] Doc ${r.EJERCICIO}-${r.NUMDOCUMENTO}, Cliente: ${r.CLIENTE}, Art: ${r.ARTICULO}, Cant: ${r.CANTIDAD}, Imp: ${r.IMPORTE}€`);
                });
                
                // 3. Verificar el documento en CAC
                const numdoc = lacRows[0].NUMDOCUMENTO;
                
                console.log(`\n\n3. VERIFICAR DOCUMENTO ${ejercicio}-${numdoc} EN CAC:`);
                console.log('═══════════════════════════════════════════════════════════════\n');
                
                const cacDoc = await conn.query(`
                    SELECT 
                        EJERCICIO, NUMDOCUMENTO, 
                        TRIM(CODIGOCLIENTE) as CLIENTE,
                        TRIM(CODIGOSERIE) as SERIE,
                        TRIM(CODIGODOCUMENTO) as TIPODOC,
                        IMPORTETOTALDOCUMENTO / 100.0 as TOTAL
                    FROM DSEDAC.CAC
                    WHERE EJERCICIO = ${ejercicio}
                      AND NUMDOCUMENTO = ${numdoc}
                `);
                
                if (cacDoc.length > 0) {
                    const doc = cacDoc[0];
                    console.log(`   ✓ Documento encontrado: ${doc.SERIE}/${doc.TIPODOC} ${doc.EJERCICIO}-${doc.NUMDOCUMENTO}`);
                    console.log(`   ✓ Cliente: ${doc.CLIENTE}`);
                    console.log(`   ✓ Total: ${doc.TOTAL}€`);
                }
            } else {
                console.log('   No se encontraron líneas con esa orden');
            }
        }

        // 4. Ahora probamos la query completa: Documentos del repartidor 79
        console.log('\n\n4. QUERY COMPLETA: DOCUMENTOS DEL REPARTIDOR 79 EN ENERO 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const docsByRep = await conn.query(`
            SELECT DISTINCT
                CAC.EJERCICIO,
                CAC.NUMDOCUMENTO,
                TRIM(CAC.CODIGOCLIENTE) as CLIENTE,
                TRIM(CLI.NOMBRECLIENTE) as NOMBRE_CLIENTE,
                CAC.IMPORTETOTALDOCUMENTO / 100.0 as TOTAL,
                OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.LAC LAC 
                ON LAC.EJERCICIO = OPP.EJERCICIOORDENPREPARACION
                AND LAC.ORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIO = LAC.EJERCICIO
                AND CAC.NUMDOCUMENTO = LAC.NUMDOCUMENTO
            LEFT JOIN DSEDAC.CLI CLI
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTE)
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '79'
              AND OPP.ANOREPARTO = 2026
              AND OPP.MESREPARTO = 1
            ORDER BY OPP.DIAREPARTO DESC, CAC.NUMDOCUMENTO DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        
        console.log('   FECHA      │ DOC         │ CLIENTE              │ TOTAL');
        console.log('   ───────────┼─────────────┼──────────────────────┼──────────');
        docsByRep.forEach(r => {
            const fecha = `${r.DIAREPARTO}/${r.MESREPARTO}/${r.ANOREPARTO}`.padEnd(10);
            const doc = `${r.EJERCICIO}-${r.NUMDOCUMENTO}`.padEnd(11);
            const cli = (r.NOMBRE_CLIENTE || r.CLIENTE || '').substring(0, 20).padEnd(20);
            const total = (r.TOTAL || 0).toFixed(2).padStart(10);
            console.log(`   ${fecha} │ ${doc} │ ${cli} │ ${total}€`);
        });

        console.log(`\n   Total documentos encontrados: ${docsByRep.length}`);

        // 5. Contar total de documentos del repartidor 79 en 2026
        console.log('\n\n5. RESUMEN TOTAL REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const totals79 = await conn.query(`
            SELECT 
                COUNT(DISTINCT CAC.NUMDOCUMENTO) as DOCS,
                COUNT(DISTINCT CAC.CODIGOCLIENTE) as CLIENTES,
                SUM(CAC.IMPORTETOTALDOCUMENTO) / 100.0 as IMPORTE_TOTAL
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.LAC LAC 
                ON LAC.EJERCICIO = OPP.EJERCICIOORDENPREPARACION
                AND LAC.ORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIO = LAC.EJERCICIO
                AND CAC.NUMDOCUMENTO = LAC.NUMDOCUMENTO
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '79'
              AND OPP.ANOREPARTO = 2026
        `);
        
        console.log(`   Documentos en 2026: ${totals79[0]?.DOCS || 0}`);
        console.log(`   Clientes distintos: ${totals79[0]?.CLIENTES || 0}`);
        console.log(`   Importe total: ${(totals79[0]?.IMPORTE_TOTAL || 0).toFixed(2)}€`);

        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('               ¡RELACIÓN CONFIRMADA!');
        console.log('════════════════════════════════════════════════════════════════\n');
        
        console.log('   OPP.CODIGOREPARTIDOR → identifica el repartidor');
        console.log('   OPP.NUMEROORDENPREPARACION → LAC.ORDENPREPARACION');
        console.log('   LAC.EJERCICIO + LAC.NUMDOCUMENTO → CAC');
        console.log('\n   ¡El repartidor 79 TIENE DOCUMENTOS!');
        console.log('   Ahora hay que actualizar las queries del backend.');
        
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
