/**
 * Database Exploration Script - Holidays and Sunday Analysis
 * Run with: node explore_holidays.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING HOLIDAYS AND SUNDAY SCHEDULE');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Check routes that include Sunday (D)
        console.log('1. ROUTES WITH SUNDAY (D) IN DESCRIPTION...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT CODIGORUTA, DESCRIPCIONRUTA
        FROM DSEDAC.RUT
        WHERE UPPER(DESCRIPCIONRUTA) LIKE '%D %' 
           OR UPPER(DESCRIPCIONRUTA) LIKE '%,D%'
           OR UPPER(DESCRIPCIONRUTA) LIKE '% D,%'
        FETCH FIRST 20 ROWS ONLY
      `);
            if (result1.length > 0) {
                console.log('Routes with Sunday:');
                result1.forEach(r => console.log(`  ${r.CODIGORUTA?.trim()} - ${r.DESCRIPCIONRUTA?.trim()}`));
            } else {
                console.log('  No routes with Sunday found');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Look for holiday/festivo tables
        console.log('\n2. LOOKING FOR HOLIDAY/FESTIVO TABLES...');
        console.log('-'.repeat(50));
        const tableNamesToTry = ['FES', 'FEST', 'FESTIVO', 'FESTIVOS', 'CAL', 'CALENDARIO', 'HOL', 'HOLIDAY', 'FIESTAS'];
        let found = false;
        for (const tbl of tableNamesToTry) {
            try {
                const result = await conn.query(`SELECT * FROM DSEDAC.${tbl} FETCH FIRST 3 ROWS ONLY`);
                console.log(`  ✓ Found DSEDAC.${tbl}:`);
                console.log(`    Columns: ${Object.keys(result[0] || {}).join(', ')}`);
                result.forEach((r, i) => console.log(`    Row ${i}: ${JSON.stringify(r).substring(0, 150)}`));
                found = true;
            } catch (e) {
                // Table doesn't exist
            }
        }
        if (!found) console.log('  No holiday tables found in DSEDAC');

        // 3. Check CLI for vacation fields
        console.log('\n3. CLI VACATION FIELDS...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`
        SELECT CODIGOCLIENTE, NOMBRECLIENTE, 
               DIAINICIOVACACIONES, MESINICIOVACACIONES, ANOINICIOVACACIONES,
               DIAFINALVACACIONES, MESFINALVACACIONES, ANOFINALVACACIONES
        FROM DSEDAC.CLI
        WHERE MESINICIOVACACIONES IS NOT NULL AND MESINICIOVACACIONES <> 0
        FETCH FIRST 10 ROWS ONLY
      `);
            if (result3.length > 0) {
                console.log('Clients with vacation dates:');
                result3.forEach(r => {
                    const start = `${r.DIAINICIOVACACIONES || '?'}/${r.MESINICIOVACACIONES || '?'}/${r.ANOINICIOVACACIONES || '?'}`;
                    const end = `${r.DIAFINALVACACIONES || '?'}/${r.MESFINALVACACIONES || '?'}/${r.ANOFINALVACACIONES || '?'}`;
                    console.log(`  ${r.NOMBRECLIENTE?.trim()?.substring(0, 30)} | Vac: ${start} - ${end}`);
                });
            } else {
                console.log('  No clients with vacation dates found');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Count clients by Sunday route
        console.log('\n4. COUNT CLIENTS WITH SUNDAY VISIT ROUTES...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT COUNT(DISTINCT C.CODIGOCLIENTE) as SUNDAY_CLIENTS
        FROM DSEDAC.CLI C
        INNER JOIN DSEDAC.RUT R ON C.CODIGORUTA = R.CODIGORUTA
        WHERE UPPER(R.DESCRIPCIONRUTA) LIKE '%D %' 
           OR UPPER(R.DESCRIPCIONRUTA) LIKE '%,D%'
           OR UPPER(R.DESCRIPCIONRUTA) LIKE '% D,%'
           OR UPPER(R.DESCRIPCIONRUTA) LIKE '%D)'
      `);
            console.log(`  Clients with Sunday routes: ${result4[0]?.SUNDAY_CLIENTS || 0}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check for any DIARIO column that might indicate daily schedule
        console.log('\n5. LOOKING FOR DAILY SCHEDULE COLUMNS IN CLI...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`SELECT * FROM DSEDAC.CLI FETCH FIRST 1 ROWS ONLY`);
            if (result5.length > 0) {
                const cols = Object.keys(result5[0]);
                const relevantCols = cols.filter(c =>
                    c.includes('DIA') || c.includes('LUN') || c.includes('MAR') ||
                    c.includes('MIE') || c.includes('JUE') || c.includes('VIE') ||
                    c.includes('SAB') || c.includes('DOM') || c.includes('FEST')
                );
                if (relevantCols.length > 0) {
                    console.log(`  Found day-related columns: ${relevantCols.join(', ')}`);
                } else {
                    console.log('  No day-specific columns in CLI table');
                }
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Check if there's activity on Sundays
        console.log('\n6. ACTIVITY ON SUNDAYS (LAC table, day=0 or day=7)...');
        console.log('-'.repeat(50));
        try {
            // In DB2, DAYOFWEEK returns 1=Sunday, 7=Saturday
            const result6 = await conn.query(`
        SELECT COUNT(*) as SUNDAY_TRANSACTIONS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2024 
          AND DAYOFWEEK(DATE(ANODOCUMENTO || '-' || RIGHT('0' || MESDOCUMENTO, 2) || '-' || RIGHT('0' || DIADOCUMENTO, 2))) = 1
        FETCH FIRST 1 ROWS ONLY
      `);
            console.log(`  Sunday transactions in 2024: ${result6[0]?.SUNDAY_TRANSACTIONS || 0}`);
        } catch (e) {
            // Alternative approach
            try {
                const result6b = await conn.query(`
          SELECT DIADOCUMENTO, MESDOCUMENTO, COUNT(*) as CNT
          FROM DSEDAC.LAC
          WHERE ANODOCUMENTO = 2024
          GROUP BY DIADOCUMENTO, MESDOCUMENTO
          ORDER BY MESDOCUMENTO, DIADOCUMENTO
          FETCH FIRST 5 ROWS ONLY
        `);
                console.log('  Sample day distribution:');
                result6b.forEach(r => console.log(`    Day ${r.DIADOCUMENTO}, Month ${r.MESDOCUMENTO}: ${r.CNT} transactions`));
            } catch (e2) {
                console.log('  Error checking Sunday activity:', e.message);
            }
        }

        console.log('\n' + '='.repeat(70));
        console.log('EXPLORATION COMPLETE');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Connection error:', error.message);
    } finally {
        if (conn) {
            await conn.close();
        }
    }
}

explore().catch(console.error);
