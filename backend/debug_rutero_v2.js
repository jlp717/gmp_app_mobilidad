const odbc = require('odbc');
const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        console.log('--- DISTINCT Clients for Vendor 33 (Monday) in LACLAE ---');

        // 1. Distinct Count
        const total = await conn.query(`
      SELECT COUNT(DISTINCT LCCDCL) as CNT
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33' AND R1_T8DIVL = 'S'
    `);
        console.log(`Distinct Assigned Clients: ${total[0].CNT}`);

        // 2. Estado Distribution
        // Check if ESTADO column exists first
        try {
            const estados = await conn.query(`
        SELECT C.ESTADO, COUNT(*) as CNT
        FROM DSED.LACLAE L
        JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
        WHERE L.R1_T8CDVD = '33' AND L.R1_T8DIVL = 'S'
        GROUP BY C.ESTADO
        `);
            console.log('\n--- Status Distribution (LACLAE + CLI) ---');
            console.log(estados.map(r => `State '${r.ESTADO}': ${r.CNT}`).join(', '));
        } catch (e) { console.log('ESTADO column check failed or not found'); }

        // 3. Baja Year Distribution
        const bajas = await conn.query(`
      SELECT C.ANOBAJA, COUNT(*) as CNT
      FROM DSED.LACLAE L
      JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
      WHERE L.R1_T8CDVD = '33' AND L.R1_T8DIVL = 'S'
      GROUP BY C.ANOBAJA
      ORDER BY C.ANOBAJA DESC
      FETCH FIRST 10 ROWS ONLY
    `);
        console.log('\n--- Baja Year Distribution ---');
        console.log(bajas.map(r => `Year ${r.ANOBAJA}: ${r.CNT}`).join(', '));

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
    }
}

main();
