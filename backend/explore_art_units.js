// explore_art_units.js - Find unit type column in ART table
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    console.log('Connecting to database...');
    const conn = await odbc.connect(CONNECTION_STRING);

    try {
        // Get sample row to see all columns
        console.log('\n=== ART Table Sample Row ===');
        const sample = await conn.query(`SELECT * FROM DSEDAC.ART FETCH FIRST 1 ROWS ONLY`);
        if (sample.length > 0) {
            const cols = Object.keys(sample[0]);
            console.log(`Total columns: ${cols.length}`);
            cols.forEach(col => {
                const val = sample[0][col];
                console.log(`  ${col}: ${val}`);
            });
        }

        // Look for unit-related columns
        console.log('\n=== Searching for UNIT columns ===');
        const unitCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'ART' 
        AND TABLE_SCHEMA = 'DSEDAC' 
        AND (UPPER(COLUMN_NAME) LIKE '%UNIDAD%' 
          OR UPPER(COLUMN_NAME) LIKE '%UNIT%'
          OR UPPER(COLUMN_NAME) LIKE '%MEDIDA%'
          OR UPPER(COLUMN_NAME) LIKE '%UDM%'
          OR UPPER(COLUMN_NAME) LIKE '%UM%')
    `);
        console.log('Unit-related columns found:', unitCols.map(r => r.COLUMN_NAME).join(', ') || 'None');

        // Get sample products with potential unit columns
        console.log('\n=== Sample Products with All Columns ===');
        const products = await conn.query(`
      SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, CODIGOFAMILIA, 
             CODIGOSUBFAMILIA
      FROM DSEDAC.ART 
      FETCH FIRST 5 ROWS ONLY
    `);
        products.forEach((p, i) => {
            console.log(`${i + 1}. ${p.CODIGOARTICULO?.trim()}: ${p.DESCRIPCIONARTICULO?.trim()}`);
            console.log(`   Family: ${p.CODIGOFAMILIA}, Subfamily: ${p.CODIGOSUBFAMILIA}`);
        });

        // Check LAC table for unit info
        console.log('\n=== LAC Table Unit Columns ===');
        const lacCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'LAC' 
        AND TABLE_SCHEMA = 'DSEDAC' 
        AND (UPPER(COLUMN_NAME) LIKE '%UNIDAD%' 
          OR UPPER(COLUMN_NAME) LIKE '%UNIT%'
          OR UPPER(COLUMN_NAME) LIKE '%MEDIDA%'
          OR UPPER(COLUMN_NAME) LIKE '%CANT%')
    `);
        console.log('LAC unit-related columns:', lacCols.map(r => r.COLUMN_NAME).join(', ') || 'None');

        // Get LAC sample with units info
        console.log('\n=== LAC Sample with Quantity Columns ===');
        const lacSample = await conn.query(`
      SELECT CODIGOARTICULO, CANTIDADUNIDADES, 
             IMPORTEVENTA, IMPORTECOSTO
      FROM DSEDAC.LAC 
      FETCH FIRST 3 ROWS ONLY
    `);
        lacSample.forEach((l, i) => {
            console.log(`${i + 1}. Art: ${l.CODIGOARTICULO?.trim()}, Qty: ${l.CANTIDADUNIDADES}, Venta: ${l.IMPORTEVENTA}`);
        });

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
        console.log('\nDone.');
    }
}

main();
