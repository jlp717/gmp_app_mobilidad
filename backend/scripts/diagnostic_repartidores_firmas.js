/**
 * DIAGNOSTIC: Repartidores + Firmas
 * Run on server: cd /opt/gmp-api && node scripts/diagnostic_repartidores_firmas.js
 */
const { query, initDb } = require('../config/db');

async function run() {
    await initDb();
    const out = [];
    const log = (msg) => { console.log(msg); out.push(msg); };

    try {
        // ═══════════════════════════════════════════════════
        // PART 1: VEH TABLE — ALL RECORDS
        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('1. DSEDAC.VEH — ALL RECORDS (Who has a vehicle?)');
        log('═'.repeat(70));

        const vehCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VEH' 
            ORDER BY ORDINAL_POSITION
        `, false);
        log('VEH columns: ' + vehCols.map(c => `${c.COLUMN_NAME}(${c.DATA_TYPE})`).join(', '));

        const vehAll = await query(`SELECT * FROM DSEDAC.VEH ORDER BY CODIGOVENDEDOR`, false);
        log(`\nVEH total rows: ${vehAll.length}`);
        vehAll.forEach(r => {
            const entries = Object.entries(r).map(([k,v]) => `${k}=${v !== null && v !== undefined ? String(v).trim() : 'NULL'}`).join(' | ');
            log(`  ${entries}`);
        });

        // ═══════════════════════════════════════════════════
        // 2. VDD names for VEH codes
        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('2. VDD + VDC data for each VEH code');
        log('═'.repeat(70));

        if (vehAll.length > 0) {
            const codes = [...new Set(vehAll.map(r => (r.CODIGOVENDEDOR || '').toString().trim()))].filter(Boolean);
            for (const code of codes) {
                try {
                    const vdd = await query(`
                        SELECT TRIM(NOMBREVENDEDOR) as NOMBRE, TRIM(CODIGOVENDEDOR) as COD
                        FROM DSEDAC.VDD WHERE TRIM(CODIGOVENDEDOR) = '${code}'
                    `, false);
                    const vdc = await query(`
                        SELECT TRIM(TIPOVENDEDOR) as TIPO, TRIM(SUBEMPRESA) as SUBEMP
                        FROM DSEDAC.VDC WHERE TRIM(CODIGOVENDEDOR) = '${code}'
                    `, false);
                    const vddx = await query(`
                        SELECT TRIM(JEFEVENTASSN) as JEFE
                        FROM DSEDAC.VDDX WHERE TRIM(CODIGOVENDEDOR) = '${code}'
                    `, false);
                    const nombre = vdd[0]?.NOMBRE || '?';
                    const tipo = vdc[0]?.TIPO || '?';
                    const subemp = vdc[0]?.SUBEMP || '?';
                    const jefe = vddx[0]?.JEFE || '?';
                    log(`  Code ${code}: Name=${nombre} | TipoVendedor=${tipo} | Subempresa=${subemp} | JefeVentas=${jefe}`);
                } catch (e) {
                    log(`  Code ${code}: ERROR ${e.message}`);
                }
            }
        }

        // ═══════════════════════════════════════════════════
        // 3. OPP — Active repartidores (2025-2026)
        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('3. DSEDAC.OPP — Active repartidores with deliveries in 2025-2026');
        log('═'.repeat(70));

        const oppReps = await query(`
            SELECT TRIM(OPP.CODIGOREPARTIDOR) as CODE,
                   COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR)) as NAME,
                   OPP.ANOREPARTO as ANO,
                   COUNT(*) as NUM_ENTREGAS
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.CODIGOREPARTIDOR IS NOT NULL 
              AND TRIM(OPP.CODIGOREPARTIDOR) <> ''
              AND OPP.ANOREPARTO >= 2025
            GROUP BY TRIM(OPP.CODIGOREPARTIDOR), COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(OPP.CODIGOREPARTIDOR)), OPP.ANOREPARTO
            ORDER BY OPP.ANOREPARTO DESC, NUM_ENTREGAS DESC
        `, false);
        log(`OPP active repartidores: ${oppReps.length} rows`);
        oppReps.forEach(r => log(`  Code ${r.CODE}: ${r.NAME} | Year=${r.ANO} | Deliveries=${r.NUM_ENTREGAS}`));

        // ═══════════════════════════════════════════════════
        // 4. CAC — Active conductores (2025-2026)
        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('4. DSEDAC.CAC — Active conductores in 2025-2026 (CODIGOCONDUCTOR)');
        log('═'.repeat(70));

        try {
            const cacCond = await query(`
                SELECT TRIM(CODIGOCONDUCTOR) as CODE,
                       COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(CAC.CODIGOCONDUCTOR)) as NAME,
                       CAC.EJERCICIO as ANO,
                       COUNT(*) as NUM_ALBARANES
                FROM DSEDAC.CAC CAC
                LEFT JOIN DSEDAC.VDD D ON TRIM(D.CODIGOVENDEDOR) = TRIM(CAC.CODIGOCONDUCTOR)
                WHERE CAC.CODIGOCONDUCTOR IS NOT NULL
                  AND TRIM(CAC.CODIGOCONDUCTOR) <> ''
                  AND CAC.EJERCICIO >= 2025
                GROUP BY TRIM(CAC.CODIGOCONDUCTOR), COALESCE(TRIM(D.NOMBREVENDEDOR), TRIM(CAC.CODIGOCONDUCTOR)), CAC.EJERCICIO
                ORDER BY CAC.EJERCICIO DESC, NUM_ALBARANES DESC
            `, false);
            log(`CAC active conductores: ${cacCond.length} rows`);
            cacCond.forEach(r => log(`  Code ${r.CODE}: ${r.NAME} | Year=${r.ANO} | Albaranes=${r.NUM_ALBARANES}`));
        } catch (e) {
            log(`CAC CODIGOCONDUCTOR error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        // 5. VDC TIPOVENDEDOR — All types in the system
        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('5. DSEDAC.VDC — All TIPOVENDEDOR values');
        log('═'.repeat(70));

        const tipos = await query(`
            SELECT TRIM(TIPOVENDEDOR) as TIPO, COUNT(*) as CNT,
                   LISTAGG(TRIM(CODIGOVENDEDOR), ',') WITHIN GROUP (ORDER BY CODIGOVENDEDOR) as CODES
            FROM DSEDAC.VDC
            WHERE SUBEMPRESA = 'GMP'
            GROUP BY TRIM(TIPOVENDEDOR)
            ORDER BY CNT DESC
        `, false);
        log(`VDC types:`);
        tipos.forEach(r => log(`  Type="${r.TIPO}" (${r.CNT}): ${r.CODES}`));

        // ═══════════════════════════════════════════════════
        // PART 2: SIGNATURES — Where are recent signatures?
        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('6. CACFIRMAS — Date range check');
        log('═'.repeat(70));

        try {
            const cfYears = await query(`
                SELECT EJERCICIO, COUNT(*) as CNT,
                       SUM(CASE WHEN FIRMABASE64 IS NOT NULL AND LENGTH(FIRMABASE64) > 10 THEN 1 ELSE 0 END) as WITH_FIRMA
                FROM DSEDAC.CACFIRMAS
                GROUP BY EJERCICIO
                ORDER BY EJERCICIO DESC
            `, false);
            log(`CACFIRMAS by year:`);
            cfYears.forEach(r => log(`  Year ${r.EJERCICIO}: ${r.CNT} rows, ${r.WITH_FIRMA} with base64`));
        } catch (e) {
            log(`CACFIRMAS year error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('7. CACCL1 — Check firma fields for recent years');
        log('═'.repeat(70));

        try {
            const caccl1Cols = await query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CACCL1'
                  AND UPPER(COLUMN_NAME) LIKE '%FIRMA%'
                ORDER BY ORDINAL_POSITION
            `, false);
            log(`CACCL1 firma columns: ${JSON.stringify(caccl1Cols)}`);

            const caccl1Firmas = await query(`
                SELECT EJERCICIO, 
                       COUNT(*) as TOTAL,
                       SUM(CASE WHEN ANOFIRMA > 0 THEN 1 ELSE 0 END) as WITH_FIRMA
                FROM DSEDAC.CACCL1
                WHERE EJERCICIO >= 2023
                GROUP BY EJERCICIO
                ORDER BY EJERCICIO DESC
            `, false);
            log(`CACCL1 firma data by year:`);
            caccl1Firmas.forEach(r => log(`  Year ${r.EJERCICIO}: ${r.TOTAL} rows, ${r.WITH_FIRMA} with firma date`));
        } catch (e) {
            log(`CACCL1 error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('8. CACT — Check firma fields for recent years');
        log('═'.repeat(70));

        try {
            const cactCols = await query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CACT'
                  AND UPPER(COLUMN_NAME) LIKE '%FIRMA%'
                ORDER BY ORDINAL_POSITION
            `, false);
            log(`CACT firma columns: ${JSON.stringify(cactCols)}`);

            const cactFirmas = await query(`
                SELECT EJERCICIO,
                       COUNT(*) as TOTAL,
                       SUM(CASE WHEN DIAFIRMA > 0 THEN 1 ELSE 0 END) as WITH_FIRMA
                FROM DSEDAC.CACT
                WHERE EJERCICIO >= 2023
                GROUP BY EJERCICIO
                ORDER BY EJERCICIO DESC
            `, false);
            log(`CACT firma data by year:`);
            cactFirmas.forEach(r => log(`  Year ${r.EJERCICIO}: ${r.TOTAL} rows, ${r.WITH_FIRMA} with firma date`));
        } catch (e) {
            log(`CACT error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('9. JAVIER.REPARTIDOR_FIRMAS — Our app signatures');
        log('═'.repeat(70));

        try {
            const rfCount = await query(`
                SELECT COUNT(*) as TOTAL,
                       SUM(CASE WHEN FIRMA_BASE64 IS NOT NULL AND LENGTH(FIRMA_BASE64) > 10 THEN 1 ELSE 0 END) as WITH_FIRMA
                FROM JAVIER.REPARTIDOR_FIRMAS
            `, false);
            log(`REPARTIDOR_FIRMAS: ${rfCount[0]?.TOTAL || 0} rows, ${rfCount[0]?.WITH_FIRMA || 0} with base64`);

            const rfSample = await query(`
                SELECT RF.ID, RF.ENTREGA_ID, RF.FIRMANTE_NOMBRE, RF.FECHA_FIRMA,
                       LENGTH(RF.FIRMA_BASE64) as FIRMA_LEN
                FROM JAVIER.REPARTIDOR_FIRMAS RF
                ORDER BY RF.FECHA_FIRMA DESC
                FETCH FIRST 10 ROWS ONLY
            `, false);
            rfSample.forEach(r => log(`  ID=${r.ID} Entrega=${r.ENTREGA_ID} Name=${r.FIRMANTE_NOMBRE} Date=${r.FECHA_FIRMA} Len=${r.FIRMA_LEN}`));
        } catch (e) {
            log(`REPARTIDOR_FIRMAS error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('10. JAVIER.DELIVERY_STATUS — Firma paths');
        log('═'.repeat(70));

        try {
            const dsCount = await query(`
                SELECT COUNT(*) as TOTAL,
                       SUM(CASE WHEN FIRMA_PATH IS NOT NULL AND TRIM(FIRMA_PATH) <> '' THEN 1 ELSE 0 END) as WITH_FIRMA
                FROM JAVIER.DELIVERY_STATUS
            `, false);
            log(`DELIVERY_STATUS: ${dsCount[0]?.TOTAL || 0} rows, ${dsCount[0]?.WITH_FIRMA || 0} with firma_path`);

            const dsSample = await query(`
                SELECT ID, STATUS, FIRMA_PATH, CREATED_AT
                FROM JAVIER.DELIVERY_STATUS
                WHERE FIRMA_PATH IS NOT NULL AND TRIM(FIRMA_PATH) <> ''
                ORDER BY CREATED_AT DESC
                FETCH FIRST 10 ROWS ONLY
            `, false);
            dsSample.forEach(r => log(`  ID=${r.ID} Status=${r.STATUS} Firma=${r.FIRMA_PATH} Date=${r.CREATED_AT}`));
        } catch (e) {
            log(`DELIVERY_STATUS error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('11. CONFORMADOSN in CPC — Recent deliveries check');
        log('═'.repeat(70));

        try {
            const cpcConf = await query(`
                SELECT CPC.EJERCICIOALBARAN as ANO,
                       COUNT(*) as TOTAL,
                       SUM(CASE WHEN TRIM(CPC.CONFORMADOSN) = 'S' THEN 1 ELSE 0 END) as CONFORMADOS
                FROM DSEDAC.CPC CPC
                WHERE CPC.EJERCICIOALBARAN >= 2024
                GROUP BY CPC.EJERCICIOALBARAN
                ORDER BY CPC.EJERCICIOALBARAN DESC
            `, false);
            log(`CPC CONFORMADOSN by year:`);
            cpcConf.forEach(r => log(`  Year ${r.ANO}: ${r.TOTAL} total, ${r.CONFORMADOS} conformados (S)`));
        } catch (e) {
            log(`CPC error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('12. Check for signature-like tables (CAC*, firma)');
        log('═'.repeat(70));

        try {
            const sigTables = await query(`
                SELECT TABLE_NAME, TABLE_TEXT
                FROM QSYS2.SYSTABLES
                WHERE TABLE_SCHEMA = 'DSEDAC'
                  AND (UPPER(TABLE_NAME) LIKE '%FIRMA%' 
                       OR UPPER(TABLE_NAME) LIKE '%SIGN%'
                       OR UPPER(TABLE_NAME) LIKE '%CONF%'
                       OR UPPER(TABLE_NAME) LIKE '%IMG%'
                       OR UPPER(TABLE_NAME) LIKE '%FOTO%'
                       OR UPPER(TABLE_NAME) LIKE '%IMAG%')
                ORDER BY TABLE_NAME
            `, false);
            log(`Tables with firma/sign/conf/img names: ${sigTables.length}`);
            sigTables.forEach(r => log(`  ${r.TABLE_NAME}: ${r.TABLE_TEXT || '(no description)'}`));
        } catch (e) {
            log(`Table search error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('13. CACCL1 — Sample row with firma data (most recent)');
        log('═'.repeat(70));

        try {
            const sample = await query(`
                SELECT EJERCICIO, SERIE, TERMINAL, NUMERO, FIRMANOMBRE, FIRMADNI, 
                       DIAFIRMA, MESFIRMA, ANOFIRMA, HORAFIRMA
                FROM DSEDAC.CACCL1
                WHERE ANOFIRMA > 0
                ORDER BY ANOFIRMA DESC, MESFIRMA DESC, DIAFIRMA DESC
                FETCH FIRST 10 ROWS ONLY
            `, false);
            log(`CACCL1 most recent signed:`);
            sample.forEach(r => {
                log(`  ${r.EJERCICIO}-${r.SERIE}-${r.TERMINAL}-${r.NUMERO}: Name=${r.FIRMANOMBRE} DNI=${r.FIRMADNI} Date=${r.DIAFIRMA}/${r.MESFIRMA}/${r.ANOFIRMA} H=${r.HORAFIRMA}`);
            });
        } catch (e) {
            log(`CACCL1 sample error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════
        log('\n' + '═'.repeat(70));
        log('14. Check uploads/signatures directory');
        log('═'.repeat(70));

        const fs = require('fs');
        const path = require('path');
        const sigDirs = ['/opt/gmp-api/uploads/signatures', '/opt/gmp-api/uploads/firmas', '/opt/gmp-api/uploads/photos'];
        for (const dir of sigDirs) {
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                log(`  ${dir}: ${files.length} files`);
                if (files.length > 0) {
                    const recent = files.slice(-5);
                    recent.forEach(f => {
                        const stat = fs.statSync(path.join(dir, f));
                        log(`    ${f} (${stat.size} bytes, ${stat.mtime.toISOString()})`);
                    });
                }
            } else {
                log(`  ${dir}: NOT FOUND`);
            }
        }

    } catch (e) {
        log(`\nFATAL ERROR: ${e.message}\n${e.stack}`);
    }

    // Save to file
    const fs = require('fs');
    fs.writeFileSync('/opt/gmp-api/diagnostic_output.txt', out.join('\n'));
    console.log('\n✅ Output saved to /opt/gmp-api/diagnostic_output.txt');
    process.exit(0);
}

run();
