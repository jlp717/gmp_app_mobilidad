const { query, initDb } = require('./config/db');

const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;

async function analyze() {
    await initDb();
    
    // Cliente PUA terminado en 9622
    const clientCode = '%9622';
    
    console.log('=== ANÁLISIS CLIENTE PUA (9622) ===\n');
    
    // 1. Buscar código exacto
    const clientInfo = await query(`
        SELECT TRIM(CODIGOCLIENTE) as CODE, TRIM(NOMBRECLIENTE) as NAME
        FROM DSEDAC.CLI
        WHERE TRIM(CODIGOCLIENTE) LIKE '${clientCode}'
        FETCH FIRST 5 ROWS ONLY
    `, false, false);
    
    console.log('Clientes encontrados:');
    clientInfo.forEach(r => console.log(`  ${r.CODE}: ${r.NAME}`));
    
    const exactCode = clientInfo[0]?.CODE;
    if (!exactCode) {
        console.log('Cliente no encontrado');
        process.exit(1);
    }
    
    // 2. Ventas mensuales 2024-2026
    const monthly = await query(`
        SELECT L.LCAADC as YEAR, L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES, COUNT(DISTINCT L.LCCDFA) as PRODUCTS
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC IN (2024, 2025, 2026)
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC, L.LCMMDC
    `, false, false);
    
    console.log('\nVentas mensuales (con conteo productos):');
    monthly.forEach(r => console.log(`  ${r.YEAR}-${String(r.MONTH).padStart(2,'0')}: ${parseFloat(r.SALES).toFixed(2)} € (${r.PRODUCTS} productos)`));
    
    // 3. Total anual
    const yearly = await query(`
        SELECT L.LCAADC as YEAR, SUM(L.LCIMVT) as SALES, COUNT(DISTINCT L.LCCDFA) as PRODUCTS
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC IN (2024, 2025, 2026)
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC
        ORDER BY L.LCAADC
    `, false, false);
    
    console.log('\nTotales anuales:');
    yearly.forEach(r => console.log(`  ${r.YEAR}: ${parseFloat(r.SALES).toFixed(2)} € (${r.PRODUCTS} productos distintos)`));
    
    // 4. Ventas por semanas en enero 2025 y 2026
    console.log('\n=== DETALLE ENERO 2025 ===');
    const jan2025 = await query(`
        SELECT L.LCDDDC as DAY, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC = 2025
          AND L.LCMMDC = 1
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCDDDC
        ORDER BY L.LCDDDC
    `, false, false);
    
    if (jan2025.length === 0) {
        console.log('  Sin ventas en enero 2025');
    } else {
        jan2025.forEach(r => console.log(`  Día ${r.DAY}: ${parseFloat(r.SALES).toFixed(2)} €`));
    }
    
    console.log('\n=== DETALLE ENERO 2026 ===');
    const jan2026 = await query(`
        SELECT L.LCDDDC as DAY, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC = 2026
          AND L.LCMMDC = 1
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCDDDC
        ORDER BY L.LCDDDC
    `, false, false);
    
    if (jan2026.length === 0) {
        console.log('  Sin ventas en enero 2026');
    } else {
        jan2026.forEach(r => console.log(`  Día ${r.DAY}: ${parseFloat(r.SALES).toFixed(2)} €`));
    }
    
    // 5. Verificar ventas semanas 1-2 (hasta día 12) de 2025 y 2026
    console.log('\n=== VENTAS SEMANAS 1-2 (hasta día 12) ===');
    const weeks = await query(`
        SELECT L.LCAADC as YEAR, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC IN (2025, 2026)
          AND L.LCMMDC = 1
          AND L.LCDDDC <= 12
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC
    `, false, false);
    
    if (weeks.length === 0) {
        console.log('  Sin ventas en semanas 1-2 de enero en ningún año');
    } else {
        weeks.forEach(r => console.log(`  ${r.YEAR}: ${parseFloat(r.SALES).toFixed(2)} €`));
    }
    
    // 6. Probar conteo con LCCDRF (CodigoArticulo)
    console.log('\n=== CONTEO PRODUCTOS CON LCCDRF ===');
    const productCount = await query(`
        SELECT L.LCAADC as YEAR, COUNT(DISTINCT TRIM(L.LCCDRF)) as PRODUCTS
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC IN (2024, 2025, 2026)
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC
        ORDER BY L.LCAADC
    `, false, false);
    productCount.forEach(r => console.log(`  ${r.YEAR}: ${r.PRODUCTS} productos distintos`));

    // Muestra de productos enero 2025
    console.log('\n=== PRODUCTOS ENERO 2025 ===');
    const sampleProducts = await query(`
        SELECT DISTINCT TRIM(L.LCCDRF) as CODE, TRIM(L.LCDESC) as DESC
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${exactCode}'
          AND L.LCAADC = 2025
          AND L.LCMMDC = 1
          AND ${LACLAE_SALES_FILTER}
        FETCH FIRST 10 ROWS ONLY
    `, false, false);
    sampleProducts.forEach(r => console.log(`  ${r.CODE}: ${r.DESC}`));
    
    process.exit(0);
}

analyze().catch(console.error);
