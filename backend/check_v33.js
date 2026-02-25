const { query, getPool } = require('./config/db');

async function checkVendor33() {
    console.log("🔍 Checking JAVIER.RUTERO_CONFIG for Vendedor 33 on Miercoles...");
    try {
        const rows = await query(`
            SELECT TRIM(CLIENTE) as CLIENTE, ORDEN
            FROM JAVIER.RUTERO_CONFIG 
            WHERE VENDEDOR='33' AND DIA='miercoles'
            ORDER BY ORDEN ASC
        `, false);

        console.log(`✅ Found ${rows.length} explicitly configured rows.`);
        console.table(rows);

        // Let's also check if any have ORDEN = -1 (which would be our "ghost" logic)
        const hidden = rows.filter(r => r.ORDEN === -1);
        console.log(`\n👻 Hidden/Skipped Clients (ORDEN = -1): ${hidden.length}`);

    } catch (e) {
        console.error("❌ DB Query Error:", e);
    } finally {
        const pool = getPool();
        if (pool) {
            await pool.close();
            console.log('✅ Connection pool closed.');
        }
        process.exit(0);
    }
}

checkVendor33();
