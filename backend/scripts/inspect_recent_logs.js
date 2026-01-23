const { query, initDb } = require('../config/db');

async function checkLog() {
    try {
        await initDb();
        console.log('🔍 Checking Recent Rutero Logs...');

        const rows = await query(`
            SELECT VENDEDOR, CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES, FECHA_HORA
            FROM JAVIER.RUTERO_LOG
            ORDER BY FECHA_HORA DESC
            FETCH FIRST 10 ROWS ONLY
        `);

        rows.forEach(r => {
            console.log(`[${r.FECHA_HORA}] Vendor: ${r.VENDEDOR} | Cli: ${r.CLIENTE} | ${r.POSICION_ANTERIOR} -> ${r.POSICION_NUEVA}`);
            console.log(`   Details: ${r.DETALLES}`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkLog();
