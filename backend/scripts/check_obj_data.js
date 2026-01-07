const { query, initDb } = require('../config/db');

async function checkData() {
    try {
        await initDb();
        console.log('Checking JAVIER.OBJ_CONFIG stats...');

        const count = await query(`SELECT COUNT(*) as CNT FROM JAVIER.OBJ_CONFIG`);
        console.log('Total rows:', count[0].CNT);

        const def = await query(`SELECT * FROM JAVIER.OBJ_CONFIG WHERE CODIGOCLIENTE IN ('*', 'DEFAULT', '0', '') OR CODIGOCLIENTE IS NULL`);
        console.log('Default record:', def);

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkData();
