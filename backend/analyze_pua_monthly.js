const { query, initDb } = require('./config/db');

const LACLAE_SALES_FILTER = `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;

async function analyzePuaMonthly() {
    await initDb();
    
    const clientCode = '4300009622'; // PUA
    
    console.log('=== ANÁLISIS PUA - ACUMULADO MENSUAL ===\n');
    
    // 1. Ventas mensuales 2024 vs 2025
    console.log('1. Ventas mensuales acumuladas:');
    const monthly = await query(`
        SELECT L.LCAADC as YEAR, L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${clientCode}'
          AND L.LCAADC IN (2024, 2025)
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC, L.LCMMDC
    `, false, false);
    
    console.log('\n  2024:');
    const sales2024 = monthly.filter(r => r.YEAR === 2024);
    if (sales2024.length === 0) {
        console.log('    SIN VENTAS EN 2024 - CLIENTE NUEVO EN 2025');
    } else {
        sales2024.forEach(r => console.log(`    Mes ${r.MONTH}: ${parseFloat(r.SALES).toFixed(2)} €`));
    }
    
    console.log('\n  2025:');
    const sales2025 = monthly.filter(r => r.YEAR === 2025);
    sales2025.forEach(r => console.log(`    Mes ${r.MONTH}: ${parseFloat(r.SALES).toFixed(2)} €`));
    
    // 2. Totales anuales
    console.log('\n2. Totales anuales:');
    const yearly = await query(`
        SELECT L.LCAADC as YEAR, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE TRIM(L.LCCDCL) = '${clientCode}'
          AND L.LCAADC IN (2024, 2025)
          AND ${LACLAE_SALES_FILTER}
        GROUP BY L.LCAADC
        ORDER BY L.LCAADC
    `, false, false);
    
    const total2024 = yearly.find(r => r.YEAR === 2024);
    const total2025 = yearly.find(r => r.YEAR === 2025);
    
    console.log(`  2024: ${total2024 ? parseFloat(total2024.SALES).toFixed(2) : '0'} €`);
    console.log(`  2025: ${total2025 ? parseFloat(total2025.SALES).toFixed(2) : '0'} €`);
    
    // 3. Conclusión para la UI
    console.log('\n3. LÓGICA ESPERADA:');
    if (!total2024 || parseFloat(total2024.SALES) < 0.01) {
        console.log('  ✅ 2024 = 0€ → Cliente es NUEVO en 2025');
        console.log('  → En la vista de acumulados 2025, cada mes debería mostrar AZUL "NUEVO"');
        console.log('  → Porque prevYearTotal (2024) = 0');
    }
    
    // 4. Simular respuesta del endpoint
    console.log('\n4. Lo que debería enviar el endpoint /sales-history/summary:');
    console.log(`  current.sales: ${total2025 ? parseFloat(total2025.SALES).toFixed(2) : '0'}`);
    console.log(`  previous.sales: ${total2024 ? parseFloat(total2024.SALES).toFixed(2) : '0'}`);
    console.log(`  → isNewClient = previous.sales < 0.01 && current.sales > 0 = ${(!total2024 || parseFloat(total2024.SALES) < 0.01) && (total2025 && parseFloat(total2025.SALES) > 0)}`);
    
    process.exit(0);
}

analyzePuaMonthly().catch(console.error);
