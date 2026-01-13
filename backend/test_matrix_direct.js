const http = require('http');

// Necesitamos un token válido para hacer la petición
// Vamos a simular lo que haría el backend directamente

const { query, initDb } = require('./config/db');

async function testMatrixResponse() {
    await initDb();
    
    const clientCode = '4300009622'; // PUA
    const currentYear = 2025;
    const previousYear = 2024;
    
    console.log('=== TEST MATRIX ENDPOINT RESPONSE ===\n');
    
    // Simular la query que hace /matrix
    const rows = await query(`
        SELECT 
            L.ANODOCUMENTO as YEAR,
            L.MESDOCUMENTO as MONTH,
            SUM(L.IMPORTEVENTA) as SALES
        FROM DSEDAC.LINDTO L
        WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
          AND L.ANODOCUMENTO IN (${currentYear}, ${previousYear})
          AND L.TIPOVENTA IN ('CC', 'VC')
          AND L.TIPOLINEA IN ('AB', 'VT')
          AND L.SERIEALBARAN NOT IN ('N', 'Z')
        GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY L.ANODOCUMENTO, L.MESDOCUMENTO
    `, false, false);
    
    console.log('Raw data from LINDTO:');
    rows.forEach(r => console.log(`  ${r.YEAR}-${r.MONTH}: ${parseFloat(r.SALES).toFixed(2)} €`));
    
    // Calculate totals
    let grandTotalSales = 0;
    let grandTotalPrevSales = 0;
    const productSet = new Set();
    const prevProductSet = new Set();
    
    rows.forEach(r => {
        const sales = parseFloat(r.SALES) || 0;
        if (r.YEAR === currentYear) {
            grandTotalSales += sales;
        } else if (r.YEAR === previousYear) {
            grandTotalPrevSales += sales;
        }
    });
    
    const isNewClient = grandTotalPrevSales < 0.01 && grandTotalSales > 0;
    
    console.log('\n=== CALCULATED VALUES ===');
    console.log(`grandTotalSales (${currentYear}): ${grandTotalSales.toFixed(2)} €`);
    console.log(`grandTotalPrevSales (${previousYear}): ${grandTotalPrevSales.toFixed(2)} €`);
    console.log(`isNewClient: ${isNewClient}`);
    
    console.log('\n=== EXPECTED SUMMARY ===');
    console.log(JSON.stringify({
        isNewClient,
        current: { sales: grandTotalSales, productCount: '?' },
        previous: { sales: grandTotalPrevSales, productCount: '?' }
    }, null, 2));
    
    process.exit(0);
}

testMatrixResponse().catch(console.error);
