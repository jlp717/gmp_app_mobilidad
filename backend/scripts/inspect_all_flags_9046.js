const { query, initDb } = require('../config/db');

async function inspect() {
    try {
        await initDb();
        const rows = await query(`
            SELECT CODIGOCLIENTE,
                   HEX(DIAVISITADOMINGOSN) as D_HEX, DIAVISITADOMINGOSN as D,
                   HEX(DIAVISITALUNESSN) as L_HEX, DIAVISITALUNESSN as L,
                   HEX(DIAVISITAMARTESSN) as M_HEX, DIAVISITAMARTESSN as M,
                   HEX(DIAVISITAMIERCOLESSN) as X_HEX, DIAVISITAMIERCOLESSN as X,
                   HEX(DIAVISITAJUEVESSN) as J_HEX, DIAVISITAJUEVESSN as J,
                   HEX(DIAVISITAVIERNESSN) as V_HEX, DIAVISITAVIERNESSN as V,
                   HEX(DIAVISITASABADOSN) as S_HEX, DIAVISITASABADOSN as S
            FROM DSEDAC.CDVI 
            WHERE CODIGOCLIENTE = '4300009046'
        `);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
inspect();
