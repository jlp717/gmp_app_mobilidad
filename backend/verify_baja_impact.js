const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        console.log('--- Analyzing Inactive Clients for Vendor 33 (Monday) ---');

        // 1. Total Raw
        const total = await conn.query(`
      SELECT COUNT(*) as CNT
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33' AND R1_T8DIVL = 'S'
    `);
        console.log(`Total Assigned (Raw): ${total[0].CNT}`);

        // 2. Total Inactive (Given 'Baja')
        // Assuming 0 means active, > 0 means inactive year
        const inactive = await conn.query(`
      SELECT COUNT(*) as CNT
      FROM DSED.LACLAE L
      JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
      WHERE L.R1_T8CDVD = '33' AND L.R1_T8DIVL = 'S'
        AND C.ANOBAJA > 0
    `);
        console.log(`Inactive Clients (ANOBAJA > 0): ${inactive[0].CNT}`);

        // 3. Total Active
        const active = await conn.query(`
      SELECT COUNT(*) as CNT
      FROM DSED.LACLAE L
      JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
      WHERE L.R1_T8CDVD = '33' AND L.R1_T8DIVL = 'S'
        AND (C.ANOBAJA = 0 OR C.ANOBAJA IS NULL)
    `);
        console.log(`Active Clients (ANOBAJA = 0/NULL): ${active[0].CNT}`);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
    }
}

main();
