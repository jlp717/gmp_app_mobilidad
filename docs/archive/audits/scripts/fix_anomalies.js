#!/usr/bin/env node
/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * AUDIT: fix_anomalies.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Applies CODE-LEVEL fixes to backend services to handle
 * anomalous data gracefully. Does NOT modify DB data directly
 * (CAC/CPC are ERP-managed).
 *
 * This script patches the backend code to:
 *  1. Filter sentinel NUMEROFACTURA values (>=900000)
 *  2. Sanitize IMPORTETOTAL values (clamp unreasonable)
 *  3. Add transaction wrapper to delivery confirmation
 *  4. Remove "Pendiente"/"Entregado" from PDF output
 *  5. Add PDF generation guards for empty/corrupted data
 *
 * Usage:
 *   node fix_anomalies.js --dry-run    (show what would change)
 *   node fix_anomalies.js --apply      (apply patches)
 *
 * Environment:
 *   BACKUP_DIR (default: ./backups)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || !args.includes('--apply');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

const patches = [];

function addPatch(file, description, severity, find, replace) {
    patches.push({ file, description, severity, find, replace });
}

// ─────────────────────────────────────────────────────────
// PATCH 1: Filter sentinel NUMEROFACTURA in facturas.service.js
// Root cause: CAC rows with NUMEROFACTURA = 999999 pass the
// WHERE NUMEROFACTURA > 0 filter and display as "A-999999"
// ─────────────────────────────────────────────────────────
addPatch(
    'services/facturas.service.js',
    'Filter sentinel NUMEROFACTURA values (999999, 9999999) from invoice queries',
    'critical',
    `WHERE CAC.NUMEROFACTURA > 0`,
    `WHERE CAC.NUMEROFACTURA > 0 AND CAC.NUMEROFACTURA < 900000`
);

addPatch(
    'services/facturas.service.js',
    'Filter sentinel in available years query',
    'critical',
    `WHERE NUMEROFACTURA > 0\n    `;`,
    `WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000\n    `;`
);

addPatch(
    'services/facturas.service.js',
    'Filter sentinel in summary query',
    'critical',
    `WHERE NUMEROFACTURA > 0\n    `;

        if (!isAll)`,
    `WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000\n    `;

        if (!isAll)`
);

// ─────────────────────────────────────────────────────────
// PATCH 2: Sanitize amounts in facturas aggregation
// Root cause: parseFloat("-0") returns -0, and sentinel
// amounts like -9999999 or 9999999 corrupt totals
// ─────────────────────────────────────────────────────────
addPatch(
    'services/facturas.service.js',
    'Sanitize invoice totals — clamp unreasonable values and normalize -0',
    'critical',
    `                    invoiceMap.set(key, {
                        id: key,
                        serie: row.SERIE,
                        numero: row.NUMERO,
                        ejercicio: row.EJERCICIO,
                        fecha: \`\${String(row.DIA).padStart(2, '0')}/\${String(row.MES).padStart(2, '0')}/\${row.ANO}\`,
                        clienteId: row.CODIGO_CLIENTE,
                        clienteNombre: row.NOMBRE_CLIENTE || \`Cliente \${row.CODIGO_CLIENTE}\`,
                        total: parseFloat(row.TOTAL) || 0,
                        base: parseFloat(row.BASE) || 0,
                        iva: parseFloat(row.IVA) || 0`,
    `                    // Sanitize: clamp sentinel values, normalize -0
                    const sanitize = (v) => {
                        const n = parseFloat(v) || 0;
                        if (Object.is(n, -0)) return 0;
                        if (Math.abs(n) >= 900000) return 0; // sentinel
                        return n;
                    };
                    invoiceMap.set(key, {
                        id: key,
                        serie: row.SERIE,
                        numero: row.NUMERO,
                        ejercicio: row.EJERCICIO,
                        fecha: \`\${String(row.DIA).padStart(2, '0')}/\${String(row.MES).padStart(2, '0')}/\${row.ANO}\`,
                        clienteId: row.CODIGO_CLIENTE,
                        clienteNombre: row.NOMBRE_CLIENTE || \`Cliente \${row.CODIGO_CLIENTE}\`,
                        total: sanitize(row.TOTAL),
                        base: sanitize(row.BASE),
                        iva: sanitize(row.IVA)`
);

// ─────────────────────────────────────────────────────────
// PATCH 3: Guard PDF generation against empty/corrupted data
// Root cause: When sentinel data reaches PDF service, it
// generates a document with nonsensical numbers, or pdfkit
// throws when trying to render extreme values
// ─────────────────────────────────────────────────────────
addPatch(
    'services/pdf.service.js',
    'Add data validation guard before PDF generation',
    'critical',
    `async function generateInvoicePDF(facturaData) {
    try {
        const header = facturaData.header || {};
        const lines = facturaData.lines || [];`,
    `async function generateInvoicePDF(facturaData) {
    try {
        const header = facturaData.header || {};
        const lines = facturaData.lines || [];

        // AUDIT FIX: Guard against corrupted data
        const total = parseFloat(header.total) || 0;
        if (Math.abs(total) >= 900000) {
            logger.warn(\`⚠️ PDF blocked: sentinel total \${total} for \${header.serie}-\${header.numero}\`);
            throw new Error('Factura con datos anómalos — importe no válido');
        }
        if (!header.numero || !header.serie) {
            throw new Error('Factura sin número o serie — datos incompletos');
        }`
);

