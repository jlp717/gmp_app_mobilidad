const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        // 1. List all columns in CLI
        console.log('--- CLI Columns ---');
        const cols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'CLI' AND TABLE_SCHEMA = 'DSEDAC'
      ORDER BY COLUMN_NAME
    `);
        console.log(cols.map(c => c.COLUMN_NAME).join(', '));

        // 2. Check Last Sales for assigned clients
        console.log('\n--- Verify Sales Activity for Assigned Clients (Vendor 33, Monday) ---');

        // Get assigned clients
        const clients = await conn.query(`
      SELECT DISTINCT LCCDCL
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33' AND R1_T8DIVL = 'S'
    `);

        const clientList = clients.map(c => `'${c.LCCDCL.trim()}'`).join(',');

        if (clientList.length > 0) {
            // Check sales in 2024/2025
            const activeSales = await conn.query(`
          SELECT COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CNT
          FROM DSEDAC.LAC
          WHERE CODIGOCLIENTEALBARAN IN (${clientList})
            AND ANODOCUMENTO >= 2024
        `);
            console.log(`Clients with sales in 2024/2025: ${activeSales[0].CNT} / ${clients.length}`);

            // Check sales in 2025 only
            const activeSales25 = await conn.query(`
          SELECT COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CNT
          FROM DSEDAC.LAC
          WHERE CODIGOCLIENTEALBARAN IN (${clientList})
            AND ANODOCUMENTO = 2025
        `);
            console.log(`Clients with sales in 2025: ${activeSales25[0].CNT} / ${clients.length}`);
        } else {
            console.log('No clients found for this day/vendor');
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
    }
}

main();
