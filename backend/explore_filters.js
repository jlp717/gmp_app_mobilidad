// explore_filters.js - Explore values forSeries (LCSRAB) and Sales Type (LCTPVT)
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    console.log('Connecting to database...');
    const conn = await odbc.connect(CONNECTION_STRING);

    try {
        // 1. Check distinct LCSRAB (Series)
        console.log('\n=== DISTINCT LCSRAB (Series) ===');
        const series = await conn.query(`
      SELECT DISTINCT LCSRAB 
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025
      ORDER BY LCSRAB
    `);
        console.log('Series found:', series.map(r => r.LCSRAB).join(', '));

        // 2. Check distinct LCTPVT (Tipo Venta)
        console.log('\n=== DISTINCT LCTPVT (Tipo Venta) ===');
        const types = await conn.query(`
      SELECT DISTINCT LCTPVT 
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025
      ORDER BY LCTPVT
    `);
        console.log('Sales Types found:', types.map(r => r.LCTPVT).join(', '));

        // 3. Check 'SC' occurrences
        console.log('\n=== CHECKING FOR "SC" (Sin Cargo) ===');
        const scRows = await conn.query(`
      SELECT COUNT(*) as COUNT
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025 AND (LCTPVT = 'SC' OR IMPORTEVENTA = 0)
    `);
        console.log('Rows with LCTPVT="SC" or Amount=0:', scRows[0].COUNT);

        // 4. Check join with CAC for CCSNSD (Signo Documento?)
        console.log('\n=== CAC.CCSNSD VALUES ===');
        const cacJoin = await conn.query(`
      SELECT DISTINCT C.CCSNSD
      FROM DSEDAC.LAC L
      JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
        AND C.CCYEAB = L.LCYEAB 
        AND C.CCSRAB = L.LCSRAB 
        AND C.CCTRAB = L.LCTRAB 
        AND C.CCNRAB = L.LCNRAB
      WHERE L.ANODOCUMENTO = 2025
    `);
        console.log('CAC.CCSNSD values:', cacJoin.map(r => r.CCSNSD).join(', '));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
        console.log('\nDone.');
    }
}

main();
