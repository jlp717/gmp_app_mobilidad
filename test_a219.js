const { query } = require('./backend/config/db');

async function test() {
    try {
        const sql = `
            SELECT CPC.NUMEROALBARAN, CPC.EJERCICIOALBARAN, CPC.IMPORTETOTAL, CAC.NUMEROFACTURA, CAC.SERIEFACTURA
            FROM DSEDAC.CPC CPC
            LEFT JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN 
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN 
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN 
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE CPC.NUMEROALBARAN = 219 AND CPC.EJERCICIOALBARAN = 2026
        `;
        const res = await query(sql, false);
        console.log("Found " + res.length + " albaranes with number 219 in 2026:");
        for (let row of res) {
            console.log(`- Albaran: ${row.NUMEROALBARAN}, Importe: ${row.IMPORTETOTAL}, Factura: ${row.NUMEROFACTURA}`);
            if (row.NUMEROFACTURA) {
                const sql2 = `
                    SELECT SUM(CPC.IMPORTETOTAL) as FACT_TOT 
                    FROM DSEDAC.CPC CPC
                    LEFT JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN 
                        AND CAC.SERIEALBARAN = CPC.SERIEALBARAN 
                        AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN 
                        AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
                    WHERE CAC.NUMEROFACTURA = ${row.NUMEROFACTURA} AND CAC.EJERCICIOFACTURA = 2026
                `;
                const r2 = await query(sql2, false);
                console.log(`  -> Factura ${row.NUMEROFACTURA} total is: ${r2[0].FACT_TOT}`);
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
test();
