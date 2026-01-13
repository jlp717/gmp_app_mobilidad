const { query, initDb } = require('./config/db');

const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;

async function debugPuaResponse() {
    await initDb();
    
    const clientCode = '4300009622'; // PUA
    const currentYear = 2025;
    const previousYear = 2024;
    
    console.log('=== DEBUG PUA - SIMULAR RESPUESTAS ENDPOINTS ===\n');
    
    // 1. Simular /rutero/client/:code/detail
    console.log('1. Endpoint /rutero/client/:code/detail:\n');
    
    const monthlySales = await query(`
        SELECT 
            L.LCAADC as YEAR,
            L.LCMMDC as MONTH,
            SUM(L.LCIMVT) as SALES,
            SUM(L.LCIMCT) as COST,
            SUM(L.LCIMVT - L.LCIMCT) as MARGIN
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${clientCode}'
          AND L.LCAADC IN (${currentYear}, ${previousYear})
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC ASC
    `, false, false);
    
    // Calculate totals
    let totalCurrentYear = 0;
    let totalLastYear = 0;
    
    monthlySales.forEach(row => {
        const sales = parseFloat(row.SALES) || 0;
        if (row.YEAR === currentYear) totalCurrentYear += sales;
        if (row.YEAR === previousYear) totalLastYear += sales;
    });
    
    const isNewClient = totalLastYear < 0.01 && totalCurrentYear > 0;
    
    console.log(`  totalCurrentYear (2025): ${totalCurrentYear.toFixed(2)} €`);
    console.log(`  totalLastYear (2024): ${totalLastYear.toFixed(2)} €`);
    console.log(`  isNewClient: ${isNewClient}`);
    console.log(`  → Esto es lo que debería enviar el backend en totals.isNewClient\n`);
    
    // 2. Simular /sales-history/summary
    console.log('2. Endpoint /sales-history/summary:\n');
    
    const getStats = async (year) => {
        const result = await query(`
            SELECT 
                SUM(L.LCIMVT) as sales,
                SUM(L.LCIMVT - L.LCIMCT) as margin,
                SUM(L.LCCTUD) as units,
                COUNT(DISTINCT TRIM(L.LCCDRF)) as product_count
            FROM DSED.LACLAE L
            WHERE ${LACLAE_SALES_FILTER}
              AND L.LCAADC = ${year}
              AND TRIM(L.LCCDCL) = '${clientCode}'
        `, false, false);
        return result[0] || {};
    };
    
    const curr = await getStats(currentYear);
    const prev = await getStats(previousYear);
    
    console.log(`  2025: sales=${curr.SALES}, units=${curr.UNITS}, products=${curr.PRODUCT_COUNT}`);
    console.log(`  2024: sales=${prev.SALES}, units=${prev.UNITS}, products=${prev.PRODUCT_COUNT}`);
    
    // 3. Verificar qué columnas tiene LACLAE para productos
    console.log('\n3. Verificando columna LCCDRF (código artículo) en LACLAE:');
    const sampleProducts = await query(`
        SELECT DISTINCT TRIM(L.LCCDRF) as ARTICLE
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${clientCode}'
          AND L.LCAADC = 2025
          AND ${LACLAE_SALES_FILTER}
        FETCH FIRST 10 ROWS ONLY
    `, false, false);
    console.log(`  Muestra de artículos: ${sampleProducts.map(p => p.ARTICLE).join(', ')}`);
    console.log(`  Total encontrados en muestra: ${sampleProducts.length}`);
    
    process.exit(0);
}

debugPuaResponse().catch(console.error);
