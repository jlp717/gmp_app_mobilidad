/**
 * check-vendor-05.js
 * ──────────────────────────────────────────────────────────────────────────
 * Smoke test: verifica el comportamiento de comisiones para el comercial 05
 * en Enero y Febrero 2026, antes y después del fix del snapshot.
 *
 * Uso (en producción vía Putty):
 *   cd /path/to/backend
 *   node scripts/check-vendor-05.js
 *
 * Requiere: DSN=GMP disponible, VENDOR_COLUMN=R1_T8CDVD en entorno
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { queryWithParams } = require('../config/db');
const { getVendorColumnExpr, SNAPSHOT_UNTIL_MONTH } = require('../utils/common');

const VENDOR = '05';
const YEAR = 2026;

async function run() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(' CHECK VENDEDOR 05 — Ene/Feb 2026 (post-fix smoke test)');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`SNAPSHOT_UNTIL_MONTH = ${SNAPSHOT_UNTIL_MONTH}`);
    console.log(`VENDOR_COLUMN = ${process.env.VENDOR_COLUMN || 'LCCDVD (default)'}\n`);

    // ── 1. Ventas LACLAE con LCCDVD (correcto) ──────────────────────────────
    console.log('── 1. Ventas LACLAE Ene/Feb 2026 usando LCCDVD (correcto) ──');
    try {
        const lacRows = await queryWithParams(`
            SELECT L.LCMMDC as MES, SUM(L.LCIMVT) as VENTAS
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ?
              AND L.LCMMDC IN (1, 2)
              AND L.TPDC = 'LAC'
              AND L.LCTPVT IN ('CC', 'VC')
              AND L.LCCLLN IN ('AB', 'VT')
              AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
              AND TRIM(L.LCCDVD) = ?
            GROUP BY L.LCMMDC
            ORDER BY L.LCMMDC
        `, [YEAR, VENDOR], false);

        if (lacRows.length === 0) {
            console.log('  → Sin ventas con LCCDVD para vendedor 05 en Ene/Feb 2026.');
            console.log('  → ESPERADO si vendedor 05 no vendió nada con su código antiguo.\n');
        } else {
            lacRows.forEach(r => {
                console.log(`  Mes ${r.MES}: ${parseFloat(r.VENTAS).toFixed(2)} €`);
            });
        }
    } catch (e) {
        console.error('  ERROR:', e.message);
    }

    // ── 2. Ventas LACLAE con R1_T8CDVD (incorrecto para Ene/Feb) ────────────
    console.log('\n── 2. Ventas LACLAE Ene/Feb 2026 usando R1_T8CDVD (BUG si env=R1_T8CDVD) ──');
    try {
        const lacBugRows = await queryWithParams(`
            SELECT L.LCMMDC as MES, SUM(L.LCIMVT) as VENTAS
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ?
              AND L.LCMMDC IN (1, 2)
              AND L.TPDC = 'LAC'
              AND L.LCTPVT IN ('CC', 'VC')
              AND L.LCCLLN IN ('AB', 'VT')
              AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
              AND TRIM(L.R1_T8CDVD) = ?
            GROUP BY L.LCMMDC
            ORDER BY L.LCMMDC
        `, [YEAR, VENDOR], false);

        if (lacBugRows.length === 0) {
            console.log('  → Sin ventas con R1_T8CDVD. OK si vendedor 05 no tiene clientes asignados.');
        } else {
            lacBugRows.forEach(r => {
                console.log(`  Mes ${r.MES}: ${parseFloat(r.VENTAS).toFixed(2)} € ← ESTO era la comisión falsa`);
            });
        }
    } catch (e) {
        console.error('  ERROR (R1_T8CDVD puede no existir en LACLAE):', e.message);
    }

    // ── 3. Snapshot autoritativo ─────────────────────────────────────────────
    console.log('\n── 3. COMMISSION_SNAPSHOT_2026_0102 (fuente de verdad) ──');
    try {
        const snapRows = await queryWithParams(`
            SELECT TRIM(VENDEDOR_CODIGO) as VENDEDOR_CODIGO, MES, VENTAS_REAL,
                   OBJETIVO_MES, COMISION_GENERADA
            FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
            WHERE ANIO = ?
              AND MES IN (1, 2)
            ORDER BY MES
        `, [YEAR], false, false);

        // Check if table has any rows for Ene/Feb at all
        if (snapRows.length === 0) {
            console.log('  → Tabla COMMISSION_SNAPSHOT_2026_0102 sin filas para Ene/Feb 2026.');
            console.log('  → Verificar que la tabla existe y tiene datos.');
        } else {
            // Check specifically for vendor 05 (try both '05' and '5')
            const vendor05Rows = snapRows.filter(r => {
                const code = (r.VENDEDOR_CODIGO || '').trim();
                return code === VENDOR || code === VENDOR.replace(/^0+/, '');
            });

            console.log(`  Total filas en snapshot Ene/Feb: ${snapRows.length}`);
            console.log(`  Filas para vendedor ${VENDOR}: ${vendor05Rows.length}`);

            if (vendor05Rows.length === 0) {
                console.log(`\n  → CORRECTO: vendedor 05 NO aparece en COMMISSION_SNAPSHOT_2026_0102.`);
                console.log(`  → La API forzará comisión = 0 para Ene y Feb 2026.`);
                console.log(`  → La app no debe mostrar ninguna etiqueta interna.\n`);
                // Show a few other vendors found (to confirm table has real data)
                const others = [...new Set(snapRows.map(r => r.VENDEDOR_CODIGO))].slice(0, 5);
                console.log(`  Vendedores encontrados (muestra): ${others.join(', ')}`);
            } else {
                console.log('\n  Snapshot encontrado para vendedor 05:');
                vendor05Rows.forEach(r => {
                    const total = parseFloat(r.VENTAS_REAL || 0);
                    const obj = parseFloat(r.OBJETIVO_MES || 0);
                    const gen = parseFloat(r.COMISION_GENERADA || 0);
                    const pct = obj > 0 ? ((total / obj) * 100).toFixed(1) : 'N/A';
                    console.log(`\n  Mes ${r.MES}:`);
                    console.log(`    Ventas Real (total): ${total.toFixed(2)} €`);
                    console.log(`    Objetivo:            ${obj.toFixed(2)} €`);
                    console.log(`    Cumplimiento:        ${pct}%`);
                    console.log(`    Com. Generada:       ${gen.toFixed(2)} € ${gen === 0 ? '← CORRECTO' : '← Tiene comisión'}`);
                });
            }
        }
    } catch (e) {
        console.error('  ERROR:', e.message);
        console.log('  → Verificar que JAVIER.COMMISSION_SNAPSHOT_2026_0102 existe en DB.');
    }

    // ── 4. Pagos registrados ─────────────────────────────────────────────────
    console.log('\n── 4. Pagos registrados en COMMISSION_PAYMENTS ──');
    try {
        const payRows = await queryWithParams(`
            SELECT MES, IMPORTE_PAGADO, COMISION_GENERADA, VENTAS_REAL, OBSERVACIONES
            FROM JAVIER.COMMISSION_PAYMENTS
            WHERE (VENDEDOR_CODIGO = ? OR VENDEDOR_CODIGO = ?)
              AND ANIO = ?
              AND MES IN (1, 2)
            ORDER BY MES
        `, [VENDOR, VENDOR.replace(/^0+/, ''), YEAR], false, false);

        if (payRows.length === 0) {
            console.log('  → Sin pagos registrados para vendedor 05 en Ene/Feb 2026.');
            console.log('  → ESPERADO: comercial 05 no superó objetivo → no hubo pago.');
        } else {
            payRows.forEach(r => {
                console.log(`  Mes ${r.MES}: pagado=${parseFloat(r.IMPORTE_PAGADO).toFixed(2)}€, gen=${parseFloat(r.COMISION_GENERADA).toFixed(2)}€`);
            });
        }
    } catch (e) {
        console.error('  ERROR:', e.message);
    }

    // ── 5. Resumen: qué debería mostrar la app ───────────────────────────────
    console.log('\n── 5. RESUMEN ESPERADO (tabla COMMISSION_SNAPSHOT_2026_0102) ──');
    console.log('  Fuente de verdad: JAVIER.COMMISSION_SNAPSHOT_2026_0102');
    console.log('  Tabla existente con datos reales Ene/Feb 2026.');
    console.log('  NO se requiere migración — tabla ya tiene datos.');
    console.log('');
    console.log('  Lógica para vendedor 05:');
    console.log('    - La tabla NO contiene fila para vendedor 05 en Ene ni Feb.');
    console.log('    - monthsWithData tiene {1, 2} (otros vendedores sí están).');
    console.log('    - calculateVendorData → mantiene ventas/objetivo históricos y commValue = 0.');
    console.log('    - API devuelve: commission=0 para mes 1 y 2 sin etiqueta visible interna.');
    console.log('');
    console.log('  Deploy: git pull origin test && pm2 restart gmp-api');
    console.log('  NO ejecutar ninguna migración SQL.\n');

    process.exit(0);
}

run().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
