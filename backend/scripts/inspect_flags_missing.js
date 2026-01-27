const { query, initDb } = require('../config/db');

async function inspect() {
    try {
        await initDb();
        const clients = ['4300010334', '4300010203'];
        console.log(`🔍 Checking Flags for ${clients.join(', ')}...`);

        const rows = await query(`
            SELECT CODIGOCLIENTE, TRIM(CODIGOVENDEDOR) as VENDEDOR,
                   HEX(DIAVISITALUNESSN) as L_HEX, DIAVISITALUNESSN as L,
                   HEX(DIAVISITAVIERNESSN) as V_HEX, DIAVISITAVIERNESSN as V,
                   HEX(DIAVISITAMARTESSN) as M_HEX, DIAVISITAMARTESSN as M,
                   HEX(DIAVISITAMIERCOLESSN) as X_HEX, DIAVISITAMIERCOLESSN as X,
                   HEX(DIAVISITAJUEVESSN) as J_HEX, DIAVISITAJUEVESSN as J,
                   HEX(DIAVISITASABADOSN) as S_HEX, DIAVISITASABADOSN as S,
                   HEX(DIAVISITADOMINGOSN) as D_HEX, DIAVISITADOMINGOSN as D
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE IN ('${clients.join("','")}')
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
inspect();
