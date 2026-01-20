const { query, initDb } = require('../config/db');

async function findTargetTables() {
    try {
        await initDb();
        console.log("🔍 Searching for relevant configuration tables in 'JAVIER'...");

        const patterns = ['%OBJ%', '%MET%', '%COMIS%', '%COND%', '%VEND%', '%CONF%'];

        for (const pattern of patterns) {
            const tables = await query(`
                SELECT TABLE_NAME, TABLE_TYPE 
                FROM QSYS2.SYSTABLES 
                WHERE TABLE_SCHEMA = 'JAVIER' 
                AND TABLE_NAME LIKE '${pattern}'
                AND TABLE_TYPE = 'T'
            `, false); // Don't log query to keep output clean

            if (tables.length > 0) {
                console.log(`\nFound matches for '${pattern}':`);
                tables.forEach(t => console.log(`- ${t.TABLE_NAME}`));
            }
        }

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

findTargetTables();
