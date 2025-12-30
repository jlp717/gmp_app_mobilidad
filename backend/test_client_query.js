const odbc = require('odbc');

async function findBusinessName() {
    const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

    // Find all columns in CLI table
    console.log('=== CLI TABLE COLUMNS ===');
    try {
        const cols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
      ORDER BY COLUMN_NAME
    `);
        console.log('Columns:', cols.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.log('Error getting columns:', e.message);
    }

    // Look for a specific client and see all their fields
    console.log('\n=== SAMPLE CLIENT DATA ===');
    try {
        const sample = await conn.query(`
      SELECT * FROM DSEDAC.CLI 
      WHERE NOMBRECLIENTE LIKE '%CHUHUA%' OR NOMBRECLIENTE LIKE '%CHINO%'
      FETCH FIRST 3 ROWS ONLY
    `);
        if (sample.length > 0) {
            console.log('Fields for client:', Object.keys(sample[0]));
            console.log('\nFirst client:');
            for (const [key, value] of Object.entries(sample[0])) {
                if (value && String(value).trim()) {
                    console.log(`  ${key}: ${String(value).trim()}`);
                }
            }
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Also check DSEMOVIL.CLIENTES
    console.log('\n=== DSEMOVIL.CLIENTES ===');
    try {
        const dsemovil = await conn.query(`
      SELECT CODIGO, NOMBRE2, NOMBRE FROM DSEMOVIL.CLIENTES 
      WHERE NOMBRE2 LIKE '%CHINO%' OR NOMBRE2 LIKE '%RESTAURANTE%'
      FETCH FIRST 5 ROWS ONLY
    `);
        dsemovil.forEach((r, i) => {
            console.log(`Client ${i + 1}: CODE=${r.CODIGO?.trim()}, NOMBRE2=${r.NOMBRE2?.trim()}, NOMBRE=${r.NOMBRE?.trim()}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }

    await conn.close();
}

findBusinessName().catch(console.error);
