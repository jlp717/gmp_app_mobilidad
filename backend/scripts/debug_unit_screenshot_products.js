/**
 * Debug script to check unit data for the specific products shown in the screenshots.
 * Products from screenshots:
 * - 1137: ALISTADO N-0 32/34 GOBER (piezas, U/R=43)
 * - 1117: ALISTADO N-1 TRES CARABELAS 40/44
 * - 1124: ALISTADO N-A TRES CARABELAS 48/52 PZ/KG (bandejas, U/R=50)
 * - 2186: CERDO IBERICO CARRILLADA TGP 1X3 APROX (estuche, U/C=1)
 * - 1337: CROQUETA BOGAVANTE 50GR 3X1 (cajas+unidades, U/C=3, U/F=1, U/R=20)
 * - 2604: CROQUETA BOLETUS Y TRUFA TGP 4BOLX1 (cajas only, U/C=4, U/F=4, U/R=25)
 * - 2907: PIZZA CARBONARA 8X405GR BUITONI (cajas+unidades, U/C=8, U/F=1, U/R=1)
 * - 1473: PULPO 1000/2000 N2 8UD RP (kilogramos)
 * - 1279: PULPO 4000/6000 N00 4UD RP (cajas, U/C=1)
 */
const { query } = require('../config/db');

async function main() {
    try {
        const codes = ['1137', '1117', '1124', '2186', '1337', '2604', '2907', '1473', '1279'];
        const codeList = codes.map(c => `'${c}'`).join(',');

        const sql = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UNIDAD_MEDIDA,
                   A.UNIDADESCAJA AS UDS_CAJA,
                   A.UNIDADESFRACCION AS UDS_FRACCION,
                   A.UNIDADESRETRACTIL AS UDS_RETRACTIL,
                   A.PESO AS PESO,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(A.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   COALESCE(A.PRODUCTOPESADOSN, '') AS PESADO_SN,
                   TRIM(A.CODIGOFAMILIA) AS FAMILIA,
                   COALESCE(S.ENVASES, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES, 0) AS STOCK_UNIDADES,
                   COALESCE(T1.PRECIOTARIFA, 0) AS PRECIO_T1
            FROM DSEDAC.ART A
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
            WHERE TRIM(A.CODIGOARTICULO) IN (${codeList})
            ORDER BY A.DESCRIPCIONARTICULO`;

        const rows = await query(sql);

        console.log('\n=== PRODUCTS FROM SCREENSHOTS - DB DATA ===\n');
        for (const r of rows) {
            console.log(`CODE: ${r.CODE}`);
            console.log(`  NAME:           ${r.NAME}`);
            console.log(`  UNIDADMEDIDA:   "${r.UNIDAD_MEDIDA}" (${r.UNIDAD_MEDIDA ? 'set' : 'EMPTY'})`);
            console.log(`  UNIDADESCAJA:   ${r.UDS_CAJA}`);
            console.log(`  UNIDADESFRAC:   ${r.UDS_FRACCION}`);
            console.log(`  UNIDADESRETRACT: ${r.UDS_RETRACTIL}`);
            console.log(`  PESO:           ${r.PESO}`);
            console.log(`  FORMATO:        "${r.FORMATO}"`);
            console.log(`  PRESENTACION:   "${r.PRESENTACION}"`);
            console.log(`  PRODUCTOPESADO: "${r.PESADO_SN}"`);
            console.log(`  FAMILIA:        "${r.FAMILIA}"`);
            console.log(`  STOCK ENV/UNI:  ${r.STOCK_ENVASES} / ${r.STOCK_UNIDADES}`);
            console.log(`  PRECIO T1:      ${r.PRECIO_T1}`);
            console.log('');
        }

        // Also check what the legacy app shows as CANTIDAD options
        // The key: The legacy app uses the PRESENCIA column in another table to determine
        // what units are available. Let's check if there's an UNIDADES DE MEDIDA table
        console.log('\n=== UNIDADES DE MEDIDA TABLE ===\n');
        const umSql = `SELECT * FROM DSEDAC.UME FETCH FIRST 20 ROWS ONLY`;
        try {
            const umRows = await query(umSql);
            for (const r of umRows) {
                console.log(JSON.stringify(r));
            }
        } catch (e) {
            console.log(`  UME table not found or error: ${e.message}`);
        }

        // Check if there's a table relating products to unit types
        console.log('\n=== CHECKING FOR ARTICLE-UNIT RELATIONSHIP TABLES ===\n');
        const tablesToCheck = [
            'DSEDAC.AUM', // Artículo-Unidad de medida
            'DSEDAC.UMA', // Unidades de medida de artículo  
            'DSEDAC.UAR', // Unidades de artículo
            'DSEDAC.APR', // Artículo-Presentación
        ];
        
        for (const table of tablesToCheck) {
            try {
                const testRows = await query(`SELECT * FROM ${table} FETCH FIRST 3 ROWS ONLY`);
                console.log(`\n${table} EXISTS - ${testRows.length} rows sample:`);
                for (const r of testRows) {
                    console.log(`  ${JSON.stringify(r)}`);
                }
            } catch (e) {
                console.log(`${table}: ${e.message.substring(0, 80)}`);
            }
        }

        // Check FORMATO distribution
        console.log('\n=== FORMATO DISTRIBUTION ===\n');
        const fmtSql = `
            SELECT TRIM(COALESCE(FORMATO, '')) AS FMT, COUNT(*) AS CNT
            FROM DSEDAC.ART
            WHERE ANOBAJA = 0
            GROUP BY TRIM(COALESCE(FORMATO, ''))
            ORDER BY CNT DESC`;
        const fmtRows = await query(fmtSql);
        for (const r of fmtRows) {
            console.log(`  "${r.FMT || '(empty)'}" = ${r.CNT} products`);
        }

        // Check PRODUCTOPESADOSN distribution
        console.log('\n=== PRODUCTOPESADO DISTRIBUTION ===\n');
        const pesSql = `
            SELECT TRIM(COALESCE(PRODUCTOPESADOSN, '')) AS PESADO, COUNT(*) AS CNT
            FROM DSEDAC.ART
            WHERE ANOBAJA = 0
            GROUP BY TRIM(COALESCE(PRODUCTOPESADOSN, ''))
            ORDER BY CNT DESC`;
        const pesRows = await query(pesSql);
        for (const r of pesRows) {
            console.log(`  "${r.PESADO || '(empty)'}" = ${r.CNT} products`);
        }

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }
    process.exit(0);
}

main();
