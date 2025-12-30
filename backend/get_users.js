/**
 * Get users/passwords from VDDX
 * Run with: node get_users.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function getUsers() {
    console.log('='.repeat(80));
    console.log('USUARIOS Y CONTRASEÑAS PARA LOGIN');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Get column names first
        console.log('\n1. Estructura de VDDX:');
        const cols = await conn.query(`
      SELECT COLNAME, TYPENAME 
      FROM SYSCAT.COLUMNS 
      WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'VDDX'
      AND (COLNAME LIKE '%USER%' OR COLNAME LIKE '%PASS%' OR COLNAME LIKE '%CODIGO%' OR COLNAME LIKE '%NOMBRE%')
    `);
        cols.forEach(c => console.log(`  ${c.COLNAME}: ${c.TYPENAME}`));

        // Get users from VDC
        console.log('\n2. Usuarios de VDC:');
        const vdc = await conn.query(`
      SELECT 
        CODIGOVENDEDOR,
        NOMBREVENDEDOR,
        TIPOVENDEDOR
      FROM DSEDAC.VDC
      ORDER BY CODIGOVENDEDOR
      FETCH FIRST 25 ROWS ONLY
    `);

        console.log('  Código | Nombre                              | Tipo');
        console.log('  ' + '-'.repeat(60));
        vdc.forEach(u => {
            const code = (u.CODIGOVENDEDOR || '').trim().padEnd(6);
            const name = (u.NOMBREVENDEDOR || '').trim().substring(0, 35).padEnd(35);
            const tipo = (u.TIPOVENDEDOR || '').trim();
            console.log(`  ${code} | ${name} | ${tipo}`);
        });

        // Try to get passwords from different location
        console.log('\n3. Intentando obtener contraseñas de VDDX:');
        try {
            const pwds = await conn.query(`
        SELECT * FROM DSEDAC.VDDX
        FETCH FIRST 5 ROWS ONLY
      `);
            if (pwds.length > 0) {
                console.log('  Columnas:', Object.keys(pwds[0]).join(', '));
                console.log('  Fila ejemplo:', JSON.stringify(pwds[0]).substring(0, 200));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // Check customer table for clients as users
        console.log('\n4. Clientes que pueden ser usuarios (tabla CLI):');
        try {
            const clis = await conn.query(`
        SELECT 
          CODIGOCLIENTE,
          NOMBRECLIENTE
        FROM DSEDAC.CLI
        WHERE CODIGOVENDEDOR = '33'
        FETCH FIRST 10 ROWS ONLY
      `);
            clis.forEach(c => {
                console.log(`  ${c.CODIGOCLIENTE?.trim()} - ${c.NOMBRECLIENTE?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

getUsers().catch(console.error);
