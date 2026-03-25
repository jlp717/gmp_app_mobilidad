const db = require('./config/db');
const fs = require('fs');

async function explorePromos() {
    try {
        const result = {};

        const resCols = await db.query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME IN ('CPESL1', 'CPES1')
        `);
        result.columns = resCols;

        const resDataL1 = await db.query(`SELECT * FROM DSEDAC.CPESL1 FETCH FIRST 5 ROWS ONLY`);
        result.sampleL1 = resDataL1;

        const resDataH = await db.query(`SELECT * FROM DSEDAC.CPES1 FETCH FIRST 5 ROWS ONLY`);
        result.sampleH = resDataH;

        fs.writeFileSync('promos_schema.json', JSON.stringify(result, null, 2));

        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
explorePromos();
