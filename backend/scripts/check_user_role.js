require('dotenv').config();
const { initDb, query } = require('../config/db');

async function checkUser(username) {
    try {
        await initDb();
        console.log(`Checking user: ${username}`);

        // 1. Get APPUSUARIOS
        const users = await query(`
            SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA
            FROM DSEDAC.APPUSUARIOS
            WHERE UPPER(TRIM(CODIGOUSUARIO)) = '${username.toUpperCase()}'
              AND SUBEMPRESA = 'GMP'
        `);

        if (users.length === 0) {
            console.log('User not found in APPUSUARIOS');
            return;
        }

        const user = users[0];
        console.log('User found:', user);

        // 2. Logic from auth.js
        const searchPattern = (user.NOMBREUSUARIO || '').trim().toUpperCase().substring(0, 4);
        console.log(`Search Pattern: '${searchPattern}'`);

        if (searchPattern.length >= 2) {
            const vendedorInfo = await query(`
                SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
                FROM DSEDAC.VDC V
                LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                WHERE V.SUBEMPRESA = 'GMP' AND UPPER(X.CORREOELECTRONICO) LIKE '%${searchPattern}%'
            `);

            console.log('Vendor Matches:', vendedorInfo);
        } else {
            console.log('Search pattern too short.');
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

(async () => {
    await checkUser('JAVIER');
    await checkUser('ADMIN');
    // await checkUser('NDELAMO');
    process.exit(0);
})();
