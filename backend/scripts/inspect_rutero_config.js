const { query, initDb } = require('../config/db');

async function checkConfig() {
    try {
        await initDb();
        console.log('🔍 Checking RUTERO_CONFIG for Vendor 33...');

        const rows = await query(`
            SELECT VENDEDOR, CLIENTE, DIA, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = '33'
            ORDER BY ORDEN ASC
        `);

        console.log(`Found ${rows.length} config entries.`);
        rows.forEach(r => {
            console.log(`- Dia: '${r.DIA}' | Cli: ${r.CLIENTE} | Orden: ${r.ORDEN}`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkConfig();
