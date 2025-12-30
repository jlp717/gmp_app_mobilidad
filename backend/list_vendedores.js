/**
 * Script to list all vendedores and users for testing
 * Run: node list_vendedores.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function listVendedores() {
    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Connected to DB2\n');

        // Get all app users
        console.log('='.repeat(80));
        console.log('USUARIOS DE LA APP (APPUSUARIOS)');
        console.log('='.repeat(80));
        const users = await conn.query(`
      SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA, DELEGACION, GRUPO
      FROM DSEDAC.APPUSUARIOS
      WHERE SUBEMPRESA = 'GMP'
      ORDER BY CODIGOUSUARIO
    `);

        console.log(`\nTotal: ${users.length} usuarios\n`);
        console.log('USUARIO'.padEnd(15), 'NOMBRE'.padEnd(30), 'PASSWORD'.padEnd(12), 'DELEGACIÓN');
        console.log('-'.repeat(80));

        users.forEach(u => {
            console.log(
                (u.CODIGOUSUARIO?.trim() || '-').padEnd(15),
                (u.NOMBREUSUARIO?.trim() || '-').padEnd(30),
                (u.PASSWORD?.trim() || '-').padEnd(12),
                (u.DELEGACION?.trim() || '-')
            );
        });

        // Get all vendedores with their info
        console.log('\n\n' + '='.repeat(80));
        console.log('VENDEDORES (VDC + VDDX)');
        console.log('='.repeat(80));
        const vendedores = await conn.query(`
      SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, 
             X.JEFEVENTASSN, X.CORREOELECTRONICO,
             S.TOTAL_VENTAS
      FROM DSEDAC.VDC V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      LEFT JOIN (
        SELECT CODIGOVENDEDOR, SUM(IMPORTEVENTA) as TOTAL_VENTAS
        FROM DSEDAC.LINDTO
        WHERE ANODOCUMENTO = 2024
        GROUP BY CODIGOVENDEDOR
      ) S ON TRIM(V.CODIGOVENDEDOR) = TRIM(S.CODIGOVENDEDOR)
      WHERE V.SUBEMPRESA = 'GMP'
      ORDER BY COALESCE(S.TOTAL_VENTAS, 0) DESC
    `);

        console.log(`\nTotal: ${vendedores.length} vendedores\n`);
        console.log('CÓDIGO'.padEnd(10), 'TIPO'.padEnd(8), 'JEFE?'.padEnd(8), 'EMAIL'.padEnd(30), 'VENTAS 2024');
        console.log('-'.repeat(80));

        vendedores.forEach(v => {
            const code = v.CODIGOVENDEDOR?.trim() || '-';
            const tipo = v.TIPOVENDEDOR?.trim() || '-';
            const jefe = v.JEFEVENTASSN === 'S' ? 'SÍ' : 'NO';
            const email = v.CORREOELECTRONICO?.trim() || '-';
            const ventas = v.TOTAL_VENTAS ? `€${(v.TOTAL_VENTAS / 1000).toFixed(0)}K` : '-';
            console.log(code.padEnd(10), tipo.padEnd(8), jefe.padEnd(8), email.padEnd(30), ventas);
        });

        console.log('\n\n' + '='.repeat(80));
        console.log('CÓMO PROBAR:');
        console.log('='.repeat(80));
        console.log(`
1. Inicia el backend:
   cd backend && node server.js

2. Inicia la app Flutter:
   flutter run

3. Login como diferentes usuarios:
   - Cada usuario arriba tiene USERNAME y PASSWORD
   - Los JEFES DE VENTAS verán datos agregados de todos
   - Los COMERCIALES verán solo sus propios datos
`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

listVendedores();
