/**
 * Debug columnas CAC
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    try {
        const conn = await odbc.connect(DB_CONFIG);
        
        // Intentar con una sola columna a la vez
        const cols = ['EJERCICIO', 'NUMDOCUMENTO', 'CODIGOCLIENTE', 'CODIGOVENDEDOR', 'CODIGOVENDEDORCONDUCTOR'];
        
        console.log('Probando columnas una a una:\n');
        
        for (const col of cols) {
            try {
                const r = await conn.query(`SELECT ${col} FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`);
                console.log(`   ✓ ${col}: OK - valor: ${r[0]?.[col]}`);
            } catch (e) {
                console.log(`   ✗ ${col}: ERROR`);
            }
        }

        // Probar combinación
        console.log('\nProbando combinaciones:');
        
        try {
            const r1 = await conn.query(`SELECT EJERCICIO FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`);
            console.log('   ✓ Solo EJERCICIO: OK');
        } catch (e) {
            console.log('   ✗ Solo EJERCICIO: ERROR');
        }

        try {
            const r2 = await conn.query(`SELECT CAC.EJERCICIO FROM DSEDAC.CAC CAC FETCH FIRST 1 ROWS ONLY`);
            console.log('   ✓ CAC.EJERCICIO con alias: OK');
        } catch (e) {
            console.log('   ✗ CAC.EJERCICIO con alias: ERROR');
        }

        try {
            const r3 = await conn.query(`SELECT CAC.EJERCICIO, CAC.NUMDOCUMENTO FROM DSEDAC.CAC CAC FETCH FIRST 1 ROWS ONLY`);
            console.log('   ✓ CAC.EJERCICIO + CAC.NUMDOCUMENTO: OK');
        } catch (e) {
            console.log('   ✗ CAC.EJERCICIO + CAC.NUMDOCUMENTO: ERROR -', e.message.substring(0, 50));
        }

        // Probar sin el alias
        console.log('\nProbando sin alias tabla:');
        try {
            const r4 = await conn.query(`SELECT DSEDAC.CAC.EJERCICIO FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`);
            console.log('   ✓ DSEDAC.CAC.EJERCICIO: OK');
        } catch (e) {
            console.log('   ✗ DSEDAC.CAC.EJERCICIO: ERROR');
        }

        // Probar con * 
        console.log('\nProbando SELECT *:');
        try {
            const r5 = await conn.query(`SELECT * FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY`);
            console.log('   ✓ SELECT *: OK - columnas:', Object.keys(r5[0]).length);
            console.log('   Primeras columnas:', Object.keys(r5[0]).slice(0, 5).join(', '));
        } catch (e) {
            console.log('   ✗ SELECT *: ERROR -', e.message.substring(0, 80));
        }

        await conn.close();
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

run();
