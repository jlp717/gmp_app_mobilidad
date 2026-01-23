const { query, initDb } = require('../config/db');

async function checkConfig() {
    try {
        await initDb();
        console.log('🔍 Checking RUTERO_CONFIG for Client 10339...');

        const rows = await query(`
            SELECT VENDEDOR, CLIENTE, DIA, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE CLIENTE = '4300010339'
        `);

        console.log(`Found ${rows.length} config entries.`);
        rows.forEach(r => {
            console.log(`- Vend: '${r.VENDEDOR}' | Dia: '${r.DIA}' | Orden: ${r.ORDEN}`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkConfig();
