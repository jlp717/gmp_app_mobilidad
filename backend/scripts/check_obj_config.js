const { query, initDb } = require('../config/db');

async function checkObjConfig() {
    await initDb();

    // Check OBJ_CONFIG columns
    console.log('=== OBJ_CONFIG Columns ===');
    try {
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'OBJ_CONFIG'
            ORDER BY ORDINAL_POSITION
        `, false);
        console.log(cols);
    } catch (e) {
        console.log('OBJ_CONFIG not found or error:', e.message);
    }

    // Check OBJ_HISTORY columns
    console.log('\n=== OBJ_HISTORY Columns ===');
    try {
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'OBJ_HISTORY'
            ORDER BY ORDINAL_POSITION
        `, false);
        console.log(cols);
    } catch (e) {
        console.log('OBJ_HISTORY not found or error:', e.message);
    }

    // Sample data from OBJ_CONFIG
    console.log('\n=== OBJ_CONFIG Sample Data ===');
    try {
        const data = await query(`SELECT * FROM JAVIER.OBJ_CONFIG`, false);
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Sample data from OBJ_HISTORY
    console.log('\n=== OBJ_HISTORY Sample Data (first 5) ===');
    try {
        const data = await query(`SELECT * FROM JAVIER.OBJ_HISTORY FETCH FIRST 5 ROWS ONLY`, false);
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

checkObjConfig();
