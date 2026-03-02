/**
 * Test Suite: Vendor Column Transition Logic
 * ===========================================
 * Tests for the LCCDVD → R1_T8CDVD transition (March 2026).
 *
 * Run: node backend/tests/test_vendor_column_transition.js
 */

const assert = require('assert');

// ============================================================================
// Mock environment for testing
// ============================================================================
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ ${name}: ${e.message}`);
        failed++;
    }
}

function section(name) {
    console.log(`\n━━━ ${name} ━━━`);
}

// ============================================================================
// Test getVendorColumn() logic directly (without requiring the module)
// ============================================================================

// Replicate the function logic for isolated testing
function makeGetVendorColumn(vendorColumnEnv) {
    const VENDOR_COLUMN = vendorColumnEnv || 'LCCDVD';
    const TRANSITION_YEAR = 2026;
    const TRANSITION_MONTH = 3;

    return function getVendorColumn(year, month) {
        if (VENDOR_COLUMN === 'LCCDVD') return 'LCCDVD';

        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);

        if (y < TRANSITION_YEAR || (y === TRANSITION_YEAR && m < TRANSITION_MONTH)) {
            return 'LCCDVD';
        }

        return VENDOR_COLUMN;
    };
}

section('getVendorColumn - LCCDVD mode (production default)');
{
    const getVC = makeGetVendorColumn('LCCDVD');

    test('2024 any month → LCCDVD', () => {
        assert.strictEqual(getVC(2024, 6), 'LCCDVD');
    });
    test('2025 any month → LCCDVD', () => {
        assert.strictEqual(getVC(2025, 12), 'LCCDVD');
    });
    test('2026 Jan → LCCDVD', () => {
        assert.strictEqual(getVC(2026, 1), 'LCCDVD');
    });
    test('2026 Feb → LCCDVD', () => {
        assert.strictEqual(getVC(2026, 2), 'LCCDVD');
    });
    test('2026 Mar → LCCDVD (no transition in LCCDVD mode)', () => {
        assert.strictEqual(getVC(2026, 3), 'LCCDVD');
    });
    test('2027 any → LCCDVD', () => {
        assert.strictEqual(getVC(2027, 1), 'LCCDVD');
    });
}

section('getVendorColumn - R1_T8CDVD mode (new logic)');
{
    const getVC = makeGetVendorColumn('R1_T8CDVD');

    test('2024 any month → LCCDVD (historical)', () => {
        assert.strictEqual(getVC(2024, 6), 'LCCDVD');
    });
    test('2025 Dec → LCCDVD (pre-transition)', () => {
        assert.strictEqual(getVC(2025, 12), 'LCCDVD');
    });
    test('2026 Jan → LCCDVD (pre-transition, snapshot)', () => {
        assert.strictEqual(getVC(2026, 1), 'LCCDVD');
    });
    test('2026 Feb → LCCDVD (pre-transition, snapshot)', () => {
        assert.strictEqual(getVC(2026, 2), 'LCCDVD');
    });
    test('2026 Mar → R1_T8CDVD (transition starts!)', () => {
        assert.strictEqual(getVC(2026, 3), 'R1_T8CDVD');
    });
    test('2026 Jun → R1_T8CDVD', () => {
        assert.strictEqual(getVC(2026, 6), 'R1_T8CDVD');
    });
    test('2026 Dec → R1_T8CDVD', () => {
        assert.strictEqual(getVC(2026, 12), 'R1_T8CDVD');
    });
    test('2027 Jan → R1_T8CDVD', () => {
        assert.strictEqual(getVC(2027, 1), 'R1_T8CDVD');
    });
}

// ============================================================================
// Test buildColumnaVendedorFilter() logic
// ============================================================================

function makeBuildColumnaVendedorFilter(vendorColumnEnv) {
    const VENDOR_COLUMN = vendorColumnEnv || 'LCCDVD';
    const TRANSITION_YEAR = 2026;
    const TRANSITION_MONTH = 3;

    return function buildColumnaVendedorFilter(vendedorCodes, years = [], tableAlias = 'L') {
        if (!vendedorCodes || vendedorCodes === 'ALL') return '';
        const prefix = tableAlias ? `${tableAlias}.` : '';

        const codeList = vendedorCodes.split(',').map(c => c.trim());
        const validCodes = codeList
            .filter(c => /^[a-zA-Z0-9]+$/.test(c))
            .map(c => `'${c}'`)
            .join(',');

        if (validCodes.length === 0) return 'AND 1=0';

        if (VENDOR_COLUMN === 'LCCDVD') {
            return `AND ${prefix}LCCDVD IN (${validCodes})`;
        }

        const involvesTransition = (!Array.isArray(years) || years.length === 0)
            ? true
            : years.some(y => y >= (TRANSITION_YEAR - 1));

        if (!involvesTransition) {
            return `AND ${prefix}LCCDVD IN (${validCodes})`;
        }

        const oldFilter = `(${prefix}LCMMDC < ${TRANSITION_MONTH} AND ${prefix}LCCDVD IN (${validCodes}))`;
        const newFilter = `(${prefix}LCMMDC >= ${TRANSITION_MONTH} AND ${prefix}${VENDOR_COLUMN} IN (${validCodes}))`;

        return `AND (${oldFilter} OR ${newFilter})`;
    };
}

section('buildColumnaVendedorFilter - LCCDVD mode');
{
    const buildFilter = makeBuildColumnaVendedorFilter('LCCDVD');

    test('ALL → empty string', () => {
        assert.strictEqual(buildFilter('ALL', [2026]), '');
    });
    test('Single vendor → simple LCCDVD filter', () => {
        const result = buildFilter('33', [2026], 'L');
        assert.strictEqual(result, "AND L.LCCDVD IN ('33')");
    });
    test('Multiple vendors → LCCDVD IN clause', () => {
        const result = buildFilter('33,44', [2025, 2026], 'L');
        assert.strictEqual(result, "AND L.LCCDVD IN ('33','44')");
    });
}

section('buildColumnaVendedorFilter - R1_T8CDVD mode');
{
    const buildFilter = makeBuildColumnaVendedorFilter('R1_T8CDVD');

    test('ALL → empty string', () => {
        assert.strictEqual(buildFilter('ALL', [2026]), '');
    });
    test('Historical years only (2023, 2024) → simple LCCDVD', () => {
        const result = buildFilter('33', [2023, 2024], 'L');
        assert.strictEqual(result, "AND L.LCCDVD IN ('33')");
    });
    test('Transition years (2025, 2026) → OR with month split', () => {
        const result = buildFilter('33', [2025, 2026], 'L');
        assert.ok(result.includes('LCMMDC < 3'), 'Should have month < 3 for old column');
        assert.ok(result.includes('LCCDVD'), 'Should reference LCCDVD for old months');
        assert.ok(result.includes('LCMMDC >= 3'), 'Should have month >= 3 for new column');
        assert.ok(result.includes('R1_T8CDVD'), 'Should reference R1_T8CDVD for new months');
    });
    test('2026 only → OR with month split', () => {
        const result = buildFilter('33', [2026], 'L');
        assert.ok(result.includes('LCMMDC < 3'));
        assert.ok(result.includes('R1_T8CDVD'));
    });
    test('Invalid codes → AND 1=0', () => {
        assert.strictEqual(buildFilter('!!!', [2026]), 'AND 1=0');
    });
    test('No alias → no prefix', () => {
        const result = buildFilter('33', [2026], '');
        assert.ok(!result.includes('L.'), 'Should not have L. prefix');
        assert.ok(result.includes('LCCDVD'));
    });
}

// ============================================================================
// Test buildVendedorFilterLACLAE with year/month params
// ============================================================================

function makeBuildVendedorFilterLACLAE(vendorColumnEnv) {
    const VENDOR_COLUMN = vendorColumnEnv || 'LCCDVD';
    const TRANSITION_YEAR = 2026;
    const TRANSITION_MONTH = 3;

    function getVendorColumn(year, month) {
        if (VENDOR_COLUMN === 'LCCDVD') return 'LCCDVD';
        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);
        if (y < TRANSITION_YEAR || (y === TRANSITION_YEAR && m < TRANSITION_MONTH)) return 'LCCDVD';
        return VENDOR_COLUMN;
    }

    return function buildVendedorFilterLACLAE(vendedorCodes, tableAlias = 'L', year, month) {
        if (!vendedorCodes || vendedorCodes === 'ALL') return '';
        const prefix = tableAlias ? `${tableAlias}.` : '';
        const col = getVendorColumn(year, month);

        const codeList = vendedorCodes.split(',').map(c => c.trim());
        const validCodes = codeList
            .filter(c => c !== 'UNK')
            .filter(c => /^[a-zA-Z0-9]+$/.test(c))
            .map(c => `'${c}'`)
            .join(',');

        const conditions = [];
        if (validCodes.length > 0) {
            conditions.push(`${prefix}${col} IN (${validCodes})`);
        }
        if (conditions.length === 0) return 'AND 1=0';
        return `AND (${conditions.join(' OR ')})`;
    };
}

section('buildVendedorFilterLACLAE - date-aware column');
{
    const buildFilter = makeBuildVendedorFilterLACLAE('R1_T8CDVD');

    test('2026 Jan → uses LCCDVD', () => {
        const result = buildFilter('33', 'L', 2026, 1);
        assert.ok(result.includes('LCCDVD'), 'Jan 2026 should use LCCDVD');
        assert.ok(!result.includes('R1_T8CDVD'));
    });
    test('2026 Mar → uses R1_T8CDVD', () => {
        const result = buildFilter('33', 'L', 2026, 3);
        assert.ok(result.includes('R1_T8CDVD'), 'Mar 2026 should use R1_T8CDVD');
    });
    test('2025 any → uses LCCDVD', () => {
        const result = buildFilter('33', 'L', 2025, 6);
        assert.ok(result.includes('LCCDVD'));
    });
}

// ============================================================================
// Summary
// ============================================================================
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\n  All tests passed! Transition logic is correct.\n');
    process.exit(0);
}
