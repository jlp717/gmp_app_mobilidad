/**
 * AUDIT: Compare Sales Totals with Different Filters
 * Purpose: Diagnose why Objetivo 2026 shows 15.2M instead of expected 16.7M
 */
const { query } = require('../config/db');

async function main() {
    console.log('========================================');
    console.log('AUDITORÍA DE VENTAS 2025 - FILTROS');
    console.log('========================================\n');

    try {
        // Test 1: Solo excluyendo N, Z (como pide el usuario)
        console.log('--- TEST 1: LCSRAB NOT IN (N, Z) ---');
        const test1 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025
              AND TPDC = 'LAC'
              AND LCTPVT IN ('CC', 'VC')
              AND LCCLLN IN ('AB', 'VT')
              AND LCSRAB NOT IN ('N', 'Z')
        `, false, false);
        console.log('Total 2025 (N,Z excluido):', parseFloat(test1[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');

        // Test 2: Excluyendo N, Z, G, D (filtro actual)
        console.log('\n--- TEST 2: LCSRAB NOT IN (N, Z, G, D) ---');
        const test2 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025
              AND TPDC = 'LAC'
              AND LCTPVT IN ('CC', 'VC')
              AND LCCLLN IN ('AB', 'VT')
              AND LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        `, false, false);
        console.log('Total 2025 (N,Z,G,D excluido):', parseFloat(test2[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');

        // Test 3: Sin filtro LCSRAB
        console.log('\n--- TEST 3: SIN FILTRO LCSRAB ---');
        const test3 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025
              AND TPDC = 'LAC'
              AND LCTPVT IN ('CC', 'VC')
              AND LCCLLN IN ('AB', 'VT')
        `, false, false);
        console.log('Total 2025 (sin filtro LCSRAB):', parseFloat(test3[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');

        // Test 4: Desglose por Serie Albarán
        console.log('\n--- DESGLOSE POR SERIE ALBARAN (LCSRAB) ---');
        const breakdown = await query(`
            SELECT LCSRAB, SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025
              AND TPDC = 'LAC'
              AND LCTPVT IN ('CC', 'VC')
              AND LCCLLN IN ('AB', 'VT')
            GROUP BY LCSRAB
            ORDER BY TOTAL DESC
        `, false, false);

        let grandTotal = 0;
        breakdown.forEach(r => {
            const val = parseFloat(r.TOTAL) || 0;
            grandTotal += val;
            console.log(`  Serie ${r.LCSRAB || '(vacío)'}: ${val.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`);
        });
        console.log(`  TOTAL: ${grandTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`);

        // Test 5: B-Sales
        console.log('\n--- VENTAS B (JAVIER.VENTAS_B) ---');
        const bsales = await query(`
            SELECT SUM(IMPORTE) as TOTAL
            FROM JAVIER.VENTAS_B
            WHERE ANIO = 2025
        `, false, false);
        console.log('Total B-Sales 2025:', parseFloat(bsales[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');

        // RESUMEN FINAL
        const base = parseFloat(test2[0]?.TOTAL || 0);
        const bsalesTotal = parseFloat(bsales[0]?.TOTAL || 0);
        const combined = base + bsalesTotal;
        const ipc = combined * 1.03;
        const growth10 = ipc * 1.10;

        console.log('\n========================================');
        console.log('RESUMEN CÁLCULO OBJETIVO 2026');
        console.log('========================================');
        console.log('Base 2025 (Normal):', base.toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');
        console.log('B-Sales 2025:      ', bsalesTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');
        console.log('TOTAL BASE:        ', combined.toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');
        console.log('+ 3% IPC:          ', ipc.toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');
        console.log('+ 10% Growth:      ', growth10.toLocaleString('es-ES', { minimumFractionDigits: 2 }), '€');
        console.log('========================================\n');

    } catch (err) {
        console.error('ERROR:', err.message);
    }

    process.exit(0);
}

main();
