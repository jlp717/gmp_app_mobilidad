/**
 * Debug básico
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        console.log('Conectando...');
        const conn = await odbc.connect(DB_CONFIG);
        console.log('Conectado OK\n');
        
        // Query simplísima
        console.log('Query 1: SELECT 1 FROM SYSIBM.SYSDUMMY1');
        const r1 = await conn.query(`SELECT 1 as TEST FROM SYSIBM.SYSDUMMY1`);
        console.log('   Resultado:', r1[0]);

        // Query a VDD
        console.log('\nQuery 2: SELECT de VDD');
        const r2 = await conn.query(`SELECT CODIGOVENDEDOR, NOMBREVENDEDOR FROM DSEDAC.VDD WHERE CODIGOVENDEDOR = '79'`);
        console.log('   Resultado:', r2[0]);

        // Query a VEH
        console.log('\nQuery 3: SELECT de VEH');
        const r3 = await conn.query(`SELECT COUNT(*) as TOTAL FROM DSEDAC.VEH`);
        console.log('   Total VEH:', r3[0]?.TOTAL);

        // Query a OPP
        console.log('\nQuery 4: SELECT de OPP');
        const r4 = await conn.query(`SELECT COUNT(*) as TOTAL FROM DSEDAC.OPP WHERE CODIGOREPARTIDOR = '79'`);
        console.log('   OPP para 79:', r4[0]?.TOTAL);

        // Query a CAC - básica
        console.log('\nQuery 5: SELECT básico de CAC');
        try {
            const r5 = await conn.query(`SELECT EJERCICIO, NUMDOCUMENTO FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`);
            console.log('   Resultado:', r5[0]);
        } catch (e) {
            console.log('   Error en CAC básico:', e.message);
        }

        // Query a CAC con filtro
        console.log('\nQuery 6: COUNT de CAC');
        try {
            const r6 = await conn.query(`SELECT COUNT(*) as T FROM DSEDAC.CAC`);
            console.log('   Total CAC:', r6[0]?.T);
        } catch (e) {
            console.log('   Error en COUNT CAC:', e.message);
        }

        await conn.close();
        console.log('\n✓ Conexión cerrada');
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