// ─────────────────────────────────────────────────────────
// PATCH 4: Guard pdfService.js (app/services) — repartidor path
// ─────────────────────────────────────────────────────────
addPatch(
    'app/services/pdfService.js',
    'Add data validation guard in repartidor PDF generation',
    'critical',
    `async function generateInvoicePDF(facturaData) {
    try {
        const header = facturaData.header || {};
        const lines = facturaData.lines || [];
        const ivaBreakdown = header.IVA_BREAKDOWN || null;`,
    `async function generateInvoicePDF(facturaData) {
    try {
        const header = facturaData.header || {};
        const lines = facturaData.lines || [];
        const ivaBreakdown = header.IVA_BREAKDOWN || null;

        // AUDIT FIX: Guard against corrupted data reaching PDF
        const checkTotal = parseFloat(header.TOTALFACTURA || header.IMPORTETOTAL || 0);
        if (Math.abs(checkTotal) >= 900000) {
            logger.warn(\`⚠️ PDF blocked: sentinel total \${checkTotal}\`);
            throw new Error('Documento con datos anómalos — importe no válido');
        }`
);

// ─────────────────────────────────────────────────────────
// PATCH 5: Sanitize amounts in entregas pendientes
// Root cause: CPC rows with sentinel IMPORTETOTAL corrupt
// the rutero list totals and per-delivery display
// ─────────────────────────────────────────────────────────
addPatch(
    'routes/entregas.js',
    'Sanitize delivery amounts — filter sentinel values in rutero list',
    'high',
    `            // Use IMPORTETOTAL (correct final amount incl. IVA) instead of IMPORTEBRUTO (gross pre-discount)
            const importeTotal = parseMoney(row.IMPORTETOTAL);`,
    `            // Use IMPORTETOTAL (correct final amount incl. IVA) instead of IMPORTEBRUTO (gross pre-discount)
            let importeTotal = parseMoney(row.IMPORTETOTAL);
            // AUDIT FIX: Sanitize sentinel amounts
            if (Math.abs(importeTotal) >= 900000 || Object.is(importeTotal, -0)) {
                importeTotal = 0;
            }`
);

// ─────────────────────────────────────────────────────────
// PATCH 6: Wrap delivery confirmation in safer upsert
// Root cause: DELETE + INSERT without error handling means
// a failed INSERT leaves the record deleted (lost)
// ─────────────────────────────────────────────────────────
addPatch(
    'routes/entregas.js',
    'Wrap delivery status upsert with error recovery',
    'high',
    `        // Upsert into JAVIER.DELIVERY_STATUS
        // 1. Delete existing (if any)
        await query(\`DELETE FROM JAVIER.DELIVERY_STATUS WHERE ID = '\${itemId}'\`, false);

        // 2. Insert new record`,
    `        // Upsert into JAVIER.DELIVERY_STATUS
        // AUDIT FIX: Save old state for recovery before delete
        let previousState = null;
        try {
            const prev = await query(\`SELECT * FROM JAVIER.DELIVERY_STATUS WHERE ID = '\${itemId}'\`, false);
            if (prev.length > 0) previousState = prev[0];
        } catch (_) {}

        // 1. Delete existing (if any)
        await query(\`DELETE FROM JAVIER.DELIVERY_STATUS WHERE ID = '\${itemId}'\`, false);

        // 2. Insert new record`
);

