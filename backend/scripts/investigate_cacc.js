/**
 * INVESTIGACIÓN: Tablas CACC y CAPC con CODIGOREPARTIDOR
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║       TABLAS CACC Y CAPC - TIENEN CODIGOREPARTIDOR             ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Estructura CACC
        console.log('1. COLUMNAS DE TABLA CACC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const caccCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CACC'
            ORDER BY ORDINAL_POSITION
        `);
        
        caccCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Datos CACC para repartidor 79
        console.log('\n\n2. DATOS EN CACC PARA REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cacc79Count = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CACC
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
        `);
        console.log(`   Total registros CACC con repartidor 79: ${cacc79Count[0].TOTAL}`);

        // 3. Sample CACC
        console.log('\n\n3. SAMPLE DE CACC REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const caccSample = await conn.query(`
            SELECT * FROM DSEDAC.CACC
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
            FETCH FIRST 2 ROWS ONLY
        `);
        
        if (caccSample.length > 0) {
            Object.entries(caccSample[0]).forEach(([k, v]) => {
                if (v !== null && String(v).trim() !== '') {
                    console.log(`   ${k}: ${v}`);
                }
            });
        }

        // 4. Estructura CAPC
        console.log('\n\n4. COLUMNAS DE TABLA CAPC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const capcCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAPC'
            ORDER BY ORDINAL_POSITION
        `);
        
        capcCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 5. Datos CAPC para repartidor 79
        console.log('\n\n5. DATOS EN CAPC PARA REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const capc79Count = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CAPC
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
        `);
        console.log(`   Total registros CAPC con repartidor 79: ${capc79Count[0].TOTAL}`);

        // 6. Estadísticas repartidores en CACC 2026
        console.log('\n\n6. TOP REPARTIDORES EN CACC (2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const topCacc = await conn.query(`
                SELECT 
                    TRIM(CODIGOREPARTIDOR) as REP,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CACC
                WHERE EJERCICIO = 2026
                  AND CODIGOREPARTIDOR IS NOT NULL
                  AND TRIM(CODIGOREPARTIDOR) <> ''
                GROUP BY TRIM(CODIGOREPARTIDOR)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            console.log('   REPARTIDOR │ TOTAL');
            console.log('   ───────────┼───────');
            topCacc.forEach(r => {
                console.log(`   ${(r.REP || '').padEnd(10)} │ ${r.TOTAL}`);
            });
        } catch (e) {
            // CACC puede no tener EJERCICIO
            console.log('   CACC no tiene EJERCICIO, buscando en todos...');
            
            const topCaccAll = await conn.query(`
                SELECT 
                    TRIM(CODIGOREPARTIDOR) as REP,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CACC
                WHERE CODIGOREPARTIDOR IS NOT NULL
                  AND TRIM(CODIGOREPARTIDOR) <> ''
                GROUP BY TRIM(CODIGOREPARTIDOR)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            console.log('   REPARTIDOR │ TOTAL');
            console.log('   ───────────┼───────');
            topCaccAll.forEach(r => {
                console.log(`   ${(r.REP || '').padEnd(10)} │ ${r.TOTAL}`);
            });
        }

        // 7. Relación CACC con CAC
        console.log('\n\n7. ¿CÓMO SE RELACIONA CACC CON CAC?');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Buscar columnas en común
        const cacColNames = await conn.query(`
            SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
        `);
        const caccColNames = caccCols.map(c => c.COLUMN_NAME);
        
        const commonCols = caccColNames.filter(c => 
            cacColNames.some(cc => cc.COLUMN_NAME === c)
        );
        console.log('   Columnas en común CAC-CACC:', commonCols.join(', '));

        // 8. Sample con JOIN CAC-CACC
        console.log('\n\n8. INTENTAR JOIN CAC-CACC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Ver las columnas que podrían servir de clave
        console.log('   Posibles claves para JOIN:');
        const keyCols = ['EJERCICIO', 'NUMDOCUMENTO', 'CODIGOSERIE', 'CODIGODOCUMENTO', 'CODIGOCLIENTE'];
        for (const col of keyCols) {
            const inCacc = caccColNames.includes(col);
            console.log(`       ${col}: ${inCacc ? '✓ está en CACC' : '✗ no está en CACC'}`);
        }

        // 9. Verificar qué significa CACC
        console.log('\n\n9. SAMPLE CACC COMPLETO:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const caccFull = await conn.query(`
            SELECT * FROM DSEDAC.CACC
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
            ORDER BY 1 DESC
            FETCH FIRST 3 ROWS ONLY
        `);
        
        caccFull.forEach((row, i) => {
            console.log(`   --- Registro ${i+1} ---`);
            Object.entries(row).forEach(([k, v]) => {
                console.log(`       ${k}: ${v}`);
            });
            console.log('');
        });

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                     CONCLUSIÓN');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        console.log('   La tabla CACC parece ser una extensión de CAC con datos de cobro.');
        console.log('   Contiene CODIGOREPARTIDOR que es el campo correcto a usar.');
        console.log('   El JOIN sería: CAC.EJERCICIO = CACC.EJERCICIO AND ');
        console.log('                  CAC.NUMDOCUMENTO = CACC.NUMDOCUMENTO');
        
        console.log('\n═══════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
