/**
 * Find GOYO user credentials and test all API endpoints
 */

const odbc = require('odbc');

async function testGOYO() {
    const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

    console.log('=== FINDING GOYO USER ===');
    const users = await conn.query(`
    SELECT * FROM DSEDAC.APPUSUARIOS
    WHERE UPPER(CODIGOUSUARIO) LIKE '%GOYO%'
       OR UPPER(NOMBREUSUARIO) LIKE '%GOYO%'
  `);
    console.log(JSON.stringify(users, null, 2));

    if (users.length > 0) {
        const goyo = users[0];
        console.log('\n=== GOYO CREDENTIALS ===');
        console.log('Username:', goyo.CODIGOUSUARIO?.trim());
        console.log('Password:', goyo.PASSWORD?.trim());
    }

    // Also check vendedores in LINDTO to find GOYO's sales
    console.log('\n=== CHECKING LINDTO FOR GOYO ===');

    // First get all unique vendedor codes
    const vendedores = await conn.query(`
    SELECT DISTINCT CODIGOVENDEDOR, COUNT(*) as VENTAS
    FROM DSEDAC.LINDTO
    WHERE ANODOCUMENTO = 2025
    GROUP BY CODIGOVENDEDOR
    ORDER BY VENTAS DESC
    FETCH FIRST 20 ROWS ONLY
  `);
    console.log('Active vendedores in 2025:', JSON.stringify(vendedores, null, 2));

    await conn.close();
}

testGOYO().catch(console.error);
