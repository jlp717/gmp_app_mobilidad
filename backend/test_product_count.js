const { query, initDb } = require('./config/db');

async function testProductCount() {
    await initDb();
    
    // Test the exact query from analytics.js
    const clientCode = '4300009622'; // PUA
    const sDate = 20250101;
    const eDate = 20251231;
    
    console.log('=== TEST PRODUCT COUNT ===\n');
    
    // 1. Query from analytics.js (DSEDAC.LINDTO - vista correcta)
    console.log('1. Query en DSEDAC.LINDTO:');
    try {
        const lindtoResult = await query(`
            SELECT 
                SUM(L.IMPORTEVENTA) as sales,
                SUM(L.UNIDADES) as units,
                COUNT(DISTINCT L.CODIGOARTICULO) as product_count
            FROM DSEDAC.LINDTO L
            WHERE L.FECHADOCUMENTO BETWEEN ${sDate} AND ${eDate}
              AND L.CODIGOCLIENTEALBARAN = '${clientCode}'
              AND L.TIPOVENTA IN ('CC', 'VC')
              AND L.TIPOLINEA IN ('AB', 'VT')
              AND L.SERIEALBARAN NOT IN ('N', 'Z')
        `, false, false);
        console.log('  Resultado LINDTO:', lindtoResult[0]);
    } catch (e) {
        console.log('  Error LINDTO:', e.message);
    }
    
    // 2. Query in DSED.LACLAE 
    console.log('\n2. Query en DSED.LACLAE:');
    const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;
    try {
        const laclaeResult = await query(`
            SELECT 
                SUM(L.LCIMVT) as sales,
                SUM(L.LCCTUD) as units,
                COUNT(DISTINCT TRIM(L.LCCDRF)) as product_count
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = '${clientCode}'
              AND L.LCAADC = 2025
              AND ${LACLAE_SALES_FILTER}
        `, false, false);
        console.log('  Resultado LACLAE:', laclaeResult[0]);
    } catch (e) {
        console.log('  Error LACLAE:', e.message);
    }
    
    // 3. Check columns in LAC view
    console.log('\n3. Columnas en DSEDAC.LAC:');
    try {
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
              AND (COLUMN_NAME LIKE '%ARTIC%' OR COLUMN_NAME LIKE '%PROD%' OR COLUMN_NAME LIKE '%COD%')
            ORDER BY COLUMN_NAME
            FETCH FIRST 20 ROWS ONLY
        `, false, false);
        cols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    } catch (e) {
        console.log('  Error:', e.message);
    }
    
    // 4. Sample LAC records
    console.log('\n4. Muestra de registros LAC:');
    try {
        const sample = await query(`
            SELECT L.CODIGOARTICULO, L.IMPORTEVENTA, L.UNIDADES
            FROM DSEDAC.LAC L
            WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
              AND L.FECHADOCUMENTO BETWEEN ${sDate} AND ${eDate}
            FETCH FIRST 5 ROWS ONLY
        `, false, false);
        sample.forEach(s => console.log(`  Art: ${s.CODIGOARTICULO}, Venta: ${s.IMPORTEVENTA}, Uds: ${s.UNIDADES}`));
    } catch (e) {
        console.log('  Error:', e.message);
    }
    
    process.exit(0);
}

testProductCount().catch(console.error);
