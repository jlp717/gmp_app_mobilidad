/**
 * Check CUSTOMER_CREDENTIALS table for passwords
 * Run with: node check_credentials.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function search() {
    console.log('='.repeat(60));
    console.log('CHECKING CUSTOMER_CREDENTIALS TABLE');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. CUSTOMER_CREDENTIALS structure
        console.log('\n1. CUSTOMER_CREDENTIALS columns:');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'CUSTOMER_CREDENTIALS'
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Query credentials with CAST to avoid BigInt issues
        console.log('\n2. CUSTOMER_CREDENTIALS data (sample):');
        try {
            const data = await conn.query(`
        SELECT 
          CAST(USERNAME AS VARCHAR(50)) as USERNAME,
          CAST(LEGACY_PASSWORD AS VARCHAR(50)) as LEGACY_PWD,
          CAST(CUSTOMER_CODE AS VARCHAR(20)) as CODE
        FROM JAVIER.CUSTOMER_CREDENTIALS
        FETCH FIRST 20 ROWS ONLY
      `);
            console.log('  Username     | Legacy PWD  | Code');
            console.log('  ' + '-'.repeat(40));
            data.forEach(d => {
                console.log(`  ${(d.USERNAME || '').trim().padEnd(12)} | ${(d.LEGACY_PWD || '').trim().padEnd(11)} | ${(d.CODE || '').trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Find GOYO specifically
        console.log('\n3. Looking for GOYO:');
        try {
            const goyo = await conn.query(`
        SELECT 
          CAST(USERNAME AS VARCHAR(50)) as USERNAME,
          CAST(LEGACY_PASSWORD AS VARCHAR(50)) as LEGACY_PWD,
          CAST(CUSTOMER_CODE AS VARCHAR(20)) as CODE
        FROM JAVIER.CUSTOMER_CREDENTIALS
        WHERE UPPER(USERNAME) = 'GOYO' OR UPPER(CUSTOMER_CODE) = 'GOYO' OR USERNAME = '93'
      `);
            if (goyo.length > 0) {
                goyo.forEach(g => {
                    console.log(`  Found: Username=${g.USERNAME?.trim()}, LegacyPwd=${g.LEGACY_PWD?.trim()}, Code=${g.CODE?.trim()}`);
                });
            } else {
                console.log('  GOYO not found');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Check for any entries with password 9584
        console.log('\n4. Entries with password containing 9584:');
        try {
            const pwd9584 = await conn.query(`
        SELECT 
          CAST(USERNAME AS VARCHAR(50)) as USERNAME,
          CAST(LEGACY_PASSWORD AS VARCHAR(50)) as LEGACY_PWD,
          CAST(CUSTOMER_CODE AS VARCHAR(20)) as CODE
        FROM JAVIER.CUSTOMER_CREDENTIALS
        WHERE LEGACY_PASSWORD LIKE '%9584%'
      `);
            if (pwd9584.length > 0) {
                pwd9584.forEach(p => {
                    console.log(`  Found: ${p.USERNAME?.trim()} - pwd=${p.LEGACY_PWD?.trim()} - code=${p.CODE?.trim()}`);
                });
            } else {
                console.log('  No entries with 9584');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check V_LEGACY_PASSWORD_CUSTOMERS view
        console.log('\n5. V_LEGACY_PASSWORD_CUSTOMERS view (sample):');
        try {
            const legacy = await conn.query(`
        SELECT * FROM JAVIER.V_LEGACY_PASSWORD_CUSTOMERS
        FETCH FIRST 10 ROWS ONLY
      `);
            if (legacy.length > 0) {
                console.log('  Columns:', Object.keys(legacy[0]).join(', '));
                legacy.forEach(l => {
                    const vals = Object.entries(l).map(([k, v]) => `${k}=${String(v || '').trim().substring(0, 15)}`).join(', ');
                    console.log('  ', vals);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

search().catch(console.error);
