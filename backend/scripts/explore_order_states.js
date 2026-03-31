// backend/scripts/explore_order_states.js
const db = require('../config/db');

async function run() {
    try {
        // 1. Sample CAC data to see actual state values
        try {
            const sample = await db.query(`
                SELECT SUBEMPRESAALBARAN, EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN,
                       CODIGOTIPOALBARAN, SITUACIONALBARAN, ESTADOENVIO, ELIMINADOSN,
                       CODIGOCLIENTEALBARAN, CODIGOVENDEDOR, IMPORTETOTAL
                FROM DSEDAC.CAC FETCH FIRST 10 ROWS ONLY
            `);
            console.log("=== CAC SAMPLE DATA ===");
            console.log(JSON.stringify(sample, null, 2));
        } catch(e) { console.log("CAC sample error:", e.message); }

        // 2. Sample CPC data
        try {
            const sample = await db.query(`
                SELECT SUBEMPRESAPEDIDO, EJERCICIOPEDIDO, SERIEPEDIDO, TERMINALPEDIDO, NUMEROPEDIDO,
                       CODIGOTIPOPEDIDO, SITUACIONPEDIDO, SITUACIONALBARAN, SITUACIONCARGA,
                       PROCESADOSN, REMOTOSN, ENVIADOSN, IMPRESOSN, CONFORMADOSN,
                       CODIGOCLIENTEALBARAN, CODIGOVENDEDOR, IMPORTETOTAL
                FROM DSEDAC.CPC FETCH FIRST 10 ROWS ONLY
            `);
            console.log("\n=== CPC SAMPLE DATA ===");
            console.log(JSON.stringify(sample, null, 2));
        } catch(e) { console.log("CPC sample error:", e.message); }

        // 3. Distinct SITUACIONALBARAN values in CAC
        try {
            const states = await db.query(`
                SELECT DISTINCT SITUACIONALBARAN, COUNT(*) as CNT 
                FROM DSEDAC.CAC 
                GROUP BY SITUACIONALBARAN 
                ORDER BY SITUACIONALBARAN
            `);
            console.log("\n=== CAC DISTINCT SITUACIONALBARAN VALUES ===");
            console.log(JSON.stringify(states, null, 2));
        } catch(e) { console.log("CAC states error:", e.message); }

        // 4. Distinct CODIGOTIPOALBARAN values in CAC
        try {
            const types = await db.query(`
                SELECT DISTINCT CODIGOTIPOALBARAN, COUNT(*) as CNT 
                FROM DSEDAC.CAC 
                GROUP BY CODIGOTIPOALBARAN 
                ORDER BY CODIGOTIPOALBARAN
            `);
            console.log("\n=== CAC DISTINCT CODIGOTIPOALBARAN VALUES ===");
            console.log(JSON.stringify(types, null, 2));
        } catch(e) { console.log("CAC types error:", e.message); }

        // 5. Distinct SITUACIONPEDIDO values in CPC
        try {
            const states = await db.query(`
                SELECT DISTINCT SITUACIONPEDIDO, COUNT(*) as CNT 
                FROM DSEDAC.CPC 
                GROUP BY SITUACIONPEDIDO 
                ORDER BY SITUACIONPEDIDO
            `);
            console.log("\n=== CPC DISTINCT SITUACIONPEDIDO VALUES ===");
            console.log(JSON.stringify(states, null, 2));
        } catch(e) { console.log("CPC states error:", e.message); }

        // 6. Distinct SITUACIONALBARAN values in CPC
        try {
            const states = await db.query(`
                SELECT DISTINCT SITUACIONALBARAN, COUNT(*) as CNT 
                FROM DSEDAC.CPC 
                GROUP BY SITUACIONALBARAN 
                ORDER BY SITUACIONALBARAN
            `);
            console.log("\n=== CPC DISTINCT SITUACIONALBARAN VALUES ===");
            console.log(JSON.stringify(states, null, 2));
        } catch(e) { console.log("CPC states error:", e.message); }

        // 7. Distinct CODIGOTIPOPEDIDO values in CPC
        try {
            const types = await db.query(`
                SELECT DISTINCT CODIGOTIPOPEDIDO, COUNT(*) as CNT 
                FROM DSEDAC.CPC 
                GROUP BY CODIGOTIPOPEDIDO 
                ORDER BY CODIGOTIPOPEDIDO
            `);
            console.log("\n=== CPC DISTINCT CODIGOTIPOPEDIDO VALUES ===");
            console.log(JSON.stringify(types, null, 2));
        } catch(e) { console.log("CPC types error:", e.message); }

        // 8. Distinct ESTADOENVIO values in CAC
        try {
            const states = await db.query(`
                SELECT DISTINCT ESTADOENVIO, COUNT(*) as CNT 
                FROM DSEDAC.CAC 
                GROUP BY ESTADOENVIO 
                ORDER BY ESTADOENVIO
            `);
            console.log("\n=== CAC DISTINCT ESTADOENVIO VALUES ===");
            console.log(JSON.stringify(states, null, 2));
        } catch(e) { console.log("CAC ESTADOENVIO error:", e.message); }

        // 9. Check ELIMINADOSN flag in CAC
        try {
            const states = await db.query(`
                SELECT DISTINCT ELIMINADOSN, COUNT(*) as CNT 
                FROM DSEDAC.CAC 
                GROUP BY ELIMINADOSN 
                ORDER BY ELIMINADOSN
            `);
            console.log("\n=== CAC DISTINCT ELIMINADOSN VALUES ===");
            console.log(JSON.stringify(states, null, 2));
        } catch(e) { console.log("CAC ELIMINADOSN error:", e.message); }

        // 10. Check PROCESADOSN, REMOTOSN, ENVIADOSN flags in CPC
        try {
            const flags = await db.query(`
                SELECT DISTINCT PROCESADOSN, REMOTOSN, ENVIADOSN, IMPRESOSN, CONFORMADOSN, COUNT(*) as CNT 
                FROM DSEDAC.CPC 
                GROUP BY PROCESADOSN, REMOTOSN, ENVIADOSN, IMPRESOSN, CONFORMADOSN
                ORDER BY PROCESADOSN, REMOTOSN, ENVIADOSN
            `);
            console.log("\n=== CPC DISTINCT FLAG COMBINATIONS ===");
            console.log(JSON.stringify(flags, null, 2));
        } catch(e) { console.log("CPC flags error:", e.message); }

        process.exit(0);
    } catch(e) { console.error(e); process.exit(1); }
}
run();
