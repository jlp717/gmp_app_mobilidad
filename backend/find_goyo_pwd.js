/**
 * Query JAVIER.CUSTOMER_PASSWORDS for GOYO
 * Run with: node find_goyo_pwd.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function search() {
    console.log('='.repeat(60));
    console.log('FINDING GOYO PASSWORD IN JAVIER TABLES');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. List all JAVIER tables
        console.log('\n1. JAVIER tables with SELECT:');
        try {
            const result = await conn.query(`SELECT TABNAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER'`);
            console.log('  Tables:', result.map(r => r.TABNAME).join(', '));
        } catch (e) {
            // Try alternative
            try {
                const tables = await conn.query(`SELECT NAME FROM SYSIBM.SYSTABLES WHERE CREATOR = 'JAVIER'`);
                console.log('  Tables (alt):', tables.map(t => t.NAME).join(', '));
            } catch (e2) {
                console.log('  Error:', e2.message);
            }
        }

        // 2. Try CUSTOMER_PASSWORDS with explicit columns
        console.log('\n2. CUSTOMER_PASSWORDS structure:');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'CUSTOMER_PASSWORDS'
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Query CUSTOMER_PASSWORDS with CAST
        console.log('\n3. CUSTOMER_PASSWORDS data:');
        try {
            const data = await conn.query(`
        SELECT 
          CAST(CUSTOMER_CODE AS VARCHAR(50)) as CODE,
          CAST(PASSWORD_HASH AS VARCHAR(100)) as PWD
        FROM JAVIER.CUSTOMER_PASSWORDS
        FETCH FIRST 15 ROWS ONLY
      `);
            console.log('  Code       | Password');
            console.log('  ' + '-'.repeat(30));
            data.forEach(d => {
                console.log(`  ${(d.CODE || '').trim().padEnd(10)} | ${(d.PWD || '').trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Try direct query without CAST
        console.log('\n4. Direct CUSTOMER_PASSWORDS query:');
        try {
            const data = await conn.query(`
        SELECT * FROM JAVIER.CUSTOMER_PASSWORDS
        WHERE CUSTOMER_CODE = 'GOYO'
      `);
            if (data.length > 0) {
                console.log('  GOYO entry:', Object.entries(data[0]).map(([k, v]) => `${k}=${v}`).join(', '));
            } else {
                console.log('  GOYO not found');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Search for 9584 as a string value across tables
        console.log('\n5. Looking for vendedor with code correlation:');
        try {
            // VDDX has CODIGOUSUARIO column - check that
            const vddxGoyo = await conn.query(`
        SELECT CODIGOUSUARIO, CODIGOVENDEDOR 
        FROM DSEDAC.VDDX 
        WHERE CODIGOVENDEDOR = '93'
      `);
            if (vddxGoyo.length > 0) {
                console.log('  VDDX for 93:', JSON.stringify(vddxGoyo[0]));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Check if CODIGOUSUARIO links to APPUSUARIOS
        console.log('\n6. Checking APPUSUARIOS for linked user:');
        try {
            const appUsers = await conn.query(`
        SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
        FROM DSEDAC.APPUSUARIOS
        WHERE UPPER(NOMBREUSUARIO) LIKE '%GOYO%' OR UPPER(NOMBREUSUARIO) LIKE '%GREGORIO%'
      `);
            appUsers.forEach(u => {
                console.log(`  ${u.CODIGOUSUARIO?.trim() || ''}: pwd=${u.PASSWORD?.trim() || ''}, name=${u.NOMBREUSUARIO?.trim() || ''}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 7. Let me check vendedor 93's CODIGOUSUARIO in VDDX
        console.log('\n7. VDDX.CODIGOUSUARIO for vendedor 93:');
        try {
            const vddx93 = await conn.query(`
        SELECT CODIGOUSUARIO FROM DSEDAC.VDDX WHERE CODIGOVENDEDOR = '93'
      `);
            if (vddx93.length > 0 && vddx93[0].CODIGOUSUARIO) {
                const userId = vddx93[0].CODIGOUSUARIO.trim();
                console.log('  CODIGOUSUARIO:', userId);

                // Now check APPUSUARIOS for this user
                const appUser = await conn.query(`
          SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
          FROM DSEDAC.APPUSUARIOS
          WHERE CODIGOUSUARIO = '${userId}'
        `);
                if (appUser.length > 0) {
                    console.log('  APPUSUARIOS entry:', JSON.stringify(appUser[0]));
                }
            } else {
                console.log('  CODIGOUSUARIO not set for vendedor 93');
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
