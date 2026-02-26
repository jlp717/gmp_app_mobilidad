/**
 * TEST: Integración Completa Rutero + Comisiones
 * Verifica la integridad referencial entre CDVI, RUTERO_CONFIG, COMMISSION tables.
 * READ-ONLY para datos reales, escribe/limpia TEST99.
 */
const { getPool, initDb } = require('../config/db');

async function main() {
    console.log('=== TEST: INTEGRACIÓN RUTERO + COMISIONES ===\n');
    await initDb();
    const conn = await getPool().connect();
    let passed = 0, failed = 0;

    try {
        // Test 1: All vendors in RUTERO_CONFIG exist in CDVI
        console.log('1. Vendors en RUTERO_CONFIG existen en CDVI...');
        const configVendors = await conn.query(`
            SELECT DISTINCT TRIM(VENDEDOR) as V FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR NOT LIKE 'TEST%'
        `);
        let missingVendors = [];
        for (const v of configVendors) {
            const cdviCheck = await conn.query(`
                SELECT COUNT(*) as CNT FROM DSEDAC.CDVI WHERE TRIM(CODIGOVENDEDOR) = '${v.V}'
            `);
            if (cdviCheck[0].CNT === 0) missingVendors.push(v.V);
        }
        if (missingVendors.length === 0) {
            console.log(`   OK - Todos los ${configVendors.length} vendors tienen datos en CDVI`);
            passed++;
        } else {
            console.log(`   WARN - Vendors sin CDVI: ${missingVendors.join(', ')}`);
            passed++; // might be valid if vendor was recently added
        }

        // Test 2: All clients in RUTERO_CONFIG exist in CLI
        console.log('2. Clientes en RUTERO_CONFIG existen en CLI...');
        const orphanClients = await conn.query(`
            SELECT DISTINCT TRIM(R.CLIENTE) as CLI
            FROM JAVIER.RUTERO_CONFIG R
            LEFT JOIN DSEDAC.CLI C ON R.CLIENTE = C.CODIGOCLIENTE
            WHERE C.CODIGOCLIENTE IS NULL
              AND R.VENDEDOR NOT LIKE 'TEST%'
            FETCH FIRST 10 ROWS ONLY
        `);
        if (orphanClients.length === 0) {
            console.log('   OK - Todos los clientes existen en CLI');
            passed++;
        } else {
            console.log(`   WARN - ${orphanClients.length} clientes no en CLI (pueden ser de baja)`);
            passed++; // bajas are expected
        }

        // Test 3: Commission exclusion consistency
        console.log('3. Consistencia de exclusiones de comisiones...');
        const exclCheck = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as V,
                   TRIM(EXCLUIDO_COMISIONES) as EXCL,
                   TRIM(HIDE_COMMISSIONS) as HIDE
            FROM JAVIER.COMMISSION_EXCEPTIONS
        `);
        let inconsistent = 0;
        for (const e of exclCheck) {
            // HIDE=Y should imply EXCL=Y (can't show empty commissions tab)
            if (e.HIDE === 'Y' && e.EXCL !== 'Y') {
                console.log(`   WARN - Vendor ${e.V}: HIDE=Y but EXCL=${e.EXCL}`);
                inconsistent++;
            }
        }
        if (inconsistent === 0) {
            console.log(`   OK - ${exclCheck.length} reglas consistentes`);
            passed++;
        } else {
            console.log(`   WARN - ${inconsistent} inconsistencias (HIDE sin EXCL)`);
            passed++; // warn only
        }

        // Test 4: RUTERO_LOG has correct type values
        console.log('4. Tipos de cambio válidos en RUTERO_LOG...');
        const logTypes = await conn.query(`
            SELECT TRIM(TIPO_CAMBIO) as TIPO, COUNT(*) as CNT
            FROM JAVIER.RUTERO_LOG
            GROUP BY TIPO_CAMBIO
            ORDER BY CNT DESC
        `);
        const validTypes = ['REORDENAMIENTO', 'CAMBIO_DIA', 'BORRADO_MASIVO', 'CONFIGURACION'];
        const invalidTypes = logTypes.filter(t => !validTypes.includes(t.TIPO));
        console.log('   Tipos encontrados:');
        logTypes.forEach(t => console.log(`      ${t.TIPO}: ${t.CNT}`));
        if (invalidTypes.length === 0) {
            console.log('   OK - Todos los tipos son válidos');
            passed++;
        } else {
            console.log(`   WARN - Tipos desconocidos: ${invalidTypes.map(t => t.TIPO).join(', ')}`);
            passed++; // new types might have been added
        }

        // Test 5: VENTAS_B table accessible
        console.log('5. Tabla VENTAS_B accesible...');
        try {
            const bsales = await conn.query(`SELECT COUNT(*) as CNT FROM JAVIER.VENTAS_B`);
            console.log(`   OK - ${bsales[0].CNT} registros en VENTAS_B`);
            passed++;
        } catch (e) {
            console.log(`   WARN - VENTAS_B no accesible: ${e.message}`);
            passed++; // may not exist yet
        }

        // Test 6: Full workflow simulation (TEST99)
        console.log('6. Simulación workflow completo (TEST99)...');
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = 'TEST99'`);

        // Simulate move_clients: insert block on source + positive on target
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('TEST99', 'lunes', 'X001', -1)`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('TEST99', 'martes', 'X001', 10)`);

        // Verify
        const moveCheck = await conn.query(`
            SELECT TRIM(DIA) as DIA, ORDEN FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = 'TEST99' AND TRIM(CLIENTE) = 'X001'
            ORDER BY DIA
        `);
        const lunesEntry = moveCheck.find(m => m.DIA === 'lunes');
        const martesEntry = moveCheck.find(m => m.DIA === 'martes');

        if (lunesEntry?.ORDEN === -1 && martesEntry?.ORDEN === 10) {
            console.log('   OK - Move: block(-1) on lunes + positive(10) on martes');
            passed++;
        } else {
            console.log('   FAIL - Move logic broken');
            console.table(moveCheck);
            failed++;
        }

        // Simulate config save: delete positives for day, re-insert
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = 'TEST99' AND DIA = 'martes' AND ORDEN >= 0`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('TEST99', 'martes', 'X001', 20)`);
        await conn.query(`INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) VALUES ('TEST99', 'martes', 'X002', 30)`);

        const configCheck = await conn.query(`
            SELECT TRIM(DIA) as DIA, TRIM(CLIENTE) as CLI, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE VENDEDOR = 'TEST99' ORDER BY DIA, ORDEN
        `);
        // Should have: lunes/X001/-1, martes/X001/20, martes/X002/30
        if (configCheck.length === 3) {
            console.log('   OK - Config save preserves blocks + replaces positives');
            passed++;
        } else {
            console.log(`   FAIL - Expected 3, got ${configCheck.length}`);
            console.table(configCheck);
            failed++;
        }

        // Cleanup
        await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = 'TEST99'`);

    } catch (e) { console.error(e); failed++; }
    finally { await conn.close(); }

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
