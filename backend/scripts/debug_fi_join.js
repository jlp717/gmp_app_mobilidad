/**
 * Debug script to investigate FI hierarchy - better join check
 */

const { query, initDb } = require('../config/db');

async function debug() {
    await initDb();
    console.log('Database initialized.\n');
    
    try {
        // 1. Check what products exist in sales for a specific client
        console.log('=== PRODUCTOS CON VENTAS Y SUS FI CODES ===\n');
        
        const salesWithProducts = await query(`
            SELECT 
                TRIM(L.LCCDAL) as PRODUCT_CODE,
                TRIM(A.NOMARTICULO) as PRODUCT_NAME,
                TRIM(X.FILTRO01) as FI1,
                TRIM(X.FILTRO02) as FI2,
                TRIM(X.FILTRO03) as FI3,
                TRIM(X.FILTRO04) as FI4,
                TRIM(A.CODIGOSECCIONLARGA) as FI5,
                SUM(L.LCIMVT) as SALES
            FROM DSED.LACLAE L
            INNER JOIN DSEDAC.ART A ON TRIM(L.LCCDAL) = TRIM(A.CODIGOARTICULO)
            LEFT JOIN DSEDAC.ARTX X ON TRIM(L.LCCDAL) = TRIM(X.CODIGOARTICULO)
            WHERE L.LCAADC = 2025 
              AND L.LCMMDC BETWEEN 1 AND 6
              AND L.LCIMVT > 100
            GROUP BY L.LCCDAL, A.NOMARTICULO, X.FILTRO01, X.FILTRO02, X.FILTRO03, X.FILTRO04, A.CODIGOSECCIONLARGA
            ORDER BY SALES DESC
            FETCH FIRST 25 ROWS ONLY
        `, false, false);
        
        console.log('Top 25 productos por ventas con sus FI:');
        salesWithProducts.forEach(r => {
            const fi1 = (r.FI1 || r.fi1 || '-').trim() || '-';
            const fi2 = (r.FI2 || r.fi2 || '-').trim() || '-';
            const fi3 = (r.FI3 || r.fi3 || '-').trim() || '-';
            const fi4 = (r.FI4 || r.fi4 || '-').trim() || '-';
            const fi5 = (r.FI5 || r.fi5 || '-').trim() || '-';
            const code = r.PRODUCT_CODE || r.product_code;
            const name = (r.PRODUCT_NAME || r.product_name || '').substring(0, 30);
            const sales = parseFloat(r.SALES || r.sales || 0).toFixed(2);
            console.log(`  ${code.padEnd(10)} | FI:${fi1}>${fi2}>${fi3}>${fi4}>${fi5} | ${sales.padStart(12)} € | ${name}`);
        });
        
        // 2. Check FI distribution in sales data (only products with ARTX join)
        console.log('\n=== DISTRIBUCIÓN FI EN VENTAS (con join ARTX) ===\n');
        
        const fiDistribution = await query(`
            SELECT 
                COALESCE(TRIM(X.FILTRO01), 'SIN_FI1') as FI1_CODE,
                COUNT(DISTINCT L.LCCDAL) as NUM_PRODUCTS,
                SUM(L.LCIMVT) as TOTAL_SALES
            FROM DSED.LACLAE L
            INNER JOIN DSEDAC.ART A ON TRIM(L.LCCDAL) = TRIM(A.CODIGOARTICULO)
            LEFT JOIN DSEDAC.ARTX X ON TRIM(L.LCCDAL) = TRIM(X.CODIGOARTICULO)
            WHERE L.LCAADC = 2025 AND L.LCIMVT > 0
            GROUP BY X.FILTRO01
            ORDER BY TOTAL_SALES DESC
            FETCH FIRST 20 ROWS ONLY
        `, false, false);
        
        console.log('FI1 distribution:');
        fiDistribution.forEach(r => {
            const fi1 = r.FI1_CODE || r.fi1_code;
            const prods = r.NUM_PRODUCTS || r.num_products;
            const sales = parseFloat(r.TOTAL_SALES || r.total_sales || 0).toFixed(2);
            console.log(`  FI1: ${fi1.padEnd(10)} | Products: ${prods.toString().padStart(5)} | Sales: ${sales.padStart(15)} €`);
        });
        
        // 3. Get FI names for top FI1 codes
        console.log('\n=== NOMBRES FI1 ===\n');
        const fi1Names = await query(`
            SELECT TRIM(CODIGOFILTRO) as CODE, TRIM(DESCRIPCIONFILTRO) as NAME 
            FROM DSEDAC.FI1 
            ORDER BY CODIGOFILTRO
        `, false, false);
        
        fi1Names.forEach(r => {
            console.log(`  ${(r.CODE || r.code).padEnd(10)} => ${r.NAME || r.name}`);
        });
        
        // 4. Check what happens with a specific product known to have sales
        console.log('\n=== VERIFICACIÓN PRODUCTO ESPECÍFICO ===\n');
        const specificProd = await query(`
            SELECT 
                TRIM(A.CODIGOARTICULO) as CODE,
                TRIM(A.NOMARTICULO) as NAME,
                TRIM(X.FILTRO01) as FI1,
                TRIM(X.FILTRO02) as FI2,
                TRIM(X.FILTRO03) as FI3,
                TRIM(X.FILTRO04) as FI4
            FROM DSEDAC.ART A
            LEFT JOIN DSEDAC.ARTX X ON TRIM(A.CODIGOARTICULO) = TRIM(X.CODIGOARTICULO)
            WHERE TRIM(A.CODIGOARTICULO) IN ('1001', '1002', '1003', '2001', '3001')
        `, false, false);
        
        console.log('Productos 1001-3001:');
        specificProd.forEach(r => {
            const code = r.CODE || r.code;
            const name = (r.NAME || r.name || '').substring(0, 30);
            const fi1 = (r.FI1 || r.fi1 || '-').trim() || '-';
            const fi2 = (r.FI2 || r.fi2 || '-').trim() || '-';
            const fi3 = (r.FI3 || r.fi3 || '-').trim() || '-';
            const fi4 = (r.FI4 || r.fi4 || '-').trim() || '-';
            console.log(`  ${code.padEnd(10)} | FI:${fi1}>${fi2}>${fi3}>${fi4} | ${name}`);
        });
        
    } catch (e) {
        console.error('Error:', e);
    }
    
    process.exit(0);
}

debug();
