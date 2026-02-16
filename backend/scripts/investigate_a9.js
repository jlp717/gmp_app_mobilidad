/**
 * Investigación v2 - Columnas + A-9 + progreso
 */
const { query, initDb } = require('../config/db');

async function investigate() {
    console.log('INVESTIGACIÓN v2');
    console.log('='.repeat(60));

    try {
        await initDb();

        // 1. CDVI columns
        console.log('\n--- 1. Todas las columnas de CDVI ---');
        const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_NAME = 'CDVI' AND TABLE_SCHEMA = 'DSEDAC'
            ORDER BY ORDINAL_POSITION
        `, false);
        cols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));

        // 2. Sample CDVI for clients 0296 and 0181
        console.log('\n--- 2. Clientes 0296 y 0181 en CDVI ---');
        const clients = await query(`
            SELECT * FROM DSEDAC.CDVI 
            WHERE TRIM(CODIGOCLIENTE) IN ('0296', '0181', '296', '181')
        `, false);
        console.log(`Registros: ${clients.length}`);
        clients.forEach(r => console.log(JSON.stringify(r)));

        // 3. CPC albaranes serie A terminal 9 para estos clientes
        console.log('\n--- 3. Albaranes A-9 para 0296/0181 ---');
        const alb = await query(`
            SELECT EJERCICIOALBARAN, TRIM(SERIEALBARAN) as SERIE, 
                   TERMINALALBARAN, NUMEROALBARAN,
                   TRIM(CODIGOCLIENTEALBARAN) as CLIENTE, 
                   IMPORTETOTAL,
                   DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
            FROM DSEDAC.CPC 
            WHERE TRIM(SERIEALBARAN) = 'A' AND TERMINALALBARAN = 9
              AND TRIM(CODIGOCLIENTEALBARAN) IN ('0296', '0181')
              AND EJERCICIOALBARAN = 2026
            ORDER BY NUMEROALBARAN DESC
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log(`Albaranes: ${alb.length}`);
        alb.forEach(r => console.log(`  ${r.EJERCICIOALBARAN}/${r.SERIE}${r.TERMINALALBARAN}/${r.NUMEROALBARAN} | Cli: ${r.CLIENTE} | ${r.IMPORTETOTAL}€ | ${r.DIADOCUMENTO}/${r.MESDOCUMENTO}/${r.ANODOCUMENTO}`));

        // 4. Check ALL albaranes for these clients today/recently  
        console.log('\n--- 4. Albaranes recientes para 0296/0181 ---');
        const recent = await query(`
            SELECT EJERCICIOALBARAN, TRIM(SERIEALBARAN) as SERIE, 
                   TERMINALALBARAN, NUMEROALBARAN,
                   TRIM(CODIGOCLIENTEALBARAN) as CLIENTE, 
                   IMPORTETOTAL,
                   DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO
            FROM DSEDAC.CPC 
            WHERE TRIM(CODIGOCLIENTEALBARAN) IN ('0296', '0181')
              AND EJERCICIOALBARAN = 2026
              AND MESDOCUMENTO >= 1
            ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log(`Albaranes recientes: ${recent.length}`);
        recent.forEach(r => console.log(`  ${r.EJERCICIOALBARAN}/${r.SERIE}${String(r.TERMINALALBARAN).padStart(2, '0')}/${r.NUMEROALBARAN} | Cli: ${r.CLIENTE} | ${r.IMPORTETOTAL}€ | ${r.DIADOCUMENTO}/${r.MESDOCUMENTO}/${r.ANODOCUMENTO}`));

        // 5. DELIVERY_STATUS últimos registros
        console.log('\n--- 5. DELIVERY_STATUS recientes ---');
        const ds = await query(`
            SELECT ID, STATUS, REPARTIDOR_ID, UPDATED_AT, FIRMA_PATH
            FROM JAVIER.DELIVERY_STATUS
            ORDER BY UPDATED_AT DESC
            FETCH FIRST 10 ROWS ONLY
        `, false);
        ds.forEach(r => console.log(`  ${r.ID} | ${r.STATUS} | Rep: ${r.REPARTIDOR_ID} | ${r.UPDATED_AT} | Firma: ${r.FIRMA_PATH || 'N/A'}`));

        // 6. CVC duplicados check para estos clientes
        console.log('\n--- 6. CVC rows por albarán (0296/0181) ---');
        const cvc = await query(`
            SELECT CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN) as SERIE, 
                   CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                   TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                   COUNT(*) as TOTAL_ROWS
            FROM DSEDAC.CPC CPC
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) IN ('0296', '0181')
              AND CPC.EJERCICIOALBARAN = 2026
            GROUP BY CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, 
                     CPC.NUMEROALBARAN, CPC.CODIGOCLIENTEALBARAN
            HAVING COUNT(*) > 1
            ORDER BY CPC.NUMEROALBARAN DESC
            FETCH FIRST 10 ROWS ONLY
        `, false);
        if (cvc.length > 0) {
            console.log('⚠️ Documentos con múltiples CVC rows:');
            cvc.forEach(r => console.log(`  ${r.EJERCICIOALBARAN}/${r.SERIE}${r.TERMINALALBARAN}/${r.NUMEROALBARAN} | Cli: ${r.CLIENTE} | ${r.TOTAL_ROWS} rows`));
        } else {
            console.log('✅ No hay duplicados CVC');
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        process.exit(0);
    }
}

investigate();
