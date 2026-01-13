/**
 * Debug - verificar conexión y estructura básica
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        console.log('Conectando...');
        const conn = await odbc.connect(DB_CONFIG);
        console.log('Conectado OK\n');
        
        // 1. Query super simple
        console.log('1. Query simple - contar documentos 2026:');
        const count = await conn.query(`
            SELECT COUNT(*) as TOTAL FROM DSEDAC.CAC WHERE EJERCICIO = 2026
        `);
        console.log(`   Total: ${count[0]?.TOTAL}\n`);

        // 2. Verificar si CODIGOVENDEDORCONDUCTOR existe y tiene datos
        console.log('2. Verificar CODIGOVENDEDORCONDUCTOR:');
        const checkCol = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME = 'CODIGOVENDEDORCONDUCTOR'
        `);
        
        if (checkCol.length > 0) {
            console.log(`   Existe: ${checkCol[0].COLUMN_NAME} ${checkCol[0].DATA_TYPE}(${checkCol[0].LENGTH})`);
            
            // Contar valores distintos
            const distinct = await conn.query(`
                SELECT COUNT(DISTINCT CODIGOVENDEDORCONDUCTOR) as DISTINTOS
                FROM DSEDAC.CAC
                WHERE EJERCICIO = 2026
            `);
            console.log(`   Valores distintos en 2026: ${distinct[0]?.DISTINTOS}\n`);
            
            // Ver sample
            console.log('3. Sample de CODIGOVENDEDORCONDUCTOR:');
            const sample = await conn.query(`
                SELECT DISTINCT CODIGOVENDEDORCONDUCTOR as COD
                FROM DSEDAC.CAC
                WHERE EJERCICIO = 2026
                FETCH FIRST 30 ROWS ONLY
            `);
            
            console.log('   Valores:', sample.map(s => `'${s.COD}'`).join(', '));
            
            // Verificar si '79' está
            const has79 = sample.find(s => String(s.COD).trim() === '79');
            console.log(`\n   ¿Está '79'? ${has79 ? 'SÍ' : 'NO'}`);
            
            // Si no está, buscar de otra forma
            if (!has79) {
                const check79Direct = await conn.query(`
                    SELECT COUNT(*) as TOTAL
                    FROM DSEDAC.CAC
                    WHERE EJERCICIO = 2026
                      AND TRIM(CODIGOVENDEDORCONDUCTOR) = '79'
                `);
                console.log(`   Documentos con '79': ${check79Direct[0]?.TOTAL}`);
            }
        }

        // 4. Verificar VEH para 79
        console.log('\n4. Verificar VEH para repartidor 79:');
        const veh79 = await conn.query(`
            SELECT CODIGOVEHICULO, MATRICULAVEHICULO, CODIGOREPARTIDOR
            FROM DSEDAC.VEH
            WHERE CODIGOREPARTIDOR = '79'
        `);
        
        if (veh79.length > 0) {
            console.log(`   Vehículo: ${veh79[0].CODIGOVEHICULO}, Matrícula: ${veh79[0].MATRICULAVEHICULO}`);
        } else {
            console.log('   No hay vehículo para 79');
            
            // Ver todos los vehículos
            console.log('\n   Todos los repartidores con vehículo:');
            const allVeh = await conn.query(`
                SELECT CODIGOVEHICULO, MATRICULAVEHICULO, CODIGOREPARTIDOR
                FROM DSEDAC.VEH
                WHERE CODIGOREPARTIDOR IS NOT NULL
                ORDER BY CODIGOREPARTIDOR
            `);
            
            allVeh.forEach(v => {
                console.log(`   Rep ${v.CODIGOREPARTIDOR}: Veh ${v.CODIGOVEHICULO} (${v.MATRICULAVEHICULO})`);
            });
        }

        await conn.close();
        console.log('\n✓ Conexión cerrada');
        
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
    }
}

run();
