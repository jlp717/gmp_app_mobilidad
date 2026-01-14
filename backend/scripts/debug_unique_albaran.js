const { query, initDb } = require('../config/db');

async function debug() {
    await initDb();
    console.log('--- Analyzing Albaran 5 (2025) ---');

    // 1. Get ALL headers for Albaran 5 in 2025
    const headers = await query(`
        SELECT 
            SERIEALBARAN, 
            NUMEROALBARAN, 
            EJERCICIOALBARAN, 
            IMPORTETOTAL,
            CODIGOCLIENTEFACTURA 
        FROM DSEDAC.CAC 
        WHERE NUMEROALBARAN = 5 AND EJERCICIOALBARAN = 2025
    `);

    console.log(`Found ${headers.length} headers for Albarán 5.`);

    for (const h of headers) {
        console.log(`\n HEADER: Series '${h.SERIEALBARAN}' | Total: ${h.IMPORTETOTAL} | Client: ${h.CODIGOCLIENTEFACTURA}`);

        // 2. Get Lines and specific columns that might indicate "cancelled" or "deposit"
        const lines = await query(`
            SELECT 
                SECUENCIA, 
                DESCRIPCION, 
                CANTIDADUNIDADES, 
                PRECIOVENTA, 
                IMPORTEVENTA, 
                IMPORTECOSTO,
                UNIDADMEDIDA
            FROM DSEDAC.LAC 
            WHERE NUMEROALBARAN = ${h.NUMEROALBARAN} 
            AND EJERCICIOALBARAN = ${h.EJERCICIOALBARAN}
            AND SERIEALBARAN = '${h.SERIEALBARAN}'
        `);

        let sumImporte = 0;
        lines.forEach(l => {
            sumImporte += parseFloat(l.IMPORTEVENTA || 0);
            console.log(`   [${l.SECUENCIA}] ${l.DESCRIPCION.trim()} | Qty: ${l.CANTIDADUNIDADES} | Price: ${l.PRECIOVENTA} | Importe: ${l.IMPORTEVENTA}`);
        });

        console.log(`   >> Calculated Sum (Importe): ${sumImporte.toFixed(2)}`);
        console.log(`   >> Discrepancy: ${(sumImporte - h.IMPORTETOTAL).toFixed(2)}`);
    }

    process.exit();
}

debug();
