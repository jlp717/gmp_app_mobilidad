const { query, initDb } = require('../config/db');

async function checkKeys() {
    try {
        await initDb();
        console.log('🔍 Checking for clients with multiple overrides...');

        const rows = await query(`
            SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(CLIENTE) as CLIENTE, COUNT(*) as COUNT
            FROM JAVIER.RUTERO_CONFIG
            GROUP BY VENDEDOR, CLIENTE
            HAVING COUNT(*) > 1
            FETCH FIRST 10 ROWS ONLY
        `);

        if (rows.length > 0) {
            console.log('✅ Found clients with multiple rows (PK includes DIA or no PK):');
            console.log(rows);
        } else {
            console.log('❌ No clients with multiple rows found (PK likely VENDOR+CLIENT).');
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkKeys();
