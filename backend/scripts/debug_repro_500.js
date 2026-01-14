const { query, initDb } = require('../config/db');

async function debugRepro() {
    await initDb();
    console.log('--- REPRODUCING 500 ERROR ---');

    const numero = 5;
    const ejercicio = 2026;

    console.log(`Target: Albaran ${numero} / Year ${ejercicio}`);

    // 1. Test Header Query
    const headerSql = `
        SELECT CAC.*
        FROM DSEDAC.CAC
        WHERE CAC.NUMEROALBARAN = ${numero} AND CAC.EJERCICIOALBARAN = ${ejercicio}
        FETCH FIRST 1 ROWS ONLY
    `;
    try {
        console.log('\nTesting HEADER query...');
        const headers = await query(headerSql, false);
        console.log(`Header found: ${headers.length > 0}`);
    } catch (e) {
        console.error('❌ Header Query Failed:', e.message);
    }

    // 2. Test Items Query (Exact failing SQL)
    const itemsSql = `
        SELECT 
            L.NUMEROLINEA as ITEM_ID,
            TRIM(L.CODIGOARTICULO) as CODIGO,
            TRIM(L.DESCRIPCION) as DESC,
            L.CANTIDADUNIDADES as QTY
        FROM DSEDAC.LAC L
        WHERE L.NUMEROALBARAN = ${numero} AND L.EJERCICIOALBARAN = ${ejercicio}
        ORDER BY L.NUMEROLINEA
    `;

    try {
        console.log('\nTesting ITEMS query...');
        await query(itemsSql, false);
        console.log('✅ Items Query Success!');
    } catch (e) {
        console.error('❌ Items Query Failed:', e.message);
        if (e.odbcErrors) console.error('ODBC Info:', e.odbcErrors);
    }

    // 3. Test Alternative Items Query (If above fails)
    const altSql = `
        SELECT *
        FROM DSEDAC.LAC L
        WHERE L.NUMEROALBARAN = ${numero} AND L.EJERCICIOALBARAN = ${ejercicio}
        FETCH FIRST 1 ROWS ONLY
    `;
    try {
        console.log('\nTesting SELECT * from LAC...');
        const rows = await query(altSql, false);
        console.log('SELECT * rows found:', rows.length);
        if (rows.length > 0) {
            console.log('Sample Row Keys:', Object.keys(rows[0]));
        }
    } catch (e) {
        console.error('❌ SELECT * Failed:', e.message);
    }
}

debugRepro();
