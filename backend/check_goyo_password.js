/**
 * Check and update GOYO password in APPUSUARIOS
 * Run with: node check_goyo_password.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function checkGoyo() {
    console.log('='.repeat(60));
    console.log('CHECKING GOYO PASSWORD');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check current GOYO password
        const result = await conn.query(`
      SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
      FROM DSEDAC.APPUSUARIOS
      WHERE UPPER(CODIGOUSUARIO) = 'GOYO'
    `);

        if (result.length > 0) {
            console.log('\nCurrent GOYO entry:');
            console.log(`  Usuario: ${result[0].CODIGOUSUARIO?.trim()}`);
            console.log(`  Password: ${result[0].PASSWORD?.trim()}`);
            console.log(`  Nombre: ${result[0].NOMBREUSUARIO?.trim()}`);

            // Check if password is correct
            if (result[0].PASSWORD?.trim() === '9584') {
                console.log('\n✓ Password is already correct (9584)');
            } else {
                console.log(`\n✗ Password is ${result[0].PASSWORD?.trim()}, expected 9584`);
                console.log('  Need to update password in database');
            }
        } else {
            console.log('GOYO user not found in APPUSUARIOS');
        }

        // Also check all users with similar patterns
        console.log('\n\nAll users with their passwords:');
        const allUsers = await conn.query(`
      SELECT CODIGOUSUARIO, PASSWORD, NOMBREUSUARIO
      FROM DSEDAC.APPUSUARIOS
      WHERE SUBEMPRESA = 'GMP'
      ORDER BY CODIGOUSUARIO
    `);

        console.log('Usuario       | Password   | Nombre');
        console.log('-'.repeat(50));
        allUsers.forEach(u => {
            const user = (u.CODIGOUSUARIO || '').trim().padEnd(13);
            const pass = (u.PASSWORD || '').trim().padEnd(10);
            const name = (u.NOMBREUSUARIO || '').trim().substring(0, 20);
            console.log(`${user} | ${pass} | ${name}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

checkGoyo().catch(console.error);
