/**
 * Obtener estructura real de CAC y probar queries correctas
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        const conn = await odbc.connect(DB_CONFIG);
        
        // 1. Obtener TODAS las columnas de CAC
        console.log('1. COLUMNAS DE CAC (primera 50):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cols = await conn.query(`
            SELECT COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
            ORDER BY ORDINAL_POSITION
            FETCH FIRST 60 ROWS ONLY
        `);
        
        cols.forEach((c, i) => console.log(`   ${(i+1).toString().padStart(2)}. ${c.COLUMN_NAME}`));

        // 2. Sample usando SELECT *
        console.log('\n\n2. SAMPLE DOCUMENTO:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const sample = await conn.query(`SELECT * FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`);
        
        // Mostrar campos clave
        const doc = sample[0];
        console.log('   Campos clave:');
        console.log(`   - SUBEMPRESAALBARAN: ${doc.SUBEMPRESAALBARAN}`);
        console.log(`   - EJERCICIOALBARAN: ${doc.EJERCICIOALBARAN}`);
        console.log(`   - SERIEALBARAN: ${doc.SERIEALBARAN}`);
        console.log(`   - TERMINALALBARAN: ${doc.TERMINALALBARAN}`);
        console.log(`   - NUMEROALBARAN: ${doc.NUMEROALBARAN}`);
        console.log(`   - CODIGOCLIENTE: ${doc.CODIGOCLIENTE}`);
        console.log(`   - CODIGOVENDEDOR: ${doc.CODIGOVENDEDOR}`);
        console.log(`   - CODIGOVENDEDORCONDUCTOR: ${doc.CODIGOVENDEDORCONDUCTOR}`);
        console.log(`   - IMPORTETOTALDOCUMENTO: ${doc.IMPORTETOTALDOCUMENTO}`);

        // 3. Buscar documentos de 2026
        console.log('\n\n3. DOCUMENTOS 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const count2026 = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CAC
            WHERE EJERCICIOALBARAN = 2026
        `);
        console.log(`   Total documentos 2026: ${count2026[0]?.TOTAL}`);

        // 4. Documentos con CODIGOVENDEDORCONDUCTOR
        console.log('\n\n4. CODIGOVENDEDORCONDUCTOR EN 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const condStats = await conn.query(`
            SELECT 
                CODIGOVENDEDORCONDUCTOR as COND,
                COUNT(*) as TOTAL
            FROM DSEDAC.CAC
            WHERE EJERCICIOALBARAN = 2026
              AND CODIGOVENDEDORCONDUCTOR IS NOT NULL
              AND TRIM(CODIGOVENDEDORCONDUCTOR) <> ''
            GROUP BY CODIGOVENDEDORCONDUCTOR
            ORDER BY TOTAL DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        
        console.log('   CONDUCTOR │ TOTAL');
        console.log('   ──────────┼───────');
        condStats.forEach(c => {
            console.log(`   '${c.COND}'      │ ${c.TOTAL}`);
        });

        // Verificar si 79 está
        const has79 = condStats.find(c => String(c.COND).trim() === '79');
        console.log(`\n   ¿Está '79'? ${has79 ? 'SÍ (' + has79.TOTAL + ' docs)' : 'NO'}`);

        // 5. Buscar documentos del repartidor 79
        console.log('\n\n5. DOCUMENTOS DEL REPARTIDOR 79 (CODIGOVENDEDORCONDUCTOR):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const docs79 = await conn.query(`
            SELECT 
                EJERCICIOALBARAN,
                NUMEROALBARAN,
                TRIM(CODIGOCLIENTE) as CLIENTE,
                DIAALBARAN, MESALBARAN,
                IMPORTETOTALDOCUMENTO / 100.0 as TOTAL
            FROM DSEDAC.CAC
            WHERE TRIM(CODIGOVENDEDORCONDUCTOR) = '79'
              AND EJERCICIOALBARAN = 2026
            ORDER BY NUMEROALBARAN DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        
        if (docs79.length > 0) {
            console.log('   ¡ENCONTRADOS!');
            docs79.forEach((d, i) => {
                console.log(`   [${i+1}] ${d.EJERCICIOALBARAN}-${d.NUMEROALBARAN}, ${d.DIAALBARAN}/${d.MESALBARAN}, Cliente: ${d.CLIENTE}, Total: ${d.TOTAL}€`);
            });
            
            // Contar total
            const total79 = await conn.query(`
                SELECT COUNT(*) as TOTAL, SUM(IMPORTETOTALDOCUMENTO) / 100.0 as IMPORTE
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOVENDEDORCONDUCTOR) = '79'
                  AND EJERCICIOALBARAN = 2026
            `);
            console.log(`\n   Total documentos: ${total79[0]?.TOTAL}, Importe: ${total79[0]?.IMPORTE?.toFixed(2)}€`);
        } else {
            console.log('   No hay documentos con CODIGOVENDEDORCONDUCTOR = 79');
        }

        // 6. Verificar campo CLI
        console.log('\n\n6. VERIFICAR COLUMNAS DE CLIENTE:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cliCols = await conn.query(`
            SELECT COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
            AND (COLUMN_NAME LIKE '%NOMBRE%' OR COLUMN_NAME LIKE '%DIRECCION%' OR COLUMN_NAME LIKE '%TELEFONO%')
        `);
        console.log('   Columnas de nombre/dirección/teléfono en CLI:');
        cliCols.forEach(c => console.log(`   - ${c.COLUMN_NAME}`));

        await conn.close();
        
        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                         CONCLUSIÓN');
        console.log('════════════════════════════════════════════════════════════════\n');
        console.log('   El campo correcto para repartidor es: CODIGOVENDEDORCONDUCTOR');
        console.log('   El campo de ejercicio es: EJERCICIOALBARAN (no EJERCICIO)');
        console.log('   El campo de documento es: NUMEROALBARAN (no NUMDOCUMENTO)');
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }
}

run();
