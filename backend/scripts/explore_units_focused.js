/**
 * FOCUSED: Get the exact info we need for unit logic decisions
 */
const { query } = require('../config/db');

async function main() {
    try {
        const codes = ['1137', '1117', '1124', '2186', '1337', '2604', '2907', '1473', '1279'];
        
        // 1. KEY UNIT FIELDS for all 9 products in a clean table
        console.log('=== KEY FIELDS ===');
        const sql1 = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(COALESCE(A.UNIDADMEDIDA,'')) AS UM,
                   A.UNIDADESCAJA AS UC,
                   A.UNIDADESFRACCION AS UF,
                   A.UNIDADESRETRACTIL AS UR,
                   COALESCE(A.PESO,0) AS PESO,
                   TRIM(COALESCE(A.FORMATO,'')) AS FMT,
                   TRIM(COALESCE(A.CODIGOPRESENTACION,'')) AS PRES,
                   TRIM(COALESCE(A.PRODUCTOPESADOSN,'')) AS PES,
                   TRIM(COALESCE(A.CLASIFICACION,'')) AS CLASIF,
                   TRIM(A.CODIGOFAMILIA) AS FAM,
                   TRIM(COALESCE(A.CODIGOTIPO,'')) AS TIPO,
                   TRIM(COALESCE(A.CODIGOGRUPO,'')) AS GRUPO,
                   TRIM(COALESCE(A.MODULOEMBALAJE,'')) AS MODEMB
            FROM DSEDAC.ART A
            WHERE TRIM(A.CODIGOARTICULO) IN (${codes.map(c=>`'${c}'`).join(',')})
            ORDER BY A.CODIGOARTICULO`;
        const r1 = await query(sql1, false);
        console.log(JSON.stringify(r1, null, 2));

        // 2. LPC order lines for these products (how legacy stores them)
        console.log('\n=== LPC LINES ===');
        for (const code of codes) {
            const sql2 = `
                SELECT TRIM(L.CODIGOARTICULO) AS CODE,
                       L.CANTIDADENVASES AS ENV,
                       L.CANTIDADUNIDADES AS UNI,
                       TRIM(COALESCE(L.UNIDADMEDIDA,'')) AS UM,
                       L.PRECIOVENTA AS PV
                FROM DSEDAC.LPC L
                WHERE TRIM(L.CODIGOARTICULO) = '${code}'
                  AND L.ANODOCUMENTO >= 2024
                ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
                FETCH FIRST 3 ROWS ONLY`;
            try {
                const r2 = await query(sql2, false);
                if (r2.length > 0) {
                    console.log(`${code}: ${JSON.stringify(r2)}`);
                } else {
                    console.log(`${code}: no recent LPC lines`);
                }
            } catch(e) {
                console.log(`${code}: LPC error: ${e.message.substring(0,50)}`);
            }
        }

        // 3. LINDTO lines for these products
        console.log('\n=== LINDTO LINES ===');
        for (const code of codes) {
            const sql3 = `
                SELECT TRIM(L.CODIGOARTICULO) AS CODE,
                       L.CANTIDADENVASES AS ENV,
                       L.CANTIDADUNIDADES AS UNI,
                       TRIM(COALESCE(L.UNIDADMEDIDA,'')) AS UM,
                       L.PRECIOVENTA AS PV,
                       TRIM(L.CLASELINEA) AS CL
                FROM DSEDAC.LINDTO L
                WHERE TRIM(L.CODIGOARTICULO) = '${code}'
                  AND L.ANODOCUMENTO >= 2024
                ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
                FETCH FIRST 3 ROWS ONLY`;
            try {
                const r3 = await query(sql3, false);
                if (r3.length > 0) {
                    console.log(`${code}: ${JSON.stringify(r3)}`);
                } else {
                    console.log(`${code}: no recent LINDTO`);
                }
            } catch(e) {
                console.log(`${code}: LINDTO error: ${e.message.substring(0,50)}`);
            }
        }
        
        // 4. UMD table
        console.log('\n=== UMD TABLE ===');
        const r4 = await query('SELECT TRIM(UNIDADMEDIDA) AS UM, TRIM(DESCRIPCIONUNIDADMEDIDA) AS DESC FROM DSEDAC.UMD ORDER BY UNIDADMEDIDA', false);
        console.log(JSON.stringify(r4));
        
        // 5. PRE table (presentations)  
        console.log('\n=== PRE TABLE ===');
        try {
            const r5 = await query('SELECT * FROM DSEDAC.PRE FETCH FIRST 10 ROWS ONLY', false);
            console.log(JSON.stringify(r5));
        } catch(e) {
            console.log('PRE not found');
        }
        
        // 6. CODIGOGRUPO for our products
        console.log('\n=== GRUPO VALUES ===');
        const sql6 = `
            SELECT TRIM(COALESCE(CODIGOGRUPO,'')) AS GRUPO, COUNT(*) AS CNT,
                   MIN(TRIM(DESCRIPCIONARTICULO)) AS SAMPLE
            FROM DSEDAC.ART WHERE ANOBAJA=0
            GROUP BY TRIM(COALESCE(CODIGOGRUPO,''))
            ORDER BY CNT DESC
            FETCH FIRST 20 ROWS ONLY`;
        const r6 = await query(sql6, false);
        for (const r of r6) {
            console.log(`  ${(r.GRUPO||'empty').padEnd(8)} = ${String(r.CNT).padEnd(5)} | ${(r.SAMPLE||'').substring(0,40)}`);
        }

        // 7. Screenshot price checks - verify Neto U/R calculation
        console.log('\n=== PRICE VERIFICATION ===');
        // Screenshot shows: 1337 price=10.845, Neto U/R=0.540
        // 10.845 / 20 (UR) = 0.54225 ≈ 0.540 -> Neto U/R = tariffPrice / UR
        // 1137: price=33.966, Neto U/R=0.790 -> 33.966 / 43 = 0.790
        // 1124: price=37.153, Neto U/R=0.740 -> 37.153 / 50 = 0.743 ≈ 0.740
        // 2907: Neto U/R=3.400 -> price/UR -> but UR=1 here
        console.log('1337: 10.845/20 = ' + (10.845/20).toFixed(3) + ' (should be 0.540)');
        console.log('1137: 33.966/43 = ' + (33.966/43).toFixed(3) + ' (should be 0.790)');
        console.log('1124: 37.153/50 = ' + (37.153/50).toFixed(3) + ' (should be 0.740)');
        console.log('2907: 3.398/1 = ' + (3.398/1).toFixed(3) + ' (should be 3.400, price per UR=1)');
        console.log('2604: 7.200/25 = ' + (7.200/25).toFixed(3) + ' (should be 0.290, Neto U/R)');

        // Check: the screenshot prices like 33.966, 10.845 - what tariff are they?
        console.log('\n=== SCREENSHOT PRICE MAPPING ===');
        const screenshotPrices = {
            '1137': 33.966, '1124': 37.153, '2186': 13.110, 
            '1337': 10.845, '2604': 7.200, '2907': 3.398,
            '1473': 12.804, '1279': 17.571
        };
        for (const [code, price] of Object.entries(screenshotPrices)) {
            const tarSql = `
                SELECT CODIGOTARIFA, PRECIOTARIFA 
                FROM DSEDAC.ARA 
                WHERE TRIM(CODIGOARTICULO)='${code}' 
                  AND ABS(PRECIOTARIFA - ${price}) < 0.01
                ORDER BY CODIGOTARIFA`;
            try {
                const rows = await query(tarSql, false);
                if (rows.length > 0) {
                    console.log(`${code}: price ${price} = Tarifa ${rows.map(r=>r.CODIGOTARIFA).join(',')}`);
                } else {
                    console.log(`${code}: price ${price} NOT MATCHED TO ANY TARIFF`);
                }
            } catch(e) {
                console.log(`${code}: error`);
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
    process.exit(0);
}

main();
