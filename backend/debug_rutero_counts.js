const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        console.log('--- LACLAE Counts for Vendor 33 ---');

        // Count raw assignments for Lunes (Monday)
        const count = await conn.query(`
      SELECT COUNT(*) as CNT
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33' AND R1_T8DIVL = 'S'
    `);
        console.log(`Raw Monday Visits for Vendor 33: ${count[0].CNT}`);

        // Inspect columns of LACLAE to find any "Status" or "Baja" indicator
        const cols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'LACLAE' AND TABLE_SCHEMA = 'DSED'
    `);
        console.log('LACLAE Columns:', cols.map(c => c.COLUMN_NAME).join(', '));

        // Inspect columns of CLI (Clients) to find status
        console.log('\n--- CLI Columns ---');
        const cliCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'CLI' AND TABLE_SCHEMA = 'DSEDAC'
      AND (UPPER(COLUMN_NAME) LIKE '%BAJA%' OR UPPER(COLUMN_NAME) LIKE '%ESTADO%' OR UPPER(COLUMN_NAME) LIKE '%ACTIVO%')
    `);
        console.log('Candidate Status Columns in CLI:', cliCols.map(c => c.COLUMN_NAME).join(', '));

        // Check sample clients
        console.log('\n--- Sample Clients for Vendor 33 (Monday) ---');
        const sample = await conn.query(`
      SELECT L.LCCDCL, C.NOMBRECLIENTE, C.FECHABAJA, C.ESTADO
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
      WHERE L.R1_T8CDVD = '33' AND L.R1_T8DIVL = 'S'
      FETCH FIRST 10 ROWS ONLY
    `);

        // Note: I'm guessing FECHABAJA or ESTADO might exist based on common patterns.
        // If query fails, we'll see the error and adjust based on column list.
        console.log(sample);

    } catch (e) {
        console.error('Error:', e.message);
        if (e.message.includes('Column')) {
            console.log('Query failed due to column name. Check column list above.');
        }
    } finally {
        await conn.close();
    }
}

main();
