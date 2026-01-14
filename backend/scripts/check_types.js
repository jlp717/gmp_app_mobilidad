const { query, initDb } = require('../config/db');

async function checkTypes() {
    await initDb();
    console.log('--- CHECKING LAC COLUMN TYPES ---');

    const sql = `
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
        AND COLUMN_NAME IN ('NUMEROLINEA', 'CODIGOARTICULO', 'DESCRIPCION', 'CANTIDADUNIDADES')
    `;

    try {
        const rows = await query(sql, false);
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}

checkTypes();
