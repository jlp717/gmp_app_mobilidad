const { query, initDb } = require('../config/db');

async function checkFlags() {
    try {
        await initDb();
        const client = '4300009046';
        console.log(`🔍 Checking Visit Flags for ${client}...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, 
                   DIAVISITAVIERNESSN as V, HEX(DIAVISITAVIERNESSN) as V_HEX,
                   DIAVISITALUNESSN as L, HEX(DIAVISITALUNESSN) as L_HEX
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE = '${client}'
        `);

        console.log(rows);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkFlags();
