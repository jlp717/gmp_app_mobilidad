const { query, initDb } = require('../config/db');

async function checkMarca() {
    try {
        await initDb();
        const clients = ['4300010334', '4300010203', '4300009046']; // Added 9046 for comparison
        console.log(`🔍 Checking MARCA for ${clients.join(', ')}...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, MARCAACTUALIZACION
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE IN ('${clients.join("','")}')
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkMarca();
