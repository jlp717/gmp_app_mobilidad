const { query } = require('../config/db');

async function run() {
    try {
        console.log("=== DB EXPLORATION - VEHICLES ===");

        // VEHICLES - DSEDAC.VEH
        const veh = await query('SELECT TRIM(CODIGOVEHICULO) AS COD, CARGAMAXIMA, TARA, VOLUMEN, CONTENEDORVOLUMEN FROM DSEDAC.VEH FETCH FIRST 10 ROWS ONLY');
        console.log("\nDSEDAC.VEH (first 10 rows):");
        console.table(veh);

        // JAVIER.ALMACEN_CAMIONES_CONFIG
        console.log("\n=== JAVIER.ALMACEN_CAMIONES_CONFIG ===");
        try {
            const conf = await query("SELECT * FROM JAVIER.ALMACEN_CAMIONES_CONFIG");
            console.table(conf);
        } catch (e) { console.log("Error reading ALMACEN_CAMIONES_CONFIG:", e.message); }

        console.log("\n=== ARTICLES ===");
        const opp = await query(`
            SELECT 
                TRIM(OPP.CODIGOVEHICULO) AS COD,
                COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) AS ORDENES,
                COUNT(*) AS LINEAS
            FROM DSEDAC.OPP OPP
            WHERE OPP.ANOREPARTO = YEAR(CURRENT_DATE) AND OPP.MESREPARTO = MONTH(CURRENT_DATE) 
            GROUP BY TRIM(OPP.CODIGOVEHICULO)
            ORDER BY LINEAS DESC
            FETCH FIRST 5 ROWS ONLY
        `);
        console.table(opp);

        process.exit(0);
    } catch (err) {
        console.error("FATAL ERROR:", err);
        process.exit(1);
    }
}
run();
