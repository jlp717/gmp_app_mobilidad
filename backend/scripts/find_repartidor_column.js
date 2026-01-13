/**
 * Script final - Buscar la relación correcta entre repartidores y documentos
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('    BUSCAR TODAS LAS TABLAS CON CODIGOREPARTIDOR');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const tablasRep = await conn.query(`
            SELECT TABLE_NAME, COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND COLUMN_NAME = 'CODIGOREPARTIDOR'
            ORDER BY TABLE_NAME
        `);
        
        console.log('   Tablas con CODIGOREPARTIDOR:');
        tablasRep.forEach(t => console.log(`       ${t.TABLE_NAME}`));

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    BUSCAR TABLAS QUE TENGAN TRANSPORTISTA');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const tablasTrans = await conn.query(`
            SELECT TABLE_NAME, COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND COLUMN_NAME LIKE '%TRANSPORTISTA%'
            ORDER BY TABLE_NAME
        `);
        
        console.log('   Tablas con *TRANSPORTISTA*:');
        tablasTrans.forEach(t => console.log(`       ${t.TABLE_NAME}.${t.COLUMN_NAME}`));

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    VERIFICAR COLUMNA TRANSPORTISTA EN CAC');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Ver todos los campos TRANSPORTISTA en CAC
        const cacTransCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME LIKE '%TRANSPORTISTA%'
        `);
        
        console.log('   Columnas TRANSPORTISTA en CAC:');
        cacTransCols.forEach(c => console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // Verificar si hay datos del repartidor 79 en alguna columna transportista de CAC
        if (cacTransCols.length > 0) {
            console.log('\n   Verificando si repartidor 79 está en columnas TRANSPORTISTA de CAC...\n');
            
            for (const col of cacTransCols) {
                const count = await conn.query(`
                    SELECT COUNT(*) as TOTAL
                    FROM DSEDAC.CAC
                    WHERE TRIM(${col.COLUMN_NAME}) = '79'
                `);
                console.log(`       ${col.COLUMN_NAME} = '79': ${count[0].TOTAL} registros`);
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    BUSCAR DOCUMENTOS CON TRANSPORTISTA 79 EN CAC 2026');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Probar con los campos transportista que tengan datos
        for (const col of cacTransCols) {
            const sample = await conn.query(`
                SELECT 
                    EJERCICIO, NUMDOCUMENTO, CODIGOSERIE, CODIGODOCUMENTO,
                    TRIM(CODIGOCLIENTE) as CLIENTE,
                    TRIM(${col.COLUMN_NAME}) as TRANSPORTISTA_VAL,
                    IMPORTETOTALDOCUMENTO / 100.0 as IMPORTE
                FROM DSEDAC.CAC
                WHERE TRIM(${col.COLUMN_NAME}) = '79'
                  AND EJERCICIO = 2026
                ORDER BY NUMDOCUMENTO DESC
                FETCH FIRST 3 ROWS ONLY
            `);
            
            if (sample.length > 0) {
                console.log(`   ¡ENCONTRADO! Documentos con ${col.COLUMN_NAME} = 79:`);
                sample.forEach((r, i) => {
                    console.log(`       [${i+1}] ${r.EJERCICIO}-${r.NUMDOCUMENTO} (${r.CODIGOSERIE}/${r.CODIGODOCUMENTO}) Cliente: ${r.CLIENTE}, Importe: ${r.IMPORTE}€`);
                });
                console.log('');
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    CONTAR DOCUMENTOS POR TRANSPORTISTA EN 2026');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Buscar la columna con más datos
        for (const col of cacTransCols) {
            const stats = await conn.query(`
                SELECT 
                    TRIM(${col.COLUMN_NAME}) as TRANS,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE ${col.COLUMN_NAME} IS NOT NULL
                  AND TRIM(${col.COLUMN_NAME}) <> ''
                  AND EJERCICIO = 2026
                GROUP BY TRIM(${col.COLUMN_NAME})
                ORDER BY TOTAL DESC
                FETCH FIRST 10 ROWS ONLY
            `);
            
            if (stats.length > 0) {
                console.log(`   Top valores en ${col.COLUMN_NAME} (2026):`);
                stats.forEach(s => console.log(`       ${s.TRANS}: ${s.TOTAL} docs`));
                console.log('');
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('    VERIFICAR SI CODIGOVENDEDORCONDUCTOR ES EL REPARTIDOR');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const checkConductor = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME = 'CODIGOVENDEDORCONDUCTOR'
        `);
        
        if (checkConductor[0].TOTAL > 0) {
            console.log('   CAC tiene CODIGOVENDEDORCONDUCTOR - verificando datos...\n');
            
            const conductorStats = await conn.query(`
                SELECT 
                    TRIM(CODIGOVENDEDORCONDUCTOR) as CONDUCTOR,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE CODIGOVENDEDORCONDUCTOR IS NOT NULL
                  AND TRIM(CODIGOVENDEDORCONDUCTOR) <> ''
                  AND EJERCICIO = 2026
                GROUP BY TRIM(CODIGOVENDEDORCONDUCTOR)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            console.log('   CONDUCTOR │ TOTAL DOCS');
            console.log('   ──────────┼────────────');
            conductorStats.forEach(s => {
                console.log(`   ${(s.CONDUCTOR || '').padEnd(9)} │ ${s.TOTAL}`);
            });
            
            // Verificar si 79 está como conductor
            const check79 = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOVENDEDORCONDUCTOR) = '79'
                  AND EJERCICIO = 2026
            `);
            
            console.log(`\n   Documentos con CODIGOVENDEDORCONDUCTOR = '79' en 2026: ${check79[0].TOTAL}`);
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                      RESUMEN FINAL');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
