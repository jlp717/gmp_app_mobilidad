const { query, initDb } = require('../config/db');

async function checkCdvi() {
    try {
        await initDb();
        const client = '4300000680';
        console.log(`🔍 Checking CDVI for client ${client}...`);

        const rows = await query(`
            SELECT CODIGOVENDEDOR, 
                   DIAVISITALUNESSN, DIAVISITAMARTESSN, DIAVISITAMIERCOLESSN, 
                   DIAVISITAJUEVESSN, DIAVISITAVIERNESSN, DIAVISITASABADOSN
            FROM DSEDAC.CDVI
            WHERE CODIGOCLIENTE = '${client}'
        `);

        if (rows.length > 0) {
            console.log('encounters in CDVI:');
            rows.forEach(r => {
                console.log(`- Vendor: ${r.CODIGOVENDEDOR} (Visits: L:${r.DIAVISITALUNESSN} M:${r.DIAVISITAMARTESSN} ...)`);
            });
        } else {
            console.log('Client not found in CDVI');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkCdvi();
