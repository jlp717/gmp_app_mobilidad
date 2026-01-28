const { query, initDb } = require('../config/db');

async function checkOrder() {
    try {
        await initDb();
        console.log('🔍 Checking Natural Order (ORDENVISITALUNES) for Vendor 15...');

        const rows = await query(`
            SELECT CODIGOCLIENTE, ORDENVISITALUNES, ORDENVISITAVIERNES
            FROM DSEDAC.CDVI 
            WHERE CODIGOVENDEDOR = '15'
            AND (DIAVISITALUNESSN = 'S' OR DIAVISITAVIERNESSN = 'S')
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkOrder();
