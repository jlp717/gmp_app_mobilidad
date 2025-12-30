/**
 * Find GOYO in the database
 * Run with: node find_goyo.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function test() {
    console.log('SEARCHING FOR GOYO...\n');

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Search in VDC table
        console.log('1. Searching in VDC (all vendedores):');
        const vdc = await conn.query(`
      SELECT CODIGOVENDEDOR, TIPOVENDEDOR FROM DSEDAC.VDC
      WHERE SUBEMPRESA = 'GMP'
      ORDER BY CODIGOVENDEDOR
    `);
        console.log('   VDC has', vdc.length, 'vendedores');

        // Check VDC columns
        console.log('\n2. VDC columns for GOYO-like codes:');
        const goyo1 = await conn.query(`
      SELECT * FROM DSEDAC.VDC
      WHERE SUBEMPRESA = 'GMP' AND (
        UPPER(CODIGOVENDEDOR) LIKE '%GOYO%'
        OR UPPER(CODIGOVENDEDOR) LIKE '%G%'
      )
      FETCH FIRST 5 ROWS ONLY
    `);
        if (goyo1.length > 0) {
            console.log('   Found:', JSON.stringify(goyo1[0], null, 2));
        }

        // List all vendedor codes
        console.log('\n3. All vendedor codes:');
        vdc.forEach(v => {
            console.log(`   ${v.CODIGOVENDEDOR?.trim().padEnd(5)} | Type: ${v.TIPOVENDEDOR?.trim()}`);
        });

        // Check which type is Jefe de Ventas (A vs P)
        console.log('\n4. Sales breakdown by vendedor type (to identify Jefe):');
        const sales = await conn.query(`
      SELECT L.CODIGOVENDEDOR, V.TIPOVENDEDOR, SUM(L.IMPORTEVENTA) as TOTAL
      FROM DSEDAC.LAC L
      JOIN DSEDAC.VDC V ON L.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
      WHERE L.ANODOCUMENTO = 2024
      GROUP BY L.CODIGOVENDEDOR, V.TIPOVENDEDOR
      ORDER BY TOTAL DESC
      FETCH FIRST 10 ROWS ONLY
    `);
        sales.forEach(s => {
            console.log(`   ${s.CODIGOVENDEDOR?.trim().padEnd(5)} | Type: ${s.TIPOVENDEDOR?.trim()} | Sales: ${parseFloat(s.TOTAL).toFixed(0)}€`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

test().catch(console.error);
