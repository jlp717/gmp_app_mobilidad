// Matrix Data Endpoint Test Script
const odbc = require('odbc');

const connectionString = 'DSN=EDAC;UID=GMP;PWD=JAVIER;';

async function testMatrixData() {
    const conn = await odbc.connect(connectionString);

    try {
        console.log('Testing Matrix Data Query...\n');

        // Get data from CVC grouped by year, quarter, vendor
        const result = await conn.query(`
      SELECT 
        V.CODIGOVENDEDOR,
        COALESCE(TRIM(X.NOMBREVENDEDOR), 'Sin nombre') as NOMBREVENDEDOR,
        C.ANOEMISION as YEAR,
        CASE 
          WHEN C.MESEMISION BETWEEN 1 AND 3 THEN 1
          WHEN C.MESEMISION BETWEEN 4 AND 6 THEN 2
          WHEN C.MESEMISION BETWEEN 7 AND 9 THEN 3
          ELSE 4
        END as QUARTER,
        SUM(C.IMPORTEVENCIMIENTO) as TOTALSALES,
        COUNT(DISTINCT C.CODIGOCLIENTEALBARAN) as CLIENTS,
        COUNT(DISTINCT C.NUMERODOCUMENTO) as ORDERS
      FROM DSEDAC.CVC C
      JOIN DSEDAC.VDC V ON TRIM(V.CODIGOVENDEDOR) = TRIM(C.CODIGOVENDEDOR)
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      WHERE C.ANOEMISION >= 2023
        AND V.SUBEMPRESA = 'GMP'
      GROUP BY V.CODIGOVENDEDOR, X.NOMBREVENDEDOR, C.ANOEMISION, QUARTER
      ORDER BY V.CODIGOVENDEDOR, C.ANOEMISION DESC, QUARTER DESC
      FETCH FIRST 100 ROWS ONLY
    `);

        console.log(`Found ${result.length} rows\n`);

        // Show first 10 rows
        console.log('Sample Data:');
        console.log('===========');
        result.slice(0, 10).forEach(row => {
            console.log(`Vendedor: ${row.CODIGOVENDEDOR} - ${row.NOMBREVENDEDOR}`);
            console.log(`  ${row.YEAR} T${row.QUARTER}: ${row.TOTALSALES}€ (${row.ORDERS} pedidos, ${row.CLIENTS} clientes)`);
        });

        // Pivot example
        console.log('\n\nPivot Example:');
        console.log('==============');
        const pivoted = {};

        result.forEach(row => {
            const key = `${row.CODIGOVENDEDOR} - ${row.NOMBREVENDEDOR}`;
            if (!pivoted[key]) {
                pivoted[key] = { total: 0 };
            }

            const period = `${row.YEAR}-T${row.QUARTER}`;
            pivoted[key][period] = parseFloat(row.TOTALSALES) || 0;
            pivoted[key].total += parseFloat(row.TOTALSALES) || 0;
        });

        // Show pivoted data
        Object.entries(pivoted).slice(0, 5).forEach(([vendor, data]) => {
            console.log(`\n${vendor}:`);
            Object.entries(data).forEach(([period, sales]) => {
                if (period !== 'total') {
                    console.log(`  ${period}: ${sales.toFixed(2)}€`);
                }
            });
            console.log(`  TOTAL: ${data.total.toFixed(2)}€`);
        });

    } finally {
        await conn.close();
    }
}

testMatrixData().catch(console.error);
