#!/usr/bin/env node
/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * AUDIT: scan_anomalies.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Scans DSEDAC.CAC, DSEDAC.CPC, DSEDAC.LAC for anomalous
 * records: sentinel values (999999, -9999999), zero/negative
 * totals, orphan invoices, and amount mismatches.
 *
 * Usage:
 *   node scan_anomalies.js --dry-run [--limit 100]
 *   node scan_anomalies.js --apply   [--limit 100]
 *
 * Environment:
 *   ODBC_DSN (default: GMP)
 *   ODBC_UID (default: JAVIER)
 *   ODBC_PWD (default: JAVIER)
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || !args.includes('--apply');
const LIMIT = (() => {
    const idx = args.indexOf('--limit');
    return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 0;
})();

// ── DB config from env ───────────────────────────────────
const DSN = process.env.ODBC_DSN || 'GMP';
const UID = process.env.ODBC_UID || 'JAVIER';
const PWD = process.env.ODBC_PWD || 'JAVIER';
const CONN_STR = `DSN=${DSN};UID=${UID};PWD=${PWD};NAM=1;CCSID=1208;`;

// ── Thresholds ───────────────────────────────────────────
const SENTINEL_VALUES = [999999, -999999, 9999999, -9999999];
const MAX_REASONABLE_TOTAL = 500000;   // 500k€ max reasonable invoice
const MIN_REASONABLE_TOTAL = -500000;
const TOLERANCE_PCT = 0.02;            // 2% tolerance for recalculation

// ── Output paths ─────────────────────────────────────────
const OUTPUT_DIR = path.join(__dirname, '..');
const ANOMALIES_CSV = path.join(OUTPUT_DIR, 'anomalies.csv');
const REPORT_JSON = path.join(OUTPUT_DIR, 'report.json');

const anomalies = [];
const report = {
    scanDate: new Date().toISOString(),
    mode: DRY_RUN ? 'DRY_RUN' : 'APPLY',
    limit: LIMIT || 'unlimited',
    tables: {},
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    fixes: []
};

function addAnomaly(table, id, clienteId, clienteNombre, fecha, campo, valor, impacto, severity) {
    anomalies.push({ table, id, clienteId, clienteNombre, fecha, campo, valor, impacto, severity });
    report.summary.total++;
    report.summary[severity] = (report.summary[severity] || 0) + 1;
}

