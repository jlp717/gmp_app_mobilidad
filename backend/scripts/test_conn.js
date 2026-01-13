/**
 * Test conexión básica
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        console.log('Conectando...');
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
        console.log('Conectado!\n');

        // Query muy simple
        const result = await conn.query('SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(NOMBREVENDEDOR) as NOM FROM DSEDAC.VDD FETCH FIRST 5 ROWS ONLY');
        console.log('VDD:');
        result.forEach(r => console.log(`  ${r.COD} - ${r.NOM}`));

        // VDPL1
        console.log('\nVDPL1:');
        const pins = await conn.query('SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(CODIGOPIN) as PIN FROM DSEDAC.VDPL1 FETCH FIRST 5 ROWS ONLY');
        pins.forEach(r => console.log(`  ${r.COD} - PIN: ${r.PIN}`));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

main();
