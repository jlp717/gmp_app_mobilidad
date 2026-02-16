const { query, initDb } = require('../config/db');

async function checkStatus() {
    try {
        await initDb();
        const client = '4300010203';
        console.log(`🔍 Checking Status for ${client}...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, MARCAACTUALIZACION, HEX(MARCAACTUALIZACION) as HEX_VAL
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE = '${client}'
        `);

        console.log(rows);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkStatus();
