const { initDb, query } = require('../config/db');

async function checkData() {
    await initDb();

    // Hardcoded date and repartidor for testing (assuming today and Repartidor 1)
    const dia = new Date().getDate();
    const mes = new Date().getMonth() + 1;
    const ano = new Date().getFullYear();

    console.log(`Checking data for ANY repartidor on ${dia}/${mes}/${ano}`);

    const sql = `
        SELECT 
            CPC.IMPORTEBRUTO,
            CPC.NUMEROALBARAN,
            CPC.CODIGOFORMAPAGO
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC 
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        INNER JOIN DSEDAC.CAC CAC 
            ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
            AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
            AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
            AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
        WHERE OPP.ANOREPARTO = ${ano} 
        AND OPP.MESREPARTO = ${mes}
        AND OPP.DIAREPARTO = ${dia}
        FETCH FIRST 5 ROWS ONLY
    `;

    try {
        const rows = await query(sql, false);

        if (rows.length > 0) {
            console.log('Row Keys:', Object.keys(rows[0]));
            // Check for both cases
            console.log('IMPORTEBRUTO:', rows[0].IMPORTEBRUTO);
            console.log('importebruto:', rows[0].importebruto);
        } else {
            console.log('No rows found!');
        }
    } catch (e) {
        console.error('Error:', e);
    }
    process.exit();
}

checkData();
