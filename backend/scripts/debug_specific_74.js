const { query, initDb } = require('../config/db');

async function debug() {
    await initDb();
    console.log('--- Analyzing Albaran 5 with Total 74.22 ---');

    // 1. Find the specific header
    const headers = await query(`
        SELECT *
        FROM DSEDAC.CAC 
        WHERE NUMEROALBARAN = 5 
        AND EJERCICIOALBARAN = 2026
        AND IMPORTETOTAL BETWEEN 74.20 AND 74.25
    `);

    if (headers.length === 0) {
        console.log('No Albaran 5 found with Total ~74.22');
        process.exit();
    }

    const h = headers[0];
    console.log(`FOUND: Series '${h.SERIEALBARAN}' | Total: ${h.IMPORTETOTAL} | Client: ${h.CODIGOCLIENTEFACTURA}`);

    // 2. Get Lines
    const lines = await query(`
        SELECT 
            SECUENCIA, 
            CODIGOARTICULO,
            DESCRIPCION, 
            CANTIDADUNIDADES, 
            PRECIOVENTA, 
            IMPORTEVENTA, 
            UNIDADMEDIDA
        FROM DSEDAC.LAC 
        WHERE NUMEROALBARAN = ${h.NUMEROALBARAN} 
        AND EJERCICIOALBARAN = ${h.EJERCICIOALBARAN}
        AND SERIEALBARAN = '${h.SERIEALBARAN}'
    `);

    let sumImporte = 0;
    lines.forEach(l => {
        sumImporte += parseFloat(l.IMPORTEVENTA || 0);
        console.log(`[${l.SECUENCIA}] ${l.DESCRIPCION.trim()} | Qty: ${l.CANTIDADUNIDADES} | PriceDB: ${l.PRECIOVENTA} | Importe: ${l.IMPORTEVENTA}`);
    });

    console.log(`\nSUM of ImporteVenta: ${sumImporte.toFixed(2)}`);
    console.log(`Header Total: ${h.IMPORTETOTAL}`);
    console.log(`Diff: ${(sumImporte - h.IMPORTETOTAL).toFixed(2)}`);

    process.exit();
}

debug();
