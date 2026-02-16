const { query, initDb } = require('../config/db');

async function checkNames() {
    try {
        await initDb();
        const client = '4300009046';
        console.log(`🔍 Checking Names for ${client}...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, NOMBRECLIENTE, NOMBREALTERNATIVO
            FROM DSEDAC.CLI 
            WHERE CODIGOCLIENTE = '${client}'
        `);

        console.log(rows);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkNames();
