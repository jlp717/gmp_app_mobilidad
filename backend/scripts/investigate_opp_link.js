/**
 * Investigar estructura OPP y cómo vincula con documentos
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        const conn = await odbc.connect(DB_CONFIG);
        
        // 1. Estructura OPP
        console.log('1. ESTRUCTURA COMPLETA DE OPP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            ORDER BY ORDINAL_POSITION
        `);
        
        oppCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample OPP para repartidor 79
        console.log('\n\n2. SAMPLE OPP REPARTIDOR 79 (2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opp79 = await conn.query(`
            SELECT * FROM DSEDAC.OPP
            WHERE CODIGOREPARTIDOR = '79' AND ANOREPARTO = 2026
            ORDER BY MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST 2 ROWS ONLY
        `);
        
        if (opp79.length > 0) {
            opp79.forEach((row, i) => {
                console.log(`   [${i+1}]:`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== 0 && String(v).trim() !== '' && v !== 0.0) {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        }

        // 3. Buscar tabla OPL (líneas de orden de preparación)
        console.log('\n\n3. BUSCAR TABLAS OP* (Órdenes Preparación):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opTables = await conn.query(`
            SELECT DISTINCT TABLE_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE 'OP%'
            ORDER BY TABLE_NAME
        `);
        
        opTables.forEach(t => console.log(`   ${t.TABLE_NAME}`));

        // 4. Ver OPL si existe
        console.log('\n\n4. ESTRUCTURA OPL (SI EXISTE):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oplExists = await conn.query(`
            SELECT COUNT(*) as EXISTE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPL'
        `);
        
        if (oplExists[0].EXISTE > 0) {
            const oplCols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPL'
                ORDER BY ORDINAL_POSITION
            `);
            oplCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } else {
            console.log('   OPL no existe');
        }

        // 5. Buscar columnas en LAC/LACLAE relacionadas con orden preparación
        console.log('\n\n5. ORDENPREPARACION EN LAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Ver si LAC tiene ORDENPREPARACION
        const lacOrden = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'LAC'
              AND COLUMN_NAME LIKE '%ORDEN%'
        `);
        
        lacOrden.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // Sample de LAC con ORDENPREPARACION
        console.log('\n   Sample LAC con ORDENPREPARACION:');
        const lacSample = await conn.query(`
            SELECT 
                SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, NUMEROALBARAN,
                ORDENPREPARACION, CODIGOCLIENTEALBARAN
            FROM DSEDAC.LAC
            WHERE ORDENPREPARACION > 0
            FETCH FIRST 5 ROWS ONLY
        `);
        
        if (lacSample.length > 0) {
            lacSample.forEach((r, i) => {
                console.log(`   [${i+1}] Albaran ${r.EJERCICIOALBARAN}-${r.SERIEALBARAN}-${r.NUMEROALBARAN}, OrdenPrep: ${r.ORDENPREPARACION}, Cliente: ${r.CODIGOCLIENTEALBARAN}`);
            });
        } else {
            console.log('   No hay registros LAC con ORDENPREPARACION > 0');
        }

        // 6. Verificar cuántos LAC tienen ORDENPREPARACION
        console.log('\n\n6. ESTADÍSTICAS LAC.ORDENPREPARACION:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacStats = await conn.query(`
            SELECT 
                COUNT(*) as TOTAL,
                COUNT(CASE WHEN ORDENPREPARACION > 0 THEN 1 END) as CON_ORDEN,
                MAX(ORDENPREPARACION) as MAX_ORDEN
            FROM DSEDAC.LAC
        `);
        
        console.log(`   Total líneas LAC: ${lacStats[0]?.TOTAL}`);
        console.log(`   Con ORDENPREPARACION > 0: ${lacStats[0]?.CON_ORDEN}`);
        console.log(`   Máximo ORDENPREPARACION: ${lacStats[0]?.MAX_ORDEN}`);

        // 7. Verificar si órdenes de OPP (repartidor 79) están en LAC
        console.log('\n\n7. VINCULAR OPP (79) CON LAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        if (opp79.length > 0) {
            const ordenPrep = opp79[0].NUMEROORDENPREPARACION;
            const ejOrden = opp79[0].EJERCICIOORDENPREPARACION;
            
            console.log(`   Buscando ORDENPREPARACION = ${ordenPrep} en LAC...`);
            
            const lacMatch = await conn.query(`
                SELECT 
                    SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, NUMEROALBARAN,
                    ORDENPREPARACION, CODIGOCLIENTEALBARAN
                FROM DSEDAC.LAC
                WHERE ORDENPREPARACION = ${ordenPrep}
                FETCH FIRST 5 ROWS ONLY
            `);
            
            if (lacMatch.length > 0) {
                console.log('   ¡ENCONTRADO!');
                lacMatch.forEach((r, i) => {
                    console.log(`   [${i+1}] Albaran ${r.EJERCICIOALBARAN}-${r.SERIEALBARAN}-${r.NUMEROALBARAN}, Cliente: ${r.CODIGOCLIENTEALBARAN}`);
                });
                
                // Ahora vincular con CAC
                const alb = lacMatch[0];
                console.log(`\n   Buscando albaran ${alb.EJERCICIOALBARAN}-${alb.SERIEALBARAN}-${alb.NUMEROALBARAN} en CAC...`);
                
                const cacMatch = await conn.query(`
                    SELECT 
                        EJERCICIOALBARAN, SERIEALBARAN, NUMEROALBARAN,
                        CODIGOCLIENTEALBARAN, IMPORTETOTAL / 100.0 as TOTAL,
                        DIADOCUMENTO, MESDOCUMENTO
                    FROM DSEDAC.CAC
                    WHERE EJERCICIOALBARAN = ${alb.EJERCICIOALBARAN}
                      AND SERIEALBARAN = '${alb.SERIEALBARAN}'
                      AND NUMEROALBARAN = ${alb.NUMEROALBARAN}
                `);
                
                if (cacMatch.length > 0) {
                    console.log('   ¡DOCUMENTO CAC ENCONTRADO!');
                    const doc = cacMatch[0];
                    console.log(`   Albaran: ${doc.EJERCICIOALBARAN}-${doc.SERIEALBARAN}-${doc.NUMEROALBARAN}`);
                    console.log(`   Cliente: ${doc.CODIGOCLIENTEALBARAN}`);
                    console.log(`   Fecha: ${doc.DIADOCUMENTO}/${doc.MESDOCUMENTO}`);
                    console.log(`   Total: ${doc.TOTAL}€`);
                }
            } else {
                console.log('   No se encontró en LAC');
            }
        }

        await conn.close();
        
        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                         CONCLUSIÓN');
        console.log('════════════════════════════════════════════════════════════════\n');
        console.log('   La cadena de vinculación es:');
        console.log('   OPP.NUMEROORDENPREPARACION → LAC.ORDENPREPARACION');
        console.log('   LAC → CAC (por EJERCICIOALBARAN, SERIEALBARAN, NUMEROALBARAN)');
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
