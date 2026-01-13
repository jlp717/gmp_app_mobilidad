/**
 * LACLAE es la tabla de líneas de albarán extendida
 * Buscar cómo vincular con OPP
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        const conn = await odbc.connect(DB_CONFIG);
        
        // 1. Estructura LACLAE
        console.log('1. ESTRUCTURA DE LACLAE (primeras 50 columnas):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const laclaeCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LACLAE'
            ORDER BY ORDINAL_POSITION
            FETCH FIRST 50 ROWS ONLY
        `);
        
        laclaeCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Buscar columnas de LACLAE relacionadas con orden preparación
        console.log('\n\n2. COLUMNAS LACLAE CON ORDEN/PREPARACION:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const laclaeOrden = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LACLAE'
            AND (COLUMN_NAME LIKE '%ORDEN%' OR COLUMN_NAME LIKE '%PREP%')
        `);
        
        laclaeOrden.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 3. Sample de LACLAE de 2026
        console.log('\n\n3. SAMPLE LACLAE 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const laclaeSample = await conn.query(`
            SELECT * FROM DSEDAC.LACLAE
            WHERE EJERCICIOALBARAN = 2026
            FETCH FIRST 1 ROWS ONLY
        `);
        
        if (laclaeSample.length > 0) {
            const row = laclaeSample[0];
            Object.entries(row).forEach(([k, v]) => {
                if (v !== null && v !== 0 && String(v).trim() !== '' && v !== 0.0) {
                    console.log(`   ${k}: ${v}`);
                }
            });
        }

        // 4. Ya que LAC no tiene ORDENPREPARACION poblado, buscar otra vinculación
        // Quizás OPP se vincula por CODIGOVEHICULO o por fecha de reparto
        console.log('\n\n4. ALTERNATIVA: VINCULAR POR FECHA DE REPARTO:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Obtener una orden del repartidor 79
        const opp79 = await conn.query(`
            SELECT EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION, DIAREPARTO, MESREPARTO, ANOREPARTO, CODIGOVEHICULO
            FROM DSEDAC.OPP
            WHERE CODIGOREPARTIDOR = '79' AND ANOREPARTO = 2026
            ORDER BY MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST 1 ROWS ONLY
        `);
        
        if (opp79.length > 0) {
            const orden = opp79[0];
            console.log(`   Orden: ${orden.EJERCICIOORDENPREPARACION}-${orden.NUMEROORDENPREPARACION}`);
            console.log(`   Fecha reparto: ${orden.DIAREPARTO}/${orden.MESREPARTO}/${orden.ANOREPARTO}`);
            console.log(`   Vehículo: ${orden.CODIGOVEHICULO}`);
            
            // Buscar albaranes de esa fecha
            console.log(`\n   Buscando albaranes del ${orden.DIAREPARTO}/${orden.MESREPARTO}/${orden.ANOREPARTO}...`);
            
            const albsDate = await conn.query(`
                SELECT 
                    EJERCICIOALBARAN, SERIEALBARAN, NUMEROALBARAN,
                    CODIGOCLIENTEALBARAN,
                    IMPORTETOTAL / 100.0 as TOTAL
                FROM DSEDAC.CAC
                WHERE DIADOCUMENTO = ${orden.DIAREPARTO}
                  AND MESDOCUMENTO = ${orden.MESREPARTO}
                  AND ANODOCUMENTO = ${orden.ANOREPARTO}
                FETCH FIRST 10 ROWS ONLY
            `);
            
            console.log(`   Albaranes encontrados: ${albsDate.length}`);
            albsDate.forEach((a, i) => {
                console.log(`   [${i+1}] ${a.EJERCICIOALBARAN}-${a.SERIEALBARAN}-${a.NUMEROALBARAN}, Cliente: ${a.CODIGOCLIENTEALBARAN}, Total: ${a.TOTAL}€`);
            });
        }

        // 5. Total albaranes por día para ver actividad
        console.log('\n\n5. ALBARANES POR DÍA EN ENERO 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const albsPerDay = await conn.query(`
            SELECT 
                DIADOCUMENTO as DIA,
                COUNT(*) as ALBARANES,
                SUM(IMPORTETOTAL) / 100.0 as IMPORTE
            FROM DSEDAC.CAC
            WHERE MESDOCUMENTO = 1 AND ANODOCUMENTO = 2026
            GROUP BY DIADOCUMENTO
            ORDER BY DIADOCUMENTO
        `);
        
        console.log('   DÍA │ ALBARANES │ IMPORTE');
        console.log('   ────┼───────────┼─────────────');
        albsPerDay.forEach(d => {
            console.log(`   ${String(d.DIA).padStart(3)} │ ${String(d.ALBARANES).padStart(9)} │ ${(d.IMPORTE || 0).toFixed(2)}€`);
        });

        // 6. OPP tiene información de cliente? No, solo ordenes
        // La vinculación real probablemente está en otra tabla
        console.log('\n\n6. BUSCAR TABLA QUE VINCULE OPP CON ALBARANES:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Buscar tablas con NUMEROORDENPREPARACION
        const tablasOrden = await conn.query(`
            SELECT DISTINCT TABLE_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND COLUMN_NAME = 'NUMEROORDENPREPARACION'
        `);
        
        console.log('   Tablas con NUMEROORDENPREPARACION:');
        tablasOrden.forEach(t => console.log(`   - ${t.TABLE_NAME}`));

        // Buscar en cada una si tiene también campo de albaran
        for (const t of tablasOrden) {
            const hasAlb = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' 
                  AND TABLE_NAME = '${t.TABLE_NAME}'
                  AND (COLUMN_NAME LIKE '%ALBARAN%' OR COLUMN_NAME LIKE '%DOCUMENTO%')
            `);
            
            if (hasAlb.length > 0) {
                console.log(`\n   ${t.TABLE_NAME} tiene: ${hasAlb.map(c => c.COLUMN_NAME).join(', ')}`);
            }
        }

        await conn.close();
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
