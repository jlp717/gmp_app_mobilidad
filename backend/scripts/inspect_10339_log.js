const { query, initDb } = require('../config/db');

async function checkLog() {
    try {
        await initDb();
        console.log('🔍 Checking Recent Rutero Logs (Client 10339 focus)...');

        // Check specific client logs
        const logs = await query(`
            SELECT VENDEDOR, CLIENTE, POSICION_NUEVA, DETALLES, FECHA_HORA
            FROM JAVIER.RUTERO_LOG
            WHERE CLIENTE = '4300010339'
            ORDER BY FECHA_HORA DESC
            FETCH FIRST 5 ROWS ONLY
        `);

        console.log('--- Logs for 10339 ---');
        logs.forEach(r => console.log(`[${r.FECHA_HORA}] Vend:${r.VENDEDOR} -> Pos:${r.POSICION_NUEVA} (${r.DETALLES})`));

        // Check general recent logs
        const recent = await query(`
            SELECT VENDEDOR, CLIENTE, POSICION_NUEVA, FECHA_HORA
            FROM JAVIER.RUTERO_LOG
            ORDER BY FECHA_HORA DESC
            FETCH FIRST 5 ROWS ONLY
        `);
        console.log('--- General Recent Logs ---');
        recent.forEach(r => console.log(`[${r.FECHA_HORA}] Vend:${r.VENDEDOR} Cli:${r.CLIENTE} -> Pos:${r.POSICION_NUEVA}`));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkLog();
