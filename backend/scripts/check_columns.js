const { connectToDatabase, query } = require('../src/config/database');

async function checkColumns() {
    try {
        await connectToDatabase();
        // Check DSEDAC.LAC columns
        const result = await query(`SELECT COLNAME, TYPENAME, LENGTH FROM SYSCAT.COLUMNS WHERE TABNAME = 'LAC' AND TABSCHEMA = 'DSEDAC' ORDER BY COLNAME`);
        console.log(result);
    } catch (err) {
        console.error(err);
    }
}

checkColumns();
