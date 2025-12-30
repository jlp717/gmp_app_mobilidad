require('dotenv').config();
const odbc = require('odbc');

async function checkObjectives() {
    let connection;
    try {
        const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';
        connection = await odbc.connect(connectionString);

        console.log('Connected to DB2');

        // 1. Identify Domingo (Code 33 from previous check)
        const vendedorCode = '33';
        console.log(`Checking data for Salesman Code: ${vendedorCode} (DOMINGO)`);

        // 2. Get Sales for 2024 and 2025
        const salesData = await connection.query(`
            SELECT ANODOCUMENTO as YEAR, SUM(IMPORTEVENTA) as SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO IN (2023, 2024, 2025)
              AND CODIGOVENDEDOR = '${vendedorCode}'
            GROUP BY ANODOCUMENTO
            ORDER BY ANODOCUMENTO
        `);

        console.log('\n--- Actual Sales Data ---');
        console.table(salesData);

        // 3. Calculate "Theoretical" Objectives based on logic
        // Logic: Objective Year X = Sales Year (X-1) * 1.10
        console.log('\n--- Calculated Objectives (Logic: PrevYear * 1.10) ---');

        let sales2023 = 0;
        let sales2024 = 0;

        const row2023 = salesData.find(r => r.YEAR == 2023);
        if (row2023) sales2023 = parseFloat(row2023.SALES);

        const row2024 = salesData.find(r => r.YEAR == 2024);
        if (row2024) sales2024 = parseFloat(row2024.SALES);

        const obj2024 = sales2023 * 1.10;
        const obj2025 = sales2024 * 1.10;

        console.log(`Sales 2023: ${sales2023.toFixed(2)} €  =>  Objective 2024: ${obj2024.toFixed(2)} €`);
        console.log(`Sales 2024: ${sales2024.toFixed(2)} €  =>  Objective 2025: ${obj2025.toFixed(2)} €`);

        const diff = Math.abs(obj2024 - obj2025);
        if (diff < 1000) {
            console.log(`\nNotice: The objectives are very similar (Diff: ${diff.toFixed(2)} €). This explains why the lines overlap.`);
        } else {
            console.log(`\nNotice: Objectives are distinct.`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) await connection.close();
    }
}

checkObjectives();
