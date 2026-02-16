const { query, initDb } = require('../config/db');

async function checkConfig() {
    try {
        await initDb();
        const clients = ['4300010334', '4300010203'];
        console.log(`🔍 Checking RUTERO_CONFIG for ${clients.join(', ')}...`);

        const rows = await query(`
            SELECT TRIM(VENDEDOR) as V, TRIM(CLIENTE) as C, TRIM(DIA) as D, ORDEN 
            FROM JAVIER.RUTERO_CONFIG 
            WHERE CLIENTE IN ('${clients.join("','")}')
            ORDER BY CLIENTE, DIA
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkConfig();