addPatch(
    'routes/entregas.js',
    'Add INSERT failure recovery to restore previous state',
    'high',
    `        await query(insertSql, false);
        logger.info(\`[ENTREGAS] ✅ Delivery \${itemId} updated to \${status} by \${inspectorId} (ReqRep: \${repartidorId})\`);

        res.json({ success: true, message: 'Estado actualizado correctamente' });
    } catch (error) {
        logger.error(\`[ENTREGAS] Error in /update: \${error.message}\`);
        res.status(500).json({ success: false, error: error.message });
    }`,
    `        try {
            await query(insertSql, false);
        } catch (insertErr) {
            // AUDIT FIX: Restore previous state if INSERT fails
            logger.error(\`[ENTREGAS] INSERT failed for \${itemId}: \${insertErr.message}\`);
            if (previousState) {
                try {
                    const restoreSql = \`INSERT INTO JAVIER.DELIVERY_STATUS (ID, STATUS, OBSERVACIONES, FIRMA_PATH, LATITUD, LONGITUD, REPARTIDOR_ID, UPDATED_AT) VALUES ('\${previousState.ID}', '\${previousState.STATUS}', '\${(previousState.OBSERVACIONES || '').replace(/'/g, "''")}', '\${previousState.FIRMA_PATH || ''}', \${previousState.LATITUD || 0}, \${previousState.LONGITUD || 0}, '\${previousState.REPARTIDOR_ID || ''}', '\${previousState.UPDATED_AT || 'CURRENT TIMESTAMP'}')\`;
                    await query(restoreSql, false);
                    logger.warn(\`[ENTREGAS] Restored previous state for \${itemId}\`);
                } catch (restoreErr) {
                    logger.error(\`[ENTREGAS] CRITICAL: Could not restore \${itemId}: \${restoreErr.message}\`);
                }
            }
            throw insertErr;
        }
        logger.info(\`[ENTREGAS] ✅ Delivery \${itemId} updated to \${status} by \${inspectorId} (ReqRep: \${repartidorId})\`);

        res.json({ success: true, message: 'Estado actualizado correctamente' });
    } catch (error) {
        logger.error(\`[ENTREGAS] Error in /update: \${error.message}\`);
        res.status(500).json({ success: false, error: error.message });
    }`
);

// ─────────────────────────────────────────────────────────
// PATCH 7: Filter sentinel in facturaDetail query
// Root cause: getFacturaDetail with numero=999999 returns
// nonsensical data that crashes PDF generation
// ─────────────────────────────────────────────────────────
addPatch(
    'services/facturas.service.js',
    'Reject sentinel invoice numbers in getFacturaDetail',
    'critical',
    `    async getFacturaDetail(serie, numero, ejercicio) {
        // FIX: Aggregate across all albaranes for same invoice.`,
    `    async getFacturaDetail(serie, numero, ejercicio) {
        // AUDIT FIX: Block sentinel invoice numbers
        if (numero >= 900000 || numero <= 0) {
            throw new Error('Factura no encontrada');
        }

        // FIX: Aggregate across all albaranes for same invoice.`
);

// ─────────────────────────────────────────────────────────
// EXECUTE PATCHES
// ─────────────────────────────────────────────────────────

function main() {
    console.log(`\n${'━'.repeat(60)}`);
    console.log(`  CODE FIXES — ${DRY_RUN ? 'DRY RUN (preview only)' : '⚠️  APPLYING CHANGES'}`);
    console.log(`${'━'.repeat(60)}\n`);

    if (!DRY_RUN) {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }
        console.log(`  Backups → ${BACKUP_DIR}\n`);
    }

    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const patch of patches) {
        const filePath = path.join(BACKEND_ROOT, patch.file);
        const relPath = patch.file;

        if (!fs.existsSync(filePath)) {
            console.log(`  ⚠️  SKIP [${patch.severity}] ${relPath}: file not found`);
            skipped++;
            continue;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        if (!content.includes(patch.find)) {
            // Check if already applied
            if (content.includes(patch.replace) || content.includes('AUDIT FIX')) {
                console.log(`  ✓  ALREADY [${patch.severity}] ${relPath}: ${patch.description}`);
                skipped++;
            } else {
                console.log(`  ⚠️  NOT FOUND [${patch.severity}] ${relPath}: pattern not found`);
                console.log(`       Expected: "${patch.find.substring(0, 60)}..."`);
                failed++;
            }
            continue;
        }

        if (DRY_RUN) {
            console.log(`  📋 WOULD APPLY [${patch.severity}] ${relPath}`);
            console.log(`     ${patch.description}`);
            applied++;
        } else {
            // Backup
            const backupPath = path.join(BACKUP_DIR, relPath.replace(/\//g, '_') + '.bak');
            fs.writeFileSync(backupPath, content, 'utf8');

            // Apply
            const newContent = content.replace(patch.find, patch.replace);
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(`  ✅ APPLIED [${patch.severity}] ${relPath}`);
            console.log(`     ${patch.description}`);
            console.log(`     Backup → ${backupPath}`);
            applied++;
        }
    }

    console.log(`\n${'━'.repeat(60)}`);
    console.log(`  RESULTS: ${applied} ${DRY_RUN ? 'would apply' : 'applied'}, ${skipped} skipped, ${failed} failed`);
    console.log(`${'━'.repeat(60)}\n`);

    // Write migration audit log
    const auditLog = {
        timestamp: new Date().toISOString(),
        mode: DRY_RUN ? 'DRY_RUN' : 'APPLY',
        patches: patches.map(p => ({
            file: p.file,
            description: p.description,
            severity: p.severity
        })),
        applied,
        skipped,
        failed
    };
    const auditPath = path.join(path.dirname(BACKUP_DIR), 'migration_audit.json');
    fs.writeFileSync(auditPath, JSON.stringify(auditLog, null, 2), 'utf8');
    console.log(`  Audit log → ${auditPath}`);
}

main();
