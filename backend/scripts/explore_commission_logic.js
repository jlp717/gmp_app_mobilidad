const { query, initDb } = require('../config/db');

async function explore() {
    try {
        await initDb();

        // 1. Get Current Objective for 02
        console.log("\n1. Current Objective for 02:");
        const obj = await query(`
            SELECT CODIGOVENDEDOR, TARGET_PERCENTAGE 
            FROM JAVIER.OBJ_CONFIG 
            WHERE CODIGOVENDEDOR = '02'
        `, false);
        console.log(JSON.stringify(obj, null, 2));

        // 2. Find Exception/Config Table
        console.log("\n2. Searching for Exception Tables:");
        const tables = await query(`
            SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER' 
            AND (TABLE_NAME LIKE '%EXCEP%' OR TABLE_NAME LIKE '%HIDDEN%' OR TABLE_NAME LIKE '%VISIB%')
        `, false);
        tables.forEach(t => console.log(`- ${t.TABLE_NAME}`));

        // 3. Inspect tables if found, or check if we can rely on TIPOVENDEDOR in VDC
        console.log("\n3. Checking TIPOVENDEDOR for 02, 03, 13:");
        const types = await query(`
            SELECT CODIGOVENDEDOR, TIPOVENDEDOR, SUBEMPRESA
            FROM DSEDAC.VDC 
            WHERE CODIGOVENDEDOR IN ('02', '03', '13') AND SUBEMPRESA='GMP'
        `, false);
        console.log(JSON.stringify(types, null, 2));

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

explore();
