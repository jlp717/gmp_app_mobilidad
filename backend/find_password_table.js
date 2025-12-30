/**
 * Search for password tables in DB - GOYO password 9584 must be somewhere
 * Run with: node find_password_table.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function search() {
    console.log('='.repeat(80));
    console.log('SEARCHING FOR PASSWORD TABLES AND GOYO 9584');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Look for tables with PASSWORD or PASS in column names
        console.log('\n1. 🔍 TABLES WITH PASSWORD-LIKE COLUMNS:');
        console.log('-'.repeat(70));

        try {
            // Check VDC table
            console.log('\n  Checking VDC (vendedores):');
            const vdc = await conn.query(`
        SELECT CODIGOVENDEDOR, NOMBREVENDEDOR 
        FROM DSEDAC.VDC 
        WHERE SUBEMPRESA = 'GMP' 
        ORDER BY CODIGOVENDEDOR
        FETCH FIRST 30 ROWS ONLY
      `);
            vdc.forEach(v => console.log(`    ${(v.CODIGOVENDEDOR || '').trim()} - ${(v.NOMBREVENDEDOR || '').trim()}`));
        } catch (e) { console.log('    VDC error:', e.message); }

        // 2. Check VDDX - extended vendedor data
        console.log('\n  Checking VDDX (extended vendedor data):');
        try {
            const vddxSample = await conn.query(`
        SELECT * FROM DSEDAC.VDDX
        WHERE CODIGOVENDEDOR = '93'
        FETCH FIRST 1 ROWS ONLY
      `);
            if (vddxSample.length > 0) {
                console.log('    Columns in VDDX:', Object.keys(vddxSample[0]).join(', '));
                // Look for any column that might contain password
                for (const [key, val] of Object.entries(vddxSample[0])) {
                    if (val && String(val).trim() === '9584') {
                        console.log(`    >>> FOUND 9584 in column: ${key}`);
                    }
                    if (key.toLowerCase().includes('pass') || key.toLowerCase().includes('pwd') || key.toLowerCase().includes('clave')) {
                        console.log(`    Password-like column: ${key} = ${val}`);
                    }
                }
            }
        } catch (e) { console.log('    VDDX error:', e.message); }

        // 3. Check if there's a vendedor code 93 (GOYO)
        console.log('\n  Looking for GOYO in vendedor tables:');
        try {
            const goyoVdc = await conn.query(`
        SELECT * FROM DSEDAC.VDC 
        WHERE NOMBREVENDEDOR LIKE '%GOYO%' OR NOMBREVENDEDOR LIKE '%GREGORIO%'
      `);
            if (goyoVdc.length > 0) {
                console.log('    Found GOYO in VDC:', JSON.stringify(goyoVdc[0]).substring(0, 200));
            }
        } catch (e) { console.log('    Error:', e.message); }

        // 4. Check VDDX for GOYO
        console.log('\n  Looking for GOYO in VDDX:');
        try {
            const goyoVddx = await conn.query(`
        SELECT * FROM DSEDAC.VDDX 
        WHERE CODIGOVENDEDOR = '93'
        FETCH FIRST 1 ROWS ONLY
      `);
            if (goyoVddx.length > 0) {
                console.log('    VDDX row for 93 (GOYO):');
                for (const [k, v] of Object.entries(goyoVddx[0])) {
                    if (v && String(v).trim()) {
                        console.log(`      ${k}: ${String(v).trim().substring(0, 50)}`);
                    }
                }
            }
        } catch (e) { console.log('    Error:', e.message); }

        // 5. Search for tables that contain '9584'
        console.log('\n\n2. 🔎 SEARCHING FOR VALUE 9584 IN KNOWN TABLES:');
        console.log('-'.repeat(70));

        // Check CLI table for any password field
        try {
            const cliCols = await conn.query(`
        SELECT COLNAME 
        FROM SYSIBM.SYSCOLUMNS 
        WHERE TBNAME = 'CLI' AND TBCREATOR = 'DSEDAC'
        AND (COLNAME LIKE '%PASS%' OR COLNAME LIKE '%CLAVE%' OR COLNAME LIKE '%COD%')
      `);
            console.log('  Password-like columns in CLI:', cliCols.map(c => c.COLNAME).join(', '));
        } catch (e) { }

        // 6. Check JAVIER schema for password tables
        console.log('\n\n3. 🔎 CHECKING JAVIER SCHEMA TABLES:');
        console.log('-'.repeat(70));

        try {
            const javierTables = await conn.query(`
        SELECT TABNAME FROM SYSIBM.SYSTABLES 
        WHERE CREATOR = 'JAVIER'
        AND (TABNAME LIKE '%PASS%' OR TABNAME LIKE '%USER%' OR TABNAME LIKE '%CRED%' OR TABNAME LIKE '%LOGIN%')
      `);
            console.log('  Password-related tables in JAVIER:', javierTables.map(t => t.TABNAME).join(', '));
        } catch (e) { console.log('    Error:', e.message); }

        // 7. Check if CUSTOMER_PASSWORDS exists in JAVIER
        console.log('\n  Checking JAVIER.CUSTOMER_PASSWORDS:');
        try {
            const custPwd = await conn.query(`
        SELECT * FROM JAVIER.CUSTOMER_PASSWORDS
        FETCH FIRST 10 ROWS ONLY
      `);
            if (custPwd.length > 0) {
                console.log('    Found! Sample:', JSON.stringify(custPwd[0]));
                // Look for GOYO
                const goyoPwd = await conn.query(`
          SELECT * FROM JAVIER.CUSTOMER_PASSWORDS
          WHERE CUSTOMER_CODE = 'GOYO' OR UPPER(CUSTOMER_CODE) = 'GOYO'
        `);
                if (goyoPwd.length > 0) {
                    console.log('    GOYO entry:', JSON.stringify(goyoPwd[0]));
                }
            }
        } catch (e) { console.log('    Not found or error:', e.message); }

        // 8. Check all tables in JAVIER schema
        console.log('\n\n4. 📋 ALL JAVIER SCHEMA TABLES:');
        console.log('-'.repeat(70));
        try {
            const allJavier = await conn.query(`
        SELECT TABNAME FROM SYSIBM.SYSTABLES WHERE CREATOR = 'JAVIER'
      `);
            console.log('  Tables:', allJavier.map(t => t.TABNAME).join(', '));
        } catch (e) { console.log('    Error:', e.message); }

        console.log('\n' + '='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

search().catch(console.error);
