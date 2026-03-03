const { query } = require('./backend/config/db');

async function debugAlbaran69() {
    try {
        const sql = `
            SELECT *
            FROM DSEDAC.CPC
            WHERE NUMEROALBARAN = 69 
              AND SERIEALBARAN = 'P'
              AND TERMINALALBARAN = 93
              AND EJERCICIOALBARAN = 2026
        `;
        const res = await query(sql, false);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

debugAlbaran69();
