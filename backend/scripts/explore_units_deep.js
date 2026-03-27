/**
 * DEEP EXPLORATION: Unit of Measure Logic
 * ========================================
 * Explores every possible DB column/table to understand how the legacy app
 * decides: (1) which unit label to show, (2) dual vs single field, (3) Neto U/R price.
 *
 * Products from screenshots:
 * 1137, 1117, 1124, 2186, 1337, 2604, 2907, 1473, 1279
 */
const { query } = require('../config/db');

async function main() {
    try {
        // ================================================================
        // PART 1: Full ART table dump for our 9 products
        // ================================================================
        console.log('\n' + '='.repeat(80));
        console.log('  PART 1: ALL ART COLUMNS FOR SCREENSHOT PRODUCTS');
        console.log('='.repeat(80));

        const codes = ['1137', '1117', '1124', '2186', '1337', '2604', '2907', '1473', '1279'];
        
        for (const code of codes) {
            const sql = `SELECT * FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) = '${code}'`;
            const rows = await query(sql, false);
            if (rows.length === 0) {
                console.log(`\n--- ${code}: NOT FOUND ---`);
                continue;
            }
            const r = rows[0];
            console.log(`\n--- ${code}: ${(r.DESCRIPCIONARTICULO || '').trim()} ---`);
            // Print ALL columns sorted alphabetically
            const keys = Object.keys(r).sort();
            for (const k of keys) {
                const val = r[k];
                // Only print non-empty/non-zero values for clarity
                if (val !== '' && val !== 0 && val !== null && val !== ' ') {
                    console.log(`  ${k.padEnd(30)} = ${JSON.stringify(val)}`);
                }
            }
        }

        // ================================================================
        // PART 2: Check key unit-related fields for these products
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 2: KEY UNIT FIELDS COMPARISON');
        console.log('='.repeat(80));

        const unitSql = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.UNIDADMEDIDA) AS UM,
                   A.UNIDADESCAJA AS UC,
                   A.UNIDADESFRACCION AS UF,
                   A.UNIDADESRETRACTIL AS UR,
                   A.PESO AS PESO,
                   TRIM(COALESCE(A.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(A.CODIGOPRESENTACION, '')) AS PRES,
                   COALESCE(A.PRODUCTOPESADOSN, '') AS PESADO,
                   TRIM(COALESCE(A.CLASIFICACION, '')) AS CLASIF,
                   TRIM(COALESCE(A.CATEGORIAARTICULO, '')) AS CATEG,
                   TRIM(COALESCE(A.CODIGOTIPO, '')) AS TIPO,
                   TRIM(COALESCE(A.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(A.CODIGOGAMA, '')) AS GAMA,
                   TRIM(COALESCE(A.OBSERVACION1, '')) AS OBS1,
                   TRIM(COALESCE(A.OBSERVACION2, '')) AS OBS2,
                   TRIM(A.CODIGOFAMILIA) AS FAM,
                   TRIM(A.CODIGOMARCA) AS MARCA,
                   TRIM(COALESCE(A.CODIGOSUBFAMILIA, '')) AS SUBFAM,
                   TRIM(COALESCE(A.CODIGOPREFAMILIA, '')) AS PREFAM
            FROM DSEDAC.ART A
            WHERE TRIM(A.CODIGOARTICULO) IN (${codes.map(c => `'${c}'`).join(',')})
            ORDER BY A.DESCRIPCIONARTICULO`;

        const unitRows = await query(unitSql, false);
        console.log('\nCODE   | UC    | UF    | UR    | PESO  | UM       | FORMATO | PRES    | PESADO | CLASIF | TIPO   | GRUPO  | CATEG  | FAM   | GAMA');
        console.log('-'.repeat(160));
        for (const r of unitRows) {
            console.log(`${(r.CODE||'').padEnd(6)} | ${String(r.UC||0).padEnd(5)} | ${String(r.UF||0).padEnd(5)} | ${String(r.UR||0).padEnd(5)} | ${String(r.PESO||0).padEnd(5)} | ${(r.UM||'').padEnd(8)} | ${(r.FORMATO||'').padEnd(7)} | ${(r.PRES||'').padEnd(7)} | ${(r.PESADO||'').padEnd(6)} | ${(r.CLASIF||'').padEnd(6)} | ${(r.TIPO||'').padEnd(6)} | ${(r.GRUPO||'').padEnd(6)} | ${(r.CATEG||'').padEnd(6)} | ${(r.FAM||'').padEnd(5)} | ${r.GAMA||''}`);
        }

        // ================================================================
        // PART 3: Check UMD table (Unidades de Medida) 
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 3: UMD TABLE (all entries)');
        console.log('='.repeat(80));

        try {
            const umdRows = await query('SELECT * FROM DSEDAC.UMD', false);
            for (const r of umdRows) {
                console.log(`  "${(r.UNIDADMEDIDA || '').trim()}" → "${(r.DESCRIPCIONUNIDADMEDIDA || '').trim()}"`);
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }

        // ================================================================
        // PART 4: How does the legacy app store orders for these products?
        // Check DSEDAC.LPC (Líneas pedidos cliente) for these products
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 4: LEGACY ORDER LINES (LPC) FOR THESE PRODUCTS');
        console.log('='.repeat(80));

        for (const code of codes) {
            const lpcSql = `
                SELECT TRIM(L.CODIGOARTICULO) AS CODE,
                       L.CANTIDADENVASES AS ENV,
                       L.CANTIDADUNIDADES AS UNI,
                       TRIM(COALESCE(L.UNIDADMEDIDA, '')) AS UM,
                       L.PRECIOVENTA,
                       L.PRECIOCOSTO,
                       TRIM(L.CLASELINEA) AS CLASE,
                       L.ANODOCUMENTO AS ANO
                FROM DSEDAC.LPC L
                WHERE TRIM(L.CODIGOARTICULO) LIKE '%${code}'
                ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
                FETCH FIRST 5 ROWS ONLY`;
            try {
                const lpcRows = await query(lpcSql, false);
                if (lpcRows.length > 0) {
                    console.log(`\n  --- ${code} (recent LPC lines) ---`);
                    for (const r of lpcRows) {
                        console.log(`    ENV: ${r.ENV} | UNI: ${r.UNI} | UM: "${r.UM}" | PV: ${r.PRECIOVENTA} | Clase: ${r.CLASE} | Año: ${r.ANO}`);
                    }
                }
            } catch (e) {
                console.log(`  ${code}: LPC error: ${e.message.substring(0, 60)}`);
            }
        }

        // ================================================================
        // PART 5: Check LINDTO (Líneas documentos - albaranes) for these products
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 5: LEGACY DELIVERY LINES (LINDTO) FOR THESE PRODUCTS');
        console.log('='.repeat(80));

        for (const code of codes) {
            const linSql = `
                SELECT TRIM(L.CODIGOARTICULO) AS CODE,
                       L.CANTIDADENVASES AS ENV,
                       L.CANTIDADUNIDADES AS UNI,
                       TRIM(COALESCE(L.UNIDADMEDIDA, '')) AS UM,
                       L.PRECIOVENTA,
                       TRIM(L.CLASELINEA) AS CLASE,
                       L.ANODOCUMENTO AS ANO,
                       L.MESDOCUMENTO AS MES
                FROM DSEDAC.LINDTO L
                WHERE TRIM(L.CODIGOARTICULO) LIKE '%${code}'
                  AND L.ANODOCUMENTO >= 2024
                ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
                FETCH FIRST 5 ROWS ONLY`;
            try {
                const linRows = await query(linSql, false);
                if (linRows.length > 0) {
                    console.log(`\n  --- ${code} (recent LINDTO lines) ---`);
                    for (const r of linRows) {
                        console.log(`    ENV: ${r.ENV} | UNI: ${r.UNI} | UM: "${r.UM}" | PV: ${r.PRECIOVENTA} | Clase: ${r.CLASE} | ${r.MES}/${r.ANO}`);
                    }
                }
            } catch (e) {
                console.log(`  ${code}: LINDTO error: ${e.message.substring(0, 60)}`);
            }
        }

        // ================================================================
        // PART 6: UNIDADMEDIDA distribution across all products
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 6: UNIDADMEDIDA DISTRIBUTION (active products)');
        console.log('='.repeat(80));

        const distSql = `
            SELECT TRIM(COALESCE(UNIDADMEDIDA, '')) AS UM,
                   COUNT(*) AS CNT,
                   MIN(TRIM(CODIGOARTICULO)) AS SAMPLE_CODE,
                   MIN(TRIM(DESCRIPCIONARTICULO)) AS SAMPLE_NAME
            FROM DSEDAC.ART
            WHERE ANOBAJA = 0
            GROUP BY TRIM(COALESCE(UNIDADMEDIDA, ''))
            ORDER BY CNT DESC`;
        const distRows = await query(distSql, false);
        for (const r of distRows) {
            console.log(`  "${(r.UM || '(empty)').padEnd(10)}" = ${String(r.CNT).padStart(5)} products | sample: ${r.SAMPLE_CODE} - ${(r.SAMPLE_NAME||'').substring(0,40)}`);
        }

        // ================================================================
        // PART 7: FORMATO distribution
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 7: FORMATO DISTRIBUTION');
        console.log('='.repeat(80));

        const fmtSql = `
            SELECT TRIM(COALESCE(FORMATO, '')) AS FMT,
                   COUNT(*) AS CNT,
                   MIN(TRIM(CODIGOARTICULO)) AS SAMPLE_CODE,
                   MIN(TRIM(DESCRIPCIONARTICULO)) AS SAMPLE_NAME
            FROM DSEDAC.ART
            WHERE ANOBAJA = 0
            GROUP BY TRIM(COALESCE(FORMATO, ''))
            ORDER BY CNT DESC`;
        const fmtRows = await query(fmtSql, false);
        for (const r of fmtRows) {
            console.log(`  "${(r.FMT || '(empty)').padEnd(10)}" = ${String(r.CNT).padStart(5)} products | sample: ${r.SAMPLE_CODE} - ${(r.SAMPLE_NAME||'').substring(0,40)}`);
        }

        // ================================================================
        // PART 8: CODIGOPRESENTACION distribution
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 8: CODIGOPRESENTACION DISTRIBUTION');
        console.log('='.repeat(80));

        const presSql = `
            SELECT TRIM(COALESCE(CODIGOPRESENTACION, '')) AS PRES,
                   COUNT(*) AS CNT,
                   MIN(TRIM(CODIGOARTICULO)) AS SAMPLE_CODE,
                   MIN(TRIM(DESCRIPCIONARTICULO)) AS SAMPLE_NAME
            FROM DSEDAC.ART
            WHERE ANOBAJA = 0
            GROUP BY TRIM(COALESCE(CODIGOPRESENTACION, ''))
            ORDER BY CNT DESC`;
        const presRows = await query(presSql, false);
        for (const r of presRows) {
            console.log(`  "${(r.PRES || '(empty)').padEnd(10)}" = ${String(r.CNT).padStart(5)} products | sample: ${r.SAMPLE_CODE} - ${(r.SAMPLE_NAME||'').substring(0,40)}`);
        }

        // ================================================================
        // PART 9: PRODUCTOPESADOSN distribution
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 9: PRODUCTOPESADOSN DISTRIBUTION');
        console.log('='.repeat(80));

        const pesSql = `
            SELECT TRIM(COALESCE(PRODUCTOPESADOSN, '')) AS P,
                   COUNT(*) AS CNT
            FROM DSEDAC.ART WHERE ANOBAJA = 0
            GROUP BY TRIM(COALESCE(PRODUCTOPESADOSN, ''))
            ORDER BY CNT DESC`;
        const pesRows = await query(pesSql, false);
        for (const r of pesRows) {
            console.log(`  "${(r.P || '(empty)').padEnd(4)}" = ${r.CNT} products`);
        }

        // ================================================================
        // PART 10: Cross-reference: products with FORMATO='K' vs PRODUCTOPESADO='S'
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 10: FORMATO=K vs PRODUCTOPESADO=S OVERLAP');
        console.log('='.repeat(80));

        const overSql = `
            SELECT 
                SUM(CASE WHEN TRIM(COALESCE(FORMATO,''))='K' AND COALESCE(PRODUCTOPESADOSN,'')='S' THEN 1 ELSE 0 END) AS BOTH_K_S,
                SUM(CASE WHEN TRIM(COALESCE(FORMATO,''))='K' AND COALESCE(PRODUCTOPESADOSN,'')<>'S' THEN 1 ELSE 0 END) AS K_ONLY,
                SUM(CASE WHEN TRIM(COALESCE(FORMATO,''))<>'K' AND COALESCE(PRODUCTOPESADOSN,'')='S' THEN 1 ELSE 0 END) AS S_ONLY,
                SUM(CASE WHEN TRIM(COALESCE(FORMATO,''))<>'K' AND COALESCE(PRODUCTOPESADOSN,'')<>'S' THEN 1 ELSE 0 END) AS NEITHER
            FROM DSEDAC.ART WHERE ANOBAJA = 0`;
        const overRows = await query(overSql, false);
        const o = overRows[0];
        console.log(`  FORMATO=K AND PESADO=S: ${o.BOTH_K_S}`);
        console.log(`  FORMATO=K only:         ${o.K_ONLY}`);
        console.log(`  PESADO=S only:          ${o.S_ONLY}`);
        console.log(`  Neither:                ${o.NEITHER}`);

        // ================================================================
        // PART 11: Check if there's a presentation table (PRE/PRES)
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 11: PRESENTATION TABLE SEARCH');
        console.log('='.repeat(80));

        const tablesToCheck = [
            'DSEDAC.PRE',   // Presentaciones
            'DSEDAC.PREL1', // Presentaciones L1
            'DSEDAC.TPA',   // Tipo artículo
            'DSEDAC.TPAL1', // Tipo artículo L1
            'DSEDAC.GAM',   // Gamas
            'DSEDAC.GAML1', // Gamas L1
            'DSEDAC.CLA',   // Clasificaciones
            'DSEDAC.CLAL1', // Clasificaciones L1
            'DSEDAC.GRP',   // Grupos
            'DSEDAC.GRPL1', // Grupos L1
            'DSEDAC.CAT',   // Categorías
            'DSEDAC.CATL1', // Categorías L1
        ];

        for (const table of tablesToCheck) {
            try {
                const testRows = await query(`SELECT * FROM ${table} FETCH FIRST 10 ROWS ONLY`, false);
                console.log(`\n  ${table} EXISTS (${testRows.length} sample rows):`);
                if (testRows.length > 0) {
                    const cols = Object.keys(testRows[0]);
                    console.log(`    Columns: ${cols.join(', ')}`);
                    for (const r of testRows.slice(0, 5)) {
                        const vals = cols.map(c => `${c}=${JSON.stringify(r[c])}`).join(' | ');
                        console.log(`    ${vals}`);
                    }
                }
            } catch (e) {
                console.log(`  ${table}: not found`);
            }
        }

        // ================================================================
        // PART 12: UNIDADESCAJA / UNIDADESFRACCION / UNIDADESRETRACTIL patterns
        // For understanding when dual-field applies
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 12: UC/UF/UR PATTERNS (active products)');
        console.log('='.repeat(80));

        const patSql = `
            SELECT 
                CASE 
                    WHEN UNIDADESCAJA > 1 AND UNIDADESFRACCION > 0 AND UNIDADESFRACCION < UNIDADESCAJA THEN 'DUAL (UC>1, 0<UF<UC)'
                    WHEN UNIDADESCAJA > 1 AND UNIDADESFRACCION = UNIDADESCAJA THEN 'BOX_ONLY (UC>1, UF=UC)'
                    WHEN UNIDADESCAJA > 1 AND UNIDADESFRACCION = 0 THEN 'UC>1_UF=0'
                    WHEN UNIDADESCAJA = 1 AND UNIDADESRETRACTIL > 0 THEN 'SINGLE_WITH_UR (UC=1, UR>0)'
                    WHEN UNIDADESCAJA = 1 AND UNIDADESRETRACTIL = 0 THEN 'SIMPLE (UC=1, UR=0)'
                    WHEN UNIDADESCAJA = 0 THEN 'UC=0'
                    ELSE 'OTHER'
                END AS PATTERN,
                COUNT(*) AS CNT
            FROM DSEDAC.ART 
            WHERE ANOBAJA = 0
            GROUP BY 
                CASE 
                    WHEN UNIDADESCAJA > 1 AND UNIDADESFRACCION > 0 AND UNIDADESFRACCION < UNIDADESCAJA THEN 'DUAL (UC>1, 0<UF<UC)'
                    WHEN UNIDADESCAJA > 1 AND UNIDADESFRACCION = UNIDADESCAJA THEN 'BOX_ONLY (UC>1, UF=UC)'
                    WHEN UNIDADESCAJA > 1 AND UNIDADESFRACCION = 0 THEN 'UC>1_UF=0'
                    WHEN UNIDADESCAJA = 1 AND UNIDADESRETRACTIL > 0 THEN 'SINGLE_WITH_UR (UC=1, UR>0)'
                    WHEN UNIDADESCAJA = 1 AND UNIDADESRETRACTIL = 0 THEN 'SIMPLE (UC=1, UR=0)'
                    WHEN UNIDADESCAJA = 0 THEN 'UC=0'
                    ELSE 'OTHER'
                END
            ORDER BY CNT DESC`;
        const patRows = await query(patSql, false);
        for (const r of patRows) {
            console.log(`  ${(r.PATTERN||'').padEnd(35)} = ${r.CNT} products`);
        }

        // Show samples for each pattern
        const patterns = [
            { name: 'DUAL', where: 'UNIDADESCAJA > 1 AND UNIDADESFRACCION > 0 AND UNIDADESFRACCION < UNIDADESCAJA' },
            { name: 'BOX_ONLY', where: 'UNIDADESCAJA > 1 AND UNIDADESFRACCION = UNIDADESCAJA' },
            { name: 'UC>1_UF=0', where: 'UNIDADESCAJA > 1 AND UNIDADESFRACCION = 0' },
        ];
        for (const p of patterns) {
            const sampleSql = `
                SELECT TRIM(CODIGOARTICULO) AS CODE,
                       TRIM(DESCRIPCIONARTICULO) AS NAME,
                       UNIDADESCAJA AS UC, UNIDADESFRACCION AS UF, UNIDADESRETRACTIL AS UR,
                       TRIM(COALESCE(FORMATO,'')) AS FMT
                FROM DSEDAC.ART
                WHERE ANOBAJA = 0 AND ${p.where}
                FETCH FIRST 5 ROWS ONLY`;
            const sampleRows = await query(sampleSql, false);
            console.log(`\n  --- Samples for ${p.name} ---`);
            for (const r of sampleRows) {
                console.log(`    ${r.CODE} | ${(r.NAME||'').substring(0,40)} | UC=${r.UC} UF=${r.UF} UR=${r.UR} | FMT=${r.FMT}`);
            }
        }

        // ================================================================
        // PART 13: How were the screenshot products priced?
        // Check ARA tariff for all tariffs
        // ================================================================
        console.log('\n\n' + '='.repeat(80));
        console.log('  PART 13: TARIFF PRICES FOR SCREENSHOT PRODUCTS');
        console.log('='.repeat(80));

        for (const code of codes) {
            const tarSql = `
                SELECT T.CODIGOTARIFA AS TARIFA,
                       T.PRECIOTARIFA AS PRECIO,
                       TRIM(TRF.DESCRIPCIONTARIFA) AS DESC
                FROM DSEDAC.ARA T
                JOIN DSEDAC.TRF TRF ON T.CODIGOTARIFA = TRF.CODIGOTARIFA
                WHERE TRIM(T.CODIGOARTICULO) LIKE '%${code}'
                  AND T.PRECIOTARIFA > 0
                ORDER BY T.CODIGOTARIFA`;
            try {
                const tarRows = await query(tarSql, false);
                if (tarRows.length > 0) {
                    console.log(`\n  --- ${code} tariffs ---`);
                    for (const r of tarRows) {
                        console.log(`    Tarifa ${r.TARIFA}: ${r.PRECIO} (${r.DESC})`);
                    }
                }
            } catch (e) {
                console.log(`  ${code}: ARA error: ${e.message.substring(0, 60)}`);
            }
        }

        console.log('\n\nDONE!');
    } catch (error) {
        console.error('FATAL Error:', error.message);
        console.error(error.stack);
    }
    process.exit(0);
}

main();
