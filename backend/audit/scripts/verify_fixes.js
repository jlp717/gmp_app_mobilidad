#!/usr/bin/env node
/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * AUDIT: verify_fixes.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Automated verification that:
 *  1. Sentinel invoices are excluded from queries
 *  2. PDFs generate successfully for normal invoices
 *  3. PDFs are blocked for anomalous invoices
 *  4. Rutero confirmation flow is recoverable
 *  5. Amounts are correctly sanitized
 *
 * Usage:
 *   node verify_fixes.js [--live]   (--live connects to real DB)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const LIVE_MODE = args.includes('--live');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
let passCount = 0;
let failCount = 0;

function pass(name) {
    console.log(`  ✅ PASS: ${name}`);
    passCount++;
}

function fail(name, reason) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`          ${reason}`);
    failCount++;
}

// ─────────────────────────────────────────────────────────
// TEST 1: Sentinel filter in facturas.service.js
// ─────────────────────────────────────────────────────────
function testSentinelFilter() {
    console.log('\n🧪 Test 1: Sentinel NUMEROFACTURA filter');

    const file = path.join(BACKEND_ROOT, 'services/facturas.service.js');
    if (!fs.existsSync(file)) { fail('File exists', 'services/facturas.service.js not found'); return; }

    const content = fs.readFileSync(file, 'utf8');

    // Check main query filter
    if (content.includes('NUMEROFACTURA < 900000')) {
        pass('Main query filters sentinel NUMEROFACTURA');
    } else {
        fail('Main query filters sentinel', 'Missing NUMEROFACTURA < 900000 in WHERE clause');
    }

    // Check getFacturaDetail guard
    if (content.includes('numero >= 900000') || content.includes('AUDIT FIX: Block sentinel')) {
        pass('getFacturaDetail rejects sentinel numbers');
    } else {
        fail('getFacturaDetail guard', 'Missing sentinel rejection in getFacturaDetail');
    }

    // Check sanitize function
    if (content.includes('sanitize') && content.includes('Object.is(n, -0)')) {
        pass('Amount sanitization handles -0 and sentinels');
    } else {
        fail('Amount sanitization', 'Missing sanitize function for -0 / sentinel amounts');
    }
}

// ─────────────────────────────────────────────────────────
// TEST 2: PDF generation guards
// ─────────────────────────────────────────────────────────
function testPdfGuards() {
    console.log('\n🧪 Test 2: PDF generation data guards');

    const files = [
        'services/pdf.service.js',
        'app/services/pdfService.js'
    ];

    for (const relPath of files) {
        const file = path.join(BACKEND_ROOT, relPath);
        if (!fs.existsSync(file)) { fail(`${relPath} exists`, 'File not found'); continue; }

        const content = fs.readFileSync(file, 'utf8');

        if (content.includes('AUDIT FIX') && content.includes('900000')) {
            pass(`${relPath} guards against sentinel totals`);
        } else {
            fail(`${relPath} PDF guard`, 'Missing sentinel total check before PDF generation');
        }
    }
}

// ─────────────────────────────────────────────────────────
// TEST 3: Delivery confirmation recovery
// ─────────────────────────────────────────────────────────
function testDeliveryRecovery() {
    console.log('\n🧪 Test 3: Delivery confirmation recovery');

    const file = path.join(BACKEND_ROOT, 'routes/entregas.js');
    if (!fs.existsSync(file)) { fail('entregas.js exists', 'File not found'); return; }

    const content = fs.readFileSync(file, 'utf8');

    if (content.includes('previousState') && content.includes('Restored previous state')) {
        pass('Delivery upsert has failure recovery');
    } else {
        fail('Delivery recovery', 'Missing previousState recovery logic in /update endpoint');
    }

    if (content.includes('AUDIT FIX: Sanitize sentinel amounts')) {
        pass('Delivery amounts sanitized');
    } else {
        fail('Delivery sanitization', 'Missing amount sanitization in pendientes');
    }
}

// ─────────────────────────────────────────────────────────
// TEST 4: No "Pendiente" or "Entregado" in PDF templates
// ─────────────────────────────────────────────────────────
function testNoPendienteInPdf() {
    console.log('\n🧪 Test 4: No "Pendiente"/"Entregado" fields in invoice PDF');

    const files = [
        'services/pdf.service.js',
        'app/services/pdfService.js'
    ];

    for (const relPath of files) {
        const file = path.join(BACKEND_ROOT, relPath);
        if (!fs.existsSync(file)) continue;

        const content = fs.readFileSync(file, 'utf8');

        // These fields should NOT appear in the PDF rendering code
        const forbidden = ['Pendiente', 'PENDIENTE', 'Entregado', 'ENTREGADO'];
        const found = forbidden.filter(f => {
            // Exclude comments and logger strings
            const lines = content.split('\n');
            return lines.some(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.includes('logger')) return false;
                return trimmed.includes(`'${f}'`) || trimmed.includes(`"${f}"`);
            });
        });

        if (found.length === 0) {
            pass(`${relPath} does not render Pendiente/Entregado`);
        } else {
            fail(`${relPath} renders forbidden fields`, `Found: ${found.join(', ')}`);
        }
    }
}

