const { query, initDb } = require('../config/db');

async function checkMoreFlags() {
    try {
        await initDb();
        const clients = ['4300010334', '4300010203'];
        console.log(`🔍 Checking Flags for ${clients.join(', ')}...`);

        // Check CDVI Flags
        const rows = await query(`
            SELECT CODIGOCLIENTE, CODIGOVENDEDOR,
                   HEX(DIAVISITALUNESSN) as L_HEX, DIAVISITALUNESSN as L,
                   HEX(DIAVISITAVIERNESSN) as V_HEX, DIAVISITAVIERNESSN as V,
                   HEX(DIAVISITASABADOSN) as S_HEX, DIAVISITASABADOSN as S
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE IN ('${clients.join("','")}')
        `);

        console.log('--- CDVI FLAGS ---');
        console.log(rows);

        // Check Overrides
        const overrides = await query(`
            SELECT * FROM JAVIER.RUTERO_CONFIG 
            WHERE CLIENTE IN ('${clients.join("','")}')
        `);
        console.log('--- OVERRIDES ---');
        console.log(overrides);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
checkMoreFlags();
