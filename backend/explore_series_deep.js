// explore_series_deep.js - Deep compare of LCSRAB vs LCSRPD and filtering logic
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    console.log('Connecting to database...');
    const conn = await odbc.connect(CONNECTION_STRING);

    try {
        // 1. Verify existence and values of LCSRAB (Serie Albaran)
        console.log('\n=== LCSRAB (Serie Albaran) Analysis ===');
        try {
            const seriesAlb = await conn.query(`
        SELECT LCSRAB, COUNT(*) as CNT 
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025
        GROUP BY LCSRAB
        ORDER BY LCSRAB
      `);
            console.log('LCSRAB values found:', seriesAlb.map(r => `${r.LCSRAB}(${r.CNT})`).join(', '));

            const forbiddenAlb = seriesAlb.filter(r => ['K', 'N', 'O', 'G'].includes(r.LCSRAB));
            console.log('Forbidden values in LCSRAB:', forbiddenAlb.length > 0 ? forbiddenAlb.map(r => r.LCSRAB).join(', ') : 'NONE');
        } catch (e) {
            console.log('Error reading LCSRAB:', e.message);
        }

        // 2. Verify existence and values of LCSRPD (Serie Pedido)
        console.log('\n=== LCSRPD (Serie Pedido) Analysis ===');
        try {
            const seriesPed = await conn.query(`
        SELECT LCSRPD, COUNT(*) as CNT 
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025
        GROUP BY LCSRPD
        ORDER BY LCSRPD
      `);
            console.log('LCSRPD values found:', seriesPed.map(r => `${r.LCSRPD}(${r.CNT})`).join(', '));

            const forbiddenPed = seriesPed.filter(r => ['K', 'N', 'O', 'G'].includes(r.LCSRPD));
            console.log('Forbidden values in LCSRPD:', forbiddenPed.length > 0 ? forbiddenPed.map(r => r.LCSRPD).join(', ') : 'NONE');
        } catch (e) {
            console.log('Error reading LCSRPD:', e.message);
        }

        // 3. Check for 'SC' in LCTPVT
        console.log('\n=== LCTPVT (Tipo Venta) Analysis ===');
        const typeSales = await conn.query(`
      SELECT LCTPVT, COUNT(*) as CNT 
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025
      GROUP BY LCTPVT
    `);
        console.log('LCTPVT values:', typeSales.map(r => `${r.LCTPVT}(${r.CNT})`).join(', '));

        // 4. Check CAC.CCSNSD for LAE detection
        console.log('\n=== CAC.CCSNSD (Signo Documento) Analysis ===');
        // Join distinct values
        const laeCheck = await conn.query(`
      SELECT C.CCSNSD, COUNT(*) as CNT
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
        AND C.CCYEAB = L.LCYEAB 
        AND C.CCSRAB = L.LCSRAB 
        AND C.CCTRAB = L.LCTRAB 
        AND C.CCNRAB = L.LCNRAB
      WHERE L.ANODOCUMENTO = 2025
      GROUP BY C.CCSNSD
    `);
        console.log('CCSNSD values:', laeCheck.map(r => `${r.CCSNSD || 'NULL'}(${r.CNT})`).join(', '));

    } catch (e) {
        console.error('General Error:', e.message);
    } finally {
        await conn.close();
        console.log('\nDone.');
    }
}

main();
