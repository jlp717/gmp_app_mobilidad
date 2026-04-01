/**
 * analyze_factura_219.js
 * =======================
 * Deep analysis of Factura 219 - all amount fields from CPC, CAC, LAC.
 * Compares CPC.IMPORTEBRUTO vs CPC.IMPORTETOTAL vs CAC.IMPORTETOTAL.
 * Usage: node analyze_factura_219.js
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

async function main() {
    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        try { await conn.query("CALL QSYS.QCMDEXC('CHGJOB CCSID(1208)', 0000000018.00000)"); } catch (e) {}

        console.log('=== FACTURA 219 DEEP ANALYSIS ===\n');

        // 1. All CAC records where NUMEROFACTURA = 219 (current year)
        console.log('--- CAC records (factura side) ---');
        const cacRows = await conn.query(`
            SELECT
                CAC.EJERCICIOALBARAN, TRIM(CAC.SERIEALBARAN) as SA,
                CAC.TERMINALALBARAN, CAC.NUMEROALBARAN,
                TRIM(CAC.SERIEFACTURA) as SF, CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLI_FACT,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CLI_ALB,
                CAC.IMPORTEBRUTO as CAC_BRUTO,
                CAC.IMPORTETOTAL as CAC_TOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 as CAC_BASE1,
                CAC.IMPORTEBASEIMPONIBLE2 as CAC_BASE2,
                CAC.PORCENTAJEIVA1 as CAC_PCT1, CAC.IMPORTEIVA1 as CAC_IVA1,
                CAC.PORCENTAJEIVA2 as CAC_PCT2, CAC.IMPORTEIVA2 as CAC_IVA2,
                CAC.IMPORTEDESCUENTO1 as CAC_DESC1,
                CAC.IMPORTEDESCUENTO2 as CAC_DESC2,
                CAC.IMPORTEBONIFICACION as CAC_BONIF,
                CAC.IMPORTESINCARGO as CAC_SINCARGO
            FROM DSEDAC.CAC CAC
            WHERE CAC.NUMEROFACTURA = 219
                AND CAC.EJERCICIOFACTURA = ${new Date().getFullYear()}
            ORDER BY CAC.SERIEFACTURA, CAC.NUMEROALBARAN
        `);

        for (const r of cacRows) {
            console.log(`  Albaran ${r.EJERCICIOALBARAN}-${r.SA}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`);
            console.log(`    Serie Factura: ${r.SF}, Cliente Fact: ${r.CLI_FACT}, Cliente Alb: ${r.CLI_ALB}`);
            console.log(`    CAC.IMPORTEBRUTO=${r.CAC_BRUTO}, CAC.IMPORTETOTAL=${r.CAC_TOTAL}`);
            console.log(`    CAC Base1=${r.CAC_BASE1} (IVA ${r.CAC_PCT1}%=${r.CAC_IVA1}), Base2=${r.CAC_BASE2} (IVA ${r.CAC_PCT2}%=${r.CAC_IVA2})`);
            console.log(`    CAC Descuento1=${r.CAC_DESC1}, Descuento2=${r.CAC_DESC2}, Bonif=${r.CAC_BONIF}, SinCargo=${r.CAC_SINCARGO}`);
        }

        // 2. CPC records for the albaranes linked to factura 219
        console.log('\n--- CPC records (delivery note side) ---');
        for (const cac of cacRows) {
            const cpcRows = await conn.query(`
                SELECT
                    CPC.IMPORTEBRUTO as CPC_BRUTO,
                    CPC.IMPORTETOTAL as CPC_TOTAL,
                    CPC.IMPORTEBASEIMPONIBLE1 as CPC_BASE1,
                    CPC.IMPORTEBASEIMPONIBLE2 as CPC_BASE2,
                    CPC.PORCENTAJEIVA1 as CPC_PCT1, CPC.IMPORTEIVA1 as CPC_IVA1,
                    CPC.PORCENTAJEIVA2 as CPC_PCT2, CPC.IMPORTEIVA2 as CPC_IVA2,
                    CPC.IMPORTEDESCUENTO1 as CPC_DESC1,
                    CPC.IMPORTEDESCUENTO2 as CPC_DESC2,
                    CPC.IMPORTEBONIFICACION as CPC_BONIF,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) as CPC_CLI,
                    TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO
                FROM DSEDAC.CPC CPC
                WHERE CPC.EJERCICIOALBARAN = ${cac.EJERCICIOALBARAN}
                    AND CPC.SERIEALBARAN = '${cac.SA}'
                    AND CPC.TERMINALALBARAN = ${cac.TERMINALALBARAN}
                    AND CPC.NUMEROALBARAN = ${cac.NUMEROALBARAN}
            `);

            for (const c of cpcRows) {
                console.log(`  Albaran ${cac.EJERCICIOALBARAN}-${cac.SA}-${cac.TERMINALALBARAN}-${cac.NUMEROALBARAN} (CPC client=${c.CPC_CLI})`);
                console.log(`    CPC.IMPORTEBRUTO=${c.CPC_BRUTO}, CPC.IMPORTETOTAL=${c.CPC_TOTAL}`);
                console.log(`    CPC Base1=${c.CPC_BASE1} (IVA ${c.CPC_PCT1}%=${c.CPC_IVA1}), Base2=${c.CPC_BASE2} (IVA ${c.CPC_PCT2}%=${c.CPC_IVA2})`);
                console.log(`    CPC Desc1=${c.CPC_DESC1}, Desc2=${c.CPC_DESC2}, Bonif=${c.CPC_BONIF}`);
                console.log(`    Forma Pago: ${c.FORMA_PAGO}`);
                console.log(`    >>> REPARTIDOR SHOWS: ${c.CPC_BRUTO}€ | CORRECT TOTAL: ${c.CPC_TOTAL}€ | FACTURA TOTAL: ${cac.CAC_TOTAL}€`);
            }
        }

        // 3. The specific albaran from screenshots: client 4300039982 (DELEGACION ALMERIA)
        console.log('\n--- SPECIFIC: Client 4300039982 (DELEGACION ALMERIA) ---');
        const specificCPC = await conn.query(`
            SELECT
                CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN) as SA,
                CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                CPC.IMPORTEBRUTO, CPC.IMPORTETOTAL,
                CPC.IMPORTEBASEIMPONIBLE1, CPC.IMPORTEBASEIMPONIBLE2,
                CPC.PORCENTAJEIVA1, CPC.IMPORTEIVA1,
                CPC.PORCENTAJEIVA2, CPC.IMPORTEIVA2,
                CPC.IMPORTEDESCUENTO1, CPC.IMPORTEDESCUENTO2,
                CPC.IMPORTEBONIFICACION
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.OPP OPP ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC ON
                CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = '4300039982'
                AND CAC.NUMEROFACTURA = 219
                AND CAC.EJERCICIOFACTURA = ${new Date().getFullYear()}
        `);

        for (const c of specificCPC) {
            console.log(`  Albaran: ${c.EJERCICIOALBARAN}-${c.SA}-${c.TERMINALALBARAN}-${c.NUMEROALBARAN}`);
            console.log(`  IMPORTEBRUTO (shown to repartidor): ${c.IMPORTEBRUTO}€`);
            console.log(`  IMPORTETOTAL (correct amount): ${c.IMPORTETOTAL}€`);
            console.log(`  Base1: ${c.IMPORTEBASEIMPONIBLE1}, IVA1 ${c.PORCENTAJEIVA1}%: ${c.IMPORTEIVA1}`);
            console.log(`  Base2: ${c.IMPORTEBASEIMPONIBLE2}, IVA2 ${c.PORCENTAJEIVA2}%: ${c.IMPORTEIVA2}`);
            console.log(`  Descuento1: ${c.IMPORTEDESCUENTO1}, Descuento2: ${c.IMPORTEDESCUENTO2}, Bonif: ${c.IMPORTEBONIFICACION}`);
        }

        // 4. LAC items for this specific albaran
        console.log('\n--- LAC items for client 4300039982 albaran ---');
        if (specificCPC.length > 0) {
            const alb = specificCPC[0];
            const lacRows = await conn.query(`
                SELECT LAC.CODIGOARTICULO, TRIM(LAC.DESCRIPCION) as DESC,
                    LAC.CANTIDADUNIDADES as QTY, LAC.CANTIDADCAJAS as CAJAS,
                    LAC.PRECIOVENTA as PRECIO, LAC.IMPORTEVENTA as IMPORTE,
                    LAC.PORCENTAJEDESCUENTO as PCT_DESC
                FROM DSEDAC.LAC LAC
                WHERE LAC.EJERCICIOALBARAN = ${alb.EJERCICIOALBARAN}
                    AND LAC.SERIEALBARAN = '${alb.SA}'
                    AND LAC.TERMINALALBARAN = ${alb.TERMINALALBARAN}
                    AND LAC.NUMEROALBARAN = ${alb.NUMEROALBARAN}
                ORDER BY LAC.SECUENCIA
            `);

            let sumImporte = 0;
            for (const l of lacRows) {
                sumImporte += parseFloat(l.IMPORTE) || 0;
                console.log(`  Art: ${(l.CODIGOARTICULO || '').trim()} | ${(l.DESC || '').substring(0, 40)} | Qty: ${l.QTY} | Cajas: ${l.CAJAS} | Precio: ${l.PRECIO} | Importe: ${l.IMPORTE} | Desc: ${l.PCT_DESC}%`);
            }
            console.log(`  TOTAL LAC items: ${lacRows.length}, SUM IMPORTEVENTA: ${sumImporte.toFixed(2)}`);
        }

        // 5. DIAGNOSIS
        console.log('\n=== DIAGNOSIS ===');
        console.log('The repartidor endpoint (GET /entregas/pendientes) uses CPC.IMPORTEBRUTO');
        console.log('CPC.IMPORTEBRUTO = GROSS amount BEFORE discounts/bonifications');
        console.log('CPC.IMPORTETOTAL = FINAL amount AFTER discounts (what should be displayed/collected)');
        console.log('CAC.IMPORTETOTAL = Invoice total (includes IVA) for this specific albarán-factura link');
        console.log('');
        console.log('ROOT CAUSE: Line 206 in backend/routes/entregas.js uses CPC.IMPORTEBRUTO');
        console.log('FIX: Change to CPC.IMPORTETOTAL (or CAC.IMPORTETOTAL if factura context)');

        // Save analysis
        const outputDir = path.join(__dirname, '..', 'reports');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const analysis = {
            generated_at: new Date().toISOString(),
            factura_number: 219,
            cac_records: cacRows.length,
            specific_client_4300039982: specificCPC.length > 0 ? {
                albaran: `${specificCPC[0].EJERCICIOALBARAN}-${specificCPC[0].SA}-${specificCPC[0].TERMINALALBARAN}-${specificCPC[0].NUMEROALBARAN}`,
                importebruto_shown: parseFloat(specificCPC[0].IMPORTEBRUTO) || 0,
                importetotal_correct: parseFloat(specificCPC[0].IMPORTETOTAL) || 0,
                difference: Math.abs((parseFloat(specificCPC[0].IMPORTEBRUTO) || 0) - (parseFloat(specificCPC[0].IMPORTETOTAL) || 0))
            } : null,
            root_cause: 'entregas.js line 206 uses CPC.IMPORTEBRUTO (gross before discounts) instead of CPC.IMPORTETOTAL (final amount)',
            fix: 'Replace CPC.IMPORTEBRUTO with CPC.IMPORTETOTAL in /pendientes endpoint SQL query'
        };
        fs.writeFileSync(path.join(outputDir, 'factura_219_analysis.json'), JSON.stringify(analysis, null, 2));
        console.log(`\nAnalysis saved to: ${path.join(outputDir, 'factura_219_analysis.json')}`);

    } catch (error) {
        console.error(`FATAL: ${error.message}`);
        process.exit(1);
    } finally {
        if (conn) try { await conn.close(); } catch (e) {}
    }
}

main();
