const odbc = require('odbc');
const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        console.log('--- DISTINCT Clients for Vendor 33 (Tuesday) in LACLAE ---');

        // 1. Distinct Count
        const total = await conn.query(`
      SELECT COUNT(DISTINCT LCCDCL) as CNT
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33' AND R1_T8DIVM = 'S'
    `);
        console.log(`Tuesday DISTINCT Assigned Clients: ${total[0].CNT}`);

        // If active sales check is needed, I can add it, but count is primary interest now.

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
    }
}

main();
