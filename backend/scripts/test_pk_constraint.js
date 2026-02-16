const { query, initDb } = require('../config/db');

async function testInsert() {
    try {
        await initDb();
        console.log('🧪 Testing duplicate insert...');

        // 1. Pick a client that exists
        const existing = await query(`
            SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(CLIENTE) as CLIENTE
            FROM JAVIER.RUTERO_CONFIG
            FETCH FIRST 1 ROWS ONLY
        `);
        const { VENDEDOR, CLIENTE } = existing[0];

        console.log(`Target: Vendor ${VENDEDOR}, Client ${CLIENTE}`);

        // 2. Try to insert a second row for same vendor/client
        try {
            await query(`
                INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, CLIENTE, DIA, ORDEN)
                VALUES ('${VENDEDOR}', '${CLIENTE}', 'test_duplicate', 999)
            `);
            console.log('✅ INSERT SUCCESS: Table SUPPORTS multiple rows per client!');

            // Clean up
            await query(`
                DELETE FROM JAVIER.RUTERO_CONFIG 
                WHERE VENDEDOR = '${VENDEDOR}' AND CLIENTE = '${CLIENTE}' AND DIA = 'test_duplicate'
            `);
        } catch (e) {
            console.log('❌ INSERT FAILED: Table likely has UNIQUE constraint on (VENDEDOR, CLIENTE).');
            console.log('Error:', e.message);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
testInsert();
