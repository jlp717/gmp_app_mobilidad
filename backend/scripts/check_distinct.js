const { query, initDb } = require('../config/db');

async function debug() {
    await initDb();

    const headers = await query(`
        SELECT 
            SUBEMPRESAALBARAN, 
            TERMINALALBARAN, 
            SERIEALBARAN, 
            NUMEROALBARAN, 
            IMPORTETOTAL
        FROM DSEDAC.CAC 
        WHERE NUMEROALBARAN = 5 
        AND EJERCICIOALBARAN = 2026
        AND SERIEALBARAN = 'S'
    `);

    console.log(JSON.stringify(headers, null, 2));
    process.exit();
}

debug();