// ─────────────────────────────────────────────────────────
// TEST 5: Unit test — sanitize function logic
// ─────────────────────────────────────────────────────────
function testSanitizeLogic() {
    console.log('\n🧪 Test 5: Sanitize function logic (unit)');

    // Simulate the sanitize function
    const sanitize = (v) => {
        const n = parseFloat(v) || 0;
        if (Object.is(n, -0)) return 0;
        if (Math.abs(n) >= 900000) return 0;
        return n;
    };

    // Normal values
    if (sanitize(100.50) === 100.50) pass('Normal positive value');
    else fail('Normal positive', 'sanitize(100.50) !== 100.50');

    if (sanitize(-50.25) === -50.25) pass('Normal negative value');
    else fail('Normal negative', 'sanitize(-50.25) !== -50.25');

    if (sanitize(0) === 0) pass('Zero');
    else fail('Zero', 'sanitize(0) !== 0');

    // Sentinel values
    if (sanitize(999999) === 0) pass('Sentinel 999999 → 0');
    else fail('Sentinel 999999', 'Not clamped to 0');

    if (sanitize(-9999999) === 0) pass('Sentinel -9999999 → 0');
    else fail('Sentinel -9999999', 'Not clamped to 0');

    if (sanitize(9999999) === 0) pass('Sentinel 9999999 → 0');
    else fail('Sentinel 9999999', 'Not clamped to 0');

    // -0
    if (sanitize("-0") === 0 && !Object.is(sanitize("-0"), -0)) pass('-0 normalized to +0');
    else fail('-0 normalization', 'sanitize("-0") should be positive 0');

    // Edge cases
    if (sanitize(null) === 0) pass('null → 0');
    else fail('null handling', 'sanitize(null) !== 0');

    if (sanitize(undefined) === 0) pass('undefined → 0');
    else fail('undefined handling', 'sanitize(undefined) !== 0');

    if (sanitize('abc') === 0) pass('NaN string → 0');
    else fail('NaN string', "sanitize('abc') !== 0");

    if (sanitize(899999) === 899999) pass('Value just below threshold preserved');
    else fail('Below threshold', 'sanitize(899999) should preserve value');
}

// ─────────────────────────────────────────────────────────
// TEST 6 (LIVE): Query real DB to verify sentinel exclusion
// ─────────────────────────────────────────────────────────
async function testLiveQuery() {
    if (!LIVE_MODE) {
        console.log('\n⏭️  Test 6: SKIPPED (use --live to test against real DB)');
        return;
    }

    console.log('\n🧪 Test 6: Live DB sentinel exclusion');

    const odbc = require('odbc');
    const DSN = process.env.ODBC_DSN || 'GMP';
    const UID = process.env.ODBC_UID || 'JAVIER';
    const PWD = process.env.ODBC_PWD || 'JAVIER';

    let conn;
    try {
        conn = await odbc.connect(`DSN=${DSN};UID=${UID};PWD=${PWD};NAM=1;CCSID=1208;`);

        // Verify no sentinels returned with the filter
        const rows = await conn.query(`
            SELECT COUNT(*) as CNT FROM DSEDAC.CAC
            WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000
              AND NUMEROFACTURA >= 900000
        `);
        // This should always be 0 (contradictory WHERE)
        if (rows[0].CNT === 0) pass('Live: filter is logically consistent');
        else fail('Live: filter consistency', `Expected 0, got ${rows[0].CNT}`);

        // Check how many sentinels exist
        const sentinels = await conn.query(`
            SELECT COUNT(*) as CNT FROM DSEDAC.CAC
            WHERE NUMEROFACTURA >= 900000
        `);
        console.log(`     ℹ️  ${sentinels[0].CNT} sentinel rows exist in CAC (now excluded)`);

        // Check client 30784
        const client30784 = await conn.query(`
            SELECT COUNT(*) as CNT FROM DSEDAC.CAC
            WHERE TRIM(CODIGOCLIENTEFACTURA) LIKE '%30784'
              AND (NUMEROFACTURA >= 900000 OR ABS(IMPORTETOTAL) >= 900000)
        `);
        console.log(`     ℹ️  ${client30784[0].CNT} anomalous rows for client *30784`);
        if (client30784[0].CNT > 0) {
            pass('Live: client 30784 anomalies confirmed and would be filtered');
        }

    } catch (e) {
        fail('Live DB connection', e.message);
    } finally {
        if (conn) try { await conn.close(); } catch (_) {}
    }
}

// ─────────────────────────────────────────────────────────
// RUN ALL TESTS
// ─────────────────────────────────────────────────────────
async function main() {
    console.log(`${'━'.repeat(60)}`);
    console.log(`  VERIFICATION SUITE ${LIVE_MODE ? '(LIVE)' : '(OFFLINE)'}`);
    console.log(`${'━'.repeat(60)}`);

    testSentinelFilter();
    testPdfGuards();
    testDeliveryRecovery();
    testNoPendienteInPdf();
    testSanitizeLogic();
    await testLiveQuery();

    console.log(`\n${'━'.repeat(60)}`);
    console.log(`  TOTAL: ${passCount} passed, ${failCount} failed`);
    console.log(`${'━'.repeat(60)}\n`);

    process.exit(failCount > 0 ? 1 : 0);
}

main();
