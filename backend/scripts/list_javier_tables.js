const { query, initDb } = require('../config/db');

async function listJavierTables() {
    try {
        await initDb();
        console.log("🔍 Searching for tables in schema 'JAVIER'...");
        const tables = await query(`
            SELECT TABLE_NAME, TABLE_TYPE 
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER'
            ORDER BY TABLE_NAME
        `);

        console.log("\nFound tables:");
        tables.forEach(t => console.log(`- ${t.TABLE_NAME} (${t.TABLE_TYPE})`));

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

listJavierTables();
