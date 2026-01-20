const { query, initDb } = require('../config/db');

async function inspectData() {
    try {
        await initDb();

        console.log("\n--------- OBJ_CONFIG (User 02) ---------");
        const obj = await query(`SELECT * FROM JAVIER.OBJ_CONFIG WHERE CODIGOVENDEDOR = '02'`, false);
        console.log(obj);

        console.log("\n--------- COMM_CONFIG (Structure & Data) ---------");
        const commStruct = await query(`
             SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT 
             FROM QSYS2.SYSCOLUMNS 
             WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'COMM_CONFIG'
        `, false);
        console.log("Structure:", commStruct.map(c => c.COLUMN_NAME).join(', '));

        const commData = await query(`SELECT * FROM JAVIER.COMM_CONFIG WHERE CODIGOVENDEDOR IN ('02', '03', '13')`, false);
        console.log("Data for 02/03/13:", commData);

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

inspectData();
