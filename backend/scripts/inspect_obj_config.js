const { query, initDb } = require('../config/db');

async function inspectAndSearch() {
    try {
        await initDb();

        // 1. Inspect OBJ_CONFIG
        console.log("\n🔍 Inspecting JAVIER.OBJ_CONFIG (First 5 rows)...");
        try {
            const objRows = await query(`SELECT * FROM JAVIER.OBJ_CONFIG FETCH FIRST 5 ROWS ONLY`, false);
            console.log(objRows);
        } catch (e) { console.log("Error reading OBJ_CONFIG: " + e.message); }

        // 2. Search deeper for commission/vendor config
        console.log("\n🔍 Searching for 'CONFIG' or 'VENDEDOR' tables in JAVIER...");
        const configTables = await query(`
            SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER' 
            AND (TABLE_NAME LIKE '%CONFIG%' OR TABLE_NAME LIKE '%VEND%' OR TABLE_NAME LIKE '%EXCEPCION%')
            AND TABLE_TYPE = 'T'
        `, false);

        configTables.forEach(t => console.log(`- ${t.TABLE_NAME}`));

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

inspectAndSearch();