async function main() {
    console.log(`\n${'━'.repeat(60)}`);
    console.log(`  AUDIT SCAN — ${DRY_RUN ? 'DRY RUN (no changes)' : '⚠️  APPLY MODE'}`);
    console.log(`  DSN: ${DSN} | Limit: ${LIMIT || 'none'}`);
    console.log(`${'━'.repeat(60)}\n`);

    let conn;
    try {
        conn = await odbc.connect(CONN_STR);
        console.log('✅ Connected to database\n');

        // ────────────────────────────────────────────────────
        // 1. SCAN CAC: Sentinel NUMEROFACTURA values
        // ────────────────────────────────────────────────────
        console.log('🔍 [1/7] Scanning CAC for sentinel NUMEROFACTURA...');
        const sentinelSql = `
            SELECT
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.NUMEROALBARAN, CAC.SERIEALBARAN, CAC.EJERCICIOALBARAN,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
                CAC.IMPORTETOTAL
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
            WHERE CAC.NUMEROFACTURA IN (999999, -999999, 9999999, -9999999)
               OR ABS(CAC.NUMEROFACTURA) >= 900000
            ORDER BY CAC.ANOFACTURA DESC, CAC.MESFACTURA DESC
            ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
        `;
        const sentinelRows = await conn.query(sentinelSql);
        console.log(`   Found ${sentinelRows.length} rows with sentinel NUMEROFACTURA`);
        report.tables.cac_sentinel_factura = sentinelRows.length;

        for (const row of sentinelRows) {
            const fecha = `${row.DIAFACTURA}/${row.MESFACTURA}/${row.ANOFACTURA}`;
            addAnomaly(
                'DSEDAC.CAC',
                `${row.SERIEFACTURA}-${row.NUMEROFACTURA}-${row.EJERCICIOFACTURA}`,
                row.CLIENTE, row.NOMBRE, fecha,
                'NUMEROFACTURA', row.NUMEROFACTURA,
                'Sentinel invoice number — causes A-999999 display and PDF failures',
                'critical'
            );
        }

        // ────────────────────────────────────────────────────
        // 2. SCAN CAC: Anomalous IMPORTETOTAL values
        // ────────────────────────────────────────────────────
        console.log('🔍 [2/7] Scanning CAC for anomalous IMPORTETOTAL...');
        const amountSql = `
            SELECT
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.NUMEROALBARAN, CAC.EJERCICIOALBARAN,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as BASE_SUM,
                CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 as IVA_SUM
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
            WHERE CAC.IMPORTETOTAL > ${MAX_REASONABLE_TOTAL}
               OR CAC.IMPORTETOTAL < ${MIN_REASONABLE_TOTAL}
               OR CAC.IMPORTETOTAL = 0 AND (CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3) != 0
            ORDER BY ABS(CAC.IMPORTETOTAL) DESC
            ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
        `;
        const amountRows = await conn.query(amountSql);
        console.log(`   Found ${amountRows.length} rows with anomalous IMPORTETOTAL`);
        report.tables.cac_anomalous_amounts = amountRows.length;

        for (const row of amountRows) {
            const fecha = `${row.DIAFACTURA}/${row.MESFACTURA}/${row.ANOFACTURA}`;
            const isSentinelAmount = SENTINEL_VALUES.some(sv => Math.abs(row.IMPORTETOTAL - sv) < 1);
            addAnomaly(
                'DSEDAC.CAC',
                `${row.SERIEFACTURA}-${row.NUMEROFACTURA}-${row.EJERCICIOFACTURA}`,
                row.CLIENTE, row.NOMBRE, fecha,
                'IMPORTETOTAL', row.IMPORTETOTAL,
                isSentinelAmount
                    ? 'Sentinel amount value — corrupts totals and PDF rendering'
                    : `Unreasonable total (base=${row.BASE_SUM}, iva=${row.IVA_SUM})`,
                isSentinelAmount ? 'critical' : 'high'
            );
        }

        // ────────────────────────────────────────────────────
        // 3. SCAN CAC: Negative-zero (-0) amounts
        // ────────────────────────────────────────────────────
        console.log('🔍 [3/7] Scanning CAC for -0 / near-zero anomalies...');
        const negZeroSql = `
            SELECT
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.NUMEROALBARAN, CAC.EJERCICIOALBARAN,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as BASE_SUM,
                CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 as IVA_SUM
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
            WHERE CAC.IMPORTETOTAL = 0
              AND CAC.NUMEROFACTURA > 0
              AND (CAC.IMPORTEBASEIMPONIBLE1 != 0 OR CAC.IMPORTEBASEIMPONIBLE2 != 0 OR CAC.IMPORTEBASEIMPONIBLE3 != 0)
            ORDER BY CAC.ANOFACTURA DESC
            ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
        `;
        const negZeroRows = await conn.query(negZeroSql);
        console.log(`   Found ${negZeroRows.length} rows with zero-total but non-zero bases`);
        report.tables.cac_zero_total_nonzero_base = negZeroRows.length;

        for (const row of negZeroRows) {
            const fecha = `${row.DIAFACTURA}/${row.MESFACTURA}/${row.ANOFACTURA}`;
            addAnomaly(
                'DSEDAC.CAC',
                `${row.SERIEFACTURA}-${row.NUMEROFACTURA}-${row.EJERCICIOFACTURA}`,
                row.CLIENTE, row.NOMBRE, fecha,
                'IMPORTETOTAL', `0 (base=${row.BASE_SUM}, iva=${row.IVA_SUM})`,
                'Total is 0 but bases are non-zero — displays "-0" or wrong amount in UI',
                'high'
            );
        }

        // ────────────────────────────────────────────────────
        // 4. SCAN: Amount mismatches (recalculate from lines)
        // ────────────────────────────────────────────────────
        console.log('🔍 [4/7] Scanning for amount mismatches (header vs lines)...');
        const mismatchSql = `
            SELECT
                CAC.SERIEFACTURA, CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
                CAC.IMPORTETOTAL as HDR_TOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as HDR_BASE,
                SUM(LAC.IMPORTEVENTA) as LINE_SUM
            FROM DSEDAC.CAC CAC
            INNER JOIN DSEDAC.LAC LAC
                ON LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
                AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
                AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
            WHERE CAC.NUMEROFACTURA > 0
              AND CAC.NUMEROFACTURA < 900000
              AND CAC.EJERCICIOFACTURA >= 2022
            GROUP BY CAC.SERIEFACTURA, CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA,
                     TRIM(CAC.CODIGOCLIENTEFACTURA), TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')),
                     CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
                     CAC.IMPORTETOTAL,
                     CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3
            HAVING ABS(SUM(LAC.IMPORTEVENTA) - (CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3)) >
                   CASE WHEN ABS(CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3) > 0
                        THEN ABS(CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3) * ${TOLERANCE_PCT}
                        ELSE 1 END
            ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
        `;
        try {
            const mismatchRows = await conn.query(mismatchSql);
            console.log(`   Found ${mismatchRows.length} invoices with line-vs-header mismatch`);
            report.tables.cac_amount_mismatches = mismatchRows.length;

            for (const row of mismatchRows) {
                const fecha = `${row.DIAFACTURA}/${row.MESFACTURA}/${row.ANOFACTURA}`;
                addAnomaly(
                    'DSEDAC.CAC+LAC',
                    `${row.SERIEFACTURA}-${row.NUMEROFACTURA}-${row.EJERCICIOFACTURA}`,
                    row.CLIENTE, row.NOMBRE, fecha,
                    'BASE_MISMATCH', `header=${row.HDR_BASE} lines=${row.LINE_SUM}`,
                    'Line items sum does not match header base — PDF shows inconsistent totals',
                    'medium'
                );
            }
        } catch (e) {
            console.log(`   ⚠️ Mismatch query failed (may timeout on large datasets): ${e.message}`);
            report.tables.cac_amount_mismatches = 'QUERY_FAILED';
        }

        // ────────────────────────────────────────────────────
        // 5. SCAN: Orphaned DELIVERY_STATUS (confirmed but no receipt)
        // ────────────────────────────────────────────────────
        console.log('🔍 [5/7] Scanning DELIVERY_STATUS for orphaned confirmations...');
        try {
            const orphanSql = `
                SELECT DS.ID, DS.STATUS, DS.REPARTIDOR_ID, DS.UPDATED_AT,
                       DS.FIRMA_PATH, DS.OBSERVACIONES
                FROM JAVIER.DELIVERY_STATUS DS
                WHERE DS.STATUS = 'ENTREGADO'
                  AND (DS.FIRMA_PATH IS NULL OR TRIM(DS.FIRMA_PATH) = '')
                ORDER BY DS.UPDATED_AT DESC
                ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
            `;
            const orphanRows = await conn.query(orphanSql);
            console.log(`   Found ${orphanRows.length} ENTREGADO without firma`);
            report.tables.delivery_status_no_firma = orphanRows.length;

            for (const row of orphanRows) {
                addAnomaly(
                    'JAVIER.DELIVERY_STATUS',
                    row.ID, '', '', row.UPDATED_AT?.toString() || '',
                    'FIRMA_PATH', 'NULL/empty',
                    'Delivery confirmed without signature — incomplete confirmation flow',
                    'medium'
                );
            }
        } catch (e) {
            console.log(`   ⚠️ DELIVERY_STATUS table not available: ${e.message}`);
            report.tables.delivery_status_no_firma = 'TABLE_NOT_FOUND';
        }

        // ────────────────────────────────────────────────────
        // 6. SCAN: Duplicate DELIVERY_STATUS entries
        // ────────────────────────────────────────────────────
        console.log('🔍 [6/7] Scanning for duplicate delivery confirmations...');
        try {
            const dupSql = `
                SELECT ID, COUNT(*) as CNT
                FROM JAVIER.DELIVERY_STATUS
                GROUP BY ID
                HAVING COUNT(*) > 1
                ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
            `;
            const dupRows = await conn.query(dupSql);
            console.log(`   Found ${dupRows.length} duplicate DELIVERY_STATUS IDs`);
            report.tables.delivery_status_duplicates = dupRows.length;

            for (const row of dupRows) {
                addAnomaly(
                    'JAVIER.DELIVERY_STATUS',
                    row.ID, '', '', '',
                    'DUPLICATE_ID', `count=${row.CNT}`,
                    'Multiple status records for same delivery — race condition in DELETE+INSERT upsert',
                    'high'
                );
            }
        } catch (e) {
            console.log(`   ⚠️ Duplicate check failed: ${e.message}`);
            report.tables.delivery_status_duplicates = 'QUERY_FAILED';
        }

        // ────────────────────────────────────────────────────
        // 7. SCAN: CPC records with sentinel-like amounts
        // ────────────────────────────────────────────────────
        console.log('🔍 [7/7] Scanning CPC for sentinel IMPORTETOTAL values...');
        const cpcSentinelSql = `
            SELECT
                CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO,
                CPC.IMPORTETOTAL, CPC.IMPORTEBRUTO
            FROM DSEDAC.CPC CPC
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CPC.CODIGOCLIENTEALBARAN
            WHERE ABS(CPC.IMPORTETOTAL) >= 900000
               OR CPC.IMPORTETOTAL < -50000
            ORDER BY ABS(CPC.IMPORTETOTAL) DESC
            ${LIMIT ? `FETCH FIRST ${LIMIT} ROWS ONLY` : ''}
        `;
        const cpcSentinelRows = await conn.query(cpcSentinelSql);
        console.log(`   Found ${cpcSentinelRows.length} CPC rows with sentinel amounts`);
        report.tables.cpc_sentinel_amounts = cpcSentinelRows.length;

        for (const row of cpcSentinelRows) {
            const fecha = `${row.DIADOCUMENTO}/${row.MESDOCUMENTO}/${row.ANODOCUMENTO}`;
            addAnomaly(
                'DSEDAC.CPC',
                `${row.EJERCICIOALBARAN}-${(row.SERIEALBARAN || '').trim()}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`,
                row.CLIENTE, row.NOMBRE, fecha,
                'IMPORTETOTAL', row.IMPORTETOTAL,
                'Sentinel/unreasonable amount in delivery header — corrupts rutero totals',
                'critical'
            );
        }

        // ── Write outputs ────────────────────────────────────
        console.log('\n📝 Writing outputs...');

        // CSV
        const csvHeader = 'table,id,cliente_id,cliente_nombre,fecha,campo,valor,impacto,severity';
        const csvLines = anomalies.map(a =>
            [a.table, a.id, a.clienteId, `"${(a.clienteNombre || '').replace(/"/g, '""')}"`,
             a.fecha, a.campo, a.valor, `"${a.impacto.replace(/"/g, '""')}"`, a.severity].join(',')
        );
        fs.writeFileSync(ANOMALIES_CSV, [csvHeader, ...csvLines].join('\n'), 'utf8');
        console.log(`   ✅ ${ANOMALIES_CSV} (${anomalies.length} rows)`);

        // JSON
        report.anomalyCount = anomalies.length;
        fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
        console.log(`   ✅ ${REPORT_JSON}`);

        // ── Summary ──────────────────────────────────────────
        console.log(`\n${'━'.repeat(60)}`);
        console.log(`  SCAN COMPLETE`);
        console.log(`  Total anomalies: ${report.summary.total}`);
        console.log(`  Critical: ${report.summary.critical || 0}`);
        console.log(`  High:     ${report.summary.high || 0}`);
        console.log(`  Medium:   ${report.summary.medium || 0}`);
        console.log(`  Low:      ${report.summary.low || 0}`);
        console.log(`${'━'.repeat(60)}\n`);

    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    } finally {
        if (conn) try { await conn.close(); } catch (_) {}
    }
}

main();
