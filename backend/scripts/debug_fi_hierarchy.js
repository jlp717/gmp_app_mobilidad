/**
 * Debug script to investigate FI hierarchy data
 * Checks what FI1-FI5 codes exist and their distribution
 */

const { query, initDb } = require('../config/db');

async function debugFiHierarchy() {
    console.log('='.repeat(60));
    console.log('DEBUG: FI Hierarchy Investigation');
    console.log('='.repeat(60));
    
    // Initialize database pool
    await initDb();
    console.log('Database pool initialized.');
    
    try {
        // 1. Check FI1-FI5 tables content
        console.log('\n--- FI TABLES CONTENT ---\n');
        
        for (let i = 1; i <= 5; i++) {
            const tableName = `FI${i}`;
            try {
                const rows = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO FROM DSEDAC.${tableName} FETCH FIRST 10 ROWS ONLY`, false, false);
                console.log(`\n${tableName} (first 10 rows):`);
                if (rows.length === 0) {
                    console.log('  NO DATA');
                } else {
                    rows.forEach(r => {
                        console.log(`  ${r.CODIGOFILTRO || r.codigofiltro || 'NULL'} => ${r.DESCRIPCIONFILTRO || r.descripcionfiltro || 'NULL'}`);
                    });
                }
                
                // Count total
                const countRows = await query(`SELECT COUNT(*) as CNT FROM DSEDAC.${tableName}`, false, false);
                console.log(`  Total rows: ${countRows[0]?.CNT || countRows[0]?.cnt || 0}`);
            } catch (e) {
                console.log(`  ERROR querying ${tableName}: ${e.message}`);
            }
        }
        
        // 2. Check ARTX table for FI mapping (FILTRO01-04)
        console.log('\n--- ARTX FI MAPPING (FILTRO01-04) ---\n');
        try {
            const artxSample = await query(`
                SELECT 
                    CODIGOARTICULO,
                    FILTRO01,
                    FILTRO02,
                    FILTRO03,
                    FILTRO04
                FROM DSEDAC.ARTX
                WHERE FILTRO01 IS NOT NULL OR FILTRO02 IS NOT NULL
                FETCH FIRST 15 ROWS ONLY
            `, false, false);
            
            console.log('Sample ARTX rows:');
            artxSample.forEach(r => {
                console.log(`  Art: ${r.CODIGOARTICULO || r.codigoarticulo} => F1:${r.FILTRO01 || r.filtro01 || '-'} F2:${r.FILTRO02 || r.filtro02 || '-'} F3:${r.FILTRO03 || r.filtro03 || '-'} F4:${r.FILTRO04 || r.filtro04 || '-'}`);
            });
            
            // Check how many articles have each FI level
            const fiStats = await query(`
                SELECT 
                    COUNT(*) as TOTAL,
                    SUM(CASE WHEN FILTRO01 IS NOT NULL AND TRIM(FILTRO01) <> '' THEN 1 ELSE 0 END) as HAS_F1,
                    SUM(CASE WHEN FILTRO02 IS NOT NULL AND TRIM(FILTRO02) <> '' THEN 1 ELSE 0 END) as HAS_F2,
                    SUM(CASE WHEN FILTRO03 IS NOT NULL AND TRIM(FILTRO03) <> '' THEN 1 ELSE 0 END) as HAS_F3,
                    SUM(CASE WHEN FILTRO04 IS NOT NULL AND TRIM(FILTRO04) <> '' THEN 1 ELSE 0 END) as HAS_F4
                FROM DSEDAC.ARTX
            `, false, false);
            
            if (fiStats[0]) {
                const s = fiStats[0];
                console.log('\nARTX FI Distribution:');
                console.log(`  Total articles: ${s.TOTAL || s.total}`);
                console.log(`  With FILTRO01: ${s.HAS_F1 || s.has_f1}`);
                console.log(`  With FILTRO02: ${s.HAS_F2 || s.has_f2}`);
                console.log(`  With FILTRO03: ${s.HAS_F3 || s.has_f3}`);
                console.log(`  With FILTRO04: ${s.HAS_F4 || s.has_f4}`);
            }
        } catch (e) {
            console.log(`  ERROR querying ARTX: ${e.message}`);
        }
        
        // 3. Check ART table for CODIGOSECCIONLARGA (FI5)
        console.log('\n--- ART CODIGOSECCIONLARGA (FI5) ---\n');
        try {
            const artSample = await query(`
                SELECT 
                    CODIGOARTICULO,
                    CODIGOSECCIONLARGA
                FROM DSEDAC.ART
                WHERE CODIGOSECCIONLARGA IS NOT NULL AND TRIM(CODIGOSECCIONLARGA) <> ''
                FETCH FIRST 10 ROWS ONLY
            `, false, false);
            
            console.log('Sample ART rows with CODIGOSECCIONLARGA:');
            artSample.forEach(r => {
                console.log(`  ${r.CODIGOARTICULO || r.codigoarticulo} => FI5: ${r.CODIGOSECCIONLARGA || r.codigoseccionlarga}`);
            });
            
            const fi5Stats = await query(`
                SELECT 
                    COUNT(*) as TOTAL,
                    SUM(CASE WHEN CODIGOSECCIONLARGA IS NOT NULL AND TRIM(CODIGOSECCIONLARGA) <> '' THEN 1 ELSE 0 END) as HAS_FI5
                FROM DSEDAC.ART
            `, false, false);
            
            if (fi5Stats[0]) {
                console.log(`\nTotal ART: ${fi5Stats[0].TOTAL || fi5Stats[0].total}`);
                console.log(`With FI5: ${fi5Stats[0].HAS_FI5 || fi5Stats[0].has_fi5}`);
            }
        } catch (e) {
            console.log(`  ERROR querying ART: ${e.message}`);
        }
        
        // 4. Check actual sales data with FI codes for a specific client
        console.log('\n--- SAMPLE SALES DATA WITH FI CODES ---\n');
        try {
            const salesSample = await query(`
                SELECT 
                    L.LCCDCL as CLIENT,
                    L.LCCDAL as PRODUCT,
                    TRIM(X.FILTRO01) as FI1,
                    TRIM(X.FILTRO02) as FI2,
                    TRIM(X.FILTRO03) as FI3,
                    TRIM(X.FILTRO04) as FI4,
                    TRIM(A.CODIGOSECCIONLARGA) as FI5,
                    SUM(L.LCIMVT) as SALES
                FROM DSED.LACLAE L
                LEFT JOIN DSEDAC.ARTX X ON TRIM(L.LCCDAL) = TRIM(X.CODIGOARTICULO)
                LEFT JOIN DSEDAC.ART A ON TRIM(L.LCCDAL) = TRIM(A.CODIGOARTICULO)
                WHERE L.LCAADC = 2025 AND L.LCMMDC = 1
                  AND L.LCIMVT > 0
                GROUP BY L.LCCDCL, L.LCCDAL, X.FILTRO01, X.FILTRO02, X.FILTRO03, X.FILTRO04, A.CODIGOSECCIONLARGA
                FETCH FIRST 20 ROWS ONLY
            `, false, false);
            
            console.log('Sample sales with FI codes (2025-01):');
            salesSample.forEach(r => {
                const fi1 = r.FI1 || r.fi1 || '-';
                const fi2 = r.FI2 || r.fi2 || '-';
                const fi3 = r.FI3 || r.fi3 || '-';
                const fi4 = r.FI4 || r.fi4 || '-';
                const fi5 = r.FI5 || r.fi5 || '-';
                console.log(`  Client: ${r.CLIENT || r.client} | Product: ${r.PRODUCT || r.product} | FI: ${fi1}>${fi2}>${fi3}>${fi4}>${fi5} | Sales: ${r.SALES || r.sales}`);
            });
        } catch (e) {
            console.log(`  ERROR querying sales: ${e.message}`);
        }
        
        // 5. Check distinct FI combinations
        console.log('\n--- DISTINCT FI COMBINATIONS IN SALES ---\n');
        try {
            const combos = await query(`
                SELECT 
                    TRIM(X.FILTRO01) as FI1,
                    TRIM(X.FILTRO02) as FI2,
                    TRIM(X.FILTRO03) as FI3,
                    TRIM(X.FILTRO04) as FI4,
                    COUNT(DISTINCT L.LCCDAL) as PRODUCTS,
                    SUM(L.LCIMVT) as TOTAL_SALES
                FROM DSED.LACLAE L
                LEFT JOIN DSEDAC.ARTX X ON TRIM(L.LCCDAL) = TRIM(X.CODIGOARTICULO)
                WHERE L.LCAADC = 2025 AND L.LCIMVT > 0
                GROUP BY X.FILTRO01, X.FILTRO02, X.FILTRO03, X.FILTRO04
                ORDER BY TOTAL_SALES DESC
                FETCH FIRST 15 ROWS ONLY
            `, false, false);
            
            console.log('Top FI combinations by sales (2025):');
            combos.forEach(r => {
                const fi1 = r.FI1 || r.fi1 || 'NULL';
                const fi2 = r.FI2 || r.fi2 || 'NULL';
                const fi3 = r.FI3 || r.fi3 || 'NULL';
                const fi4 = r.FI4 || r.fi4 || 'NULL';
                console.log(`  ${fi1} > ${fi2} > ${fi3} > ${fi4} | Products: ${r.PRODUCTS || r.products} | Sales: ${(r.TOTAL_SALES || r.total_sales || 0).toFixed(2)}`);
            });
        } catch (e) {
            console.log(`  ERROR: ${e.message}`);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('DEBUG COMPLETE');
        console.log('='.repeat(60));
        
    } catch (e) {
        console.error('Fatal error:', e);
    }
    
    process.exit(0);
}

debugFiHierarchy();
