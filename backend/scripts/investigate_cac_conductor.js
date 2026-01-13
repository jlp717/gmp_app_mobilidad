/**
 * CAC tiene CODIGOCONDUCTOR, CODIGOVENDEDORCONDUCTOR, CODIGOVEHICULO
 * Investigar cuál usar para el repartidor
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║    INVESTIGAR COLUMNAS CONDUCTOR/VEHICULO EN CAC               ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Ver tamaño de las columnas
        console.log('1. TIPO DE COLUMNAS EN CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const colTypes = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME IN ('CODIGOCONDUCTOR', 'CODIGOVENDEDORCONDUCTOR', 'CODIGOVEHICULO')
        `);
        
        colTypes.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Estadísticas de CODIGOCONDUCTOR
        console.log('\n\n2. ESTADÍSTICAS DE CODIGOCONDUCTOR (2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const condStats = await conn.query(`
                SELECT 
                    TRIM(CODIGOCONDUCTOR) as CONDUCTOR,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE EJERCICIO = 2026
                  AND CODIGOCONDUCTOR IS NOT NULL
                  AND TRIM(CODIGOCONDUCTOR) <> ''
                GROUP BY TRIM(CODIGOCONDUCTOR)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            console.log('   CONDUCTOR │ TOTAL');
            console.log('   ──────────┼───────');
            condStats.forEach(c => {
                console.log(`   ${(c.CONDUCTOR || '').padEnd(9)} │ ${c.TOTAL}`);
            });
            
            // Verificar si 79 está
            const check79 = condStats.find(c => c.CONDUCTOR === '79');
            console.log(`\n   ¿El 79 está en CODIGOCONDUCTOR? ${check79 ? 'SÍ (' + check79.TOTAL + ' docs)' : 'NO'}`);
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // 3. Estadísticas de CODIGOVEHICULO
        console.log('\n\n3. ESTADÍSTICAS DE CODIGOVEHICULO (2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const vehStats = await conn.query(`
                SELECT 
                    TRIM(CODIGOVEHICULO) as VEHICULO,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE EJERCICIO = 2026
                  AND CODIGOVEHICULO IS NOT NULL
                  AND TRIM(CODIGOVEHICULO) <> ''
                GROUP BY TRIM(CODIGOVEHICULO)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            console.log('   VEHÍCULO  │ TOTAL');
            console.log('   ──────────┼───────');
            vehStats.forEach(v => {
                console.log(`   ${(v.VEHICULO || '').padEnd(9)} │ ${v.TOTAL}`);
            });
        } catch (e) {
            console.log('   Error:', e.message);
        }

        // 4. Obtener vehículo del repartidor 79 en VEH
        console.log('\n\n4. VEHÍCULO ASIGNADO AL REPARTIDOR 79 EN VEH:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const veh79 = await conn.query(`
            SELECT 
                TRIM(CODIGOVEHICULO) as COD_VEH,
                TRIM(MATRICULAVEHICULO) as MATRICULA,
                TRIM(CODIGOREPARTIDOR) as REP
            FROM DSEDAC.VEH
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
        `);
        
        if (veh79.length > 0) {
            console.log(`   Vehículo: ${veh79[0].COD_VEH}, Matrícula: ${veh79[0].MATRICULA}`);
            
            // Buscar documentos con ese vehículo
            const vehCode = veh79[0].COD_VEH;
            
            console.log(`\n   Buscando documentos 2026 con CODIGOVEHICULO = '${vehCode}'...`);
            
            const docsVeh = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOVEHICULO) = '${vehCode}'
                  AND EJERCICIO = 2026
            `);
            
            console.log(`   Documentos encontrados: ${docsVeh[0]?.TOTAL || 0}`);
            
            if (docsVeh[0]?.TOTAL > 0) {
                // Sample
                const sampleVeh = await conn.query(`
                    SELECT 
                        EJERCICIO, NUMDOCUMENTO,
                        TRIM(CODIGOCLIENTE) as CLIENTE,
                        DIA, MES,
                        IMPORTETOTALDOCUMENTO / 100.0 as TOTAL
                    FROM DSEDAC.CAC
                    WHERE TRIM(CODIGOVEHICULO) = '${vehCode}'
                      AND EJERCICIO = 2026
                    ORDER BY NUMDOCUMENTO DESC
                    FETCH FIRST 5 ROWS ONLY
                `);
                
                console.log('\n   Sample documentos:');
                sampleVeh.forEach((d, i) => {
                    console.log(`   [${i+1}] ${d.EJERCICIO}-${d.NUMDOCUMENTO}, ${d.DIA}/${d.MES}, Cliente: ${d.CLIENTE}, Total: ${d.TOTAL}€`);
                });
            }
        } else {
            console.log('   El repartidor 79 NO tiene vehículo en VEH');
            
            // Buscar en OPP qué vehículo usa
            console.log('\n   Buscando vehículo en OPP...');
            const oppVeh = await conn.query(`
                SELECT DISTINCT TRIM(CODIGOVEHICULO) as VEH
                FROM DSEDAC.OPP
                WHERE TRIM(CODIGOREPARTIDOR) = '79'
                  AND ANOREPARTO = 2026
            `);
            
            if (oppVeh.length > 0) {
                console.log(`   Vehículos usados por 79 en OPP 2026: ${oppVeh.map(v => v.VEH).join(', ')}`);
                
                // Buscar documentos con esos vehículos
                for (const v of oppVeh) {
                    const docsVeh = await conn.query(`
                        SELECT COUNT(*) as TOTAL
                        FROM DSEDAC.CAC
                        WHERE TRIM(CODIGOVEHICULO) = '${v.VEH}'
                          AND EJERCICIO = 2026
                    `);
                    console.log(`   Docs con vehículo ${v.VEH}: ${docsVeh[0]?.TOTAL || 0}`);
                }
            }
        }

        // 5. Buscar directamente por CODIGOCONDUCTOR = 79
        console.log('\n\n5. DOCUMENTOS CON CODIGOCONDUCTOR = 79 EN 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const docs79Cond = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOCONDUCTOR) = '79'
                  AND EJERCICIO = 2026
            `);
            
            console.log(`   Total documentos: ${docs79Cond[0]?.TOTAL || 0}`);
            
            if (docs79Cond[0]?.TOTAL > 0) {
                const sample = await conn.query(`
                    SELECT 
                        EJERCICIO, NUMDOCUMENTO,
                        TRIM(CODIGOCLIENTE) as CLIENTE,
                        DIA, MES,
                        IMPORTETOTALDOCUMENTO / 100.0 as TOTAL
                    FROM DSEDAC.CAC
                    WHERE TRIM(CODIGOCONDUCTOR) = '79'
                      AND EJERCICIO = 2026
                    ORDER BY NUMDOCUMENTO DESC
                    FETCH FIRST 5 ROWS ONLY
                `);
                
                console.log('\n   Sample documentos:');
                sample.forEach((d, i) => {
                    console.log(`   [${i+1}] ${d.EJERCICIO}-${d.NUMDOCUMENTO}, ${d.DIA}/${d.MES}, Cliente: ${d.CLIENTE}, Total: ${d.TOTAL}€`);
                });
            }
        } catch (e) {
            console.log('   Error:', e.message);
        }

        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                       CONCLUSIÓN');
        console.log('════════════════════════════════════════════════════════════════\n');
        
        console.log('   El campo correcto en CAC para identificar repartidor podría ser:');
        console.log('   1. CODIGOCONDUCTOR - si contiene el código del repartidor');
        console.log('   2. CODIGOVEHICULO - vinculado con VEH.CODIGOREPARTIDOR');
        console.log('   3. O la relación OPP → documentos que aún no está clara');
        
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
