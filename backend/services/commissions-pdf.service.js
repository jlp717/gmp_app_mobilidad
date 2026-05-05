/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * COMMISSIONS PDF REPORT SERVICE
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Generates PDF report with per-vendor monthly breakdown:
 *   Mes | Objetivo | Ventas LAC | Ventas CONDOR | Total | % | Generada | Pagada | Obs
 * Format: landscape A4, DIEGO-only.
 */

const PDFDocument = require('pdfkit');
const logger = require('../middleware/logger');
const { queryWithParams } = require('../config/db');
const { CircuitBreaker } = require('./circuit-breaker');
const {
    getVendorColumnExpr,
    LACLAE_SALES_FILTER,
    SNAPSHOT_UNTIL_MONTH,
} = require('../utils/common');

const commissionsPdfBreaker = new CircuitBreaker({
    name: 'commissions-pdf',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COLORS = {
    header: '#003d7a',
    headerText: '#FFFFFF',
    border: '#000000',
    totalBg: '#003d7a',
    totalText: '#FFFFFF',
    text: '#000000',
    lightBg: '#E8F4FD',
    condorBg: '#FFF8E1',
};

// Allowed users who can generate this PDF
const ALLOWED_USERS = ['DIEGO', 'diego'];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPER FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatCurrency(num) {
    if (num === null || num === undefined || isNaN(num)) return '0,00';
    const fixed = Math.abs(num).toFixed(2);
    const parts = fixed.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const result = parts[1] ? integerPart + ',' + parts[1] : integerPart;
    return num < 0 ? '-' + result : result;
}

function getMonthName(monthNum) {
    const months = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return months[monthNum] || '';
}

function formatPct(pct) {
    if (!pct && pct !== 0) return '-';
    return pct.toFixed(1) + '%';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERMISSION CHECK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isAuthorized(userName) {
    return ALLOWED_USERS.includes(userName?.toUpperCase());
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATA QUERIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get LAC sales data per vendor for the specified month range.
 * Uses getVendorColumnExpr for correct LCCDVD/R1_T8CDVD per row.
 * For months <= SNAPSHOT_UNTIL_MONTH of 2026, reads from snapshot table.
 */
async function getLacSalesData(year, startMonth, endMonth) {
    // For snapshot months of 2026, we'll merge live + snapshot data below.
    // Build the CASE expression for the vendor column.
    const vendorColExpr = getVendorColumnExpr('L');

    // Determine which months to query live vs from snapshot
    const isSnapshotYear = (year === 2026 && SNAPSHOT_UNTIL_MONTH > 0);
    const snapshotMonths = isSnapshotYear
        ? Array.from({ length: Math.min(SNAPSHOT_UNTIL_MONTH, endMonth) - startMonth + 1 }, (_, i) => i + startMonth)
              .filter(m => m <= SNAPSHOT_UNTIL_MONTH)
        : [];
    const liveMonths = [];
    for (let m = startMonth; m <= endMonth; m++) {
        if (!snapshotMonths.includes(m)) liveMonths.push(m);
    }

    const vendorMap = new Map();

    // Helper to upsert vendor entry
    const upsertVendor = (code, name) => {
        if (!vendorMap.has(code)) {
            vendorMap.set(code, { code, name: name || `Vendedor ${code}`, months: {} });
        } else if (name && !vendorMap.get(code).name) {
            vendorMap.get(code).name = name;
        }
    };

    // 1. Query snapshot months from JAVIER.COMMISSION_SNAPSHOT_2026_0102
    // VENTAS_REAL = LAC + CONDOR combined (no split available in this table).
    // We store it under 'lac' so the PDF column shows the total; CONDOR will be 0
    // for snapshot rows. A footer note explains this.
    if (snapshotMonths.length > 0) {
        try {
            const monthPlaceholders = snapshotMonths.map(() => '?').join(',');
            const snapRows = await queryWithParams(`
                SELECT CSS.VENDEDOR_CODIGO, CSS.MES, CSS.VENTAS_REAL,
                       COALESCE(TRIM(V.NOMBREVENDEDOR), '') as NOMBRE_VENDEDOR
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102 CSS
                LEFT JOIN DSEDAC.VDD V ON TRIM(V.CODIGOVENDEDOR) = TRIM(CSS.VENDEDOR_CODIGO)
                WHERE CSS.ANIO = ?
                  AND CSS.MES IN (${monthPlaceholders})
            `, [year, ...snapshotMonths], false);

            for (const row of snapRows) {
                const code = (row.VENDEDOR_CODIGO || '').trim();
                const name = row.NOMBRE_VENDEDOR || `Vendedor ${code}`;
                upsertVendor(code, name);
                vendorMap.get(code).months[row.MES] = {
                    // VENTAS_REAL is the total (LAC + CONDOR); no split available.
                    lac: parseFloat(row.VENTAS_REAL) || 0,
                    isSnapshot: true,
                };
            }
            logger.info(`[PDF] Snapshot LAC data loaded from COMMISSION_SNAPSHOT_2026_0102: ${snapRows.length} rows for months ${snapshotMonths.join(',')}`);
        } catch (e) {
            logger.warn(`[PDF] Snapshot LAC query failed (COMMISSION_SNAPSHOT_2026_0102): ${e.message}`);
            // Fall through to live query for these months
            liveMonths.push(...snapshotMonths);
        }
    }

    // 2. Query live months from DSED.LACLAE
    if (liveMonths.length > 0) {
        const monthPlaceholders = liveMonths.map(() => '?').join(',');
        const sql = `
            SELECT
                (${vendorColExpr}) as VENDEDOR,
                COALESCE(TRIM(V.NOMBREVENDEDOR), '') as NOMBRE_VENDEDOR,
                L.LCMMDC as MES,
                COALESCE(SUM(L.LCIMVT), 0) as LAC_TOTAL
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.VDD V ON (${vendorColExpr}) = RTRIM(V.CODIGOVENDEDOR)
            WHERE L.LCAADC = ?
              AND L.LCMMDC IN (${monthPlaceholders})
              AND L.LCTPVT IN ('CC', 'VC')
              AND L.LCCLLN IN ('AB', 'VT')
              AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
              AND L.TPDC = 'LAC'
              AND (${vendorColExpr}) IS NOT NULL
              AND (${vendorColExpr}) <> ''
            GROUP BY (${vendorColExpr}), V.NOMBREVENDEDOR, L.LCMMDC
            ORDER BY (${vendorColExpr}), L.LCMMDC
        `;

        const rows = await queryWithParams(sql, [year, ...liveMonths], false);
        for (const row of rows) {
            const code = (row.VENDEDOR || '').trim();
            const name = row.NOMBRE_VENDEDOR || `Vendedor ${code}`;
            upsertVendor(code, name);
            vendorMap.get(code).months[row.MES] = {
                lac: parseFloat(row.LAC_TOTAL) || 0,
                isSnapshot: false,
            };
        }
    }

    return Array.from(vendorMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Get CONDOR (VENTAS_B) sales per vendor for the specified month range.
 * For snapshot months of 2026, CONDOR is set to 0 (no split in COMMISSION_SNAPSHOT_2026_0102; total is in LAC column).
 */
async function getCondorSalesData(year, startMonth, endMonth) {
    const isSnapshotYear = (year === 2026 && SNAPSHOT_UNTIL_MONTH > 0);
    const snapshotMonths = isSnapshotYear
        ? Array.from({ length: Math.min(SNAPSHOT_UNTIL_MONTH, endMonth) - startMonth + 1 }, (_, i) => i + startMonth)
              .filter(m => m <= SNAPSHOT_UNTIL_MONTH)
        : [];
    const liveMonths = [];
    for (let m = startMonth; m <= endMonth; m++) {
        if (!snapshotMonths.includes(m)) liveMonths.push(m);
    }

    const condorMap = new Map(); // vendorCode → { mes → { condor, isSnapshot } }

    // 1. Snapshot months — COMMISSION_SNAPSHOT_2026_0102 has no LAC/CONDOR split.
    // VENTAS_REAL is already stored as 'lac' in getLacSalesData; we return 0 CONDOR
    // for snapshot rows so the PDF doesn't double-count. A PDF footer note explains this.
    // (No DB query needed — condorMap simply has no entries for snapshot months.)
    if (snapshotMonths.length > 0) {
        logger.info(`[PDF] Snapshot months [${snapshotMonths.join(',')}]: CONDOR set to 0 (no split in COMMISSION_SNAPSHOT_2026_0102; VENTAS_REAL shown in LAC column)`);
    }

    // 2. Live months from JAVIER.VENTAS_B
    if (liveMonths.length > 0) {
        try {
            const monthPlaceholders = liveMonths.map(() => '?').join(',');
            const rows = await queryWithParams(`
                SELECT TRIM(CODIGOVENDEDOR) as VENDEDOR_CODIGO, MES, SUM(IMPORTE) as VENTAS_CONDOR
                FROM JAVIER.VENTAS_B
                WHERE EJERCICIO = ?
                  AND MES IN (${monthPlaceholders})
                GROUP BY TRIM(CODIGOVENDEDOR), MES
                ORDER BY TRIM(CODIGOVENDEDOR), MES
            `, [year, ...liveMonths], false);

            for (const row of rows) {
                const code = (row.VENDEDOR_CODIGO || '').trim();
                if (!condorMap.has(code)) condorMap.set(code, {});
                condorMap.get(code)[row.MES] = {
                    condor: parseFloat(row.VENTAS_CONDOR) || 0,
                    isSnapshot: false,
                };
            }
            logger.info(`[PDF] Live CONDOR data loaded: ${rows.length} rows`);
        } catch (e) {
            logger.warn(`[PDF] CONDOR (VENTAS_B) query failed: ${e.message}`);
        }
    }

    return condorMap;
}

/**
 * Get monthly targets and commission amounts per vendor.
 * For snapshot months: reads authoritative values from COMMISSION_SNAPSHOT_2026_0102.
 * For live months: uses COMMERCIAL_TARGETS table for objectives.
 * Returns: Map of vendorCode → month → { objetivo, comisionGenerada, isSnapshot }
 */
async function getMonthlyTargetsAndCommissions(year, startMonth, endMonth) {
    const isSnapshotYear = (year === 2026 && SNAPSHOT_UNTIL_MONTH > 0);
    const snapshotMonths = isSnapshotYear
        ? Array.from({ length: Math.min(SNAPSHOT_UNTIL_MONTH, endMonth) - startMonth + 1 }, (_, i) => i + startMonth)
              .filter(m => m <= SNAPSHOT_UNTIL_MONTH)
        : [];

    const targetMap = new Map(); // vendorCode → month → { objetivo, comisionGenerada, isSnapshot }

    // Snapshot months: get objetivo + comisionGenerada from COMMISSION_SNAPSHOT_2026_0102.
    // Column names: OBJETIVO_MES (not OBJETIVO).
    if (snapshotMonths.length > 0) {
        try {
            const monthPlaceholders = snapshotMonths.map(() => '?').join(',');
            const rows = await queryWithParams(`
                SELECT TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO, MES, OBJETIVO_MES, COMISION_GENERADA
                FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
                WHERE ANIO = ?
                  AND MES IN (${monthPlaceholders})
            `, [year, ...snapshotMonths], false);

            for (const row of rows) {
                const code = (row.VENDEDOR_CODIGO || '').trim();
                if (!targetMap.has(code)) targetMap.set(code, {});
                targetMap.get(code)[row.MES] = {
                    objetivo: parseFloat(row.OBJETIVO_MES) || 0,
                    comisionGenerada: parseFloat(row.COMISION_GENERADA) || 0,
                    isSnapshot: true,
                };
            }
        } catch (e) {
            logger.warn(`[PDF] Snapshot targets query failed: ${e.message}`);
        }
    }

    // For live months, COMMERCIAL_TARGETS gives the objective
    // (commission for live months is shown from COMMISSION_PAYMENTS)
    // No separate query needed here — the PDF uses live data directly from
    // getLacSalesData / getCondorSalesData and payments for live months.

    return targetMap;
}

/**
 * Get registered payments (COMMISSION_PAYMENTS) per vendor for the year.
 * Returns: Map of vendorCode → month → { importePagado, comisionGenerada, observaciones }
 */
async function getVendorPaymentsForPdf(year) {
    try {
        const rows = await queryWithParams(`
            SELECT VENDEDOR_CODIGO, MES, IMPORTE_PAGADO, COMISION_GENERADA,
                   VENTAS_REAL, OBJETIVO_MES, OBSERVACIONES
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE ANIO = ?
            ORDER BY VENDEDOR_CODIGO, MES
        `, [year], false, false);

        const map = new Map();
        rows.forEach(r => {
            const code = (r.VENDEDOR_CODIGO || '').trim();
            const mes = parseInt(r.MES);
            if (!map.has(code)) map.set(code, {});
            if (!map.get(code)[mes]) {
                map.get(code)[mes] = { importePagado: 0, comisionGenerada: 0, observaciones: [] };
            }
            map.get(code)[mes].importePagado += parseFloat(r.IMPORTE_PAGADO) || 0;
            map.get(code)[mes].comisionGenerada += parseFloat(r.COMISION_GENERADA) || 0;
            if (r.OBSERVACIONES && r.OBSERVACIONES.trim()) {
                map.get(code)[mes].observaciones.push(r.OBSERVACIONES.trim());
            }
        });
        return map;
    } catch (e) {
        logger.warn(`[PDF] Payments query failed: ${e.message}`);
        return new Map();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Generates a landscape A4 PDF report for DIEGO.
 * One section per comercial, with a table:
 *   Mes | Objetivo | Ventas LAC | Ventas CONDOR | Total | % | Gen. | Pagado | Obs.
 * Footer per vendor: totales anuales + flag "Tiene CONDOR".
 */
async function generateCommissionsPdf(vendorData, condorDataMap, year, startMonth, endMonth) {
    // Load targets/commissions from snapshot
    const targetMap = await getMonthlyTargetsAndCommissions(year, startMonth, endMonth);
    // Load payments for the full year
    const paymentsMap = await getVendorPaymentsForPdf(year);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 30,
                layout: 'landscape'
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;   // ~842 landscape
            const pageHeight = doc.page.height; // ~595 landscape
            const margin = 30;
            const contentWidth = pageWidth - margin * 2;

            const now = new Date();
            const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const periodLabel = startMonth === endMonth
                ? `${getMonthName(startMonth)} ${year}`
                : `${getMonthName(startMonth)} - ${getMonthName(endMonth)} ${year}`;

            // Column definitions (total ~782px for A4 landscape content width ~782)
            const cols = [
                { key: 'mes',     label: 'Mes',         width: 62  },
                { key: 'obj',     label: 'Objetivo',    width: 82  },
                { key: 'lac',     label: 'Venta LAC',   width: 82  },
                { key: 'condor',  label: 'V. CONDOR',   width: 78  },
                { key: 'total',   label: 'Total',       width: 82  },
                { key: 'pct',     label: '%Cumpl.',     width: 55  },
                { key: 'gen',     label: 'Com.Gen.',    width: 72  },
                { key: 'pag',     label: 'Com.Pag.',    width: 72  },
                { key: 'obs',     label: 'Observaciones', width: 143 },
            ];
            const tableWidth = cols.reduce((s, c) => s + c.width, 0);

            const ROW_H = 14;
            const HDR_H = 18;

            let firstPage = true;

            // Helper: draw page header
            const drawPageHeader = (y) => {
                doc.fontSize(9).fillColor(COLORS.text).text(
                    `Informe de Comisiones ${year} — ${periodLabel}   |   Generado: ${dateStr}`,
                    margin, y, { width: contentWidth, align: 'center' }
                );
                return y + 14;
            };

            let yPos = margin;
            yPos = drawPageHeader(yPos);
            yPos += 4;

            // Iterate vendors
            for (const vendor of vendorData) {
                const vendorCondorMap = condorDataMap.get(vendor.code) || {};
                const vendorTargets = targetMap.get(vendor.code) || {};
                const vendorPayments = paymentsMap.get(vendor.code) || {};

                // Estimate rows needed: months + header + vendor header + footer = months+3
                const monthsInRange = endMonth - startMonth + 1;
                const estimatedHeight = HDR_H * 2 + ROW_H * monthsInRange + HDR_H + 10;

                // New page if not enough space
                if (!firstPage && yPos + estimatedHeight > pageHeight - margin - 20) {
                    doc.addPage();
                    yPos = margin;
                    yPos = drawPageHeader(yPos);
                    yPos += 4;
                }
                firstPage = false;

                // ── Vendor header bar ──
                doc.rect(margin, yPos, tableWidth, HDR_H).fill(COLORS.header);
                doc.fillColor(COLORS.headerText).fontSize(9).font('Helvetica-Bold')
                    .text(`${vendor.code} — ${vendor.name}`, margin + 4, yPos + 4, {
                        width: tableWidth - 8, align: 'left'
                    });
                yPos += HDR_H;

                // ── Column headers ──
                let xPos = margin;
                doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.text);
                cols.forEach(col => {
                    doc.rect(xPos, yPos, col.width, HDR_H).fill('#D0E4F7').stroke();
                    doc.fillColor(COLORS.text).text(col.label, xPos + 2, yPos + 4, {
                        width: col.width - 4, align: 'center'
                    });
                    xPos += col.width;
                });
                yPos += HDR_H;

                // ── Data rows ──
                let totalLac = 0, totalCondor = 0, totalObj = 0, totalGen = 0, totalPag = 0;
                let tieneCondorAnual = false;
                let rowIdx = 0;

                for (let m = startMonth; m <= endMonth; m++) {
                    const monthLacData = vendor.months[m] || { lac: 0, isSnapshot: false };
                    const condorData = vendorCondorMap[m] || { condor: 0, isSnapshot: false };
                    const targData = vendorTargets[m];
                    const payData = vendorPayments[m];

                    const lacAmt = monthLacData.lac || 0;
                    const condorAmt = condorData.condor || 0;
                    const totalAmt = lacAmt + condorAmt;

                    // Objective: from snapshot → targData.objetivo, otherwise 0 (live months don't have it here)
                    const objAmt = targData ? targData.objetivo : 0;
                    const pct = (objAmt > 0 && totalAmt > 0) ? (totalAmt / objAmt) * 100 : 0;

                    // Commission generated: snapshot → targData.comisionGenerada, else payment recorded value
                    const genAmt = targData ? targData.comisionGenerada
                        : (payData ? payData.comisionGenerada : 0);
                    const pagAmt = payData ? payData.importePagado : 0;
                    const obs = payData ? payData.observaciones.join('; ') : '';
                    if (condorAmt > 0) tieneCondorAnual = true;
                    totalLac += lacAmt;
                    totalCondor += condorAmt;
                    totalObj += objAmt;
                    totalGen += genAmt;
                    totalPag += pagAmt;

                    // Row background
                    const rowBg = rowIdx % 2 === 0 ? COLORS.lightBg : '#FFFFFF';
                    doc.rect(margin, yPos, tableWidth, ROW_H).fill(rowBg);

                    xPos = margin;
                    doc.font('Helvetica').fontSize(7).fillColor(COLORS.text);

                    cols.forEach(col => {
                        let cellText = '';
                        let cellColor = COLORS.text;
                        let align = 'right';

                        switch (col.key) {
                            case 'mes':
                                align = 'left';
                                doc.fillColor(COLORS.text).text(
                                    getMonthName(m).substring(0, 3).toUpperCase(),
                                    xPos + 2, yPos + 3,
                                    { width: col.width - 4, align: 'left' }
                                );
                                xPos += col.width;
                                return; // handled manually
                            case 'obj':
                                cellText = objAmt > 0 ? formatCurrency(objAmt) : '-';
                                break;
                            case 'lac':
                                cellText = formatCurrency(lacAmt);
                                break;
                            case 'condor':
                                cellText = condorAmt > 0 ? formatCurrency(condorAmt) : '-';
                                if (condorAmt > 0) cellColor = '#8B6914';
                                break;
                            case 'total':
                                cellText = formatCurrency(totalAmt);
                                cellColor = pct >= 100 ? '#1A6B1A' : COLORS.text;
                                break;
                            case 'pct':
                                cellText = objAmt > 0 ? formatPct(pct) : '-';
                                cellColor = pct >= 100 ? '#1A6B1A' : (pct > 0 ? '#A05000' : COLORS.text);
                                break;
                            case 'gen':
                                cellText = genAmt > 0 ? formatCurrency(genAmt) : '0,00';
                                cellColor = genAmt > 0 ? '#1A6B1A' : '#888888';
                                break;
                            case 'pag':
                                cellText = pagAmt > 0 ? formatCurrency(pagAmt) : '-';
                                cellColor = pagAmt > 0 ? '#003d7a' : '#888888';
                                break;
                            case 'obs':
                                align = 'left';
                                cellText = obs.length > 30 ? obs.substring(0, 28) + '...' : obs;
                                break;
                        }

                        doc.fillColor(cellColor).text(cellText, xPos + 2, yPos + 3, {
                            width: col.width - 4, align
                        });
                        xPos += col.width;
                    });

                    // Draw row borders
                    xPos = margin;
                    doc.lineWidth(0.3).strokeColor('#AAAAAA');
                    cols.forEach(col => {
                        doc.rect(xPos, yPos, col.width, ROW_H).stroke();
                        xPos += col.width;
                    });

                    yPos += ROW_H;
                    rowIdx++;

                    // New page if needed
                    if (yPos > pageHeight - margin - ROW_H * 4) {
                        doc.addPage();
                        yPos = margin;
                        yPos = drawPageHeader(yPos);
                        yPos += 4;
                    }
                }

                // ── Vendor total row ──
                doc.rect(margin, yPos, tableWidth, HDR_H).fill(COLORS.totalBg);
                doc.fillColor(COLORS.totalText).font('Helvetica-Bold').fontSize(7);

                xPos = margin;
                const totalRowData = {
                    mes: 'TOTAL',
                    obj: totalObj > 0 ? formatCurrency(totalObj) : '-',
                    lac: formatCurrency(totalLac),
                    condor: totalCondor > 0 ? formatCurrency(totalCondor) : '-',
                    total: formatCurrency(totalLac + totalCondor),
                    pct: totalObj > 0 ? formatPct(((totalLac + totalCondor) / totalObj) * 100) : '-',
                    gen: formatCurrency(totalGen),
                    pag: formatCurrency(totalPag),
                    obs: tieneCondorAnual ? 'Tiene ventas CONDOR' : '',
                };
                cols.forEach(col => {
                    const align = (col.key === 'mes' || col.key === 'obs') ? 'left' : 'right';
                    doc.text(totalRowData[col.key] || '', xPos + 2, yPos + 4, {
                        width: col.width - 4, align
                    });
                    xPos += col.width;
                });
                doc.strokeColor(COLORS.border).lineWidth(0.5);
                xPos = margin;
                cols.forEach(col => {
                    doc.rect(xPos, yPos, col.width, HDR_H).stroke();
                    xPos += col.width;
                });

                yPos += HDR_H + 8;
                doc.font('Helvetica');
            }

            // ── Global footer ──
            doc.fontSize(7).fillColor('#555555')
                .text(
                    `Informe de comisiones ${year} (${periodLabel}) — Solo para uso interno`,
                    margin, pageHeight - 30,
                    { width: contentWidth, align: 'left' }
                );
            doc.fontSize(7).fillColor('#555555')
                .text(
                    'GMP App Movilidad',
                    margin + contentWidth / 2, pageHeight - 30,
                    { width: contentWidth / 2, align: 'right' }
                );

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// MAIN EXPORT
module.exports = {
    isAuthorized,
    getLacSalesData,
    getCondorSalesData,
    generateCommissionsPdf
};
