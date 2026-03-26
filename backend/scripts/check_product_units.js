/**
 * Quick script to check real product unit data from ART table.
 * Shows: UNIDADMEDIDA, UNIDADESCAJA, UNIDADESFRACCION, UNIDADESRETRACTIL, PESO
 * for various product types to understand valid unit configurations.
 */
const { query } = require('../config/db');

async function main() {
    try {
        // Get a diverse sample of products with their unit configuration
        const sql = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UNIDAD_MEDIDA,
                   A.UNIDADESCAJA AS UDS_CAJA,
                   A.UNIDADESFRACCION AS UDS_FRACCION,
                   A.UNIDADESRETRACTIL AS UDS_RETRACTIL,
                   A.PESO AS PESO,
                   TRIM(A.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(A.CODIGOMARCA) AS MARCA,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(A.CODIGOPRESENTACION, '')) AS PRESENTACION
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0
            ORDER BY RAND()
            FETCH FIRST 50 ROWS ONLY`;
        
        const rows = await query(sql);
        
        console.log('\n=== SAMPLE PRODUCTS WITH UNIT DATA ===\n');
        console.log('CODE    | NAME (first 40 chars)                    | UM       | U/Caja | U/Frac | U/Retr | Peso   | Familia');
        console.log('--------|------------------------------------------|----------|--------|--------|--------|--------|--------');
        
        for (const r of rows) {
            const name = (r.NAME || '').substring(0, 40).padEnd(40);
            const um = (r.UNIDAD_MEDIDA || '').padEnd(8);
            const uc = String(r.UDS_CAJA || 0).padStart(6);
            const uf = String(r.UDS_FRACCION || 0).padStart(6);
            const ur = String(r.UDS_RETRACTIL || 0).padStart(6);
            const p = String(r.PESO || 0).padStart(6);
            const fam = (r.FAMILIA || '').padEnd(6);
            console.log(`${(r.CODE||'').padEnd(7)} | ${name} | ${um} | ${uc} | ${uf} | ${ur} | ${p} | ${fam}`);
        }
        
        // Now specific products: aceite, pollo, and a few others
        console.log('\n\n=== SPECIFIC SEARCHES ===\n');
        const searches = ['ACEITE', 'POLLO', 'LECHE', 'AGUA', 'JAMON', 'BANDEJA'];
        
        for (const term of searches) {
            const sql2 = `
                SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                       TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                       TRIM(A.UNIDADMEDIDA) AS UNIDAD_MEDIDA,
                       A.UNIDADESCAJA AS UDS_CAJA,
                       A.UNIDADESFRACCION AS UDS_FRACCION,
                       A.UNIDADESRETRACTIL AS UDS_RETRACTIL,
                       A.PESO AS PESO
                FROM DSEDAC.ART A
                WHERE A.ANOBAJA = 0
                  AND UPPER(A.DESCRIPCIONARTICULO) LIKE '%${term}%'
                FETCH FIRST 5 ROWS ONLY`;
            
            const results = await query(sql2);
            console.log(`\n--- ${term} ---`);
            for (const r of results) {
                console.log(`  ${r.CODE} | ${r.NAME} | UM:${r.UNIDAD_MEDIDA} | Caja:${r.UDS_CAJA} | Frac:${r.UDS_FRACCION} | Retract:${r.UDS_RETRACTIL} | Peso:${r.PESO}`);
            }
        }
        
        // Count products by UNIDADMEDIDA to understand the distribution
        console.log('\n\n=== UNIT MEASURE DISTRIBUTION ===\n');
        const sql3 = `
            SELECT TRIM(A.UNIDADMEDIDA) AS UM, COUNT(*) AS CNT
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0
            GROUP BY TRIM(A.UNIDADMEDIDA)
            ORDER BY CNT DESC`;
        const dist = await query(sql3);
        for (const r of dist) {
            console.log(`  ${(r.UM || '(vacío)').padEnd(12)} = ${r.CNT} products`);
        }

        // Check how many have unitsFraction > 0, unitsRetractil > 0, peso > 0
        console.log('\n\n=== UNIT FIELD USAGE ===\n');
        const sql4 = `
            SELECT 
                COUNT(*) AS TOTAL,
                SUM(CASE WHEN UNIDADESCAJA > 0 THEN 1 ELSE 0 END) AS HAS_CAJA,
                SUM(CASE WHEN UNIDADESFRACCION > 0 THEN 1 ELSE 0 END) AS HAS_FRACCION,
                SUM(CASE WHEN UNIDADESRETRACTIL > 0 THEN 1 ELSE 0 END) AS HAS_RETRACTIL,
                SUM(CASE WHEN PESO > 0 THEN 1 ELSE 0 END) AS HAS_PESO
            FROM DSEDAC.ART A
            WHERE A.ANOBAJA = 0`;
        const usage = await query(sql4);
        console.log(`  Total active products: ${usage[0].TOTAL}`);
        console.log(`  With UNIDADESCAJA > 0:     ${usage[0].HAS_CAJA}`);
        console.log(`  With UNIDADESFRACCION > 0: ${usage[0].HAS_FRACCION}`);
        console.log(`  With UNIDADESRETRACTIL > 0: ${usage[0].HAS_RETRACTIL}`);
        console.log(`  With PESO > 0:             ${usage[0].HAS_PESO}`);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
    process.exit(0);
}

main();
