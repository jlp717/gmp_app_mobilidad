const { query, initDb } = require('./config/db');

async function testLACvsPUA() {
    await initDb();
    
    const clientCode = '4300009622'; // PUA
    
    console.log('=== TEST LAC vs LACLAE for PUA ===\n');
    
    // 1. Query DSEDAC.LAC
    console.log('1. DSEDAC.LAC:');
    try {
        const lacResult = await query(`
            SELECT COUNT(*) as CNT, SUM(L.IMPORTEVENTA) as SALES
            FROM DSEDAC.LAC L
            WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
              AND L.ANODOCUMENTO IN (2024, 2025)
              AND L.TIPOVENTA IN ('CC', 'VC')
              AND L.TIPOLINEA IN ('AB', 'VT')
              AND L.SERIEALBARAN NOT IN ('N', 'Z')
        `, false, false);
        console.log(`  Result: ${JSON.stringify(lacResult[0])}`);
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
    }
    
    // 2. Query DSED.LACLAE
    console.log('\n2. DSED.LACLAE:');
    try {
        const laclaeResult = await query(`
            SELECT COUNT(*) as CNT, SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = '${clientCode}'
              AND L.LCAADC IN (2024, 2025)
              AND L.TPDC = 'LAC' 
              AND L.LCTPVT IN ('CC', 'VC') 
              AND L.LCCLLN IN ('AB', 'VT') 
              AND L.LCSRAB NOT IN ('N', 'Z')
        `, false, false);
        console.log(`  Result: ${JSON.stringify(laclaeResult[0])}`);
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
    }
    
    // 3. Check client code format
    console.log('\n3. Client code formats in LAC:');
    try {
        const formats = await query(`
            SELECT DISTINCT LENGTH(CODIGOCLIENTEALBARAN) as LEN, CODIGOCLIENTEALBARAN as CODE
            FROM DSEDAC.LAC
            WHERE CODIGOCLIENTEALBARAN LIKE '%9622%'
            FETCH FIRST 5 ROWS ONLY
        `, false, false);
        formats.forEach(f => console.log(`  Code: "${f.CODE}" (len: ${f.LEN})`));
    } catch (e) {
        console.log(`  ERROR: ${e.message}`);
    }
    
    process.exit(0);
}

testLACvsPUA().catch(console.error);
