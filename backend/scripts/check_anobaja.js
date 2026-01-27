const { query, initDb } = require('../config/db');

async function checkAnobaja() {
    try {
        await initDb();
        const clients = ['4300009046', '4300010203'];
        console.log(`🔍 Checking ANOBAJA for clients...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, NOMBRECLIENTE, ANOBAJA
            FROM DSEDAC.CLI 
            WHERE CODIGOCLIENTE IN ('${clients.join("','")}')
        `);

        console.log(rows);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkAnobaja();
