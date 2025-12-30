/**
 * Get users from APPUSUARIOS table
 * Run with: node get_app_users.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function getUsers() {
    console.log('='.repeat(80));
    console.log('USUARIOS DE APPUSUARIOS PARA LOGIN');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Get all users from APPUSUARIOS
        console.log('\n👤 USUARIOS EN APPUSUARIOS (tabla de login):');
        console.log('-'.repeat(75));

        const users = await conn.query(`
      SELECT 
        ID,
        CODIGOUSUARIO,
        NOMBREUSUARIO,
        PASSWORD,
        SUBEMPRESA,
        DELEGACION,
        GRUPO
      FROM DSEDAC.APPUSUARIOS
      WHERE SUBEMPRESA = 'GMP'
      ORDER BY CODIGOUSUARIO
    `);

        console.log('Usuario      | Contraseña       | Nombre                           | Delegación');
        console.log('-'.repeat(85));
        users.forEach(u => {
            const user = (u.CODIGOUSUARIO || '').trim().padEnd(12);
            const pass = (u.PASSWORD || '').trim().padEnd(16);
            const name = (u.NOMBREUSUARIO || '').trim().substring(0, 32).padEnd(32);
            const del = (u.DELEGACION || '').trim();
            console.log(`${user} | ${pass} | ${name} | ${del}`);
        });

        console.log('\n' + '='.repeat(80));
        console.log('RESUMEN:');
        console.log(`  Total usuarios: ${users.length}`);
        console.log('='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

getUsers().catch(console.error);
