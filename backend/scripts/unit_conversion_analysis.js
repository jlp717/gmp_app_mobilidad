/**
 * Deep analysis of unit conversion data from DB
 * Checks specific products from screenshots + overall unit distribution
 */
const { query, queryWithParams } = require('../config/db');

async function main() {
    try {
        // 1. Products from screenshots
        console.log('\n=== PRODUCTS FROM SCREENSHOTS ===\n');
        const screenshotCodes = ['1124', '2186', '1337', '2604', '1685', '2780', '2907'];
        const placeholders = screenshotCodes.map(() => '?').join(',');
        const sql1 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UM,
                   A.UNIDADESCAJA AS UC,
                   A.UNIDADESFRACCION AS UF,
                   A.UNIDADESRETRACTIL AS UR,
                   A.PESO AS PESO,
                   COALESCE(A.PRODUCTOPESADOSN, '') AS PESADO,
                   COALESCE(A.TRAZABLESN, '') AS TRAZABLE,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(A.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(A.CALIBRE, '')) AS CALIBRE,
                   TRIM(COALESCE(A.GRADOS, '')) AS GRADOS,
                   COALESCE(A.VOLUMEN, 0) AS VOLUMEN,
                   TRIM(COALESCE(A.CODIGOFAMILIA, '')) AS FAMILIA,
                   TRIM(COALESCE(A.CODIGOSUBFAMILIA, '')) AS SUBFAM,
                   TRIM(COALESCE(A.CODIGOMARCA, '')) AS MARCA,
                   TRIM(COALESCE(A.OBSERVACION1, '')) AS OBS1,
                   TRIM(COALESCE(A.OBSERVACION2, '')) AS OBS2
            FROM DSEDAC.ART A
            WHERE TRIM(A.CODIGOARTICULO) IN (${placeholders})`;
        
        const rows1 = await queryWithParams(sql1, screenshotCodes);
        for (const r of rows1) {
            console.log(`\n--- ${r.CODE}: ${r.NAME} ---`);
            console.log(`  UM: "${r.UM}" | U/C: ${r.UC} | U/F: ${r.UF} | U/R: ${r.UR}`);
            console.log(`  PESO: ${r.PESO} | PESADO: "${r.PESADO}" | TRAZABLE: "${r.TRAZABLE}"`);
            console.log(`  FORMATO: "${r.FORMATO}" | PRESENTACION: "${r.PRESENTACION}"`);
            console.log(`  CALIBRE: "${r.CALIBRE}" | GRADOS: "${r.GRADOS}" | VOLUMEN: ${r.VOLUMEN}`);
            console.log(`  FAMILIA: "${r.FAMILIA}" | SUBFAM: "${r.SUBFAM}" | MARCA: "${r.MARCA}"`);
            console.log(`  OBS1: "${r.OBS1}" | OBS2: "${r.OBS2}"`);
        }

        // 2. Unit measure distribution (what units exist in DB)
        console.log('\n\n=== UNIT MEASURE DISTRIBUTION ===\n');
        const sql2 = `
            SELECT TRIM(A.UNIDADMEDIDA) AS UM, COUNT(*) AS CNT,
                   AVG(A.UNIDADESCAJA) AS AVG_UC,
                   AVG(A.PESO) AS AVG_PESO,
                   SUM(CASE WHEN A.PRODUCTOPESADOSN = 'S' THEN 1 ELSE 0 END) AS PESADOS
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0
            GROUP BY TRIM(A.UNIDADMEDIDA)
            ORDER BY CNT DESC`;
        const dist = await query(sql2);
        for (const r of dist) {
            console.log(`  ${(r.UM || '(vacío)').padEnd(12)} = ${String(r.CNT).padStart(5)} products | avg U/C: ${(r.AVG_UC || 0).toFixed(1)} | avg peso: ${(r.AVG_PESO || 0).toFixed(2)} | pesados: ${r.PESADOS}`);
        }

        // 3. Products with PRODUCTOPESADOSN = 'S'
        console.log('\n\n=== WEIGHED PRODUCTS (PRODUCTOPESADOSN=S) SAMPLE ===\n');
        const sql3 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UM,
                   A.UNIDADESCAJA AS UC, A.PESO AS PESO,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0 AND A.PRODUCTOPESADOSN = 'S'
            FETCH FIRST 20 ROWS ONLY`;
        const pesados = await query(sql3);
        for (const r of pesados) {
            console.log(`  ${r.CODE} | ${(r.NAME || '').substring(0, 50).padEnd(50)} | UM:${(r.UM || '').padEnd(8)} | UC:${r.UC} | Peso:${r.PESO} | Fmt:${r.FORMATO}`);
        }

        // 4. Products sold by KILOGRAMOS
        console.log('\n\n=== KILOGRAMOS PRODUCTS SAMPLE ===\n');
        const sql4 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   A.UNIDADESCAJA AS UC, A.UNIDADESFRACCION AS UF,
                   A.UNIDADESRETRACTIL AS UR, A.PESO AS PESO,
                   COALESCE(A.PRODUCTOPESADOSN, '') AS PESADO,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0 AND UPPER(TRIM(A.UNIDADMEDIDA)) IN ('KILO', 'KILOGRAMOS', 'KG', 'KILOS')
            FETCH FIRST 20 ROWS ONLY`;
        const kilos = await query(sql4);
        for (const r of kilos) {
            console.log(`  ${r.CODE} | ${(r.NAME || '').substring(0, 50).padEnd(50)} | UC:${r.UC} | UF:${r.UF} | UR:${r.UR} | Peso:${r.PESO} | Pesado:${r.PESADO} | Fmt:${r.FORMATO}`);
        }

        // 5. Products sold by LITROS
        console.log('\n\n=== LITROS PRODUCTS SAMPLE ===\n');
        const sql5 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   A.UNIDADESCAJA AS UC, A.UNIDADESFRACCION AS UF,
                   A.PESO AS PESO, COALESCE(A.VOLUMEN, 0) AS VOLUMEN,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0 AND UPPER(TRIM(A.UNIDADMEDIDA)) IN ('LITRO', 'LITROS', 'LT')
            FETCH FIRST 20 ROWS ONLY`;
        const litros = await query(sql5);
        for (const r of litros) {
            console.log(`  ${r.CODE} | ${(r.NAME || '').substring(0, 50).padEnd(50)} | UC:${r.UC} | UF:${r.UF} | Peso:${r.PESO} | Vol:${r.VOLUMEN} | Fmt:${r.FORMATO}`);
        }

        // 6. Aceite products (liquid/LITROS case)
        console.log('\n\n=== ACEITE PRODUCTS (liquid) ===\n');
        const sql6 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UM,
                   A.UNIDADESCAJA AS UC, A.UNIDADESFRACCION AS UF,
                   A.PESO AS PESO, COALESCE(A.VOLUMEN, 0) AS VOLUMEN,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0 AND UPPER(A.DESCRIPCIONARTICULO) LIKE '%ACEITE%'
            FETCH FIRST 15 ROWS ONLY`;
        const aceites = await query(sql6);
        for (const r of aceites) {
            console.log(`  ${r.CODE} | ${(r.NAME || '').substring(0, 50).padEnd(50)} | UM:${(r.UM || '').padEnd(8)} | UC:${r.UC} | UF:${r.UF} | Peso:${r.PESO} | Vol:${r.VOLUMEN} | Fmt:${r.FORMATO}`);
        }

        // 7. Field usage stats
        console.log('\n\n=== FIELD USAGE STATS (active products) ===\n');
        const sql7 = `
            SELECT 
                COUNT(*) AS TOTAL,
                SUM(CASE WHEN UNIDADESCAJA > 0 THEN 1 ELSE 0 END) AS HAS_UC,
                SUM(CASE WHEN UNIDADESCAJA > 1 THEN 1 ELSE 0 END) AS UC_GT1,
                SUM(CASE WHEN UNIDADESFRACCION > 0 THEN 1 ELSE 0 END) AS HAS_UF,
                SUM(CASE WHEN UNIDADESRETRACTIL > 0 THEN 1 ELSE 0 END) AS HAS_UR,
                SUM(CASE WHEN PESO > 0 THEN 1 ELSE 0 END) AS HAS_PESO,
                SUM(CASE WHEN VOLUMEN > 0 THEN 1 ELSE 0 END) AS HAS_VOL,
                SUM(CASE WHEN PRODUCTOPESADOSN = 'S' THEN 1 ELSE 0 END) AS IS_PESADO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0`;
        const stats = await query(sql7);
        const s = stats[0];
        console.log(`  Total active products:       ${s.TOTAL}`);
        console.log(`  With UNIDADESCAJA > 0:       ${s.HAS_UC} (${(s.HAS_UC/s.TOTAL*100).toFixed(1)}%)`);
        console.log(`  With UNIDADESCAJA > 1:       ${s.UC_GT1} (${(s.UC_GT1/s.TOTAL*100).toFixed(1)}%)`);
        console.log(`  With UNIDADESFRACCION > 0:   ${s.HAS_UF} (${(s.HAS_UF/s.TOTAL*100).toFixed(1)}%)`);
        console.log(`  With UNIDADESRETRACTIL > 0:  ${s.HAS_UR} (${(s.HAS_UR/s.TOTAL*100).toFixed(1)}%)`);
        console.log(`  With PESO > 0:               ${s.HAS_PESO} (${(s.HAS_PESO/s.TOTAL*100).toFixed(1)}%)`);
        console.log(`  With VOLUMEN > 0:            ${s.HAS_VOL} (${(s.HAS_VOL/s.TOTAL*100).toFixed(1)}%)`);
        console.log(`  PRODUCTOPESADOSN = S:        ${s.IS_PESADO} (${(s.IS_PESADO/s.TOTAL*100).toFixed(1)}%)`);

        // 8. Common U/C values
        console.log('\n\n=== COMMON U/C VALUES ===\n');
        const sql8 = `
            SELECT A.UNIDADESCAJA AS UC, COUNT(*) AS CNT
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0
            GROUP BY A.UNIDADESCAJA
            ORDER BY CNT DESC
            FETCH FIRST 20 ROWS ONLY`;
        const ucDist = await query(sql8);
        for (const r of ucDist) {
            console.log(`  U/C=${String(r.UC).padStart(6)} → ${r.CNT} products`);
        }

        // 9. Products with fractions (UF > 0) - what do they look like?
        console.log('\n\n=== FRACTION PRODUCTS (UF > 0) SAMPLE ===\n');
        const sql9 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UM,
                   A.UNIDADESCAJA AS UC, A.UNIDADESFRACCION AS UF,
                   A.UNIDADESRETRACTIL AS UR, A.PESO AS PESO,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0 AND A.UNIDADESFRACCION > 0
            ORDER BY A.UNIDADESFRACCION DESC
            FETCH FIRST 20 ROWS ONLY`;
        const fracciones = await query(sql9);
        for (const r of fracciones) {
            console.log(`  ${r.CODE} | ${(r.NAME || '').substring(0, 50).padEnd(50)} | UM:${(r.UM || '').padEnd(8)} | UC:${r.UC} | UF:${r.UF} | UR:${r.UR} | Peso:${r.PESO} | Fmt:${r.FORMATO}`);
        }

        // 10. How does PESO relate to UC for KILO products? 
        console.log('\n\n=== PESO vs UC RELATIONSHIP (KILO products) ===\n');
        const sql10 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   A.UNIDADESCAJA AS UC,
                   A.PESO AS PESO,
                   CASE WHEN A.UNIDADESCAJA > 0 AND A.PESO > 0 
                        THEN A.PESO / A.UNIDADESCAJA 
                        ELSE 0 END AS KG_PER_UNIT,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0 
              AND UPPER(TRIM(A.UNIDADMEDIDA)) IN ('KILO', 'KILOGRAMOS', 'KG', 'KILOS')
              AND A.PESO > 0
            ORDER BY RAND()
            FETCH FIRST 20 ROWS ONLY`;
        const kgRelation = await query(sql10);
        for (const r of kgRelation) {
            console.log(`  ${r.CODE} | ${(r.NAME || '').substring(0, 45).padEnd(45)} | UC:${String(r.UC).padStart(4)} | PESO:${String(r.PESO).padStart(6)} | kg/unit: ${(r.KG_PER_UNIT || 0).toFixed(3)} | Fmt:${r.FORMATO}`);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
    process.exit(0);
}

main();
