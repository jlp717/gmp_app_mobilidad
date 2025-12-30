/**
 * Debug script to test sales-evolution query directly
 * Run: node test_evolution.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';
const MIN_YEAR = 2023;

async function testQueries() {
    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Connected to DB2\n');

        // Test 1: Check what years/months have data
        console.log('='.repeat(60));
        console.log('TEST 1: All available months with sales data');
        console.log('='.repeat(60));

        const allMonths = await conn.query(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
             SUM(IMPORTEVENTA) as totalSales, 
             COUNT(*) as numLines
      FROM DSEDAC.LINDTO 
      WHERE ANODOCUMENTO >= ${MIN_YEAR}
      GROUP BY ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
    `);

        console.log(`\nFound ${allMonths.length} months with data:\n`);
        console.log('YEAR  MONTH  TOTAL_SALES      LINES');
        console.log('-'.repeat(40));
        allMonths.forEach(row => {
            console.log(
                String(row.YEAR).padEnd(6),
                String(row.MONTH).padEnd(7),
                `€${(row.TOTALSALES / 1000).toFixed(0)}K`.padEnd(17),
                row.NUMLINES
            );
        });

        // Test 2: Check with vendedor filter (simulating GOYO who should see all)
        console.log('\n\n' + '='.repeat(60));
        console.log('TEST 2: With vendedor filter (empty = ALL)');
        console.log('='.repeat(60));

        const withFilter = await conn.query(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
             SUM(IMPORTEVENTA) as totalSales
      FROM DSEDAC.LINDTO 
      WHERE ANODOCUMENTO >= ${MIN_YEAR}
      GROUP BY ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      FETCH FIRST 36 ROWS ONLY
    `);

        console.log(`\nFound ${withFilter.length} rows (limit 36):\n`);
        withFilter.forEach(row => {
            console.log(`${row.YEAR}-${String(row.MONTH).padStart(2, '0')}: €${(row.TOTALSALES / 1000).toFixed(0)}K`);
        });

        // Test 3: Check specific year 2024
        console.log('\n\n' + '='.repeat(60));
        console.log('TEST 3: Only year 2024');
        console.log('='.repeat(60));

        const year2024 = await conn.query(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as totalSales
      FROM DSEDAC.LINDTO 
      WHERE ANODOCUMENTO = 2024
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `);

        console.log(`\n2024 has ${year2024.length} months with data:\n`);
        year2024.forEach(row => {
            console.log(`  Month ${row.MONTH}: €${(row.TOTALSALES / 1000).toFixed(0)}K`);
        });

        // Test 4: Check specific year 2023
        console.log('\n\n' + '='.repeat(60));
        console.log('TEST 4: Only year 2023');
        console.log('='.repeat(60));

        const year2023 = await conn.query(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as totalSales
      FROM DSEDAC.LINDTO 
      WHERE ANODOCUMENTO = 2023
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `);

        console.log(`\n2023 has ${year2023.length} months with data:\n`);
        year2023.forEach(row => {
            console.log(`  Month ${row.MONTH}: €${(row.TOTALSALES / 1000).toFixed(0)}K`);
        });

        // Test 5: Check specific year 2025
        console.log('\n\n' + '='.repeat(60));
        console.log('TEST 5: Only year 2025');
        console.log('='.repeat(60));

        const year2025 = await conn.query(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as totalSales
      FROM DSEDAC.LINDTO 
      WHERE ANODOCUMENTO = 2025
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `);

        console.log(`\n2025 has ${year2025.length} months with data:\n`);
        year2025.forEach(row => {
            console.log(`  Month ${row.MONTH}: €${(row.TOTALSALES / 1000).toFixed(0)}K`);
        });

        console.log('\n\nDIAGNOSIS:');
        console.log('='.repeat(60));
        console.log(`Total months in DB: ${allMonths.length}`);
        console.log(`2023: ${year2023.length} months`);
        console.log(`2024: ${year2024.length} months`);
        console.log(`2025: ${year2025.length} months`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

testQueries();
