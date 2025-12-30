require('dotenv').config();
const odbc = require('odbc');

async function checkHistory() {
    let connection;
    try {
        const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';
        connection = await odbc.connect(connectionString);

        console.log('Connected to DB2');
        const vendedorCode = '33'; // DOMINGO

        // Query Sales by Year
        const query = `
            SELECT ANODOCUMENTO as YEAR, SUM(IMPORTEVENTA) as SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO IN (2023, 2024, 2025)
              AND CODIGOVENDEDOR = '${vendedorCode}'
            GROUP BY ANODOCUMENTO
            ORDER BY ANODOCUMENTO
        `;

        console.log('Executing query...');
        const result = await connection.query(query);

        console.log('\n--- SALES HISTORY (DB Values) ---');
        console.table(result);

        // Check for duplicates
        if (result.length > 1) {
            const yr1 = result[0];
            const yr2 = result[1];
            if (yr1.SALES == yr2.SALES) {
                console.log('!!! WARNING: SALES ARE IDENTICAL FOR DIFFERENT YEARS !!!');
            } else {
                console.log('Sales are different, so the Frontend/Backend logic is duplicating them.');
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) await connection.close();
    }
}

checkHistory();
