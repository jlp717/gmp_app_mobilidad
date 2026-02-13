/**
 * CLEANUP — Eliminar filas basura de DELIVERY_STATUS
 * 
 * Fila #13: ID='2026-P-80-271', FIRMA_PATH='base64_signature_mock' (prueba vieja, Rep 21)
 * Fila #14: ID es undefined/vacío, FIRMA_PATH='base64_signature_mock' (prueba rota)
 */

const { query } = require('../config/db');

async function cleanup() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  CLEANUP — Filas basura en DELIVERY_STATUS');
    console.log('═══════════════════════════════════════════════════\n');

    // 1. Show what we're about to delete
    const junk = await query(`
        SELECT ID, STATUS, FIRMA_PATH, REPARTIDOR_ID, UPDATED_AT 
        FROM JAVIER.DELIVERY_STATUS 
        WHERE FIRMA_PATH = 'base64_signature_mock'
    `, false);
    
    console.log(`  Filas con FIRMA_PATH='base64_signature_mock': ${junk.length}`);
    junk.forEach((r, i) => {
        console.log(`    [${i + 1}] ID="${r.ID}" | Rep=${r.REPARTIDOR_ID} | ${r.UPDATED_AT}`);
    });

    if (junk.length === 0) {
        console.log('\n  ✅ Nada que limpiar');
        process.exit(0);
    }

    // 2. Delete them
    const deleted = await query(`
        DELETE FROM JAVIER.DELIVERY_STATUS 
        WHERE FIRMA_PATH = 'base64_signature_mock'
    `, false, true);

    console.log(`\n  ✅ Eliminadas ${junk.length} filas basura`);

    // 3. Verify
    const remaining = await query(`SELECT COUNT(*) as CNT FROM JAVIER.DELIVERY_STATUS`, false);
    console.log(`  Total restante: ${remaining[0].CNT} filas limpias\n`);

    process.exit(0);
}

cleanup().catch(e => { console.error('Error:', e.message); process.exit(1); });
