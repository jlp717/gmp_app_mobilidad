const { query, initDb } = require('../config/db');

async function checkAlbaran() {
    try {
        await initDb();
        // Find Albaran 5 for Cerveceria Victoria (or just Albaran 5 in general)
        // ... rest of logic
        // Find Albaran 5 for Cerveceria Victoria (or just Albaran 5 in general)
        // We'll search for ALBARAN 5 in recent exercises (2025, 2026)

        console.log('--- Searching for Albaran 5 ---');

        const headerSql = `
            SELECT 
                EJERCICIOALBARAN, 
                SERIEALBARAN, 
                NUMEROALBARAN, 
                IMPORTETOTAL, 
                NUMEROFACTURA, 
                SERIEFACTURA 
            FROM DSEDAC.CAC 
            WHERE NUMEROALBARAN = 5 
            AND EJERCICIOALBARAN >= 2025
        `;

        const headers = await query(headerSql);
        console.log('Headers found:', headers);

        if (headers.length > 0) {
            const h = headers[0]; // Assume first one is relevant (or check client name)
            const ej = h.EJERCICIOALBARAN;
            const serie = h.SERIEALBARAN || '';
            const num = h.NUMEROALBARAN;

            console.log(`--- Checking Lines for ${ej}-${serie}-${num} ---`);

            const linesSql = `
                SELECT 
                    SECUENCIA, 
                    CODIGOARTICULO, 
                    DESCRIPCION, 
                    CANTIDADUNIDADES, 
                    PRECIOVENTA, 
                    PRECIOCOSTO,
                    IMPORTEVENTA, 
                    UNIDADMEDIDA
                FROM DSEDAC.LAC 
                WHERE NUMEROALBARAN = ${num} 
                AND EJERCICIOALBARAN = ${ej}
                AND SERIEALBARAN = '${serie}'
            `;

            const lines = await query(linesSql);
            console.log('Lines found:', lines.length);
            lines.forEach(l => {
                console.log(`Line ${l.SECUENCIA}: ${l.DESCRIPCION}`);
                console.log(`  Qty Units: ${l.CANTIDADUNIDADES}, UoM: ${l.UNIDADMEDIDA}`);
                console.log(`  Price (Venta): ${l.PRECIOVENTA}, Cost: ${l.PRECIOCOSTO}`);
                console.log(`  Importe (Total Line): ${l.IMPORTEVENTA}`);

                // Calculate theoretical total
                const calc = parseFloat(l.CANTIDADUNIDADES) * parseFloat(l.PRECIOVENTA);
                console.log(`  Calc (Units * Price): ${calc}`);
                console.log('---');
            });

            const sumImporte = lines.reduce((acc, l) => acc + parseFloat(l.IMPORTEVENTA), 0);
            console.log(`Total Sum of IMPORTES: ${sumImporte}`);
            console.log(`Header Total: ${h.IMPORTETOTAL}`);
        }

    } catch (e) {
        console.error(e);
    }
    process.exit();
}

checkAlbaran();
