/**
 * TEST: Guardado Persistente en RUTERO_CONFIG
 * Verifica que INSERT/UPDATE/DELETE persisten correctamente (auto-commit de DB2).
 */
const { getPool, initDb } = require('../config/db');

const VENDOR = 'TEST99';
const DAY = 'lunes';

async function main() {
    console.log('=== TEST: GUARDADO PERSISTENTE ===\n');
    await initDb();
    const pool = getPool();
    let passed = 0, failed = 0;

    // Cleanup first
    const conn1 = await pool.connect();
    await conn1.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await conn1.close();

    // Test 1: INSERT persists
    console.log('1. INSERT persistence...');
    const c1 = await pool.connect();
    await c1.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', 'CLI001', 10)`);
    await c1.close();

    // Read on a NEW connection
    const c2 = await pool.connect();
    const r1 = await c2.query(`SELECT * FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = 'CLI001'`);
    if (r1.length === 1 && r1[0].ORDEN === 10) {
        console.log('   OK - INSERT persisted on new connection');
        passed++;
    } else {
        console.log('   FAIL - INSERT not found on new connection', r1);
        failed++;
    }

    // Test 2: UPDATE persists
    console.log('2. UPDATE persistence...');
    await c2.query(`UPDATE JAVIER.RUTERO_CONFIG SET ORDEN = 99 WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = 'CLI001'`);
    await c2.close();

    const c3 = await pool.connect();
    const r2 = await c3.query(`SELECT ORDEN FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = 'CLI001'`);
    if (r2.length === 1 && r2[0].ORDEN === 99) {
        console.log('   OK - UPDATE persisted');
        passed++;
    } else {
        console.log('   FAIL - UPDATE not persisted', r2);
        failed++;
    }

    // Test 3: Multiple inserts + bulk read
    console.log('3. Bulk INSERT + read...');
    for (let i = 2; i <= 10; i++) {
        await c3.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', '${DAY}', 'CLI${String(i).padStart(3,'0')}', ${i * 10})`);
    }
    await c3.close();

    const c4 = await pool.connect();
    const r3 = await c4.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    if (r3[0].CNT === 10) {
        console.log('   OK - 10 rows persisted');
        passed++;
    } else {
        console.log(`   FAIL - Expected 10, got ${r3[0].CNT}`);
        failed++;
    }

    // Test 4: DELETE + verify
    console.log('4. DELETE persistence...');
    await c4.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = 'CLI005'`);
    await c4.close();

    const c5 = await pool.connect();
    const r4 = await c5.query(`SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    if (r4[0].CNT === 9) {
        console.log('   OK - DELETE persisted (9 remaining)');
        passed++;
    } else {
        console.log(`   FAIL - Expected 9, got ${r4[0].CNT}`);
        failed++;
    }

    // Test 5: Blocking entry (ORDEN = -1) persists
    console.log('5. Blocking entry (ORDEN=-1) persistence...');
    await c5.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('${VENDOR}', 'martes', 'CLI_BLOCK', -1)`);
    await c5.close();

    const c6 = await pool.connect();
    const r5 = await c6.query(`SELECT ORDEN FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}' AND TRIM(CLIENTE) = 'CLI_BLOCK'`);
    if (r5.length === 1 && r5[0].ORDEN === -1) {
        console.log('   OK - Blocking entry persisted');
        passed++;
    } else {
        console.log('   FAIL - Blocking entry not persisted', r5);
        failed++;
    }

    // Cleanup
    await c6.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${VENDOR}'`);
    await c6.close();

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
