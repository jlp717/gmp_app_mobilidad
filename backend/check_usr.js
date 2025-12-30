/**
 * Check DSEDAC.USR table for vendor passwords
 * Run with: node check_usr.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function search() {
    console.log('='.repeat(60));
    console.log('CHECKING DSEDAC.USR TABLE');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. USR table columns
        console.log('\n1. DSEDAC.USR columns:');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'USR'
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Sample USR data
        console.log('\n2. DSEDAC.USR data:');
        try {
            const data = await conn.query(`
        SELECT * FROM DSEDAC.USR
        FETCH FIRST 15 ROWS ONLY
      `);
            if (data.length > 0) {
                const cols = Object.keys(data[0]);
                console.log('  Columns:', cols.join(', '));
                data.forEach(d => {
                    const vals = Object.values(d).map(v => String(v || '').trim().substring(0, 12)).join(' | ');
                    console.log('  ', vals);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. USRL1 table
        console.log('\n3. DSEDAC.USRL1 columns:');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'USRL1'
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. USRL1 data sample
        console.log('\n4. DSEDAC.USRL1 data:');
        try {
            const data = await conn.query(`
        SELECT * FROM DSEDAC.USRL1
        FETCH FIRST 15 ROWS ONLY
      `);
            if (data.length > 0) {
                const cols = Object.keys(data[0]);
                console.log('  Columns:', cols.join(', '));
                data.forEach(d => {
                    const vals = Object.values(d).map(v => String(v || '').trim().substring(0, 15)).join(' | ');
                    console.log('  ', vals);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Search in USR for password field containing 9584
        console.log('\n5. Looking for 9584 in USR:');
        try {
            const data = await conn.query(`
        SELECT * FROM DSEDAC.USR
        WHERE CODIGOUSUARIO LIKE '%9584%' OR CLAVEUSUARIO LIKE '%9584%'
      `);
            if (data.length > 0) {
                data.forEach(d => console.log('  Found:', JSON.stringify(d)));
            } else {
                console.log('  Not found');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. All APPUSUARIOS entries sorted by password
        console.log('\n6. All APPUSUARIOS with numeric passwords:');
        try {
            const data = await conn.query(`
        SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
        FROM DSEDAC.APPUSUARIOS
        WHERE PASSWORD REGEXP_LIKE '[0-9]+'
        ORDER BY PASSWORD
      `);
            data.forEach(d => {
                console.log(`  ${(d.CODIGOUSUARIO || '').trim().padEnd(12)} | ${(d.PASSWORD || '').trim().padEnd(8)} | ${(d.NOMBREUSUARIO || '').trim()}`);
            });
        } catch (e) {
            // Try without REGEXP
            try {
                const data = await conn.query(`
          SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
          FROM DSEDAC.APPUSUARIOS
          ORDER BY PASSWORD
        `);
                data.forEach(d => {
                    const pwd = (d.PASSWORD || '').trim();
                    // Only show numeric passwords
                    if (/^\d+$/.test(pwd)) {
                        console.log(`  ${(d.CODIGOUSUARIO || '').trim().padEnd(12)} | ${pwd.padEnd(8)} | ${(d.NOMBREUSUARIO || '').trim()}`);
                    }
                });
            } catch (e2) {
                console.log('  Error:', e2.message);
            }
        }

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

search().catch(console.error);
