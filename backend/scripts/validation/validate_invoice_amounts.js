/**
 * validate_invoice_amounts.js
 * ===========================
 * Validates neto/IVA/total consistency for invoices delivered by repartidores.
 * Compares CPC.IMPORTEBRUTO (used by repartidor view) vs CAC.IMPORTETOTAL (factura total).
 * Also calculates item-level aggregates from LAC (líneas de albarán).
 *
 * Output: JSON report to stdout + CSV file to disk.
 * Usage: node validate_invoice_amounts.js [--factura 219] [--limit 100]
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

// Reuse connection config from project
const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;`;

// Parse CLI args
const args = process.argv.slice(2);
const facturaFilter = args.includes('--factura') ? args[args.indexOf('--factura') + 1] : null;
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100;

async function main() {
    let conn;
    try {
        console.log('[VALIDATE] Connecting to DB...');
        conn = await odbc.connect(DB_CONFIG);

        // Ensure UTF-8
        try {
            await conn.query("CALL QSYS.QCMDEXC('CHGJOB CCSID(1208)', 0000000018.00000)");
        } catch (e) { /* non-fatal */ }

        // Step 1: Discover columns dynamically on CPC, CAC, LAC
        console.log('[VALIDATE] Step 1: Introspecting table columns...');
        const tables = ['CPC', 'CAC', 'LAC'];
        const tableColumns = {};
        for (const table of tables) {
            const cols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_SCALE
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${table}'
                  AND (COLUMN_NAME LIKE '%IMPORTE%' OR COLUMN_NAME LIKE '%PRECIO%'
                       OR COLUMN_NAME LIKE '%IVA%' OR COLUMN_NAME LIKE '%BASE%'
                       OR COLUMN_NAME LIKE '%TOTAL%' OR COLUMN_NAME LIKE '%BRUTO%'
                       OR COLUMN_NAME LIKE '%NETO%' OR COLUMN_NAME LIKE '%FACTURA%'
                       OR COLUMN_NAME LIKE '%ALBARAN%' OR COLUMN_NAME LIKE '%VENTA%'
                       OR COLUMN_NAME LIKE '%PORCENTAJE%')
                ORDER BY ORDINAL_POSITION
            `);
            tableColumns[table] = cols.map(c => ({
                name: (c.COLUMN_NAME || '').trim(),
                type: (c.DATA_TYPE || '').trim(),
                scale: c.NUMERIC_SCALE
            }));
        }

        console.log('[VALIDATE] Detected columns:');
        for (const [table, cols] of Object.entries(tableColumns)) {
            console.log(`  ${table}: ${cols.map(c => c.name).join(', ')}`);
        }

        // Step 2: Query facturas with both CPC and CAC amounts
        console.log(`[VALIDATE] Step 2: Querying invoices (limit=${limit})...`);

        let whereFact = '';
        if (facturaFilter) {
            whereFact = ` AND CAC.NUMEROFACTURA = ${parseInt(facturaFilter)}`;
        }

        const sql = `
            SELECT
                CAC.EJERCICIOALBARAN,
                TRIM(CAC.SERIEALBARAN) as SERIE_ALB,
                CAC.TERMINALALBARAN,
                CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA,
                TRIM(CAC.SERIEFACTURA) as SERIE_FACT,
                CAC.EJERCICIOFACTURA,
                CPC.IMPORTEBRUTO as CPC_IMPORTEBRUTO,
                CAC.IMPORTETOTAL as CAC_IMPORTETOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 as CAC_BASE1,
                CAC.IMPORTEBASEIMPONIBLE2 as CAC_BASE2,
                CAC.IMPORTEBASEIMPONIBLE3 as CAC_BASE3,
                CAC.PORCENTAJEIVA1 as CAC_PCT_IVA1,
                CAC.PORCENTAJEIVA2 as CAC_PCT_IVA2,
                CAC.PORCENTAJEIVA3 as CAC_PCT_IVA3,
                CAC.IMPORTEIVA1 as CAC_IVA1,
                CAC.IMPORTEIVA2 as CAC_IVA2,
                CAC.IMPORTEIVA3 as CAC_IVA3,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE
            FROM DSEDAC.CAC CAC
            INNER JOIN DSEDAC.CPC CPC
                ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                AND CPC.SERIEALBARAN = CAC.SERIEALBARAN
                AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
                AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROFACTURA > 0
                AND CAC.EJERCICIOFACTURA = ${new Date().getFullYear()}
                ${whereFact}
            ORDER BY CAC.NUMEROFACTURA DESC
            FETCH FIRST ${limit} ROWS ONLY
        `;

        const rows = await conn.query(sql);
        console.log(`[VALIDATE] Got ${rows.length} albaran-factura records`);

        // Step 3: For each record, get LAC items aggregate
        const results = [];
        const processed = new Set();

        for (const row of rows) {
            const albKey = `${row.EJERCICIOALBARAN}-${(row.SERIE_ALB || '').trim()}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;
            if (processed.has(albKey)) continue;
            processed.add(albKey);

            // Get item lines from LAC
            const itemsSql = `
                SELECT IMPORTEVENTA, CANTIDADUNIDADES, PRECIOVENTA
                FROM DSEDAC.LAC
                WHERE EJERCICIOALBARAN = ${row.EJERCICIOALBARAN}
                    AND SERIEALBARAN = '${(row.SERIE_ALB || '').trim()}'
                    AND TERMINALALBARAN = ${row.TERMINALALBARAN}
                    AND NUMEROALBARAN = ${row.NUMEROALBARAN}
            `;

            let items = [];
            try {
                items = await conn.query(itemsSql);
            } catch (e) {
                console.warn(`[VALIDATE] LAC query failed for ${albKey}: ${e.message}`);
            }

            const lacNetoSum = items.reduce((s, i) => s + (parseFloat(i.IMPORTEVENTA) || 0), 0);
            const cpcBruto = parseFloat(row.CPC_IMPORTEBRUTO) || 0;
            const cacTotal = parseFloat(row.CAC_IMPORTETOTAL) || 0;
            const cacBase = (parseFloat(row.CAC_BASE1) || 0) + (parseFloat(row.CAC_BASE2) || 0) + (parseFloat(row.CAC_BASE3) || 0);
            const cacIva = (parseFloat(row.CAC_IVA1) || 0) + (parseFloat(row.CAC_IVA2) || 0) + (parseFloat(row.CAC_IVA3) || 0);
            const cacBaseIva = cacBase + cacIva;

            const diffBrutoVsTotal = Math.abs(cpcBruto - cacTotal);
            const diffBrutoVsBase = Math.abs(cpcBruto - cacBase);
            const diffLacVsBase = Math.abs(lacNetoSum - cacBase);

            results.push({
                albaran_id: albKey,
                factura: `${(row.SERIE_FACT || '').trim()}-${row.NUMEROFACTURA}`,
                ejercicio_factura: row.EJERCICIOFACTURA,
                cliente: (row.CLIENTE || '').trim(),
                nombre_cliente: (row.NOMBRE_CLIENTE || '***').substring(0, 30),
                cpc_importebruto: round2(cpcBruto),
                cac_importetotal: round2(cacTotal),
                cac_base_sum: round2(cacBase),
                cac_iva_sum: round2(cacIva),
                cac_base_plus_iva: round2(cacBaseIva),
                lac_neto_sum: round2(lacNetoSum),
                item_count: items.length,
                diff_bruto_vs_total: round2(diffBrutoVsTotal),
                diff_bruto_vs_base: round2(diffBrutoVsBase),
                diff_lac_vs_base: round2(diffLacVsBase),
                iva_pct_1: row.CAC_PCT_IVA1 || 0,
                iva_pct_2: row.CAC_PCT_IVA2 || 0,
                iva_pct_3: row.CAC_PCT_IVA3 || 0,
                bruto_matches: diffBrutoVsTotal < 0.05 ? 'TOTAL' : diffBrutoVsBase < 0.05 ? 'BASE' : 'NEITHER',
                has_discrepancy: diffBrutoVsTotal >= 0.05
            });
        }

        // Step 4: Aggregate stats for facturas with multiple albaranes
        console.log(`\n[VALIDATE] Step 4: Checking multi-albaran facturas...`);
        const multiAlbSql = `
            SELECT
                TRIM(CAC.SERIEFACTURA) as SERIE_FACT,
                CAC.NUMEROFACTURA,
                CAC.EJERCICIOFACTURA,
                COUNT(*) as NUM_ALBARANES,
                SUM(CAC.IMPORTETOTAL) as SUM_TOTAL,
                SUM(CPC.IMPORTEBRUTO) as SUM_BRUTO
            FROM DSEDAC.CAC CAC
            INNER JOIN DSEDAC.CPC CPC
                ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                AND CPC.SERIEALBARAN = CAC.SERIEALBARAN
                AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
                AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
            WHERE CAC.NUMEROFACTURA > 0
                AND CAC.EJERCICIOFACTURA = ${new Date().getFullYear()}
                ${whereFact}
            GROUP BY CAC.SERIEFACTURA, CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC
            FETCH FIRST 50 ROWS ONLY
        `;

        const multiAlb = await conn.query(multiAlbSql);
        console.log(`[VALIDATE] Found ${multiAlb.length} facturas with multiple albaranes`);

        // Step 5: Specific analysis for Factura 219 if exists
        let factura219Analysis = null;
        if (facturaFilter === '219' || !facturaFilter) {
            console.log('\n[VALIDATE] Step 5: Deep analysis for Factura 219...');
            const f219sql = `
                SELECT
                    CAC.EJERCICIOALBARAN, TRIM(CAC.SERIEALBARAN) as SERIE_ALB,
                    CAC.TERMINALALBARAN, CAC.NUMEROALBARAN,
                    CAC.NUMEROFACTURA, TRIM(CAC.SERIEFACTURA) as SERIE_FACT,
                    CPC.IMPORTEBRUTO as CPC_BRUTO,
                    CAC.IMPORTETOTAL as CAC_TOTAL,
                    CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as CAC_BASE,
                    CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 as CAC_IVA,
                    TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE
                FROM DSEDAC.CAC CAC
                INNER JOIN DSEDAC.CPC CPC
                    ON CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                    AND CPC.SERIEALBARAN = CAC.SERIEALBARAN
                    AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
                    AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
                WHERE CAC.NUMEROFACTURA = 219
                    AND CAC.EJERCICIOFACTURA = ${new Date().getFullYear()}
                ORDER BY CAC.NUMEROALBARAN
            `;

            const f219rows = await conn.query(f219sql);
            if (f219rows.length > 0) {
                factura219Analysis = {
                    total_albaranes: f219rows.length,
                    albaranes: f219rows.map(r => ({
                        albaran: `${r.EJERCICIOALBARAN}-${(r.SERIE_ALB || '').trim()}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`,
                        serie_factura: r.SERIE_FACT,
                        cpc_bruto: round2(parseFloat(r.CPC_BRUTO) || 0),
                        cac_total: round2(parseFloat(r.CAC_TOTAL) || 0),
                        cac_base: round2(parseFloat(r.CAC_BASE) || 0),
                        cac_iva: round2(parseFloat(r.CAC_IVA) || 0),
                        cliente: r.CLIENTE
                    })),
                    sum_cpc_bruto: round2(f219rows.reduce((s, r) => s + (parseFloat(r.CPC_BRUTO) || 0), 0)),
                    sum_cac_total: round2(f219rows.reduce((s, r) => s + (parseFloat(r.CAC_TOTAL) || 0), 0)),
                    sum_cac_base: round2(f219rows.reduce((s, r) => s + (parseFloat(r.CAC_BASE) || 0), 0)),
                    sum_cac_iva: round2(f219rows.reduce((s, r) => s + (parseFloat(r.CAC_IVA) || 0), 0))
                };
                console.log(`[VALIDATE] Factura 219: ${f219rows.length} albaran(es)`);
                console.log(`  SUM CPC.IMPORTEBRUTO = ${factura219Analysis.sum_cpc_bruto}`);
                console.log(`  SUM CAC.IMPORTETOTAL = ${factura219Analysis.sum_cac_total}`);
                console.log(`  SUM CAC Base = ${factura219Analysis.sum_cac_base}`);
                console.log(`  SUM CAC IVA = ${factura219Analysis.sum_cac_iva}`);
            } else {
                console.log('[VALIDATE] Factura 219 not found in current year');
            }
        }

        // Step 6: Generate report
        const discrepancies = results.filter(r => r.has_discrepancy);
        const report = {
            generated_at: new Date().toISOString(),
            total_records: results.length,
            discrepancies_count: discrepancies.length,
            discrepancy_rate: `${((discrepancies.length / Math.max(results.length, 1)) * 100).toFixed(1)}%`,
            columns_detected: tableColumns,
            multi_albaran_facturas: multiAlb.map(r => ({
                factura: `${(r.SERIE_FACT || '').trim()}-${r.NUMEROFACTURA}`,
                num_albaranes: r.NUM_ALBARANES,
                sum_total: round2(parseFloat(r.SUM_TOTAL) || 0),
                sum_bruto: round2(parseFloat(r.SUM_BRUTO) || 0)
            })),
            factura_219: factura219Analysis,
            summary: {
                bruto_matches_total: results.filter(r => r.bruto_matches === 'TOTAL').length,
                bruto_matches_base: results.filter(r => r.bruto_matches === 'BASE').length,
                bruto_matches_neither: results.filter(r => r.bruto_matches === 'NEITHER').length,
            },
            records: results
        };

        // Output JSON
        const outputDir = path.join(__dirname, '..', 'reports');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const jsonPath = path.join(outputDir, 'invoice_validation_report.json');
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
        console.log(`\n[VALIDATE] JSON report: ${jsonPath}`);

        // Output CSV
        const csvHeader = 'albaran_id,factura,cliente,nombre_cliente,cpc_importebruto,cac_importetotal,cac_base_sum,cac_iva_sum,lac_neto_sum,item_count,diff_bruto_vs_total,bruto_matches,has_discrepancy';
        const csvRows = results.map(r =>
            `${r.albaran_id},${r.factura},${r.cliente},${csvEsc(r.nombre_cliente)},${r.cpc_importebruto},${r.cac_importetotal},${r.cac_base_sum},${r.cac_iva_sum},${r.lac_neto_sum},${r.item_count},${r.diff_bruto_vs_total},${r.bruto_matches},${r.has_discrepancy}`
        );
        const csvContent = [csvHeader, ...csvRows].join('\n');
        const csvPath = path.join(outputDir, 'invoice_discrepancies.csv');
        fs.writeFileSync(csvPath, csvContent);
        console.log(`[VALIDATE] CSV report: ${csvPath}`);

        // Summary
        console.log('\n===== SUMMARY =====');
        console.log(`Total records analyzed: ${results.length}`);
        console.log(`Discrepancies (IMPORTEBRUTO != IMPORTETOTAL): ${discrepancies.length} (${report.discrepancy_rate})`);
        console.log(`  BRUTO matches TOTAL: ${report.summary.bruto_matches_total}`);
        console.log(`  BRUTO matches BASE (without IVA): ${report.summary.bruto_matches_base}`);
        console.log(`  BRUTO matches NEITHER: ${report.summary.bruto_matches_neither}`);
        console.log(`Multi-albaran facturas: ${multiAlb.length}`);

        // Print JSON to stdout for automated consumption
        console.log('\n=== JSON OUTPUT ===');
        console.log(JSON.stringify(report, null, 2));

    } catch (error) {
        console.error(`[VALIDATE] FATAL: ${error.message}`);
        process.exit(1);
    } finally {
        if (conn) try { await conn.close(); } catch (e) { /* ignore */ }
    }
}

function round2(n) { return Math.round(n * 100) / 100; }
function csvEsc(s) { return `"${(s || '').replace(/"/g, '""')}"`; }

main();
