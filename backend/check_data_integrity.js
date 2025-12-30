require('dotenv').config();
const odbc = require('odbc');

async function checkData() {
    let connection;
    try {
        const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';
        connection = await odbc.connect(connectionString);

        console.log('Connected to DB2');

        // 1. Check Columns first to be safe
        console.log('\n--- Checking Table Columns ---');
        try {
            const cols = await connection.query(`SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROWS ONLY`);
            console.log('Columns found:', Object.keys(cols[0]).join(', '));
        } catch (e) {
            console.log('Error checking columns: ' + e.message);
        }

        // 2. Identify Domingo's code by checking 2024 Sales
        // Target 2025 = 783.059 => 2024 Sales should be ~711.871
        console.log('\n--- Finding Salesman matching ~711k Sales in 2024 ---');

        const salesmen = await connection.query(`
            SELECT CODIGOVENDEDOR, SUM(IMPORTEVENTA) as SALES_2024
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = 2024
            GROUP BY CODIGOVENDEDOR
        `);

        let vendedorCode = '';
        salesmen.forEach(row => {
            const s = parseFloat(row.SALES_2024 || 0);
            if (s > 700000 && s < 720000) {
                console.log(`POTENTIAL MATCH: Code ${row.CODIGOVENDEDOR} with Sales ${s}`);
                vendedorCode = row.CODIGOVENDEDOR;
            }
        });

        if (!vendedorCode) {
            console.log('No exact match found. Using first available code:');
            vendedorCode = salesmen[0]?.CODIGOVENDEDOR || '1';
        }

        console.log(`Using Salesman Code: ${vendedorCode}`);

        // 3. Client Counts for 2025
        console.log('\n--- Client Counts 2025 ---');

        // Monthly breakdown
        const monthlyClients = await connection.query(`
        SELECT MESDOCUMENTO as MONTH, COUNT(DISTINCT CODIGOCLIENTE) as UNIQUE_CLIENTS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2025 
            AND CODIGOVENDEDOR = '${vendedorCode}'
        GROUP BY MESDOCUMENTO
        ORDER BY MESDOCUMENTO
        `);
        console.log('Monthly Unique Clients:');
        console.table(monthlyClients);

        // Total Unique for Year
        const yearClients = await connection.query(`
        SELECT COUNT(DISTINCT CODIGOCLIENTE) as TOTAL_UNIQUE_YEAR
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2025 
            AND CODIGOVENDEDOR = '${vendedorCode}'
        `);
        console.log(`Total Unique Clients for 2025: ${yearClients[0].TOTAL_UNIQUE_YEAR}`);

        // 4. Margin Verification 2025
        console.log('\n--- Sales & Margin 2025 ---');
        const marginData = await connection.query(`
            SELECT 
                SUM(IMPORTEVENTA) as SALES,
                SUM(IMPORTECOSTO) as COST,
                SUM(IMPORTEVENTA) - SUM(IMPORTECOSTO) as MARGIN
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = 2025
                AND CODIGOVENDEDOR = '${vendedorCode}'
        `);

        console.table(marginData);

        const sales = parseFloat(marginData[0].SALES || 0);
        const margin = parseFloat(marginData[0].MARGIN || 0);

        // Check the "Objective Margin" logic (12% of Sales Objective)
        const objectiveSales = 783059;
        const theoreticalMarginObj = objectiveSales * 0.12;
        console.log(`\nVerifying Margin Objective:`);
        console.log(`Objective Sales: ${objectiveSales}`);
        console.log(`Theoretical Margin Objective (12%): ${theoreticalMarginObj.toFixed(2)}`);
        console.log(`Actual Margin Achieved: ${margin.toFixed(2)}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) await connection.close();
    }
}

checkData();
