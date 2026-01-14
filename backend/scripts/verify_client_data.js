const { query, initDb } = require('../config/db');

async function verifyData() {
    await initDb();
    console.log('--- VERIFYING CLIENT DATA ---');
    console.log('Target: Client ending in 40336, Date: 2026-01-14');

    // Searching in OPP (Reparto) linked to CPC/CAC (Cabeceras)
    // The existing query in 'repartidor.js' joins OPP -> CPC -> CAC

    // Let's verify specific albaranes 5 and 6
    const sql = `
        SELECT 
              CAC.NUMEROALBARAN,
              CAC.EJERCICIOALBARAN,
              TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
              CPC.IMPORTETOTAL as IMPORTE_CPC,
              CAC.IMPORTETOTAL as IMPORTE_CAC,
              CAC.DIADOCUMENTO, CAC.MESDOCUMENTO, CAC.ANODOCUMENTO
        FROM DSEDAC.CAC CAC
        JOIN DSEDAC.CPC CPC 
              ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
              AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
              AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
              AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
        WHERE CAC.NUMEROALBARAN IN (5, 6)
          AND CAC.EJERCICIOALBARAN = 2026
    `;

    try {
        const rows = await query(sql, false);
        console.table(rows);

        console.log('\nChecking details (Lines) for Albaran 6 (Expected 0.00?):');
        const linesSql = `
            SELECT * FROM DSEDAC.LAC 
            WHERE NUMEROALBARAN = 6 AND EJERCICIOALBARAN = 2026
        `;
        const lines = await query(linesSql, false);
        console.log(`Albaran 6 Lines: ${lines.length}`);

    } catch (e) {
        console.error(e);
    }
}

verifyData();
