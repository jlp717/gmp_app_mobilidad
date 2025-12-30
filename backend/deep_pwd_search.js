/**
 * Deep search for password 9584 across all possible tables
 * Run with: node deep_pwd_search.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function search() {
    console.log('='.repeat(60));
    console.log('DEEP SEARCH FOR PASSWORD 9584');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Check VDC columns
        console.log('\n1. VDC table columns:');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDC'
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Check all columns in VDC for vendedor 93
        console.log('\n2. VDC row for vendedor 93:');
        try {
            const vdc93 = await conn.query(`
        SELECT * FROM DSEDAC.VDC WHERE CODIGOVENDEDOR = '93'
      `);
            if (vdc93.length > 0) {
                for (const [k, v] of Object.entries(vdc93[0])) {
                    const val = String(v || '').trim();
                    if (val) console.log(`  ${k}: ${val.substring(0, 50)}`);
                    // Check if any value contains 9584
                    if (val.includes('9584')) {
                        console.log(`  >>> FOUND 9584 in column ${k}!`);
                    }
                }
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Check CLI (clientes) for any password field
        console.log('\n3. CLI columns that might contain passwords:');
        try {
            const cliCols = await conn.query(`
        SELECT COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
        AND (COLUMN_NAME LIKE '%PASS%' OR COLUMN_NAME LIKE '%COD%' OR COLUMN_NAME LIKE '%PIN%' OR COLUMN_NAME LIKE '%CLAVE%')
      `);
            console.log('  Columns:', cliCols.map(c => c.COLUMN_NAME).join(', '));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Maybe GOYO uses a different user code - check MARICARMEN since email is hers
        console.log('\n4. Checking MARICARMEN in APPUSUARIOS (GOYO VDDX email is maricarmen@):');
        try {
            const mc = await conn.query(`
        SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
        FROM DSEDAC.APPUSUARIOS
        WHERE UPPER(CODIGOUSUARIO) = 'MARICARMEN' OR UPPER(NOMBREUSUARIO) LIKE '%MARICARMEN%'
      `);
            mc.forEach(u => {
                console.log(`  ${u.CODIGOUSUARIO?.trim()}: pwd=${u.PASSWORD?.trim()}, name=${u.NOMBREUSUARIO?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check for users ending in numbers like 9584
        console.log('\n5. APPUSUARIOS with password containing 9584 or 95:');
        try {
            const users = await conn.query(`
        SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
        FROM DSEDAC.APPUSUARIOS
        WHERE PASSWORD LIKE '%95%'
      `);
            users.forEach(u => {
                console.log(`  ${u.CODIGOUSUARIO?.trim()}: pwd=${u.PASSWORD?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Check if there's a USUARIOS or USR table
        console.log('\n6. Looking for other user tables:');
        try {
            const userTables = await conn.query(`
        SELECT TABLE_NAME, TABLE_SCHEMA 
        FROM QSYS2.SYSTABLES 
        WHERE (TABLE_NAME LIKE '%USR%' OR TABLE_NAME LIKE '%USER%' OR TABLE_NAME LIKE '%LOGIN%')
        AND TABLE_SCHEMA IN ('DSED', 'DSEDAC', 'JAVIER')
      `);
            userTables.forEach(t => console.log(`  ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 7. Check JAVIER.CUSTOMER_EMAILS for user info
        console.log('\n7. JAVIER.CUSTOMER_EMAILS structure:');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'CUSTOMER_EMAILS'
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 8. List all JAVIER tables
        console.log('\n8. ALL JAVIER schema tables:');
        try {
            const tables = await conn.query(`
        SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER'
      `);
            console.log('  Tables:', tables.map(t => t.TABLE_NAME).join(', '));
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
