/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 📊 COMMISSIONS PDF REPORT SERVICE
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Generates PDF report with LAC sales data for DIEGO only
 * Format matches the printed template exactly
 */

const PDFDocument = require('pdfkit');
const logger = require('../middleware/logger');
const { queryWithParams } = require('../config/db');

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
    lightBg: '#E8F4FD'
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
 * Get LAC sales data per vendor for the specified month range
 */
async function getLacSalesData(year, startMonth, endMonth) {
    const sql = `
        SELECT
            RTRIM(L.R1_T8CDVD) as VENDEDOR,
            COALESCE(TRIM(V.NOMBREVENDEDOR), '') as NOMBRE_VENDEDOR,
            L.LCMMDC as MES,
            COALESCE(SUM(L.LCIMVT), 0) as LAC_TOTAL
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.VDD V ON RTRIM(L.R1_T8CDVD) = RTRIM(V.CODIGOVENDEDOR)
        WHERE L.LCAADC = ?
          AND L.LCMMDC BETWEEN ? AND ?
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
          AND L.R1_T8CDVD IS NOT NULL
          AND L.R1_T8CDVD <> ''
        GROUP BY L.R1_T8CDVD, V.NOMBREVENDEDOR, L.LCMMDC
        ORDER BY L.R1_T8CDVD, L.LCMMDC
    `;

    const rows = await queryWithParams(sql, [year, startMonth, endMonth], false);
    
    // Aggregate by vendor
    const vendorMap = new Map();
    for (const row of rows) {
        const code = row.VENDEDOR;
        const name = row.NOMBRE_VENDEDOR || `Vendedor ${code}`;
        if (!vendorMap.has(code)) {
            vendorMap.set(code, { code, name, months: {} });
        }
        vendorMap.get(code).months[row.MES] = parseFloat(row.LAC_TOTAL) || 0;
    }
    
    return Array.from(vendorMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Get CONDOR sales data per vendor for the specified month range
 * NOTE: Adjust table/column names to match your actual CONDOR data source
 */
async function getCondorSalesData(year, startMonth, endMonth) {
    // TODO: Replace with actual CONDOR table query
    // For now, returns empty array - update with actual table name
    try {
        // Placeholder: If CONDOR data exists in a table, query it here
        // Example structure:
        // SELECT CODIGOVENDEDOR as vd, MESDOCUMENTO as Mes, IMPORTEVENTA as Importe
        // FROM YOUR_CONDOR_TABLE
        // WHERE ANODOCUMENTO = ? AND MESDOCUMENTO BETWEEN ? AND ?
        
        // For now, return empty - the PDF will show just LAC data
        logger.info('[PDF] CONDOR data source not configured - showing LAC only');
        return [];
    } catch (e) {
        logger.warn(`[PDF] CONDOR query failed: ${e.message}`);
        return [];
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generateCommissionsPdf(vendorData, condorData, year, startMonth, endMonth) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                layout: 'landscape'
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;
            const margin = 40;
            const contentWidth = pageWidth - margin * 2;

            // Title
            const now = new Date();
            const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            
            const periodLabel = startMonth === endMonth 
                ? `${getMonthName(startMonth)} ${year}` 
                : `${getMonthName(startMonth)} - ${getMonthName(endMonth)} ${year}`;

            doc.fontSize(10).fillColor(COLORS.text).text(dateStr, { align: 'center' });
            doc.moveDown(0.5);

            // ──────────────────────────────────────────
            // LEFT TABLE: VENTA (LAC)
            // ──────────────────────────────────────────
            const tableLeftX = margin;
            const tableWidth = contentWidth * 0.65;
            const rowHeight = 14;
            const headerHeight = 18;

            // Table header - VENTA
            let y = doc.y;
            doc.fontSize(9).fillColor(COLORS.headerText);
            doc.rect(tableLeftX, y, tableWidth, headerHeight).fill(COLORS.header);
            doc.text('VENTA', tableLeftX + 4, y + 4, { width: tableWidth - 8, align: 'left' });

            y += headerHeight;

            // Column headers
            const colDefs = [
                { key: 'code', label: 'VENDEDOR', width: 50 },
                { key: 'name', label: 'NOMBRE VENDEDOR', width: 200 },
                { key: 'mes', label: 'MES', width: 35 },
                { key: 'lac', label: 'LAC', width: 100 },
                { key: 'total', label: 'Total general', width: 100 }
            ];

            let x = tableLeftX;
            colDefs.forEach(col => {
                doc.rect(x, y, col.width, headerHeight).fill(COLORS.secondary);
                doc.text(col.label, x + 3, y + 4, { width: col.width - 6, align: 'center' });
                x += col.width;
            });

            y += headerHeight;

            // Data rows
            let lacTotal = 0;
            vendorData.forEach(vendor => {
                // Sum all months for this vendor
                let vendorTotal = 0;
                Object.values(vendor.months).forEach(v => vendorTotal += v);
                lacTotal += vendorTotal;

                Object.entries(vendor.months).forEach(([month, amount]) => {
                    x = tableLeftX;
                    
                    // Alternating row colors
                    if (Object.keys(vendor.months).indexOf(month) % 2 === 0) {
                        doc.rect(tableLeftX, y, tableWidth, rowHeight).fill(COLORS.lightBg);
                    }

                    doc.fillColor(COLORS.text).fontSize(8);
                    
                    colDefs.forEach(col => {
                        let cellText = '';
                        switch(col.key) {
                            case 'code': cellText = vendor.code; break;
                            case 'name': cellText = vendor.name; break;
                            case 'mes': cellText = month; break;
                            case 'lac': cellText = formatCurrency(amount); break;
                            case 'total': cellText = formatCurrency(vendorTotal); break;
                        }
                        doc.text(cellText, x + 3, y + 3, { width: col.width - 6, align: col.key === 'name' ? 'left' : 'center' });
                        x += col.width;
                    });

                    // Draw borders
                    x = tableLeftX;
                    doc.lineWidth(0.5).strokeColor(COLORS.border);
                    colDefs.forEach(col => {
                        doc.rect(x, y, col.width, rowHeight).stroke();
                        x += col.width;
                    });

                    y += rowHeight;

                    // Check if we need a new page
                    if (y > pageHeight - margin - rowHeight * 5) {
                        doc.addPage();
                        y = margin;
                    }
                });
            });

            // Total row
            doc.rect(tableLeftX, y, tableWidth, headerHeight).fill(COLORS.totalBg);
            doc.fillColor(COLORS.totalText).fontSize(9).text('Total general', tableLeftX + 4, y + 4);
            
            let totalX = tableLeftX + colDefs.slice(0, 3).reduce((s, c) => s + c.width, 0);
            doc.text(formatCurrency(lacTotal), totalX + 3, y + 4, { width: colDefs[3].width - 6, align: 'center' });
            doc.text(formatCurrency(lacTotal), totalX + colDefs[3].width + 3, y + 4, { width: colDefs[4].width - 6, align: 'center' });
            
            x = tableLeftX;
            colDefs.forEach(col => {
                doc.rect(x, y, col.width, headerHeight).strokeColor(COLORS.border).stroke();
                x += col.width;
            });

            // ──────────────────────────────────────────
            // RIGHT TABLE: CONDOR
            // ──────────────────────────────────────────
            const tableRightX = margin + tableWidth + 30;
            const tableRightWidth = contentWidth * 0.3;

            y = margin + headerHeight * 2 + 20;

            // CONDOR header
            doc.fontSize(9).fillColor(COLORS.headerText);
            doc.rect(tableRightX, y, tableRightWidth, headerHeight).fill('#DAA520');
            doc.text('CONDOR', tableRightX + 4, y + 4, { width: tableRightWidth - 8, align: 'left' });

            y += headerHeight;

            // CONDOR column headers
            const condorColDefs = [
                { key: 'vd', label: 'vd', width: 40 },
                { key: 'mes', label: 'Mes', width: 35 },
                { key: 'ejercicio', label: year.toString(), width: 80 },
                { key: 'total', label: 'Total general', width: 100 }
            ];

            x = tableRightX;
            condorColDefs.forEach(col => {
                doc.rect(x, y, col.width, headerHeight).fill(COLORS.header);
                doc.text(col.label, x + 3, y + 4, { width: col.width - 6, align: 'center' });
                x += col.width;
            });

            y += headerHeight;

            // CONDOR data rows
            let condorTotal = 0;
            if (condorData && condorData.length > 0) {
                condorData.forEach(row => {
                    x = tableRightX;
                    
                    if (condorData.indexOf(row) % 2 === 0) {
                        doc.rect(tableRightX, y, tableRightWidth, rowHeight).fill(COLORS.lightBg);
                    }

                    doc.fillColor(COLORS.text).fontSize(8);
                    
                    condorColDefs.forEach(col => {
                        let cellText = '';
                        switch(col.key) {
                            case 'vd': cellText = row.vd || ''; break;
                            case 'mes': cellText = row.mes || ''; break;
                            case 'ejercicio': cellText = formatCurrency(row.importe || 0); break;
                            case 'total': cellText = formatCurrency(row.total || row.importe || 0); break;
                        }
                        doc.text(cellText, x + 3, y + 3, { width: col.width - 6, align: 'center' });
                        x += col.width;
                    });

                    x = tableRightX;
                    doc.lineWidth(0.5).strokeColor(COLORS.border);
                    condorColDefs.forEach(col => {
                        doc.rect(x, y, col.width, rowHeight).stroke();
                        x += col.width;
                    });

                    y += rowHeight;
                });

                // CONDOR total
                condorTotal = condorData.reduce((sum, r) => sum + (r.total || r.importe || 0), 0);
            } else {
                doc.rect(tableRightX, y, tableRightWidth, rowHeight).fill(COLORS.lightBg);
                doc.fillColor(COLORS.mediumGray).fontSize(8).text('Sin datos', tableRightX + 4, y + 3, { width: tableRightWidth - 8, align: 'center' });
                y += rowHeight;
                doc.rect(tableRightX, y - rowHeight, tableRightWidth, rowHeight).strokeColor(COLORS.border).stroke();
            }

            // CONDOR total row
            doc.rect(tableRightX, y, tableRightWidth, headerHeight).fill(COLORS.totalBg);
            doc.fillColor(COLORS.totalText).fontSize(9).text('Total general', tableRightX + 4, y + 4);
            
            let condTotalX = tableRightX + condorColDefs.slice(0, 2).reduce((s, c) => s + c.width, 0);
            doc.text(formatCurrency(condorTotal), condTotalX + 3, y + 4, { width: condorColDefs[2].width - 6, align: 'center' });
            doc.text(formatCurrency(condorTotal), condTotalX + condorColDefs[2].width + 3, y + 4, { width: condorColDefs[3].width - 6, align: 'center' });
            
            x = tableRightX;
            condorColDefs.forEach(col => {
                doc.rect(x, y, col.width, headerHeight).strokeColor(COLORS.border).stroke();
                x += col.width;
            });

            // Footer
            doc.fontSize(8).fillColor(COLORS.mediumGray)
                .text(`Informe de comisiones - ${periodLabel}`, margin, pageHeight - 20, { align: 'left' })
                .text(`Generado por GMP App Movilidad`, pageWidth - margin - 150, pageHeight - 20, { align: 'right' });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN EXPORT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {
    isAuthorized,
    getLacSalesData,
    getCondorSalesData,
    generateCommissionsPdf
};
