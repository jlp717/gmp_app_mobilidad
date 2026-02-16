const { query, initDb } = require('../config/db');

async function inspectFlags() {
    try {
        await initDb();
        console.log('🔍 Inspecting 9046 Flags...');

        const rows = await query(`
            SELECT CODIGOCLIENTE, 
                   DIAVISITALUNESSN as VIS_L,
                   DIAVISITAVIERNESSN as VIS_V
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE = '4300009046'
        `);

        if (rows.length > 0) {
            console.log('Row 0 Raw:', JSON.stringify(rows[0], null, 2));
            const v = rows[0].VIS_V;
            console.log(`VIS_V Value: '${v}'`);
            console.log(`VIS_V Code: ${v ? v.charCodeAt(0) : 'null'}`);
        } else {
            console.log('Client not found in CDVI');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
inspectFlags();
